import pool from '../../../db/pool';
import type { WaConversationStatus, WaServiceRow } from '../automations/types';
import { HttpError } from '../../../utils';

function parseJson(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

const CONVERSATION_STATUSES: WaConversationStatus[] = [
  'bot',
  'waiting_human',
  'human',
  'closed',
];

export type AdminInboxMessage = {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  at: Date;
  status: string;
  trigger_type?: string | null;
  has_media?: boolean;
  media_note?: string | null;
};

function inboundDisplay(body: string | null, metadata: Record<string, unknown>) {
  let text = (body || '').trim();
  let hasMedia = false;
  let mediaNote: string | null = null;

  if (metadata.image_description && typeof metadata.image_description === 'string') {
    hasMedia = true;
    mediaNote = `وصف صورة: ${metadata.image_description}`;
    text = text ? `${text}\n[${mediaNote}]` : `[${mediaNote}]`;
  } else if (metadata.has_media) {
    hasMedia = true;
    mediaNote = 'أرسل الطالب صورة/مرفقاً';
    text = text || `[${mediaNote}]`;
  }
  if (metadata.media_error) {
    const errNote = `تعذر قراءة المرفق: ${metadata.media_error}`;
    mediaNote = mediaNote ? `${mediaNote} — ${errNote}` : errNote;
    text = `${text}\n[${errNote}]`.trim();
  }

  return { text, hasMedia, mediaNote };
}

export interface ServiceListItem extends WaServiceRow {
  session_count: number;
  ready_session_count: number;
}

export interface PoolMemberInput {
  session_slug: string;
  weight?: number;
  priority?: number;
  role?: 'primary' | 'fallback';
  is_enabled?: boolean;
}

export class WhatsAppServiceAdmin {
  static async list(): Promise<ServiceListItem[]> {
    const result = await pool.query<ServiceListItem>(
      `SELECT
         sv.*,
         COALESCE(sc.cnt, 0)::int AS session_count,
         COALESCE(sc.ready_cnt, 0)::int AS ready_session_count
       FROM wa_services sv
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS cnt,
           COUNT(*) FILTER (WHERE s.status = 'ready' AND s.is_enabled AND ps.is_enabled)::int AS ready_cnt
         FROM wa_service_sessions ps
         JOIN wa_sessions s ON s.slug = ps.session_slug
         WHERE ps.service_id = sv.id
       ) sc ON TRUE
       ORDER BY sv.id ASC`,
    );
    return result.rows.map((r) => ({ ...r, config: parseJson(r.config) }));
  }

  static async getById(id: number): Promise<{
    service: ServiceListItem;
    sessions: Array<{
      session_slug: string;
      weight: number;
      priority: number;
      role: string;
      is_enabled: boolean;
      status: string;
      phone_number: string | null;
      label: string | null;
    }>;
  }> {
    const svc = await pool.query<ServiceListItem>(
      `SELECT
         sv.*,
         COALESCE(sc.cnt, 0)::int AS session_count,
         COALESCE(sc.ready_cnt, 0)::int AS ready_session_count
       FROM wa_services sv
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS cnt,
           COUNT(*) FILTER (WHERE s.status = 'ready' AND s.is_enabled AND ps.is_enabled)::int AS ready_cnt
         FROM wa_service_sessions ps
         JOIN wa_sessions s ON s.slug = ps.session_slug
         WHERE ps.service_id = sv.id
       ) sc ON TRUE
       WHERE sv.id = $1`,
      [id],
    );
    if (!svc.rowCount) throw new HttpError(404, 'الخدمة غير موجودة');

    const sessions = await pool.query(
      `SELECT
         ps.session_slug, ps.weight, ps.priority, ps.role, ps.is_enabled,
         s.status, s.phone_number, s.label
       FROM wa_service_sessions ps
       JOIN wa_sessions s ON s.slug = ps.session_slug
       WHERE ps.service_id = $1
       ORDER BY ps.priority DESC, ps.weight DESC, ps.session_slug ASC`,
      [id],
    );

    return {
      service: { ...svc.rows[0], config: parseJson(svc.rows[0].config) },
      sessions: sessions.rows,
    };
  }

  static async patch(
    id: number,
    patch: {
      name?: string;
      description?: string | null;
      is_enabled?: boolean;
      config?: Record<string, unknown>;
    },
  ): Promise<WaServiceRow> {
    const result = await pool.query<WaServiceRow>(
      `UPDATE wa_services SET
         name = CASE WHEN $2::boolean THEN $3 ELSE name END,
         description = CASE WHEN $4::boolean THEN $5 ELSE description END,
         is_enabled = CASE WHEN $6::boolean THEN $7 ELSE is_enabled END,
         config = CASE WHEN $8::boolean THEN $9::jsonb ELSE config END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.name !== undefined,
        patch.name ?? '',
        patch.description !== undefined,
        patch.description ?? null,
        patch.is_enabled !== undefined,
        patch.is_enabled ?? false,
        patch.config !== undefined,
        JSON.stringify(patch.config ?? {}),
      ],
    );
    if (!result.rowCount) throw new HttpError(404, 'الخدمة غير موجودة');
    return { ...result.rows[0], config: parseJson(result.rows[0].config) };
  }

  static async replacePool(serviceId: number, members: PoolMemberInput[]): Promise<void> {
    const exists = await pool.query(`SELECT id FROM wa_services WHERE id = $1`, [serviceId]);
    if (!exists.rowCount) throw new HttpError(404, 'الخدمة غير موجودة');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM wa_service_sessions WHERE service_id = $1`, [serviceId]);

      for (const m of members) {
        const slug = String(m.session_slug || '').trim();
        if (!slug) continue;
        const sessionExists = await client.query(`SELECT 1 FROM wa_sessions WHERE slug = $1`, [
          slug,
        ]);
        if (!sessionExists.rowCount) {
          throw new HttpError(400, `الجلسة غير موجودة: ${slug}`);
        }
        await client.query(
          `INSERT INTO wa_service_sessions
             (service_id, session_slug, weight, priority, role, is_enabled)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            serviceId,
            slug,
            Math.max(1, Number(m.weight) || 1),
            Number(m.priority) || 0,
            m.role === 'fallback' ? 'fallback' : 'primary',
            m.is_enabled !== false,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async listConversations(params: {
    limit?: number;
    offset?: number;
    serviceId?: number;
    search?: string;
    status?: string;
  }): Promise<{ conversations: unknown[]; total: number }> {
    const limit = Math.min(200, Math.max(1, Number(params.limit) || 50));
    const offset = Math.max(0, Number(params.offset) || 0);
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (params.serviceId) {
      conditions.push(`c.service_id = $${i++}`);
      values.push(params.serviceId);
    }
    if (params.status) {
      conditions.push(`c.status = $${i++}`);
      values.push(params.status);
    }
    if (params.search?.trim()) {
      conditions.push(`c.contact_phone ILIKE $${i++}`);
      values.push(`%${params.search.trim().replace(/\D/g, '')}%`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM wa_conversations c ${where}`,
      values,
    );

    const listRes = await pool.query(
      `SELECT c.*, sv.key AS service_key, sv.name AS service_name
       FROM wa_conversations c
       LEFT JOIN wa_services sv ON sv.id = c.service_id
       ${where}
       ORDER BY c.last_message_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...values, limit, offset],
    );

    return {
      conversations: listRes.rows.map((r) => ({
        ...r,
        metadata: parseJson(r.metadata),
      })),
      total: Number(countRes.rows[0]?.total || 0),
    };
  }

  static async getConversation(id: number) {
    const result = await pool.query(
      `SELECT c.*, sv.key AS service_key, sv.name AS service_name
       FROM wa_conversations c
       LEFT JOIN wa_services sv ON sv.id = c.service_id
       WHERE c.id = $1`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'المحادثة غير موجودة');
    const row = result.rows[0];
    return { ...row, metadata: parseJson(row.metadata) };
  }

  static async listMessages(
    conversationId: number,
    params?: { limit?: number },
  ): Promise<{ messages: AdminInboxMessage[]; conversation_id: number }> {
    const exists = await pool.query(`SELECT id FROM wa_conversations WHERE id = $1`, [
      conversationId,
    ]);
    if (!exists.rowCount) throw new HttpError(404, 'المحادثة غير موجودة');

    const limit = Math.min(200, Math.max(1, Number(params?.limit) || 100));

    const inbound = await pool.query<{
      id: number;
      body: string | null;
      processed_at: Date;
      metadata: unknown;
    }>(
      `SELECT id, body, processed_at, metadata
       FROM wa_inbound_events
       WHERE conversation_id = $1
       ORDER BY processed_at ASC`,
      [conversationId],
    );

    const outbound = await pool.query<{
      id: number;
      body: string;
      created_at: Date;
      status: string;
      trigger_type: string | null;
    }>(
      `SELECT id, body, created_at, status, trigger_type
       FROM wa_outbound_jobs
       WHERE conversation_id = $1
         AND status IN ('pending', 'processing', 'sent', 'failed', 'dead')
       ORDER BY created_at ASC`,
      [conversationId],
    );

    const merged: AdminInboxMessage[] = [];

    for (const row of inbound.rows) {
      const meta = parseJson(row.metadata);
      const { text, hasMedia, mediaNote } = inboundDisplay(row.body, meta);
      if (!text) continue;
      merged.push({
        id: `in-${row.id}`,
        direction: 'inbound',
        body: text,
        at: row.processed_at,
        status: 'received',
        has_media: hasMedia,
        media_note: mediaNote,
      });
    }

    for (const row of outbound.rows) {
      const text = (row.body || '').trim();
      if (!text) continue;
      merged.push({
        id: `out-${row.id}`,
        direction: 'outbound',
        body: text,
        at: row.created_at,
        status: row.status,
        trigger_type: row.trigger_type,
      });
    }

    merged.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
    const messages = merged.length > limit ? merged.slice(merged.length - limit) : merged;

    return { conversation_id: conversationId, messages };
  }

  static async updateConversationStatus(id: number, status: WaConversationStatus) {
    if (!CONVERSATION_STATUSES.includes(status)) {
      throw new HttpError(400, 'حالة المحادثة غير صحيحة');
    }

    const result = await pool.query(
      `UPDATE wa_conversations SET
         status = $2,
         assigned_at = CASE WHEN $2 = 'human' THEN NOW() ELSE assigned_at END,
         updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    if (!result.rowCount) throw new HttpError(404, 'المحادثة غير موجودة');

    const detail = await this.getConversation(id);
    return detail;
  }

  static async markConversationHumanAndTouch(id: number): Promise<void> {
    const muteResult = await pool.query<{ mute_minutes: string | null }>(
      `SELECT COALESCE(
         NULLIF(s.config->>'human_mute_minutes', '')::int,
         60
       )::text AS mute_minutes
       FROM wa_conversations c
       LEFT JOIN wa_services s ON s.id = c.service_id
       WHERE c.id = $1`,
      [id],
    );
    const muteMinutes = Math.max(
      1,
      Number(muteResult.rows[0]?.mute_minutes || 60) || 60,
    );
    const humanMuteUntil = new Date(Date.now() + muteMinutes * 60_000).toISOString();

    await pool.query(
      `UPDATE wa_conversations SET
         status = CASE
           WHEN status IN ('bot', 'waiting_human') THEN 'human'
           ELSE status
         END,
         assigned_at = CASE
           WHEN status IN ('bot', 'waiting_human') THEN NOW()
           ELSE assigned_at
         END,
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         last_message_at = NOW(),
         updated_at = NOW()
       WHERE id = $1`,
      [id, JSON.stringify({ human_mute_until: humanMuteUntil })],
    );
  }
}
