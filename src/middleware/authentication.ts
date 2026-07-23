import { RequestHandler, Request, Response } from 'express';
import * as jwt from 'jsonwebtoken';
import { config, generateToken } from '../utils';
import pool from '../db/pool';
import { User } from '../db/types';

type Roles = 'student' | 'teacher' | 'admin' | 'employee';

type UserRow = User & {
  tenant_id?: number | null;
  account_status?: 'active' | 'inactive' | 'suspended' | null;
};

/** استخراج التوكن من Authorization أو X-Access-Token بشكل متسامح */
function extractAccessToken(req: Request): string | null {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const trimmed = authHeader.trim();
    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]?.trim()) return bearerMatch[1].trim();
    // بعض العملاء يرسلون التوكن خامًا بدون Bearer
    if (!trimmed.includes(' ') && trimmed.length > 20) return trimmed;
  }

  const xAccess =
    req.headers['x-access-token'] ||
    req.headers['X-Access-Token'] ||
    req.headers['x-accessToken'];
  if (typeof xAccess === 'string' && xAccess.trim()) return xAccess.trim();
  if (Array.isArray(xAccess) && xAccess[0]?.trim()) return xAccess[0].trim();

  return null;
}

/**
 * مدرّس يملك كورسًا في المسار (/api/course/:id/...) وكل الطلاب المشتركين من نفس tenant الـ Host
 * (أو لا يوجد مشتركون بعد): يُسمح بالعمل حتى لو tid في التوكن أو users.tenant_id غير متزامنين.
 */
async function teacherOwnedCourseAlignsWithRequestTenant(
  req: Request,
  user: UserRow,
  tenant: { id: number },
): Promise<boolean> {
  if (user.role !== 'teacher') return false;

  const raw = (req.originalUrl || req.path || '').split('?')[0];
  const m = raw.match(/\/course\/(\d+)/);
  if (!m) return false;
  const courseId = Number(m[1]);
  if (!Number.isInteger(courseId) || courseId <= 0) return false;

  const owns = await pool.query(`SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`, [
    courseId,
    user.id,
  ]);
  if (!owns.rowCount) return false;

  const crossTenantStudent = await pool.query(
    `SELECT 1 FROM enrollments e
     INNER JOIN users st ON st.id = e.user_id AND st.role = 'student'
     WHERE e.course_id = $1 AND st.tenant_id IS DISTINCT FROM $2
     LIMIT 1`,
    [courseId, tenant.id],
  );
  if (crossTenantStudent.rowCount) return false;

  return true;
}

async function assertRequestTenantMatchesUserAndToken(
  req: Request,
  res: Response,
  decoded: { tid?: unknown },
  user: UserRow,
): Promise<boolean> {
  const tenant = req.tenant;
  if (!tenant) return true;
  const tokenTid = decoded.tid !== undefined && decoded.tid !== null ? Number(decoded.tid) : null;

  const dbTenantMatchesHost = user.tenant_id != null && user.tenant_id === tenant.id;

  const userIsOwnerOfRequestTenant = async (): Promise<boolean> => {
    const r = await pool.query(
      'SELECT 1 FROM tenants WHERE id = $1 AND owner_user_id = $2 LIMIT 1',
      [tenant.id, user.id],
    );
    return Boolean(r.rowCount);
  };

  if (tokenTid === null) {
    // Old tokens without tid: allow when DB tenant matches host, or platform owner (even if users.tenant_id is stale).
    if (dbTenantMatchesHost) return true;
    if (tenant.id !== 1) {
      if (await userIsOwnerOfRequestTenant()) return true;
      if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant)) return true;
      res.status(401).json({ message: 'Re-authentication required for this host' });
      return false;
    }
  } else {
    if (Number.isNaN(tokenTid)) {
      res.status(401).json({ message: 'Session is not valid for this site' });
      return false;
    }
    // Wrong tid in token but DB says this user belongs to this host — trust DB (mis-issued tokens).
    if (tokenTid !== tenant.id) {
      if (dbTenantMatchesHost) return true;
      if (await userIsOwnerOfRequestTenant()) return true;
      if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant)) return true;
      res.status(401).json({ message: 'Session is not valid for this site' });
      return false;
    }
  }

  if (user.tenant_id != null && user.tenant_id !== tenant.id) {
    if (await userIsOwnerOfRequestTenant()) return true;
    if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant)) return true;
    res.status(403).json({ message: 'Forbidden: tenant mismatch' });
    return false;
  }
  return true;
}

