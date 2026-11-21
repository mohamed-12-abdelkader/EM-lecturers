import * as jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { config, HttpError } from '../utils';
import { decryptSecret, encryptSecret } from '../utils/secretCrypto';
import {
  exchangeCodeForUserToken,
  exchangeForLongLivedUserToken,
  fetchIgUser,
  fetchManagedPages,
  fetchMetaMe,
} from './metaGraphClient';

export const META_OAUTH_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_user_content',
].join(',');

export type MetaConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected';

export type MetaConnectionRow = {
  id: number;
  teacher_id: number;
  tenant_id: number | null;
  meta_user_id: string;
  meta_user_name: string | null;
  user_access_token_enc: string;
  token_expires_at: Date | null;
  scopes: string | null;
  status: MetaConnectionStatus;
  connected_at: Date;
  updated_at: Date;
};

export type MetaTargetRow = {
  id: number;
  connection_id: number;
  teacher_id: number;
  platform: 'facebook_page' | 'instagram_business';
  page_id: string | null;
  page_name: string | null;
  page_access_token_enc: string | null;
  page_picture_url: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  ig_picture_url: string | null;
  is_enabled: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
};

export type PublicMetaTarget = {
  id: number;
  platform: MetaTargetRow['platform'];
  page_id: string | null;
  page_name: string | null;
  page_picture_url: string | null;
  ig_user_id: string | null;
  ig_username: string | null;
  ig_picture_url: string | null;
  is_enabled: boolean;
  is_default: boolean;
  connection_status: MetaConnectionStatus;
  connected_at: Date | null;
  display_name: string;
  picture_url: string | null;
};

function assertMetaConfigured() {
  if (!config.META_APP_ID || !config.META_APP_SECRET) {
    throw new HttpError(503, 'Meta App غير مُعدّ — أضف META_APP_ID و META_APP_SECRET');
  }
}

export function getMetaRedirectUrl(): string {
  const fromEnv = (config.META_OAUTH_REDIRECT_URL || '').trim();
  if (fromEnv) return fromEnv;
  const apiBase = (config.API_URL || config.BASE_URL || config.PRODUCTION_URL || '').replace(/\/$/, '');
  if (apiBase) return `${apiBase}/api/teacher/social-publishing/oauth/callback`;
  return `http://localhost:${config.PORT}/api/teacher/social-publishing/oauth/callback`;
}

export function metaFrontendReturnUrl(query: Record<string, string> = {}): string {
  const fromEnv = (config.META_FRONTEND_RETURN_URL || '').trim();
  const base = fromEnv
    ? fromEnv.replace(/\/$/, '')
    : `${(config.FRONTEND_HOST || 'https://em-online.online').replace(/\/$/, '')}/social`;
  const url = new URL(base.includes('://') ? base : `https://${base}`);
  if (!fromEnv) url.searchParams.set('tab', 'connections');
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, v);
  }
  return url.toString();
}

function toPublicTarget(row: MetaTargetRow & { connection_status?: MetaConnectionStatus; connected_at?: Date }): PublicMetaTarget {
  const display_name =
    row.platform === 'instagram_business'
      ? row.ig_username || row.page_name || row.ig_user_id || 'Instagram'
      : row.page_name || row.page_id || 'Facebook Page';
  const picture_url =
    row.platform === 'instagram_business' ? row.ig_picture_url || row.page_picture_url : row.page_picture_url;
  return {
    id: row.id,
    platform: row.platform,
    page_id: row.page_id,
    page_name: row.page_name,
    page_picture_url: row.page_picture_url,
    ig_user_id: row.ig_user_id,
    ig_username: row.ig_username,
    ig_picture_url: row.ig_picture_url,
    is_enabled: row.is_enabled,
    is_default: row.is_default,
    connection_status: row.connection_status || 'connected',
    connected_at: row.connected_at || null,
    display_name,
    picture_url: picture_url || null,
  };
}

