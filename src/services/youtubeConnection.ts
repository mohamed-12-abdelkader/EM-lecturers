import { google } from 'googleapis';
import * as jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { config, HttpError } from '../utils';

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtubepartner',
  'https://www.googleapis.com/auth/youtube.force-ssl',
];

type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type OAuthCredentials = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string;
};

export type YoutubeConnectionStatus = 'connected' | 'needs_reauth';

export type YoutubeConnectionRow = {
  id: number;
  channel_id: string | null;
  channel_title: string | null;
  refresh_token: string;
  access_token: string | null;
  expires_at: Date | null;
  scopes: string | null;
  status: YoutubeConnectionStatus;
  connected_by: number | null;
  connected_at: Date;
  updated_at: Date;
};

function getRedirectUrl(): string {
  const fromEnv = (config.YOUTUBE_OAUTH_REDIRECT_URL || '').trim();
  if (fromEnv) return fromEnv;
  const apiBase = (config.API_URL || config.BASE_URL || config.PRODUCTION_URL || '').replace(/\/$/, '');
  if (apiBase) return `${apiBase}/api/admin/youtube/callback`;
  return 'http://localhost:8000/api/admin/youtube/callback';
}

export function getYoutubeOAuthClient(): OAuth2Client {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    getRedirectUrl(),
  );
}

export class YoutubeConnectionService {
  static getRedirectUrl(): string {
    return getRedirectUrl();
  }

  static async getActiveConnection(): Promise<YoutubeConnectionRow | null> {
    const result = await pool.query<YoutubeConnectionRow>(
      `SELECT * FROM youtube_connections ORDER BY id DESC LIMIT 1`,
    );
    return result.rows[0] ?? null;
  }

  static async getStatus() {
    const row = await this.getActiveConnection();
    if (!row) {
      return {
        connected: false,
        status: null as YoutubeConnectionStatus | null,
        channel_id: null as string | null,
        channel_title: null as string | null,
        connected_at: null as string | null,
        redirect_uri: getRedirectUrl(),
      };
    }
    return {
      connected: row.status === 'connected',
      status: row.status,
      channel_id: row.channel_id,
      channel_title: row.channel_title,
      connected_at: row.connected_at,
      redirect_uri: getRedirectUrl(),
    };
  }

