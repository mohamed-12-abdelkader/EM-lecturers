import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import type { PoolClient } from 'pg';
import pool from '../db/pool';
import {
  config,
  logger,
  HttpError,
  generateToken,
  isAccessSessionReplaced,
  SESSION_REPLACED,
  SESSION_REVOKED,
} from '../utils';
import type { User } from '../db/types';
import { disconnectUserSockets } from './notifications';

/**
 * Server-side device sessions.
 *
 * - Refresh token: `<deviceId>.<secret>` (hash stored, never the JWT)
 * - Access JWT carries `jti` (+ `sid`) matching this row
 * - expires_at is fixed at creation (1 year) — last_used_at is updated, never expires_at
 * - Student: exclusive = one active session
 * - Teacher/admin/staff: many active sessions
 */

export const REFRESH_COOKIE_NAME = 'em_refresh';
export const REFRESH_COOKIE_PATH = '/api/auth';

const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const LAST_USED_TOUCH_MS = 2 * 60 * 1000;

export type DeviceSessionRow = {
  id: string;
  user_id: number;
  tenant_id: number | null;
  jti: string | null;
  role: string | null;
  exclusive: boolean;
  client_device_id: string | null;
  device_info: string | null;
  refresh_token_hash: string;
  previous_token_hash: string | null;
  browser: string | null;
  platform: string | null;
  ip: string | null;
  remember_me: boolean;
  last_used_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AccessSessionFailure = {
  ok: false;
  status: number;
  body: { success: false; message: string; code: string };
};

export type AccessSessionSuccess = {
  ok: true;
  session: DeviceSessionRow | null;
};

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function newSecret(): string {
  return crypto.randomBytes(48).toString('base64url');
}

function parseRefreshToken(raw: string): { deviceId: string; secret: string } | null {
  const trimmed = (raw || '').trim();
  const dot = trimmed.indexOf('.');
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  const deviceId = trimmed.slice(0, dot);
  const secret = trimmed.slice(dot + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return null;
  }
  if (secret.length < 32) return null;
  return { deviceId, secret };
}

export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

export function parseUserAgent(req: Request): { browser: string; platform: string } {
  const ua = String(req.headers['user-agent'] || '');

  let browser = 'unknown';
  if (/edg(a|e|ios)?\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua)) browser = 'Safari';
  else if (/okhttp|axios|node|expo/i.test(ua)) browser = 'App';

  let platform = 'unknown';
  if (/android/i.test(ua)) platform = 'Android';
  else if (/iphone|ipad|ipod|ios/i.test(ua)) platform = 'iOS';
  else if (/windows/i.test(ua)) platform = 'Windows';
  else if (/mac os|macintosh/i.test(ua)) platform = 'macOS';
  else if (/linux/i.test(ua)) platform = 'Linux';

  return { browser, platform };
}

export function readClientDeviceId(req: Request): string | null {
  const header = req.headers['x-device-id'];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  const fromBody =
    req.body && typeof req.body === 'object'
      ? (req.body.device_id ?? req.body.deviceId ?? req.body.client_device_id)
      : undefined;
  const raw = String(fromBody || fromHeader || '').trim();
  if (!raw) return null;
  return raw.slice(0, 120);
}

export function isExclusiveAuthRole(role: string): boolean {
  return role === 'student';
}

function sessionTtlMs(): number {
  const days = Math.max(365, config.REFRESH_TOKEN_TTL_DAYS, config.REFRESH_TOKEN_REMEMBER_DAYS);
  return Math.max(SESSION_TTL_MS, days * 24 * 60 * 60 * 1000);
}

function cookieDomain(req: Request): string | undefined {
  if (config.AUTH_COOKIE_DOMAIN) return config.AUTH_COOKIE_DOMAIN;

  const root = config.TENANT_ROOT_DOMAIN?.trim().toLowerCase();
  if (!root) return undefined;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  if (host === root || host.endsWith(`.${root}`)) return `.${root}`;
  return undefined;
}

function isHttpsRequest(req: Request): boolean {
  if (req.secure) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return proto === 'https';
}

function cookieSameSite(req: Request): 'lax' | 'strict' | 'none' {
  if (config.AUTH_COOKIE_SAMESITE) {
    return config.AUTH_COOKIE_SAMESITE as 'lax' | 'strict' | 'none';
  }
  if (cookieDomain(req)) return 'lax';
  if (isHttpsRequest(req) && config.NODE_ENV !== 'production') return 'none';
  return 'lax';
}

export function setRefreshCookie(
  req: Request,
  res: Response,
  token: string,
  rememberMe: boolean,
): void {
  const sameSite = cookieSameSite(req);
  const secure = sameSite === 'none' || config.NODE_ENV === 'production' || isHttpsRequest(req);
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain(req),
    path: REFRESH_COOKIE_PATH,
    maxAge: sessionTtlMs(),
  });
}