export class MetaConnectionService {
  static getRedirectUrl(): string {
    return getMetaRedirectUrl();
  }

  static buildConnectUrl(teacherId: number, tenantId: number | null | undefined): string {
    assertMetaConfigured();
    const state = jwt.sign(
      { purpose: 'meta_oauth', teacherId, tenantId: tenantId ?? null },
      config.SECRET_KEY,
      { expiresIn: '15m' },
    );
    const redirectUri = getMetaRedirectUrl();
    const url = new URL(`https://www.facebook.com/${config.META_API_VERSION || 'v21.0'}/dialog/oauth`);
    url.searchParams.set('client_id', config.META_APP_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', META_OAUTH_SCOPES);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  static verifyOAuthState(state: string): { teacherId: number; tenantId: number | null } {
    try {
      const payload = jwt.verify(state, config.SECRET_KEY) as {
        purpose?: string;
        teacherId?: number;
        tenantId?: number | null;
      };
      if (payload.purpose !== 'meta_oauth' || !payload.teacherId) {
        throw new Error('invalid state');
      }
      return {
        teacherId: Number(payload.teacherId),
        tenantId: payload.tenantId != null ? Number(payload.tenantId) : null,
      };
    } catch {
      throw new HttpError(400, 'رابط الربط منتهي أو غير صالح — أعد المحاولة');
    }
  }

  static async handleOAuthCallback(code: string, teacherId: number, tenantId: number | null) {
    assertMetaConfigured();
    const redirectUri = getMetaRedirectUrl();
    const short = await exchangeCodeForUserToken(code, redirectUri);
    const longLived = await exchangeForLongLivedUserToken(short.access_token);
    const me = await fetchMetaMe(longLived.access_token);
    const pages = await fetchManagedPages(longLived.access_token);

    const expiresAt =
      longLived.expires_in != null
        ? new Date(Date.now() + Number(longLived.expires_in) * 1000)
        : null;

    const connRes = await pool.query<MetaConnectionRow>(
      `INSERT INTO teacher_meta_connections
         (teacher_id, tenant_id, meta_user_id, meta_user_name, user_access_token_enc,
          token_expires_at, scopes, status, connected_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'connected', NOW(), NOW())
       ON CONFLICT (teacher_id, meta_user_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         meta_user_name = EXCLUDED.meta_user_name,
         user_access_token_enc = EXCLUDED.user_access_token_enc,
         token_expires_at = EXCLUDED.token_expires_at,
         scopes = EXCLUDED.scopes,
         status = 'connected',
         connected_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [
        teacherId,
        tenantId,
        me.id,
        me.name || null,
        encryptSecret(longLived.access_token),
        expiresAt,
        META_OAUTH_SCOPES,
      ],
    );
    const connection = connRes.rows[0];

    const discovered: Array<{
      platform: 'facebook_page' | 'instagram_business';
      page_id: string;
      page_name: string | null;
      page_picture_url: string | null;
      ig_user_id: string | null;
      ig_username: string | null;
      ig_picture_url: string | null;
      has_page_token: boolean;
    }> = [];

    for (const page of pages.data || []) {
      if (!page?.id || !page.access_token) continue;
      discovered.push({
        platform: 'facebook_page',
        page_id: page.id,
        page_name: page.name || null,
        page_picture_url: page.picture?.data?.url || null,
        ig_user_id: null,
        ig_username: null,
        ig_picture_url: null,
        has_page_token: true,
      });

      // Persist / refresh FB page target with encrypted page token
      const existingFb = await pool.query<{ id: number }>(
        `SELECT id FROM teacher_meta_targets
         WHERE teacher_id = $1 AND platform = 'facebook_page' AND page_id = $2
         LIMIT 1`,
        [teacherId, page.id],
      );
      if (existingFb.rowCount) {
        await pool.query(
          `UPDATE teacher_meta_targets SET
             connection_id = $2,
             page_name = $3,
             page_access_token_enc = $4,
             page_picture_url = $5,
             is_enabled = TRUE,
             updated_at = NOW()
           WHERE id = $1`,
          [
            existingFb.rows[0].id,
            connection.id,
            page.name || null,
            encryptSecret(page.access_token),
            page.picture?.data?.url || null,
          ],
        );
      } else {
        await pool.query(
          `INSERT INTO teacher_meta_targets
             (connection_id, teacher_id, platform, page_id, page_name, page_access_token_enc,
              page_picture_url, is_enabled, updated_at)
           VALUES ($1, $2, 'facebook_page', $3, $4, $5, $6, TRUE, NOW())`,
          [
            connection.id,
            teacherId,
            page.id,
            page.name || null,
            encryptSecret(page.access_token),
            page.picture?.data?.url || null,
          ],
        );
      }

      const igId = page.instagram_business_account?.id;
      if (igId) {
        let igUsername: string | null = null;
        let igPicture: string | null = null;
        try {
          const ig = await fetchIgUser(igId, page.access_token);
          igUsername = ig.username || null;
          igPicture = ig.profile_picture_url || null;
        } catch {
          // IG discovery is best-effort
        }
        discovered.push({
          platform: 'instagram_business',
          page_id: page.id,
          page_name: page.name || null,
          page_picture_url: page.picture?.data?.url || null,
          ig_user_id: igId,
          ig_username: igUsername,
          ig_picture_url: igPicture,
          has_page_token: true,
        });

        const existingIg = await pool.query<{ id: number }>(
          `SELECT id FROM teacher_meta_targets
           WHERE teacher_id = $1 AND platform = 'instagram_business' AND ig_user_id = $2
           LIMIT 1`,
          [teacherId, igId],
        );
        if (existingIg.rowCount) {
          await pool.query(
            `UPDATE teacher_meta_targets SET
               connection_id = $2,
               page_id = $3,
               page_name = $4,
               page_access_token_enc = $5,
               page_picture_url = $6,
               ig_username = $7,
               ig_picture_url = $8,
               is_enabled = TRUE,
               updated_at = NOW()
             WHERE id = $1`,
            [
              existingIg.rows[0].id,
              connection.id,
              page.id,
              page.name || null,
              encryptSecret(page.access_token),
              page.picture?.data?.url || null,
              igUsername,
              igPicture,
            ],
          );
        } else {
          await pool.query(
            `INSERT INTO teacher_meta_targets
               (connection_id, teacher_id, platform, page_id, page_name, page_access_token_enc,
                page_picture_url, ig_user_id, ig_username, ig_picture_url, is_enabled, updated_at)
             VALUES ($1, $2, 'instagram_business', $3, $4, $5, $6, $7, $8, $9, TRUE, NOW())`,
            [
              connection.id,
              teacherId,
              page.id,
              page.name || null,
              encryptSecret(page.access_token),
              page.picture?.data?.url || null,
              igId,
              igUsername,
              igPicture,
            ],
          );
        }
      }
    }

    // Ensure at least one default target
    const defaults = await pool.query(
      `SELECT id FROM teacher_meta_targets
       WHERE teacher_id = $1 AND is_enabled = TRUE AND is_default = TRUE
       LIMIT 1`,
      [teacherId],
    );
    if (!defaults.rowCount) {
      await pool.query(
        `UPDATE teacher_meta_targets
         SET is_default = TRUE, updated_at = NOW()
         WHERE id = (
           SELECT id FROM teacher_meta_targets
           WHERE teacher_id = $1 AND is_enabled = TRUE
           ORDER BY CASE platform WHEN 'facebook_page' THEN 0 ELSE 1 END, id
           LIMIT 1
         )`,
        [teacherId],
      );
    }

    return {
      connection: {
        id: connection.id,
        meta_user_id: connection.meta_user_id,
        meta_user_name: connection.meta_user_name,
        status: connection.status,
        connected_at: connection.connected_at,
      },
      discovered_count: discovered.length,
      discovered,
    };
  }

  static async listTargets(teacherId: number): Promise<PublicMetaTarget[]> {
    const res = await pool.query<
      MetaTargetRow & { connection_status: MetaConnectionStatus; connected_at: Date }
    >(
      `SELECT t.*, c.status AS connection_status, c.connected_at
       FROM teacher_meta_targets t
       JOIN teacher_meta_connections c ON c.id = t.connection_id
       WHERE t.teacher_id = $1
         AND c.status <> 'disconnected'
       ORDER BY t.is_default DESC, t.platform, t.id`,
      [teacherId],
    );
    return res.rows.map(toPublicTarget);
  }

  static async listConnections(teacherId: number) {
    const res = await pool.query<MetaConnectionRow>(
      `SELECT id, teacher_id, tenant_id, meta_user_id, meta_user_name, token_expires_at,
              scopes, status, connected_at, updated_at
       FROM teacher_meta_connections
       WHERE teacher_id = $1 AND status <> 'disconnected'
       ORDER BY connected_at DESC`,
      [teacherId],
    );
    // Never return encrypted tokens
    return res.rows.map((r) => ({
      id: r.id,
      meta_user_id: r.meta_user_id,
      meta_user_name: r.meta_user_name,
      token_expires_at: r.token_expires_at,
      status: r.status,
      connected_at: r.connected_at,
      scopes: r.scopes,
    }));
  }

  static async setTargetEnabled(teacherId: number, targetId: number, enabled: boolean) {
    const res = await pool.query(
      `UPDATE teacher_meta_targets
       SET is_enabled = $3, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING id`,
      [targetId, teacherId, enabled],
    );
    if (!res.rowCount) throw new HttpError(404, 'الحساب غير موجود');
    return this.listTargets(teacherId);
  }

  static async setDefaultTarget(teacherId: number, targetId: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const check = await client.query(
        `SELECT id FROM teacher_meta_targets WHERE id = $1 AND teacher_id = $2 AND is_enabled = TRUE`,
        [targetId, teacherId],
      );
      if (!check.rowCount) throw new HttpError(404, 'الحساب غير موجود أو غير مفعّل');
      await client.query(
        `UPDATE teacher_meta_targets SET is_default = FALSE, updated_at = NOW() WHERE teacher_id = $1`,
        [teacherId],
      );
      await client.query(
        `UPDATE teacher_meta_targets SET is_default = TRUE, updated_at = NOW() WHERE id = $1 AND teacher_id = $2`,
        [targetId, teacherId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listTargets(teacherId);
  }

  static async disconnectTarget(teacherId: number, targetId: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const target = await client.query<MetaTargetRow>(
        `SELECT * FROM teacher_meta_targets WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
        [targetId, teacherId],
      );
      if (!target.rowCount) throw new HttpError(404, 'الحساب غير موجود');

      // Cancel pending publish jobs for this target
      await client.query(
        `UPDATE teacher_social_publish_jobs j
         SET status = 'cancelled', updated_at = NOW(),
             last_error = COALESCE(last_error, 'تم فصل الحساب')
         FROM teacher_social_post_targets pt
         WHERE j.post_target_id = pt.id
           AND pt.target_id = $1
           AND j.status IN ('queued', 'processing')`,
        [targetId],
      );
      await client.query(
        `UPDATE teacher_social_post_targets
         SET status = 'cancelled', updated_at = NOW(),
             last_error = COALESCE(last_error, 'تم فصل الحساب')
         WHERE target_id = $1 AND status IN ('pending', 'publishing')`,
        [targetId],
      );

      await client.query(`DELETE FROM teacher_meta_targets WHERE id = $1 AND teacher_id = $2`, [
        targetId,
        teacherId,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.listTargets(teacherId);
  }

  static async disconnectConnection(teacherId: number, connectionId: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const conn = await client.query(
        `SELECT id FROM teacher_meta_connections WHERE id = $1 AND teacher_id = $2 FOR UPDATE`,
        [connectionId, teacherId],
      );
      if (!conn.rowCount) throw new HttpError(404, 'الاتصال غير موجود');

      const targets = await client.query<{ id: number }>(
        `SELECT id FROM teacher_meta_targets WHERE connection_id = $1 AND teacher_id = $2`,
        [connectionId, teacherId],
      );
      const targetIds = targets.rows.map((r) => r.id);
      if (targetIds.length) {
        await client.query(
          `UPDATE teacher_social_publish_jobs j
           SET status = 'cancelled', updated_at = NOW(),
               last_error = COALESCE(last_error, 'تم فصل الحساب')
           FROM teacher_social_post_targets pt
           WHERE j.post_target_id = pt.id
             AND pt.target_id = ANY($1::int[])
             AND j.status IN ('queued', 'processing')`,
          [targetIds],
        );
        await client.query(
          `UPDATE teacher_social_post_targets
           SET status = 'cancelled', updated_at = NOW(),
               last_error = COALESCE(last_error, 'تم فصل الحساب')
           WHERE target_id = ANY($1::int[]) AND status IN ('pending', 'publishing')`,
          [targetIds],
        );
      }

      await client.query(
        `UPDATE teacher_meta_connections
         SET status = 'disconnected',
             user_access_token_enc = '',
             updated_at = NOW()
         WHERE id = $1`,
        [connectionId],
      );
      await client.query(
        `UPDATE teacher_meta_targets
         SET page_access_token_enc = NULL, is_enabled = FALSE, updated_at = NOW()
         WHERE connection_id = $1`,
        [connectionId],
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async getTargetForPublish(teacherId: number, targetId: number): Promise<{
    target: MetaTargetRow;
    pageAccessToken: string;
  }> {
    const res = await pool.query<MetaTargetRow & { connection_status: MetaConnectionStatus }>(
      `SELECT t.*, c.status AS connection_status
       FROM teacher_meta_targets t
       JOIN teacher_meta_connections c ON c.id = t.connection_id
       WHERE t.id = $1 AND t.teacher_id = $2`,
      [targetId, teacherId],
    );
    const row = res.rows[0];
    if (!row) throw new HttpError(404, 'الحساب المستهدف غير موجود');
    if (!row.is_enabled) throw new HttpError(400, 'الحساب غير مفعّل');
    if (row.connection_status !== 'connected') {
      throw new HttpError(401, 'يلزم إعادة ربط الحساب', { code: 'needs_reauth' });
    }
    if (!row.page_access_token_enc) {
      throw new HttpError(401, 'رمز الوصول غير متاح — أعد الربط', { code: 'needs_reauth' });
    }
    let pageAccessToken: string;
    try {
      pageAccessToken = decryptSecret(row.page_access_token_enc);
    } catch {
      throw new HttpError(500, 'تعذر فك تشفير رمز الوصول');
    }
    if (!pageAccessToken) {
      throw new HttpError(401, 'رمز الوصول فارغ — أعد الربط', { code: 'needs_reauth' });
    }
    return { target: row, pageAccessToken };
  }

  static async markNeedsReauth(connectionId: number, message?: string) {
    await pool.query(
      `UPDATE teacher_meta_connections
       SET status = 'needs_reauth', updated_at = NOW()
       WHERE id = $1`,
      [connectionId],
    );
    if (message) {
      await pool.query(
        `UPDATE teacher_social_publish_jobs j
         SET status = 'needs_reauth', last_error = $2, updated_at = NOW()
         FROM teacher_social_post_targets pt
         JOIN teacher_meta_targets t ON t.id = pt.target_id
         WHERE j.post_target_id = pt.id
           AND t.connection_id = $1
           AND j.status IN ('queued', 'processing')`,
        [connectionId, message],
      );
    }
  }
}
