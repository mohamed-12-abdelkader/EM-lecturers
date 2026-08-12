import pool from '../../../db/pool';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  reconnectSession,
  type GatewaySession,
  isWhatsAppConfigured,
} from '../gateway/whatsappGatewayClient';
import type { WaSessionRow } from '../automations/types';
import { HttpError } from '../../../utils';

export type MergedSession = GatewaySession & {
  label: string | null;
  is_enabled: boolean;
  max_messages_per_minute: number;
  last_ready_at: Date | null;
  last_error: string | null;
  local_id: number | null;
  teacher_id: number | null;
  teacher_name: string | null;
};

async function upsertLocalFromGateway(gw: GatewaySession): Promise<void> {
  const status = gw.status || 'pending';
  const phone = gw.phone_number ?? null;
  const readyAt = status === 'ready' ? new Date() : null;

  await pool.query(
    `INSERT INTO wa_sessions (slug, phone_number, status, last_ready_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (slug) DO UPDATE SET
       phone_number = COALESCE(EXCLUDED.phone_number, wa_sessions.phone_number),
       status = EXCLUDED.status,
       last_ready_at = CASE
         WHEN EXCLUDED.status = 'ready' THEN COALESCE(EXCLUDED.last_ready_at, NOW())
         ELSE wa_sessions.last_ready_at
       END,
       last_error = CASE WHEN EXCLUDED.status = 'ready' THEN NULL ELSE wa_sessions.last_error END,
       updated_at = NOW()`,
    [gw.id, phone, status, readyAt],
  );
}

export class WhatsAppSessionService {
  static async listMerged(): Promise<MergedSession[]> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured (WHATSAPP_API_KEY).');
    }

    const gatewaySessions = await listSessions();
    for (const gw of gatewaySessions) {
      await upsertLocalFromGateway(gw);
    }

    const local = await pool.query<
      WaSessionRow & { teacher_name: string | null }
    >(
      `SELECT s.*, u.name AS teacher_name
       FROM wa_sessions s
       LEFT JOIN users u ON u.id = s.teacher_id
       ORDER BY s.created_at DESC`,
    );
    const localBySlug = new Map(local.rows.map((r) => [r.slug, r]));
    const gwById = new Map(gatewaySessions.map((g) => [g.id, g]));

    const merged: MergedSession[] = [];

    for (const gw of gatewaySessions) {
      const loc = localBySlug.get(gw.id);
      merged.push({
        ...gw,
        label: loc?.label ?? null,
        is_enabled: loc?.is_enabled ?? true,
        max_messages_per_minute: loc?.max_messages_per_minute ?? 20,
        last_ready_at: loc?.last_ready_at ?? null,
        last_error: loc?.last_error ?? null,
        local_id: loc?.id ?? null,
        teacher_id: loc?.teacher_id ?? null,
        teacher_name: loc?.teacher_name ?? null,
      });
    }

    // Local-only rows (gateway offline / deleted remotely)
    for (const loc of local.rows) {
      if (!gwById.has(loc.slug)) {
        merged.push({
          id: loc.slug,
          status: loc.status,
          phone_number: loc.phone_number,
          qr: null,
          label: loc.label,
          is_enabled: loc.is_enabled,
          max_messages_per_minute: loc.max_messages_per_minute,
          last_ready_at: loc.last_ready_at,
          last_error: loc.last_error,
          local_id: loc.id,
          teacher_id: loc.teacher_id ?? null,
          teacher_name: loc.teacher_name ?? null,
        });
      }
    }

    return merged;
  }

  static async create(slug: string, label?: string): Promise<MergedSession> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured.');
    }
    const gw = await createSession(slug);
    await pool.query(
      `INSERT INTO wa_sessions (slug, label, phone_number, status, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (slug) DO UPDATE SET
         label = COALESCE(EXCLUDED.label, wa_sessions.label),
         phone_number = COALESCE(EXCLUDED.phone_number, wa_sessions.phone_number),
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [slug, label || null, gw.phone_number ?? null, gw.status || 'pending'],
    );
    const [merged] = (await this.listMerged()).filter((s) => s.id === slug);
    return (
      merged || {
        ...gw,
        label: label || null,
        is_enabled: true,
        max_messages_per_minute: 20,
        last_ready_at: null,
        last_error: null,
        local_id: null,
        teacher_id: null,
        teacher_name: null,
      }
    );
  }

  static async get(slug: string): Promise<MergedSession> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured.');
    }
    const gw = await getSession(slug);
    await upsertLocalFromGateway(gw);
    const local = await pool.query<WaSessionRow & { teacher_name: string | null }>(
      `SELECT s.*, u.name AS teacher_name
       FROM wa_sessions s
       LEFT JOIN users u ON u.id = s.teacher_id
       WHERE s.slug = $1`,
      [slug],
    );
    const loc = local.rows[0];
    return {
      ...gw,
      label: loc?.label ?? null,
      is_enabled: loc?.is_enabled ?? true,
      max_messages_per_minute: loc?.max_messages_per_minute ?? 20,
      last_ready_at: loc?.last_ready_at ?? null,
      last_error: loc?.last_error ?? null,
      local_id: loc?.id ?? null,
      teacher_id: loc?.teacher_id ?? null,
      teacher_name: loc?.teacher_name ?? null,
    };
  }

  static async reconnect(slug: string): Promise<MergedSession> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured.');
    }
    const gw = await reconnectSession(slug);
    await upsertLocalFromGateway(gw);
    return this.get(slug);
  }

  static async remove(slug: string): Promise<void> {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured.');
    }
    try {
      await deleteSession(slug);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status !== 404) throw err;
    }
    await pool.query(`DELETE FROM wa_service_sessions WHERE session_slug = $1`, [slug]);
    await pool.query(`DELETE FROM wa_sessions WHERE slug = $1`, [slug]);
  }

  static async patchLocal(
    slug: string,
    patch: { label?: string | null; is_enabled?: boolean; max_messages_per_minute?: number },
  ): Promise<WaSessionRow> {
    const result = await pool.query<WaSessionRow>(
      `UPDATE wa_sessions SET
         label = CASE WHEN $2::boolean THEN $3 ELSE label END,
         is_enabled = CASE WHEN $4::boolean THEN $5 ELSE is_enabled END,
         max_messages_per_minute = CASE WHEN $6::boolean THEN $7 ELSE max_messages_per_minute END,
         updated_at = NOW()
       WHERE slug = $1
       RETURNING *`,
      [
        slug,
        patch.label !== undefined,
        patch.label ?? null,
        patch.is_enabled !== undefined,
        patch.is_enabled ?? true,
        patch.max_messages_per_minute !== undefined,
        patch.max_messages_per_minute ?? 20,
      ],
    );
    if (!result.rowCount) throw new HttpError(404, 'الجلسة غير موجودة محلياً');
    return result.rows[0];
  }
}
