import pool from '../../../db/pool';
import { normalizePhone } from '../gateway/whatsappGatewayClient';
import { HttpError } from '../../../utils';

interface PoolMember {
  session_slug: string;
  weight: number;
  priority: number;
  role: string;
  status: string;
  is_enabled: boolean;
  open_count: number;
}

export class SessionPoolService {
  /**
   * Pick a session for outbound messaging.
   * 1. Sticky: reuse open conversation session for (service, phone)
   * 2. Else weighted among ready + enabled pool members
   */
  static async pickSession(
    serviceKey: string,
    contactPhone?: string | null,
  ): Promise<{ sessionSlug: string; serviceId: number }> {
    const serviceRes = await pool.query<{ id: number; is_enabled: boolean }>(
      `SELECT id, is_enabled FROM wa_services WHERE key = $1`,
      [serviceKey],
    );
    if (!serviceRes.rowCount) {
      throw new HttpError(404, `خدمة واتساب غير موجودة: ${serviceKey}`);
    }
    const service = serviceRes.rows[0];
    if (!service.is_enabled) {
      throw new HttpError(400, `خدمة واتساب معطّلة: ${serviceKey}`);
    }

    const phone = contactPhone ? normalizePhone(contactPhone) : null;

    if (phone) {
      const sticky = await pool.query<{ session_slug: string }>(
        `SELECT session_slug FROM wa_conversations
         WHERE service_id = $1
           AND contact_phone = $2
           AND status IN ('bot', 'waiting_human', 'human')
         ORDER BY last_message_at DESC
         LIMIT 1`,
        [service.id, phone],
      );
      if (sticky.rowCount) {
        const slug = sticky.rows[0].session_slug;
        const stillReady = await pool.query(
          `SELECT 1 FROM wa_sessions s
           JOIN wa_service_sessions ps ON ps.session_slug = s.slug
           WHERE ps.service_id = $1 AND s.slug = $2
             AND ps.is_enabled = TRUE AND s.is_enabled = TRUE
             AND s.status = 'ready'`,
          [service.id, slug],
        );
        if (stillReady.rowCount) {
          return { sessionSlug: slug, serviceId: service.id };
        }
      }
    }

    const members = await pool.query<PoolMember>(
      `SELECT
         ps.session_slug,
         ps.weight,
         ps.priority,
         ps.role,
         s.status,
         (ps.is_enabled AND s.is_enabled) AS is_enabled,
         COALESCE(oc.open_count, 0)::int AS open_count
       FROM wa_service_sessions ps
       JOIN wa_sessions s ON s.slug = ps.session_slug
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS open_count
         FROM wa_conversations c
         WHERE c.session_slug = s.slug
           AND c.status IN ('bot', 'waiting_human', 'human')
       ) oc ON TRUE
       WHERE ps.service_id = $1
         AND ps.is_enabled = TRUE
         AND s.is_enabled = TRUE
         AND s.status = 'ready'
       ORDER BY ps.priority DESC, ps.weight DESC`,
      [service.id],
    );

    if (!members.rowCount) {
      throw new HttpError(
        503,
        `لا توجد جلسات واتساب جاهزة لخدمة ${serviceKey}. اربط أرقاماً وتأكد من حالة «متصلة».`,
      );
    }

    let best = members.rows[0];
    let bestScore = best.weight / (best.open_count + 1);

    for (const m of members.rows.slice(1)) {
      const score = m.weight / (m.open_count + 1);
      if (score > bestScore) {
        best = m;
        bestScore = score;
      }
    }

    return { sessionSlug: best.session_slug, serviceId: service.id };
  }

  /** Resolve which service owns a session slug (for inbound routing). */
  static async resolveServiceBySession(
    sessionSlug: string,
  ): Promise<{ id: number; key: string; is_enabled: boolean } | null> {
    const result = await pool.query<{ id: number; key: string; is_enabled: boolean }>(
      `SELECT sv.id, sv.key, sv.is_enabled
       FROM wa_service_sessions ps
       JOIN wa_services sv ON sv.id = ps.service_id
       WHERE ps.session_slug = $1 AND ps.is_enabled = TRUE
       ORDER BY ps.priority DESC, sv.is_enabled DESC, sv.id ASC
       LIMIT 1`,
      [sessionSlug],
    );
    return result.rows[0] ?? null;
  }
}
