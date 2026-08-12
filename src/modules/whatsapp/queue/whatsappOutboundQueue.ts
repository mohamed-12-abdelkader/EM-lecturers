import pool from '../../../db/pool';
import { whatsappConfig } from '../config/whatsapp';
import { normalizePhone } from '../gateway/whatsappGatewayClient';
import { logger } from '../../../utils';

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
      const result = await client.query<OutboundJobRow>(
        `SELECT id, service_id, session_slug, to_phone, body, media_url, tenant_id,
                conversation_id, trigger_type, trigger_ref, metadata, status,
                attempts, max_attempts, last_error, scheduled_at
         FROM wa_outbound_jobs
         WHERE status IN ('pending', 'failed')
           AND scheduled_at <= NOW()
           AND attempts < max_attempts
         ORDER BY scheduled_at ASC, id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [limit],
      );

      if (!result.rowCount) {
        await client.query('COMMIT');
        return [];
      }

      const ids = result.rows.map((r) => r.id);
      await client.query(
        `UPDATE wa_outbound_jobs
         SET status = 'processing', attempts = attempts + 1
         WHERE id = ANY($1::int[])`,
        [ids],
      );
      await client.query('COMMIT');

      return result.rows.map((row) => ({
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
