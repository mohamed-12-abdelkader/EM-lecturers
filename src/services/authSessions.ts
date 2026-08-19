import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import pool from '../db/pool';
import { config, logger, HttpError } from '../utils';
import { disconnectUserSockets } from './notifications';

/**
 * Device Sessions + Refresh Token Rotation
 *
 * - الـ Refresh Token مبني بصيغة: `<deviceId>.<secret>` (opaque — ليس JWT)
 * - يُخزَّن hash فقط (SHA-256) في قاعدة البيانات
 * - كل Refresh يعمل Rotation: توكن جديد + إبطال القديم
 * - استخدام توكن قديم بعد الـ Rotation → إلغاء الجلسة + تسجيل محاولة مشبوهة
 */

export const REFRESH_COOKIE_NAME = 'em_refresh';
/** Cookie تُرسل فقط لمسارات /api/auth (refresh / logout) */
export const REFRESH_COOKIE_PATH = '/api/auth';

export type DeviceSessionRow = {
  id: string;
  user_id: number;
  tenant_id: number | null;
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
  // UUID v4 check
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)) {
    return null;
  }
  if (secret.length < 32) return null;
  return { deviceId, secret };
}

/** استخراج IP الحقيقي (خلف proxy / ngrok / nginx) */
export function clientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

/** تحليل مبسّط للـ User-Agent (بدون dependency خارجية) */
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

function refreshTtlMs(_rememberMe: boolean): number {
  const days = Math.max(config.REFRESH_TOKEN_TTL_DAYS, config.REFRESH_TOKEN_REMEMBER_DAYS);
  return days * 24 * 60 * 60 * 1000;
}

/** Domain المناسب للكوكي حسب الـ host (multi-tenant subdomains) */
function cookieDomain(req: Request): string | undefined {
  if (config.AUTH_COOKIE_DOMAIN) return config.AUTH_COOKIE_DOMAIN;

  const root = config.TENANT_ROOT_DOMAIN?.trim().toLowerCase();
  if (!root) return undefined;

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, '');

  // الكوكي تعمل على كل الـ subdomains فقط عندما يكون الطلب فعلاً على النطاق الجذر
  if (host === root || host.endsWith(`.${root}`)) return `.${root}`;

  // localhost / ngrok → host-only cookie
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
  // subdomains على نفس الـ root domain = same-site → lax
  if (cookieDomain(req)) return 'lax';
  // cross-site (مثلاً frontend localhost → API ngrok) يحتاج none + Secure
  if (isHttpsRequest(req) && config.NODE_ENV !== 'production') return 'none';
  // localhost:3000 → localhost:8000 = same-site
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
    maxAge: refreshTtlMs(rememberMe),
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

export class AuthSessionsService {
  /** إنشاء جلسة جهاز جديدة عند Login — يرجع الـ Refresh Token الخام (يوضع في الكوكي فقط) */
  static async createDeviceSession(input: {
    userId: number;
    tenantId?: number | null;
    rememberMe: boolean;
    req: Request;
    /** true = Login جديد يلغي باقي الأجهزة. false = السماح بأكثر من جهاز. */
    exclusiveSession?: boolean;
  }): Promise<{ refreshToken: string; deviceId: string; expiresAt: Date; jti: string }> {
    const exclusiveSession = input.exclusiveSession !== false;
    const secret = newSecret();
    const { browser, platform } = parseUserAgent(input.req);
    const ip = clientIp(input.req);
    const expiresAt = new Date(Date.now() + refreshTtlMs(input.rememberMe));
    const jti = crypto.randomUUID();

    const client = await pool.connect();
    let revokedCount = 0;
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

      const res = await client.query<{ id: string }>(
        `INSERT INTO user_devices
           (user_id, tenant_id, refresh_token_hash, browser, platform, ip, remember_me, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.userId,
          input.tenantId ?? null,
          sha256(secret),
          browser,
          platform,
          ip,
          input.rememberMe,
          expiresAt,
        ],
      );

      if (exclusiveSession) {
        await client.query('UPDATE users SET jti = $1 WHERE id = $2', [jti, input.userId]);
      } else {
        await client.query('UPDATE users SET jti = NULL WHERE id = $1 AND jti IS NOT NULL', [
          input.userId,
        ]);
      }
      await client.query('COMMIT');

      const deviceId = res.rows[0].id;
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
        device_id: deviceId,
        browser,
        platform,
        ip,
        remember_me: input.rememberMe,
      });

      return { refreshToken: `${deviceId}.${secret}`, deviceId, expiresAt, jti };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Refresh Rotation:
   * - توكن صالح → توكن جديد + إبطال القديم
   * - توكن قديم (مُستَبدَل) → إلغاء الجلسة + تسجيل محاولة مشبوهة
   */
  static async rotateDeviceSession(
    rawToken: string,
    req: Request,
  ): Promise<{
    refreshToken: string;
    device: DeviceSessionRow;
  }> {
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
      throw new HttpError(401, 'Session revoked', { code: 'SESSION_REVOKED' });
    }

    if (presentedHash !== device.refresh_token_hash) {
      // Replay attack: توكن قديم بعد الـ rotation → إلغاء الجلسة بالكامل
      const isOldRotatedToken = device.previous_token_hash === presentedHash;
      await this.revokeDevice(device.id, isOldRotatedToken ? 'refresh_token_reuse' : 'refresh_token_mismatch');
      logAuthEvent(
        'suspicious_activity',
        {
          reason: isOldRotatedToken ? 'refresh_token_reuse' : 'refresh_token_mismatch',
          device_id: device.id,
          user_id: device.user_id,
          ip: clientIp(req),
          browser: parseUserAgent(req).browser,
        },
        'warn',
      );
      throw new HttpError(401, 'Refresh token reuse detected — session revoked', {
        code: 'REFRESH_REUSE_DETECTED',
      });
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

    // Rotation: secret جديد + حفظ القديم لاكتشاف الـ replay
    const nextSecret = newSecret();
    const updated = await pool.query<DeviceSessionRow>(
      `UPDATE user_devices
       SET previous_token_hash = refresh_token_hash,
           refresh_token_hash = $2,
           last_used_at = NOW(),
           ip = $3,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [device.id, sha256(nextSecret), clientIp(req)],
    );

    logAuthEvent('refresh', { device_id: device.id, user_id: device.user_id });

    return {
      refreshToken: `${device.id}.${nextSecret}`,
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

  /** Logout جهاز واحد عبر الـ Refresh Token في الكوكي */
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

  /** Logout من جميع الأجهزة */
  static async revokeAllForUser(userId: number, reason: string): Promise<number> {
    const res = await pool.query(
      `UPDATE user_devices
       SET revoked_at = NOW(), revoked_reason = $2, updated_at = NOW()
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId, reason],
    );
    logAuthEvent('logout_all', { user_id: userId, revoked_count: res.rowCount });
    return res.rowCount ?? 0;
  }

  /** جلسات المستخدم النشطة (للاستعلام/الإدارة) */
  static async listActiveSessions(userId: number): Promise<
    Array<
      Pick<
        DeviceSessionRow,
        'id' | 'browser' | 'platform' | 'ip' | 'remember_me' | 'last_used_at' | 'created_at' | 'expires_at'
      >
    >
  > {
    const res = await pool.query(
      `SELECT id, browser, platform, ip, remember_me, last_used_at, created_at, expires_at
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
