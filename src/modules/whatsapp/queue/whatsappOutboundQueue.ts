import pool from '../../../db/pool';
import { whatsappConfig } from '../config/whatsapp';
import { normalizePhone } from '../gateway/whatsappGatewayClient';
import { logger } from '../../../utils';
import {
  PARENT_EXAM_NO_SESSION,
  PARENTS_EXAM_NOTIFY_KEY,
} from '../automations/parentsExamNotify/constants';
import { selectOutboundClaim } from './selectOutboundClaim';

export interface OutboundJobRow {
  id: number;
  service_id: number | null;
  session_slug: string;
  to_phone: string;
  body: string;
  media_url: string | null;
  tenant_id: number | null;
  conversation_id: number | null;
  trigger_type: string | null;
  trigger_ref: string | null;
  metadata: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: Date;
}

export interface EnqueueOutboundParams {
  sessionSlug: string;
  to: string;
  body: string;
  serviceId?: number | null;
  tenantId?: number | null;
  conversationId?: number | null;
  triggerType?: string | null;
  triggerRef?: string | null;
  metadata?: Record<string, unknown>;
  mediaUrl?: string | null;
  scheduledAt?: Date;
}

export class WhatsAppOutboundQueue {
  static async enqueue(params: EnqueueOutboundParams): Promise<number> {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO wa_outbound_jobs
         (service_id, session_slug, to_phone, body, media_url, tenant_id, conversation_id,
          trigger_type, trigger_ref, metadata, max_attempts, scheduled_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
       RETURNING id`,
      [
        params.serviceId ?? null,
        params.sessionSlug,
        normalizePhone(params.to),
        params.body,
        params.mediaUrl ?? null,
        params.tenantId ?? null,
        params.conversationId ?? null,
        params.triggerType ?? null,
        params.triggerRef ?? null,
        JSON.stringify(params.metadata ?? {}),
        whatsappConfig.maxAttempts,
        params.scheduledAt ?? new Date(),
      ],
    );
    return result.rows[0].id;
  }

  static async claimBatch(limit: number): Promise<OutboundJobRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const jobSql = `SELECT j.id, j.service_id, j.session_slug, j.to_phone, j.body, j.media_url, j.tenant_id,
                j.conversation_id, j.trigger_type, j.trigger_ref, j.metadata, j.status,
                j.attempts, j.max_attempts, j.last_error, j.scheduled_at,
                CASE WHEN j.trigger_type LIKE 'parents_exam_%' THEN '${PARENTS_EXAM_NOTIFY_KEY}' ELSE s.key END AS service_key
         FROM wa_outbound_jobs j
         LEFT JOIN wa_services s ON s.id = j.service_id`;
      const due = `j.status IN ('pending', 'failed')
           AND j.scheduled_at <= NOW()
           AND j.attempts < j.max_attempts`;
      const nonPaced = await client.query<OutboundJobRow & { service_key: string | null }>(
        `${jobSql}
         WHERE ${due}
           AND (j.trigger_type IS NULL OR j.trigger_type NOT LIKE 'parents_exam_%')
         ORDER BY j.scheduled_at ASC, j.id ASC
         LIMIT $1
         FOR UPDATE OF j SKIP LOCKED`,
        [limit],
      );
      const paced = await client.query<OutboundJobRow & { service_key: string | null }>(
        `${jobSql}
         WHERE ${due}
           AND j.trigger_type LIKE 'parents_exam_%'
           AND (
             COALESCE(j.metadata->>'immediate', '') = 'true'
             OR NOT EXISTS (
               SELECT 1
               FROM wa_outbound_jobs prev
               WHERE prev.session_slug = j.session_slug
                 AND prev.trigger_type LIKE 'parents_exam_%'
                 AND (
                   prev.status = 'processing'
                   OR (
                     prev.status = 'sent'
                     AND prev.processed_at > NOW() - make_interval(
                       secs => GREATEST(15, LEAST(300, COALESCE(
                         (SELECT (config->>'interval_seconds')::int FROM wa_services WHERE key = 'parents_exam_notify'),
                         30
                       )))
                     )
                   )
                 )
             )
           )
           AND NOT EXISTS (
             SELECT 1 FROM wa_parent_exam_notifications n
             JOIN wa_parent_exam_settings st ON st.exam_id = n.exam_id AND st.paused = TRUE
             WHERE n.job_id = j.id
           )
         ORDER BY j.scheduled_at ASC, j.id ASC
         LIMIT 500
         FOR UPDATE OF j SKIP LOCKED`,
      );

      const picked = selectOutboundClaim(
        [...nonPaced.rows, ...paced.rows].map((row) => ({
          ...row,
          sessionSlug: row.session_slug,
          serviceKey: row.service_key,
          scheduledAt: new Date(row.scheduled_at).getTime(),
        })),
        { batchSize: limit, pacedServiceKey: PARENTS_EXAM_NOTIFY_KEY },
      );

      if (!picked.length) {
        await client.query('COMMIT');
        return [];
      }

      const ids = picked.map((r) => r.id);
      await client.query(
        `UPDATE wa_outbound_jobs
         SET status = 'processing', attempts = attempts + 1
         WHERE id = ANY($1::int[])`,
        [ids],
      );
      await client.query('COMMIT');

      return picked.map((row) => ({
        ...row,
        metadata:
          typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, 'Failed to claim WhatsApp outbound queue batch');
      throw err;
    } finally {
      client.release();
    }
  }

  static async markSent(jobId: number): Promise<void> {
    await pool.query(
      `UPDATE wa_outbound_jobs
       SET status = 'sent', processed_at = NOW(), last_error = NULL
       WHERE id = $1`,
      [jobId],
    );
    await pool.query(
      `UPDATE wa_parent_exam_notifications
       SET status = 'sent'
       WHERE job_id = $1 AND status = 'scheduled'`,
      [jobId],
    );
  }

  /** Teacher has no ready number. Keep the job and do not spend an attempt. */
  static async parkUntilSession(jobId: number): Promise<void> {
    await pool.query(
      `UPDATE wa_outbound_jobs
       SET status = 'pending',
           attempts = GREATEST(attempts - 1, 0),
           scheduled_at = NOW() + INTERVAL '3 minutes',
           last_error = $2
       WHERE id = $1`,
      [jobId, PARENT_EXAM_NO_SESSION],
    );
  }

  static async markFailed(jobId: number, errorMessage: string, retry: boolean, attempts = 1): Promise<void> {
    if (retry) {
      const backoffSeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
      await pool.query(
        `UPDATE wa_outbound_jobs
         SET status = 'failed',
             last_error = $2,
             scheduled_at = NOW() + ($3 || ' seconds')::interval
         WHERE id = $1`,
        [jobId, errorMessage.slice(0, 2000), String(backoffSeconds)],
      );
    } else {
      await pool.query(
        `UPDATE wa_outbound_jobs
         SET status = 'dead', processed_at = NOW(), last_error = $2
         WHERE id = $1`,
        [jobId, errorMessage.slice(0, 2000)],
      );
    }
  }

  static async getStats(): Promise<{
    pending: number;
    processing: number;
    failed: number;
    dead: number;
    sent_today: number;
  }> {
    const result = await pool.query<{
      pending: string;
      processing: string;
      failed: string;
      dead: string;
      sent_today: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::text AS pending,
         COUNT(*) FILTER (WHERE status = 'processing')::text AS processing,
         COUNT(*) FILTER (WHERE status = 'failed')::text AS failed,
         COUNT(*) FILTER (WHERE status = 'dead')::text AS dead,
         COUNT(*) FILTER (
           WHERE status = 'sent' AND processed_at >= date_trunc('day', NOW())
         )::text AS sent_today
       FROM wa_outbound_jobs`,
    );
    const row = result.rows[0];
    return {
      pending: Number(row?.pending || 0),
      processing: Number(row?.processing || 0),
      failed: Number(row?.failed || 0),
      dead: Number(row?.dead || 0),
      sent_today: Number(row?.sent_today || 0),
    };
  }
}
