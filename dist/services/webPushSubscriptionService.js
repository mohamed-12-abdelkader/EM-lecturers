"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebPushSubscriptionService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
function parseBrowserFromUserAgent(userAgent) {
    if (!userAgent)
        return null;
    if (/Edg\//i.test(userAgent))
        return 'Edge';
    if (/Chrome/i.test(userAgent) && !/Chromium/i.test(userAgent))
        return 'Chrome';
    if (/Firefox/i.test(userAgent))
        return 'Firefox';
    if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent))
        return 'Safari';
    if (/Opera|OPR/i.test(userAgent))
        return 'Opera';
    return 'Unknown';
}
class WebPushSubscriptionService {
    static async subscribe(userId, input) {
        const browser = input.browser || parseBrowserFromUserAgent(input.user_agent);
        const result = await pool_1.default.query(`INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, browser, device_label, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth_key = EXCLUDED.auth_key,
         user_agent = EXCLUDED.user_agent,
         browser = EXCLUDED.browser,
         device_label = COALESCE(EXCLUDED.device_label, web_push_subscriptions.device_label),
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`, [
            userId,
            input.endpoint,
            input.p256dh,
            input.auth_key,
            input.user_agent || null,
            browser,
            input.device_label || null,
        ]);
        return result.rows[0];
    }
    static async updateSubscription(userId, subscriptionId, input) {
        const fields = [];
        const values = [userId, subscriptionId];
        let idx = 3;
        if (input.endpoint !== undefined) {
            fields.push(`endpoint = $${idx++}`);
            values.push(input.endpoint);
        }
        if (input.p256dh !== undefined) {
            fields.push(`p256dh = $${idx++}`);
            values.push(input.p256dh);
        }
        if (input.auth_key !== undefined) {
            fields.push(`auth_key = $${idx++}`);
            values.push(input.auth_key);
        }
        if (input.user_agent !== undefined) {
            fields.push(`user_agent = $${idx++}`);
            values.push(input.user_agent);
            fields.push(`browser = $${idx++}`);
            values.push(input.browser || parseBrowserFromUserAgent(input.user_agent));
        }
        else if (input.browser !== undefined) {
            fields.push(`browser = $${idx++}`);
            values.push(input.browser);
        }
        if (input.device_label !== undefined) {
            fields.push(`device_label = $${idx++}`);
            values.push(input.device_label);
        }
        if (fields.length === 0) {
            const existing = await pool_1.default.query(`SELECT * FROM web_push_subscriptions WHERE id = $1 AND user_id = $2 AND is_active = TRUE`, [subscriptionId, userId]);
            return existing.rows[0] || null;
        }
        fields.push('updated_at = NOW()');
        const result = await pool_1.default.query(`UPDATE web_push_subscriptions SET ${fields.join(', ')}
       WHERE id = $2 AND user_id = $1 AND is_active = TRUE
       RETURNING *`, values);
        return result.rows[0] || null;
    }
    static async deleteSubscription(userId, subscriptionId) {
        const result = await pool_1.default.query(`UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE`, [subscriptionId, userId]);
        return (result.rowCount || 0) > 0;
    }
    static async deleteByEndpoint(userId, endpoint) {
        const result = await pool_1.default.query(`UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND endpoint = $2 AND is_active = TRUE`, [userId, endpoint]);
        return (result.rowCount || 0) > 0;
    }
    static async listUserSubscriptions(userId) {
        const result = await pool_1.default.query(`SELECT id, user_id, endpoint, p256dh, auth_key, user_agent, browser, device_label, is_active, created_at, updated_at
       FROM web_push_subscriptions
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`, [userId]);
        return result.rows;
    }
    static async getActiveSubscriptionsForUser(userId) {
        const result = await pool_1.default.query(`SELECT * FROM web_push_subscriptions WHERE user_id = $1 AND is_active = TRUE`, [userId]);
        return result.rows;
    }
    static async deactivateSubscription(subscriptionId) {
        await pool_1.default.query(`UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [subscriptionId]);
    }
}
exports.WebPushSubscriptionService = WebPushSubscriptionService;
