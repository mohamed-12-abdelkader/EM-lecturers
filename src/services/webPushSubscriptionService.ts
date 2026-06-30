import pool from '../db/pool';

export interface PushSubscriptionInput {
  endpoint: string;
  p256dh: string;
  auth_key: string;
  user_agent?: string;
  browser?: string;
  device_label?: string;
}

export interface WebPushSubscriptionRow {
  id: number;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  user_agent: string | null;
  browser: string | null;
  device_label: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

function parseBrowserFromUserAgent(userAgent?: string): string | null {
  if (!userAgent) return null;
  if (/Edg\//i.test(userAgent)) return 'Edge';
  if (/Chrome/i.test(userAgent) && !/Chromium/i.test(userAgent)) return 'Chrome';
  if (/Firefox/i.test(userAgent)) return 'Firefox';
  if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) return 'Safari';
  if (/Opera|OPR/i.test(userAgent)) return 'Opera';
  return 'Unknown';
}

export class WebPushSubscriptionService {
  static async subscribe(userId: number, input: PushSubscriptionInput): Promise<WebPushSubscriptionRow> {
    const browser = input.browser || parseBrowserFromUserAgent(input.user_agent);
    const result = await pool.query<WebPushSubscriptionRow>(
      `INSERT INTO web_push_subscriptions (user_id, endpoint, p256dh, auth_key, user_agent, browser, device_label, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
       ON CONFLICT (user_id, endpoint) DO UPDATE SET
         p256dh = EXCLUDED.p256dh,
         auth_key = EXCLUDED.auth_key,
         user_agent = EXCLUDED.user_agent,
         browser = EXCLUDED.browser,
         device_label = COALESCE(EXCLUDED.device_label, web_push_subscriptions.device_label),
         is_active = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [
        userId,
        input.endpoint,
        input.p256dh,
        input.auth_key,
        input.user_agent || null,
        browser,
        input.device_label || null,
      ],
    );
    return result.rows[0];
  }

  static async updateSubscription(
    userId: number,
    subscriptionId: number,
    input: Partial<PushSubscriptionInput>,
  ): Promise<WebPushSubscriptionRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [userId, subscriptionId];
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
    } else if (input.browser !== undefined) {
      fields.push(`browser = $${idx++}`);
      values.push(input.browser);
    }
    if (input.device_label !== undefined) {
      fields.push(`device_label = $${idx++}`);
      values.push(input.device_label);
    }

    if (fields.length === 0) {
      const existing = await pool.query<WebPushSubscriptionRow>(
        `SELECT * FROM web_push_subscriptions WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
        [subscriptionId, userId],
      );
      return existing.rows[0] || null;
    }

    fields.push('updated_at = NOW()');
    const result = await pool.query<WebPushSubscriptionRow>(
      `UPDATE web_push_subscriptions SET ${fields.join(', ')}
       WHERE id = $2 AND user_id = $1 AND is_active = TRUE
       RETURNING *`,
      values,
    );
    return result.rows[0] || null;
  }

  static async deleteSubscription(userId: number, subscriptionId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND is_active = TRUE`,
      [subscriptionId, userId],
    );
    return (result.rowCount || 0) > 0;
  }

  static async deleteByEndpoint(userId: number, endpoint: string): Promise<boolean> {
    const result = await pool.query(
      `UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW()
       WHERE user_id = $1 AND endpoint = $2 AND is_active = TRUE`,
      [userId, endpoint],
    );
    return (result.rowCount || 0) > 0;
  }

  static async listUserSubscriptions(userId: number): Promise<WebPushSubscriptionRow[]> {
    const result = await pool.query<WebPushSubscriptionRow>(
      `SELECT id, user_id, endpoint, p256dh, auth_key, user_agent, browser, device_label, is_active, created_at, updated_at
       FROM web_push_subscriptions
       WHERE user_id = $1 AND is_active = TRUE
       ORDER BY updated_at DESC`,
      [userId],
    );
    return result.rows;
  }

  static async getActiveSubscriptionsForUser(userId: number): Promise<WebPushSubscriptionRow[]> {
    const result = await pool.query<WebPushSubscriptionRow>(
      `SELECT * FROM web_push_subscriptions WHERE user_id = $1 AND is_active = TRUE`,
      [userId],
    );
    return result.rows;
  }

  static async deactivateSubscription(subscriptionId: number): Promise<void> {
    await pool.query(
      `UPDATE web_push_subscriptions SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
      [subscriptionId],
    );
  }
}
