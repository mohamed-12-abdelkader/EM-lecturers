import pool from '../db/pool';
import { webPushConfig } from '../config/webPush';
import { logger } from '../utils';

export interface QueuedPushPayload {
  title: string;
  body: string;
  icon?: string;
  image?: string;
  url?: string;
  type: string;
  notification_id?: number;
  data?: Record<string, unknown>;
}

export interface QueueJobRow {
  id: number;
  user_id: number;
  notification_id: number | null;
  subscription_id: number;
  payload: QueuedPushPayload;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  scheduled_at: Date;
}

export class NotificationPushQueue {
  static async enqueueForUser(
    userId: number,
    payload: QueuedPushPayload,
    notificationId?: number,
  ): Promise<number> {
    const subs = await pool.query<{ id: number }>(
      `SELECT id FROM web_push_subscriptions WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    if (!subs.rowCount) return 0;

    let enqueued = 0;
    for (const sub of subs.rows) {
      await pool.query(
        `INSERT INTO notification_push_queue (user_id, notification_id, subscription_id, payload, max_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [userId, notificationId || null, sub.id, JSON.stringify(payload), webPushConfig.maxAttempts],
      );
      enqueued++;
    }
    return enqueued;
  }

  static async enqueueForUsers(
    userIds: number[],
    payload: QueuedPushPayload,
    notificationIdByUser?: Map<number, number>,
  ): Promise<number> {
    if (userIds.length === 0) return 0;
    const uniqueIds = [...new Set(userIds)];
    let total = 0;
    for (const userId of uniqueIds) {
      total += await this.enqueueForUser(userId, payload, notificationIdByUser?.get(userId));
    }
    return total;
  }

  static async claimBatch(limit: number): Promise<QueueJobRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<QueueJobRow>(
        `SELECT q.id, q.user_id, q.notification_id, q.subscription_id, q.payload, q.status,
                q.attempts, q.max_attempts, q.last_error, q.scheduled_at
         FROM notification_push_queue q
         WHERE q.status IN ('pending', 'failed')
           AND q.scheduled_at <= NOW()
           AND q.attempts < q.max_attempts
         ORDER BY q.scheduled_at ASC, q.id ASC
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
        `UPDATE notification_push_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ANY($1::int[])`,
        [ids],
      );
      await client.query('COMMIT');

      return result.rows.map((row) => ({
        ...row,
        payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      }));
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error({ err }, 'Failed to claim notification push queue batch');
      throw err;
    } finally {
      client.release();
    }
  }

  static async markSent(queueId: number): Promise<void> {
    await pool.query(
      `UPDATE notification_push_queue SET status = 'sent', processed_at = NOW(), last_error = NULL WHERE id = $1`,
      [queueId],
    );
  }

  static async markFailed(
    queueId: number,
    errorMessage: string,
    retry: boolean,
    attempts = 1,
  ): Promise<void> {
    if (retry) {
      const backoffSeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
      await pool.query(
        `UPDATE notification_push_queue
         SET status = 'failed',
             last_error = $2,
             scheduled_at = NOW() + ($3 || ' seconds')::interval
         WHERE id = $1`,
        [queueId, errorMessage.slice(0, 2000), String(backoffSeconds)],
      );
    } else {
      await pool.query(
        `UPDATE notification_push_queue SET status = 'dead', processed_at = NOW(), last_error = $2 WHERE id = $1`,
        [queueId, errorMessage.slice(0, 2000)],
      );
    }
  }

  static async logDelivery(params: {
    queueId?: number;
    userId: number;
    subscriptionId?: number;
    notificationId?: number;
    status: 'sent' | 'failed' | 'expired_subscription';
    responseCode?: number;
    errorMessage?: string;
  }): Promise<void> {
    await pool.query(
      `INSERT INTO notification_push_delivery_logs
         (queue_id, user_id, subscription_id, notification_id, status, response_code, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        params.queueId || null,
        params.userId,
        params.subscriptionId || null,
        params.notificationId || null,
        params.status,
        params.responseCode || null,
        params.errorMessage?.slice(0, 2000) || null,
      ],
    );
  }
}
