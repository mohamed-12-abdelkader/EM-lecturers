import net from 'net';
import type { Request } from 'express';
import pool from '../db/pool';
import { HttpError } from '../utils';

export type StudentDeviceLimit = 'multiple_devices' | 'single_device';

export interface DeviceRestrictionSettings {
  student_device_limit: StudentDeviceLimit;
  single_device: boolean;
  multiple_devices: boolean;
}

export interface LoginIpEnforcement {
  allowed: boolean;
  ip_registered: boolean;
  status?: number;
  code?: string;
  message?: string;
}

const DEFAULT_LIMIT: StudentDeviceLimit = 'single_device';

const ACCOUNT_IP_MISMATCH_MESSAGE =
  'هذا الحساب مرتبط بجهاز آخر، ولا يُسمح بتسجيل الدخول من هذا الجهاز.';

async function loadTenantSettingsData(tenantId: number): Promise<Record<string, unknown>> {
  if (!tenantId) return {};
  const res = await pool.query<{ data: Record<string, unknown> | string | null }>(
    `SELECT data FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  const data = res.rows[0]?.data;
  if (!data) return {};
  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return typeof data === 'object' ? data : {};
}

function normalizeLimit(raw: unknown): StudentDeviceLimit {
  if (raw === 'multiple_devices' || raw === 'multi' || raw === 'unlimited') {
    return 'multiple_devices';
  }
  if (raw === 'single_device' || raw === 'single' || raw === 'one') {
    return 'single_device';
  }
  return DEFAULT_LIMIT;
}

function toSettings(limit: StudentDeviceLimit): DeviceRestrictionSettings {
  return {
    student_device_limit: limit,
    single_device: limit === 'single_device',
    multiple_devices: limit === 'multiple_devices',
  };
}

/** Normalize IPv4 / IPv6 for storage and comparison. */
export function normalizeIp(raw: unknown): string | null {
  if (raw == null) return null;
  let ip = String(raw).trim();
  if (!ip) return null;
  if (
    (ip.startsWith('"') && ip.endsWith('"')) ||
    (ip.startsWith("'") && ip.endsWith("'"))
  ) {
    ip = ip.slice(1, -1).trim();
  }

  if (ip.startsWith('[') && ip.includes(']')) {
    ip = ip.slice(1, ip.indexOf(']'));
  }

  ip = ip.split('%')[0].trim();

  const v4port = ip.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4port) ip = v4port[1];

  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];

  if (net.isIPv4(ip)) return ip;
  if (net.isIPv6(ip)) return ip.toLowerCase();
  return null;
}

export function ipsEqual(a: unknown, b: unknown): boolean {
  const na = normalizeIp(a);
  const nb = normalizeIp(b);
  if (!na || !nb) return false;
  return na === nb;
}

function headerIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return String(forwarded[0]).split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();
  return req.ip || req.socket?.remoteAddress || null;
}

function pickRawBodyIp(body: Record<string, unknown> | undefined): unknown {
  if (!body || typeof body !== 'object') return undefined;
  return (
    body.device_ip ??
    body.deviceIp ??
    body.registered_ip ??
    body.registeredIp ??
    body.client_ip ??
    body.clientIp ??
    body.login_ip ??
    body.loginIp ??
    body.ip
  );
}

export function extractBodyIp(body: Record<string, unknown> | undefined): string | null {
  return normalizeIp(pickRawBodyIp(body));
}

function bodyIpWasSent(body: Record<string, unknown> | undefined): boolean {
  const raw = pickRawBodyIp(body);
  return raw != null && String(raw).trim() !== '';
}

/**
 * IP المستخدم للربط/المقارنة:
 * 1) device_ip القادم من الفرونت (هذا هو معرف الجهاز حسب تصميم النظام)
 * 2) وإلا IP الطلب كاحتياطي
 */
export function resolveClientIp(req: Request, body?: Record<string, unknown>): string | null {
  const fromBody = extractBodyIp(body);
  if (fromBody) return fromBody;
  return normalizeIp(headerIp(req));
}

function storedIp(user: { registered_ip?: string | null; device_ip?: string | null }): string | null {
  return normalizeIp(user.registered_ip) || normalizeIp(user.device_ip);
}

export class StudentDeviceRestrictionService {
  static async ensureSchema() {
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS registered_ip TEXT,
        ADD COLUMN IF NOT EXISTS ip_registered_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS ip_reset_at TIMESTAMPTZ
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_ip_logs (
        id            SERIAL PRIMARY KEY,
        student_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tenant_id     INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
        old_ip        TEXT,
        new_ip        TEXT,
        action        VARCHAR(40) NOT NULL,
        performed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  static async getSettings(tenantId: number): Promise<DeviceRestrictionSettings> {
    if (!tenantId) return toSettings(DEFAULT_LIMIT);
    const data = await loadTenantSettingsData(tenantId);
    return toSettings(normalizeLimit(data.student_device_limit));
  }

  static async isSingleDevice(tenantId: number): Promise<boolean> {
    const settings = await this.getSettings(tenantId);
    return settings.student_device_limit === 'single_device';
  }

  static async setSettings(
    tenantId: number,
    patch: { student_device_limit?: StudentDeviceLimit },
  ): Promise<DeviceRestrictionSettings> {
    if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');

    const current = await this.getSettings(tenantId);
    const next = patch.student_device_limit
      ? normalizeLimit(patch.student_device_limit)
      : current.student_device_limit;

    if (next !== 'multiple_devices' && next !== 'single_device') {
      throw new HttpError(400, 'student_device_limit غير صالح. القيم: multiple_devices | single_device');
    }

    const data = await loadTenantSettingsData(tenantId);
    const merged = {
      ...data,
      student_device_limit: next,
    };

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [tenantId, JSON.stringify(merged)],
    );

    return toSettings(next);
  }

  private static async log(params: {
    studentId: number;
    tenantId: number | null;
    oldIp: string | null;
    newIp: string | null;
    action: 'bind' | 'rebind' | 'mismatch' | 'reset';
    performedBy: number | null;
  }) {
    try {
      await this.ensureSchema();
      await pool.query(
        `INSERT INTO student_ip_logs
           (student_id, tenant_id, old_ip, new_ip, action, performed_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          params.studentId,
          params.tenantId,
          params.oldIp,
          params.newIp,
          params.action,
          params.performedBy,
        ],
      );
    } catch (err) {
      console.error('student_ip_logs insert failed:', err);
    }
  }

  private static async persistIp(studentId: number, ip: string) {
    await this.ensureSchema();
    await pool.query(
      `UPDATE users
       SET device_ip = $1,
           registered_ip = $1,
           ip_registered_at = NOW(),
           ip_reset_at = NULL
       WHERE id = $2 AND role = 'student'`,
      [ip, studentId],
    );
  }

  /** Bind IP on first registration when the platform is in single-device mode. */
  static async bindOnRegister(params: {
    studentId: number;
    tenantId: number;
    req: Request;
    body?: Record<string, unknown>;
  }): Promise<{ bound: boolean; ip: string | null }> {
    const single = await this.isSingleDevice(params.tenantId);
    if (!single) return { bound: false, ip: null };

    await this.ensureSchema();

    const ip = resolveClientIp(params.req, params.body);
    if (!ip) return { bound: false, ip: null };

    await this.persistIp(params.studentId, ip);
    await this.log({
      studentId: params.studentId,
      tenantId: params.tenantId,
      oldIp: null,
      newIp: ip,
      action: 'bind',
      performedBy: null,
    });
    return { bound: true, ip };
  }

  /**
   * Login enforcement for students only. No-op when multiple_devices is enabled.
   */
  static async enforceOnLogin(params: {
    user: {
      id: number;
      role: string;
      tenant_id?: number | null;
      device_ip?: string | null;
      registered_ip?: string | null;
    };
    tenantId: number;
    req: Request;
    body?: Record<string, unknown>;
  }): Promise<LoginIpEnforcement> {
    if (params.user.role !== 'student') {
      return { allowed: true, ip_registered: false };
    }

    await this.ensureSchema();

    const settingsTenantId = Number(params.user.tenant_id) || params.tenantId;
    const single = await this.isSingleDevice(settingsTenantId);
    if (!single) {
      return { allowed: true, ip_registered: false };
    }

    const fresh = await pool.query<{ device_ip: string | null; registered_ip: string | null }>(
      `SELECT device_ip, registered_ip FROM users WHERE id = $1`,
      [params.user.id],
    );
    const accountIp = storedIp(fresh.rows[0] || params.user);
    const loginIp = resolveClientIp(params.req, params.body);

    if (accountIp) {
      if (bodyIpWasSent(params.body) && !extractBodyIp(params.body)) {
        await this.log({
          studentId: params.user.id,
          tenantId: settingsTenantId,
          oldIp: accountIp,
          newIp: String(pickRawBodyIp(params.body) ?? ''),
          action: 'mismatch',
          performedBy: null,
        });
        return {
          allowed: false,
          ip_registered: false,
          status: 403,
          code: 'ACCOUNT_IP_MISMATCH',
          message: ACCOUNT_IP_MISMATCH_MESSAGE,
        };
      }
      if (!loginIp) {
        return {
          allowed: false,
          ip_registered: false,
          status: 400,
          code: 'DEVICE_IP_REQUIRED',
          message: 'تعذر تحديد عنوان الجهاز. أعد المحاولة.',
        };
      }
      if (!ipsEqual(accountIp, loginIp)) {
        await this.log({
          studentId: params.user.id,
          tenantId: settingsTenantId,
          oldIp: accountIp,
          newIp: loginIp,
          action: 'mismatch',
          performedBy: null,
        });
        return {
          allowed: false,
          ip_registered: false,
          status: 403,
          code: 'ACCOUNT_IP_MISMATCH',
          message: ACCOUNT_IP_MISMATCH_MESSAGE,
        };
      }
      return { allowed: true, ip_registered: false };
    }

    if (loginIp) {
      await this.persistIp(params.user.id, loginIp);
      await this.log({
        studentId: params.user.id,
        tenantId: settingsTenantId,
        oldIp: null,
        newIp: loginIp,
        action: 'bind',
        performedBy: null,
      });
      params.user.device_ip = loginIp;
      params.user.registered_ip = loginIp;
      return { allowed: true, ip_registered: true };
    }

    return { allowed: true, ip_registered: false };
  }

  /**
   * مالك المنصة أو مدرس/أكاديمية حسابه على نفس الـ tenant.
   * (بعض المنصات owner_user_id مختلف عن حساب المدرس اللي بيدخل لوحة التحكم)
   */
  static async assertCanManagePlatformSettings(userId: number, tenantId: number) {
    const tenant = await pool.query<{ owner_user_id: number | null; is_active: boolean }>(
      `SELECT owner_user_id, is_active FROM tenants WHERE id = $1`,
      [tenantId],
    );
    if (!tenant.rowCount || !tenant.rows[0].is_active) {
      throw new HttpError(403, 'غير مصرح — هذه المنصة لا تخصك', { code: 'TENANT_FORBIDDEN' });
    }
    if (Number(tenant.rows[0].owner_user_id) === Number(userId)) return;

    const user = await pool.query<{ role: string; tenant_id: number | null }>(
      `SELECT role, tenant_id FROM users WHERE id = $1`,
      [userId],
    );
    const row = user.rows[0];
    const sameTenant = row?.tenant_id != null && Number(row.tenant_id) === Number(tenantId);
    const allowedRole = row?.role === 'teacher' || row?.role === 'academy';
    if (sameTenant && allowedRole) return;

    const courseOwner = await pool.query(
      `SELECT 1 FROM courses WHERE teacher_id = $1 AND tenant_id = $2 LIMIT 1`,
      [userId, tenantId],
    );
    if (courseOwner.rowCount && allowedRole) return;

    throw new HttpError(403, 'غير مصرح — هذه المنصة لا تخصك', { code: 'TENANT_FORBIDDEN' });
  }

  static async assertTeacherCanManageStudent(
    teacherId: number,
    tenantId: number,
    studentId: number,
  ) {
    const student = await pool.query<{
      id: number;
      name: string;
      phone: string | null;
      device_ip: string | null;
      registered_ip: string | null;
      tenant_id: number | null;
    }>(
      `SELECT id, name, phone, device_ip, registered_ip, tenant_id
       FROM users
       WHERE id = $1 AND role = 'student' AND tenant_id = $2
       LIMIT 1`,
      [studentId, tenantId],
    );

    if (!student.rowCount) {
      throw new HttpError(404, 'الطالب غير موجود على هذه المنصة', { code: 'STUDENT_NOT_FOUND' });
    }

    return student.rows[0];
  }

  static async resetStudentIp(params: {
    studentId: number;
    tenantId: number;
    performedBy: number;
    requireTenantOwner?: boolean;
  }) {
    await this.ensureSchema();

    let student: {
      id: number;
      name: string;
      phone: string | null;
      device_ip: string | null;
      registered_ip: string | null;
    };

    if (params.requireTenantOwner !== false) {
      student = await this.assertTeacherCanManageStudent(
        params.performedBy,
        params.tenantId,
        params.studentId,
      );
    } else {
      const r = await pool.query(
        `SELECT id, name, phone, device_ip, registered_ip
         FROM users WHERE id = $1 AND role = 'student' LIMIT 1`,
        [params.studentId],
      );
      if (!r.rowCount) {
        throw new HttpError(404, 'الطالب غير موجود', { code: 'STUDENT_NOT_FOUND' });
      }
      student = r.rows[0];
    }

    const oldIp = storedIp(student);

    await pool.query(
      `UPDATE users
       SET device_ip = NULL,
           registered_ip = NULL,
           ip_reset_at = NOW()
       WHERE id = $1 AND role = 'student'`,
      [student.id],
    );

    await this.log({
      studentId: student.id,
      tenantId: params.tenantId,
      oldIp,
      newIp: null,
      action: 'reset',
      performedBy: params.performedBy,
    });

    return {
      student_id: student.id,
      student_name: student.name,
      student_phone: student.phone,
      old_ip: oldIp,
      registered_ip: null,
      ip_reset_at: new Date().toISOString(),
    };
  }

  static async listLogs(studentId: number, tenantId: number, limit = 50) {
    await this.ensureSchema();
    const res = await pool.query(
      `SELECT id, student_id, tenant_id, old_ip, new_ip, action, performed_by, created_at
       FROM student_ip_logs
       WHERE student_id = $1 AND (tenant_id = $2 OR tenant_id IS NULL)
       ORDER BY created_at DESC
       LIMIT $3`,
      [studentId, tenantId, Math.min(Math.max(limit, 1), 200)],
    );
    return res.rows;
  }
}