  static buildConnectUrl(adminUserId: number): string {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      throw new HttpError(503, 'GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET غير مُعدّين');
    }
    const client = getYoutubeOAuthClient();
    const state = jwt.sign(
      { purpose: 'yt_oauth', adminId: adminUserId },
      config.SECRET_KEY,
      { expiresIn: '15m' },
    );
    return client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: YOUTUBE_SCOPES,
      state,
    });
  }

  static verifyOAuthState(state: string): { adminId: number } {
    try {
      const payload = jwt.verify(state, config.SECRET_KEY) as { purpose?: string; adminId?: number };
      if (payload.purpose !== 'yt_oauth' || !payload.adminId) {
        throw new Error('invalid state');
      }
      return { adminId: Number(payload.adminId) };
    } catch {
      throw new HttpError(400, 'رابط الربط منتهي أو غير صالح — أعد المحاولة من لوحة الأدمن');
    }
  }

  static async exchangeCodeAndSave(code: string, adminUserId: number): Promise<YoutubeConnectionRow> {
    const client = getYoutubeOAuthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.refresh_token) {
      // May happen if Google already issued a refresh token earlier — keep previous refresh if present.
      const existing = await this.getActiveConnection();
      if (!existing?.refresh_token) {
        throw new HttpError(
          400,
          'لم يُرجع Google refresh_token. ألغِ صلاحية التطبيق من حساب Google ثم أعد الربط مع prompt=consent',
        );
      }
      tokens.refresh_token = existing.refresh_token;
    }

    client.setCredentials(tokens);
    const youtube = google.youtube({ version: 'v3', auth: client });
    const channelRes = await youtube.channels.list({ part: ['snippet'], mine: true });
    const channel = channelRes.data.items?.[0];

    const expiresAt =
      tokens.expiry_date != null ? new Date(tokens.expiry_date) : null;

    const existing = await this.getActiveConnection();
    if (existing) {
      const updated = await pool.query<YoutubeConnectionRow>(
        `UPDATE youtube_connections SET
           channel_id = $1,
           channel_title = $2,
           refresh_token = $3,
           access_token = $4,
           expires_at = $5,
           scopes = $6,
           status = 'connected',
           connected_by = $7,
           connected_at = NOW(),
           updated_at = NOW()
         WHERE id = $8
         RETURNING *`,
        [
          channel?.id ?? null,
          channel?.snippet?.title ?? null,
          tokens.refresh_token,
          tokens.access_token ?? null,
          expiresAt,
          tokens.scope ?? YOUTUBE_SCOPES.join(' '),
          adminUserId,
          existing.id,
        ],
      );
      return updated.rows[0];
    }

    const inserted = await pool.query<YoutubeConnectionRow>(
      `INSERT INTO youtube_connections
         (channel_id, channel_title, refresh_token, access_token, expires_at, scopes, status, connected_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'connected', $7)
       RETURNING *`,
      [
        channel?.id ?? null,
        channel?.snippet?.title ?? null,
        tokens.refresh_token,
        tokens.access_token ?? null,
        expiresAt,
        tokens.scope ?? YOUTUBE_SCOPES.join(' '),
        adminUserId,
      ],
    );
    return inserted.rows[0];
  }

  static async markNeedsReauth(message?: string): Promise<void> {
    await pool.query(
      `UPDATE youtube_connections
       SET status = 'needs_reauth', updated_at = NOW()
       WHERE id = (SELECT id FROM youtube_connections ORDER BY id DESC LIMIT 1)`,
    );
    if (message) {
      await pool.query(
        `UPDATE youtube_upload_jobs
         SET status = 'needs_reauth',
             error_message = $1,
             updated_at = NOW()
         WHERE status IN ('queued', 'uploading')`,
        [message],
      );
    }
  }

  static async disconnect(): Promise<void> {
    await pool.query(`DELETE FROM youtube_connections`);
    await pool.query(
      `UPDATE youtube_upload_jobs
       SET status = 'failed',
           error_message = COALESCE(error_message, 'تم قطع اتصال YouTube'),
           updated_at = NOW()
       WHERE status IN ('queued', 'uploading', 'needs_reauth')`,
    );
  }

  /**
   * Returns an OAuth2 client with a valid access token, refreshing when needed.
   * Throws HttpError(401) with code needs_reauth on invalid_grant.
   */
  static async getAuthenticatedClient(): Promise<OAuth2Client> {
    const row = await this.getActiveConnection();
    if (!row) {
      throw new HttpError(401, 'YouTube غير مربوط — اربط القناة من لوحة الأدمن', {
        code: 'needs_reauth',
      });
    }
    if (row.status === 'needs_reauth') {
      throw new HttpError(401, 'انتهت صلاحية YouTube — سجّل الدخول مجدداً', {
        code: 'needs_reauth',
      });
    }

    const client = getYoutubeOAuthClient();
    client.setCredentials({
      refresh_token: row.refresh_token,
      access_token: row.access_token ?? undefined,
      expiry_date: row.expires_at ? new Date(row.expires_at).getTime() : undefined,
    });

    client.on('tokens', (tokens) => {
      void this.persistRefreshedTokens(row.id, tokens).catch(() => undefined);
    });

    try {
      const needsRefresh =
        !row.access_token ||
        !row.expires_at ||
        new Date(row.expires_at).getTime() <= Date.now() + 60_000;
      if (needsRefresh) {
        const { credentials } = await client.refreshAccessToken();
        client.setCredentials(credentials);
        await this.persistRefreshedTokens(row.id, credentials);
      }
    } catch (err: any) {
      if (isInvalidGrantError(err)) {
        await this.markNeedsReauth('انتهت صلاحية توكن YouTube (invalid_grant)');
        throw new HttpError(401, 'انتهت صلاحية YouTube — سجّل الدخول مجدداً', {
          code: 'needs_reauth',
        });
      }
      throw err;
    }

    return client;
  }

  private static async persistRefreshedTokens(
    connectionId: number,
    tokens: OAuthCredentials,
  ): Promise<void> {
    const expiresAt =
      tokens.expiry_date != null ? new Date(tokens.expiry_date) : null;
    await pool.query(
      `UPDATE youtube_connections SET
         access_token = COALESCE($1, access_token),
         refresh_token = COALESCE($2, refresh_token),
         expires_at = COALESCE($3, expires_at),
         status = 'connected',
         updated_at = NOW()
       WHERE id = $4`,
      [tokens.access_token ?? null, tokens.refresh_token ?? null, expiresAt, connectionId],
    );
  }

  static frontendReturnUrl(query: Record<string, string> = {}): string {
    const base = (config.FRONTEND_HOST || 'https://em-online.online').replace(/\/$/, '');
    const qs = new URLSearchParams(query).toString();
    return `${base}/admin/youtube-uploads${qs ? `?${qs}` : ''}`;
  }
}

export function isInvalidGrantError(err: unknown): boolean {
  const e = err as any;
  const dataError = e?.response?.data?.error;
  const msg = String(e?.message || '');
  return (
    dataError === 'invalid_grant' ||
    msg.includes('invalid_grant') ||
    (e?.code === 400 && msg.toLowerCase().includes('invalid_grant'))
  );
}

export function isYoutubeQuotaError(err: unknown): boolean {
  const e = err as any;
  const reasons: string[] = [];
  const nested = e?.errors || e?.response?.data?.error?.errors;
  if (Array.isArray(nested)) {
    for (const item of nested) {
      if (item?.reason) reasons.push(String(item.reason));
    }
  }
  const msg = String(e?.message || '').toLowerCase();
  return (
    reasons.includes('uploadLimitExceeded') ||
    reasons.includes('quotaExceeded') ||
    reasons.includes('rateLimitExceeded') ||
    msg.includes('uploadlimitexceeded') ||
    msg.includes('quota exceeded') ||
    (e?.code === 403 && msg.includes('quota')) ||
    e?.code === 429
  );
}