export function clearRefreshCookie(req: Request, res: Response): void {
  const sameSite = cookieSameSite(req);
  const secure = sameSite === 'none' || config.NODE_ENV === 'production' || isHttpsRequest(req);
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure,
    sameSite,
    domain: cookieDomain(req),
    path: REFRESH_COOKIE_PATH,
  });
}

export function readRefreshCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const value = cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function logAuthEvent(
  event: string,
  data: Record<string, unknown>,
  level: 'info' | 'warn' = 'info',
): void {
  logger[level]({ auth_event: event, ...data }, `auth: ${event}`);
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === 'object' && (err as { code?: string }).code === '23505');
}

function asJti(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return null;
  return raw.toLowerCase();
}

let schemaReady: Promise<void> | null = null;

export class AuthSessionsService {
  static ensureSchema(): Promise<void> {
    if (!schemaReady) {
      schemaReady = (async () => {
        await pool.query(`
          ALTER TABLE user_devices
            ADD COLUMN IF NOT EXISTS jti UUID,
            ADD COLUMN IF NOT EXISTS role TEXT,
            ADD COLUMN IF NOT EXISTS exclusive BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS client_device_id TEXT,
            ADD COLUMN IF NOT EXISTS device_info TEXT
        `);
        await pool.query(`UPDATE user_devices SET jti = gen_random_uuid() WHERE jti IS NULL`);
        await pool.query(`
          UPDATE user_devices d
          SET role = u.role
          FROM users u
          WHERE u.id = d.user_id AND d.role IS NULL
        `);
        // Collapse extra student sessions BEFORE marking exclusive (unique index may already exist)
        await pool.query(`
          WITH ranked AS (
            SELECT d.id,
                   ROW_NUMBER() OVER (
                     PARTITION BY d.user_id
                     ORDER BY d.last_used_at DESC, d.created_at DESC
                   ) AS rn
            FROM user_devices d
            JOIN users u ON u.id = d.user_id
            WHERE u.role = 'student' AND d.revoked_at IS NULL
          )
          UPDATE user_devices d
          SET revoked_at = NOW(),
              revoked_reason = 'login_other_device',
              updated_at = NOW()
          FROM ranked r
          WHERE d.id = r.id AND r.rn > 1
        `);
        await pool.query(`
          UPDATE user_devices d
          SET exclusive = TRUE
          FROM users u
          WHERE u.id = d.user_id
            AND u.role = 'student'
            AND d.revoked_at IS NULL
        `);
        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_devices_jti
            ON user_devices (jti) WHERE jti IS NOT NULL
        `);
        await pool.query(`
          CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_devices_one_exclusive_active
            ON user_devices (user_id)
            WHERE revoked_at IS NULL AND exclusive IS TRUE
        `);
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_user_devices_jti_lookup ON user_devices (jti)
        `);
      })().catch((err) => {
        schemaReady = null;
        throw err;
      });
    }
    return schemaReady;
  }

  static async signAccessToken(
    user: User,
    session: Pick<DeviceSessionRow, 'id' | 'jti' | 'tenant_id' | 'expires_at'>,
  ): Promise<string> {
    return generateToken(user, pool, {
      sessionTenantId: session.tenant_id,
      jti: session.jti,
      sid: session.id,
      expiresAt: session.expires_at,
      persistJti: false,
    });
  }

  static async createDeviceSession(input: {
    userId: number;
    role: string;
    tenantId?: number | null;
    rememberMe: boolean;
    req: Request;
    exclusiveSession?: boolean;
  }): Promise<{
    refreshToken: string;
    deviceId: string;
    expiresAt: Date;
    createdAt: Date;
    jti: string;
    session: DeviceSessionRow;
  }> {
    await this.ensureSchema();
    const exclusiveSession = input.exclusiveSession ?? isExclusiveAuthRole(input.role);
    const secret = newSecret();
    const { browser, platform } = parseUserAgent(input.req);
    const ip = clientIp(input.req);
    const clientDeviceId = readClientDeviceId(input.req);
    const deviceInfo = `${platform} / ${browser}`.slice(0, 200);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + sessionTtlMs());
    const jti = crypto.randomUUID();

    const insert = async (client: PoolClient) => {
      return client.query<DeviceSessionRow>(
        `INSERT INTO user_devices
           (user_id, tenant_id, jti, role, exclusive, client_device_id, device_info,
            refresh_token_hash, browser, platform, ip, remember_me, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING *`,
        [
          input.userId,
          input.tenantId ?? null,
          jti,
          input.role,
          exclusiveSession,
          clientDeviceId,
          deviceInfo,
          sha256(secret),
          browser,
          platform,
          ip,
          input.rememberMe,
          expiresAt,
          createdAt,
        ],
      );
    };

    const client = await pool.connect();
    let revokedCount = 0;
    let row: DeviceSessionRow | undefined;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [input.userId]);

      if (exclusiveSession) {
        const revoked = await client.query(
          `UPDATE user_devices
           SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [input.userId, 'login_other_device'],
        );
        revokedCount = revoked.rowCount ?? 0;
      }

      try {
        row = (await insert(client)).rows[0];
      } catch (err) {
        if (!exclusiveSession || !isUniqueViolation(err)) throw err;
        await client.query(
          `UPDATE user_devices
           SET revoked_at = NOW(), revoked_reason = $2, exclusive = FALSE, updated_at = NOW()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [input.userId, 'login_other_device'],
        );
        row = (await insert(client)).rows[0];
      }

      if (exclusiveSession) {
        await client.query('UPDATE users SET jti = $1 WHERE id = $2', [jti, input.userId]);
      } else {
        await client.query('UPDATE users SET jti = NULL WHERE id = $1 AND jti IS NOT NULL', [
          input.userId,
        ]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    if (!row) throw new HttpError(500, 'تعذر إنشاء الجلسة');

    if (revokedCount > 0) {
      logAuthEvent('login_replaces_sessions', {
        user_id: input.userId,
        revoked_count: revokedCount,
        ip,
      });
      disconnectUserSockets(input.userId);
    }

    logAuthEvent('device_login', {
      user_id: input.userId,
      device_id: row.id,
      role: input.role,
      exclusive: exclusiveSession,
      browser,
      platform,
      ip,
    });

    return {
      refreshToken: `${row.id}.${secret}`,
      deviceId: row.id,
      expiresAt,
      createdAt,
      jti,
      session: row,
    };
  }

  static async findByJti(jti: string): Promise<DeviceSessionRow | null> {
    await this.ensureSchema();
    const found = await pool.query<DeviceSessionRow>(
      `SELECT * FROM user_devices WHERE jti = $1 LIMIT 1`,
      [jti],
    );
    return found.rows[0] ?? null;
  }

  /**
   * JWT is valid only if the matching DB session is still active.
   * Legacy tokens (no user_devices.jti row) keep working until login, except
   * students whose users.jti was rotated (login from another device).
   */
  static async assertAccessSession(
    decoded: { id?: unknown; jti?: unknown; role?: unknown },
    user: { id: number; role: string; jti?: string | null },
  ): Promise<AccessSessionSuccess | AccessSessionFailure> {
    await this.ensureSchema();
    const jti = asJti(decoded.jti);

    if (jti) {
      const session = await this.findByJti(jti);
      if (session) {
        if (Number(session.user_id) !== Number(user.id)) {
          return {
            ok: false,
            status: 401,
            body: { success: false, message: 'Invalid token', code: 'INVALID_TOKEN' },
          };
        }
        if (session.revoked_at) {
          const otherDevice = session.revoked_reason === 'login_other_device';
          return {
            ok: false,
            status: 401,
            body: otherDevice ? SESSION_REPLACED : SESSION_REVOKED,
          };
        }
        if (new Date(session.expires_at).getTime() <= Date.now()) {
          await this.revokeDevice(session.id, 'expired');
          return {
            ok: false,
            status: 401,
            body: {
              success: false,
              message: 'Access token expired',
              code: 'TOKEN_EXPIRED',
            },
          };
        }
        void this.touchLastUsed(session.id, session.last_used_at);
        return { ok: true, session };
      }
    }

    if (isAccessSessionReplaced(decoded, user)) {
      return { ok: false, status: 401, body: SESSION_REPLACED };
    }

    return { ok: true, session: null };
  }

  static async touchLastUsed(deviceId: string, lastUsedAt?: string): Promise<void> {
    if (lastUsedAt && Date.now() - new Date(lastUsedAt).getTime() < LAST_USED_TOUCH_MS) return;
    await pool.query(
      `UPDATE user_devices SET last_used_at = NOW(), updated_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
      [deviceId],
    );
  }

  static async rotateDeviceSession(
    rawToken: string,
    req: Request,
  ): Promise<{
    refreshToken: string;
    device: DeviceSessionRow;
  }> {
    await this.ensureSchema();
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      logAuthEvent('refresh_failure', { reason: 'malformed_token', ip: clientIp(req) }, 'warn');
      throw new HttpError(401, 'Invalid refresh token', { code: 'INVALID_REFRESH_TOKEN' });
    }

    const found = await pool.query<DeviceSessionRow>(
      `SELECT * FROM user_devices WHERE id = $1 LIMIT 1`,
      [parsed.deviceId],
    );
    if (!found.rowCount) {
      logAuthEvent(
        'refresh_failure',
        { reason: 'device_not_found', device_id: parsed.deviceId, ip: clientIp(req) },
        'warn',
      );
      throw new HttpError(401, 'Invalid refresh token', { code: 'INVALID_REFRESH_TOKEN' });
    }

    const device = found.rows[0];
    const presentedHash = sha256(parsed.secret);

    if (device.revoked_at) {
      const otherDevice = device.revoked_reason === 'login_other_device';
      logAuthEvent(
        'suspicious_activity',
        {
          reason: 'refresh_on_revoked_session',
          device_id: device.id,
          user_id: device.user_id,
          ip: clientIp(req),
        },
        'warn',
      );
      throw new HttpError(401, otherDevice ? SESSION_REPLACED.message : 'Session revoked', {
        code: otherDevice ? 'SESSION_REPLACED' : 'SESSION_REVOKED',
      });
    }

    const hashMatches =
      presentedHash === device.refresh_token_hash ||
      (device.previous_token_hash != null && presentedHash === device.previous_token_hash);

    if (!hashMatches) {
      await this.revokeDevice(device.id, 'refresh_token_mismatch');
      logAuthEvent(
        'suspicious_activity',
        {
          reason: 'refresh_token_mismatch',
          device_id: device.id,
          user_id: device.user_id,
          ip: clientIp(req),
        },
        'warn',
      );
      throw new HttpError(401, 'Invalid refresh token', { code: 'INVALID_REFRESH_TOKEN' });
    }

    if (new Date(device.expires_at).getTime() <= Date.now()) {
      await this.revokeDevice(device.id, 'expired');
      logAuthEvent(
        'refresh_failure',
        { reason: 'refresh_expired', device_id: device.id, user_id: device.user_id },
        'warn',
      );
      throw new HttpError(401, 'Refresh token expired', { code: 'REFRESH_EXPIRED' });
    }

    let jti = device.jti;
    if (!jti) {
      jti = crypto.randomUUID();
      await pool.query(`UPDATE user_devices SET jti = $2, updated_at = NOW() WHERE id = $1`, [
        device.id,
        jti,
      ]);
      device.jti = jti;
    }

    const updated = await pool.query<DeviceSessionRow>(
      `UPDATE user_devices
       SET last_used_at = NOW(),
           ip = $2,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [device.id, clientIp(req)],
    );

    logAuthEvent('refresh', { device_id: device.id, user_id: device.user_id });

    return {
      refreshToken: rawToken,
      device: updated.rows[0],
    };
  }

  static async revokeDevice(deviceId: string, reason: string): Promise<void> {
    await pool.query(
      `UPDATE user_devices
       SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [deviceId, reason],
    );
  }

  static async revokeByJti(jti: string, reason: string): Promise<DeviceSessionRow | null> {
    const parsed = asJti(jti);
    if (!parsed) return null;
    await this.ensureSchema();
    const res = await pool.query<DeviceSessionRow>(
      `UPDATE user_devices
       SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE jti = $1 AND revoked_at IS NULL
       RETURNING *`,
      [parsed, reason],
    );
    return res.rows[0] ?? null;
  }

  static async revokeByToken(rawToken: string, reason: string): Promise<DeviceSessionRow | null> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return null;
    const res = await pool.query<DeviceSessionRow>(
      `UPDATE user_devices
       SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING *`,
      [parsed.deviceId, reason],
    );
    return res.rowCount ? res.rows[0] : null;
  }

  static async revokeAllForUser(userId: number, reason: string): Promise<number> {
    const res = await pool.query(
      `UPDATE user_devices
       SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
    );
    await pool.query(`UPDATE users SET jti = NULL WHERE id = $1 AND jti IS NOT NULL`, [userId]);
    logAuthEvent('logout_all', { user_id: userId, revoked_count: res.rowCount });
    return res.rowCount ?? 0;
  }

  static async listActiveSessions(userId: number): Promise<
    Array<
      Pick<
        DeviceSessionRow,
        | 'id'
        | 'browser'
        | 'platform'
        | 'ip'
        | 'remember_me'
        | 'last_used_at'
        | 'created_at'
        | 'expires_at'
        | 'device_info'
        | 'client_device_id'
      >
    >
  > {
    const res = await pool.query(
      `SELECT id, browser, platform, ip, remember_me, last_used_at, created_at, expires_at,
              device_info, client_device_id
       FROM user_devices
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_used_at DESC`,
      [userId],
    );
    return res.rows;
  }

  static logLogin(userId: number, role: string, method: string, req: Request): void {
    logAuthEvent('login', { user_id: userId, role, method, ip: clientIp(req) });
  }

  static logLogout(userId: number | null, deviceId: string | null, req: Request): void {
    logAuthEvent('logout', { user_id: userId, device_id: deviceId, ip: clientIp(req) });
  }
}
