"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationPushQueue = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const webPush_1 = require("../config/webPush");
const utils_1 = require("../utils");
class NotificationPushQueue {
    static async enqueueForUser(userId, payload, notificationId) {
        const subs = await pool_1.default.query(`SELECT id FROM web_push_subscriptions WHERE user_id = $1 AND is_active = TRUE`, [userId]);
        if (!subs.rowCount)
            return 0;
        let enqueued = 0;
        for (const sub of subs.rows) {
            await pool_1.default.query(`INSERT INTO notification_push_queue (user_id, notification_id, subscription_id, payload, max_attempts)
         VALUES ($1, $2, $3, $4::jsonb, $5)`, [userId, notificationId || null, sub.id, JSON.stringify(payload), webPush_1.webPushConfig.maxAttempts]);
            enqueued++;
        }
        return enqueued;
    }
    static async enqueueForUsers(userIds, payload, notificationIdByUser) {
        if (userIds.length === 0)
            return 0;
        const uniqueIds = [...new Set(userIds)];
        let total = 0;
        for (const userId of uniqueIds) {
            total += await this.enqueueForUser(userId, payload, notificationIdByUser?.get(userId));
        }
        return total;
    }
    static async claimBatch(limit) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query(`SELECT q.id, q.user_id, q.notification_id, q.subscription_id, q.payload, q.status,
                q.attempts, q.max_attempts, q.last_error, q.scheduled_at
         FROM notification_push_queue q
         WHERE q.status IN ('pending', 'failed')
           AND q.scheduled_at <= NOW()
           AND q.attempts < q.max_attempts
         ORDER BY q.scheduled_at ASC, q.id ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`, [limit]);
            if (!result.rowCount) {
                await client.query('COMMIT');
                return [];
            }
            const ids = result.rows.map((r) => r.id);
            await client.query(`UPDATE notification_push_queue SET status = 'processing', attempts = attempts + 1 WHERE id = ANY($1::int[])`, [ids]);
            await client.query('COMMIT');
            return result.rows.map((row) => ({
                ...row,
                payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
            }));
        }
        catch (err) {
            await client.query('ROLLBACK');
            utils_1.logger.error({ err }, 'Failed to claim notification push queue batch');
            throw err;
        }
        finally {
            client.release();
        }
    }
    static async markSent(queueId) {
        await pool_1.default.query(`UPDATE notification_push_queue SET status = 'sent', processed_at = NOW(), last_error = NULL WHERE id = $1`, [queueId]);
    }
    static async markFailed(queueId, errorMessage, retry, attempts = 1) {
        if (retry) {
            const backoffSeconds = Math.min(3600, 30 * Math.pow(2, Math.max(0, attempts - 1)));
            await pool_1.default.query(`UPDATE notification_push_queue
         SET status = 'failed',
             last_error = $2,
             scheduled_at = NOW() + ($3 || ' seconds')::interval
         WHERE id = $1`, [queueId, errorMessage.slice(0, 2000), String(backoffSeconds)]);
        }
        else {
            await pool_1.default.query(`UPDATE notification_push_queue SET status = 'dead', processed_at = NOW(), last_error = $2 WHERE id = $1`, [queueId, errorMessage.slice(0, 2000)]);
        }
    }
    static async logDelivery(params) {
        await pool_1.default.query(`INSERT INTO notification_push_delivery_logs
         (queue_id, user_id, subscription_id, notification_id, status, response_code, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
            params.queueId || null,
            params.userId,
            params.subscriptionId || null,
            params.notificationId || null,
            params.status,
            params.responseCode || null,
            params.errorMessage?.slice(0, 2000) || null,
        ]);
    }
}
exports.NotificationPushQueue = NotificationPushQueue;