async function refreshSessionToken(
  res: Response,
  req: Request,
  user: UserRow,
): Promise<string> {
  const newToken = await generateToken(user, pool, {
    sessionTenantId: (req as Request & { tenant?: { id: number } }).tenant?.id,
  });
  res.setHeader('X-Access-Token', newToken);
  // Allow browsers / axios to read refreshed token across origins when CORS exposes it.
  const existing = res.getHeader('Access-Control-Expose-Headers');
  const expose = typeof existing === 'string' ? existing : Array.isArray(existing) ? existing.join(',') : '';
  if (!/x-access-token/i.test(expose)) {
    res.setHeader(
      'Access-Control-Expose-Headers',
      expose ? `${expose}, X-Access-Token` : 'X-Access-Token',
    );
  }
  return newToken;
}

export function authMiddleware(roles: Roles[] = []): RequestHandler {
  return async (req, res, next) => {
    const token = extractAccessToken(req);

    if (!token) {
      return res.status(401).json({
        message: 'Unauthorized',
        code: 'MISSING_TOKEN',
        hint: 'أضف Authorization: Bearer <token> أو أعد تسجيل الدخول',
      });
    }

    try {
      const decoded = jwt.verify(token, config.SECRET_KEY) as any;
      const { id } = decoded;

      // التحقق من أن id موجود وصحيح
      if (!id || isNaN(Number(id))) {
        return res.status(401).json({
          message: 'Invalid token: invalid user id',
        });
      }

      // Fetch user from DB
      const result = await pool.query<UserRow>(
        'SELECT id, role, jti, tenant_id, account_status FROM users WHERE id = $1',
        [id],
      );

      if (!result.rowCount) {
        return res.status(401).json({ message: 'User not found' });
      }

      const user = result.rows[0];

      if (user.role === 'teacher' && user.account_status && user.account_status !== 'active') {
        return res.status(403).json({
          message: 'Teacher account is not active',
          code: 'TEACHER_ACCOUNT_INACTIVE',
        });
      }

      if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user))) return;

      // Role-based access check (only if roles are specified)
      if (roles.length > 0 && !roles.includes(user.role)) {
        return res.status(403).json({
          message: 'Forbidden: insufficient role',
          details: {
            user_role: user.role,
            required_roles: roles,
            user_id: user.id,
          },
        });
      }

      // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)

      req.user = user;
      next();
    } catch (error: any) {
      // Auto-refresh for students/teachers if token is expired (keep session alive)
      if (error?.name === 'TokenExpiredError') {
        try {
          const decoded = jwt.verify(token, config.SECRET_KEY, { ignoreExpiration: true }) as any;
          const { id } = decoded || {};

          if (!id || isNaN(Number(id))) {
            return res.status(401).json({ message: 'Invalid token: invalid user id' });
          }

          const result = await pool.query<UserRow>(
            'SELECT id, role, jti, tenant_id, account_status FROM users WHERE id = $1',
            [id],
          );
          if (!result.rowCount) return res.status(401).json({ message: 'User not found' });

          const user = result.rows[0];

          if (user.role === 'teacher' && user.account_status && user.account_status !== 'active') {
            return res.status(403).json({
              message: 'Teacher account is not active',
              code: 'TEACHER_ACCOUNT_INACTIVE',
            });
          }

          if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user))) return;

          if (user.role === 'student' || user.role === 'teacher') {
            await refreshSessionToken(res, req, user);
            req.user = user;
            return next();
          }

          return res.status(401).json({ message: 'Token expired' });
        } catch (innerErr) {
          console.error('JWT refresh error:', innerErr);
          return res.status(401).json({ message: 'Invalid token' });
        }
      }

      console.error('JWT verification error:', error);
      return res.status(401).json({ message: 'Invalid token' });
    }
  };
}

// Middleware خاص للطلاب فقط
export function studentAuthMiddleware(): RequestHandler {
  return authMiddleware(['student']);
}

// Middleware للطلاب والمعلمين
export function studentTeacherAuthMiddleware(): RequestHandler {
  return authMiddleware(['student', 'teacher']);
}

// Middleware بدون قيود على الأدوار (للمصادقة فقط)
export function authOnlyMiddleware(): RequestHandler {
  return authMiddleware([]);
}

// Middleware خاص للطلاب فقط
export function studentOnlyMiddleware(): RequestHandler {
  return authMiddleware(['student']);
}

// Middleware بدون قيود على الأدوار (للمصادقة فقط) - نسخة محسنة
export function simpleAuthMiddleware(): RequestHandler {
  return authMiddleware([]);
}
