import { Router } from 'express';
import pool from '../db/pool';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { asyncWrapper, config, generateToken, sendEmail, HttpError, isAccessSessionReplaced, SESSION_REPLACED } from '../utils';
import { validate } from '../middleware/validateReq';
import { ForgotPassword, Login, ResetPassword, RegisterAdminOrTeacher } from './auth.modules';
import { TeacherManagedStudentsService } from '../services/teacherManagedStudents';
import { StudentDeviceRestrictionService } from '../services/studentDeviceRestriction';
import {
  AuthSessionsService,
  setRefreshCookie,
  clearRefreshCookie,
  readRefreshCookie,
} from '../services/authSessions';
import { authMiddleware } from '../middleware/authentication';

export const router = Router();

// ==================== Rate Limiting ====================

const authLimiterOptions = {
  standardHeaders: true as const,
  legacyHeaders: false,
  keyGenerator: (req: import('express').Request) => {
    const fwd = req.headers['x-forwarded-for'];
    const raw =
      typeof fwd === 'string' && fwd.trim()
        ? fwd.split(',')[0].trim()
        : req.ip || req.socket?.remoteAddress || '127.0.0.1';
    return ipKeyGenerator(raw);
  },
  validate: { xForwardedForHeader: false, trustProxy: false },
};

const loginLimiter = rateLimit({
  ...authLimiterOptions,
  windowMs: 15 * 60 * 1000,
  limit: 30,
  message: { message: 'محاولات تسجيل دخول كثيرة. حاول مرة أخرى بعد قليل.', code: 'RATE_LIMITED' },
});

const refreshLimiter = rateLimit({
  ...authLimiterOptions,
  windowMs: 15 * 60 * 1000,
  limit: 120,
  message: { message: 'Too many refresh attempts', code: 'RATE_LIMITED' },
});

const forgotPasswordLimiter = rateLimit({
  ...authLimiterOptions,
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: { message: 'محاولات كثيرة. حاول مرة أخرى لاحقاً.', code: 'RATE_LIMITED' },
});

router.post(
  '/login',
  loginLimiter,
  validate(Login),
  asyncWrapper(async (req, res) => {
    const { email, phone, student_code, password } = req.body;
    let effectiveTenantId = req.tenant!.id;

    const staffRoles = ['teacher', 'admin', 'employee', 'academy', 'academy_teacher'];

    if (student_code && !email && !phone) {
      const explicitSlug = (req.body.subdomain ?? req.body.tenant_subdomain) as
        | string
        | undefined;
      if (effectiveTenantId === 1 && explicitSlug) {
        const tRes = await pool.query<{ id: number }>(
          `SELECT id FROM tenants WHERE subdomain = $1 AND is_active = TRUE LIMIT 1`,
          [String(explicitSlug).trim().toLowerCase()],
        );
        if (!tRes.rowCount) {
          return res.status(400).json({
            message: 'المنصة غير موجودة أو غير مفعّلة لهذا الـ subdomain',
            code: 'TENANT_NOT_FOUND',
          });
        }
        effectiveTenantId = tRes.rows[0].id;
      }
      if (effectiveTenantId === 1) {
        return res.status(400).json({
          message: 'يرجى إرسال subdomain المنصة مع رقم الطالب',
          code: 'SUBDOMAIN_REQUIRED',
        });
      }
    }

    const queryUserByTenant = async (tenantId: number) => {
      if (student_code) {
        const user = await TeacherManagedStudentsService.findStudentByCode(
          student_code,
          tenantId,
        );
        return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
      }
      if (email) {
        const emailNorm = String(email).trim().toLowerCase();
        return pool.query(`SELECT * FROM users WHERE lower(trim(email)) = $1 AND tenant_id = $2`, [
          emailNorm,
          tenantId,
        ]);
      }
      return pool.query('SELECT * FROM users WHERE phone = $1 AND tenant_id = $2', [phone, tenantId]);
    };

    let userQuery = await queryUserByTenant(effectiveTenantId);

    // المدرس/الأدمن/الموظف: يُحدَّد الـ tenant تلقائياً من البريد أو الهاتف (بدون subdomain)
    if (!userQuery.rowCount && (email || phone)) {
      let globalStaffQuery;
      if (email) {
        const emailNorm = String(email).trim().toLowerCase();
        globalStaffQuery = await pool.query(
          `SELECT u.*, t.subdomain AS tenant_subdomain
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id AND t.is_active = true
           WHERE lower(trim(u.email)) = $1 AND u.role::text = ANY($2::text[])`,
          [emailNorm, staffRoles],
        );
      } else {
        globalStaffQuery = await pool.query(
          `SELECT u.*, t.subdomain AS tenant_subdomain
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id AND t.is_active = true
           WHERE u.phone = $1 AND u.role::text = ANY($2::text[])`,
          [phone, staffRoles],
        );
      }

      if (globalStaffQuery.rowCount && globalStaffQuery.rowCount > 1) {
        return res.status(409).json({
          message: 'يوجد أكثر من حساب بهذا البريد أو الهاتف. أرسل subdomain المنصة.',
          code: 'MULTIPLE_STAFF_ACCOUNTS',
          accounts: globalStaffQuery.rows.map((row) => ({
            role: row.role,
            subdomain: row.tenant_subdomain,
          })),
        });
      }

      if (globalStaffQuery.rowCount === 1) {
        userQuery = globalStaffQuery;
        effectiveTenantId = globalStaffQuery.rows[0].tenant_id;
      }
    }

    if (!userQuery.rowCount && effectiveTenantId === 1) {
      // Backward compatibility: some legacy root accounts may still have tenant_id = NULL.
      if (email) {
        const emailNorm = String(email).trim().toLowerCase();
        userQuery = await pool.query(
          `SELECT * FROM users WHERE lower(trim(email)) = $1 AND tenant_id IS NULL LIMIT 1`,
          [emailNorm],
        );
      } else {
        userQuery = await pool.query(
          `SELECT * FROM users WHERE phone = $1 AND tenant_id IS NULL LIMIT 1`,
          [phone],
        );
      }
      // Auto-link legacy account to default tenant after first successful lookup.
      if (userQuery.rowCount) {
        await pool.query(`UPDATE users SET tenant_id = 1 WHERE id = $1 AND tenant_id IS NULL`, [
          userQuery.rows[0].id,
        ]);
        userQuery.rows[0].tenant_id = 1;
      }
    }

    if (!userQuery.rowCount) {
      // للطالب فقط: تلميح بوجود الحساب على منصة أخرى
      if (effectiveTenantId === 1 && email) {
        const emailNorm = String(email).trim().toLowerCase();
        const crossTenant = await pool.query(
          `SELECT u.id, u.role, u.tenant_id, t.subdomain
           FROM users u
           LEFT JOIN tenants t ON t.id = u.tenant_id
           WHERE lower(trim(u.email)) = $1
           LIMIT 1`,
          [emailNorm],
        );
        if (crossTenant.rowCount) {
          const row = crossTenant.rows[0] as {
            tenant_id: number | null;
            subdomain: string | null;
            role: string;
          };
          if (row.role === 'student' && row.tenant_id && row.tenant_id !== 1) {
            return res.status(400).json({
              message: 'Account belongs to another tenant',
              code: 'TENANT_LOGIN_MISMATCH',
              expected_subdomain: row.subdomain,
            });
          }
        }
      }
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const user = userQuery.rows[0];
    if (user.role === 'teacher' && user.account_status && user.account_status !== 'active') {
      return res.status(403).json({
        message: 'Teacher account is not active',
        code: 'TEACHER_ACCOUNT_INACTIVE',
      });
    }
    if (user.role === 'student' && user.account_status && user.account_status !== 'active') {
      return res.status(403).json({
        message: 'حساب الطالب موقوف أو غير نشط',
        code: 'STUDENT_ACCOUNT_INACTIVE',
      });
    }

    const registrationSettings =
      await TeacherManagedStudentsService.getRegistrationSettings(effectiveTenantId);
    const studentCodeOnlyLogin =
      user.role === 'student' &&
      !!student_code &&
      !email &&
      !phone &&
      registrationSettings.registration_mode === 'teacher_registration';

    if (!studentCodeOnlyLogin) {
      if (!password) {
        return res.status(400).json({ message: 'password is required' });
      }
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }
    } else if (password) {
      const validPassword = await bcrypt.compare(password, user.password);
      if (!validPassword) {
        return res.status(400).json({ message: 'Invalid credentials' });
      }
    }

    // Device/IP restriction for students (skipped when platform allows multiple devices)
    let ipRegistered = false;
    if (user.role === 'student') {
      const ipCheck = await StudentDeviceRestrictionService.enforceOnLogin({
        user,
        tenantId: effectiveTenantId,
        req,
        body: req.body,
      });
      if (!ipCheck.allowed) {
        return res.status(ipCheck.status || 403).json({
          success: false,
          code: ipCheck.code,
          message: ipCheck.message,
        });
      }
      ipRegistered = ipCheck.ip_registered;
    }

    // Device Session + Refresh Cookie (HttpOnly) — الـ Refresh Token لا يُرسل في الـ JSON
    const rememberMe = req.body.remember_me === true;
    const exclusiveSession = await StudentDeviceRestrictionService.shouldReplaceOtherSessions(
      user.role,
      effectiveTenantId,
    );
    const session = await AuthSessionsService.createDeviceSession({
      userId: user.id,
      tenantId: effectiveTenantId,
      rememberMe,
      req,
      exclusiveSession,
    });
    const token = await generateToken(user, pool, {
      sessionTenantId: effectiveTenantId,
      jti: exclusiveSession ? session.jti : undefined,
      persistJti: exclusiveSession,
    });
    setRefreshCookie(req, res, session.refreshToken, rememberMe);
    AuthSessionsService.logLogin(
      user.id,
      user.role,
      student_code ? 'student_code' : email ? 'email' : 'phone',
      req,
    );

    const tenantResult = await pool.query(
      `SELECT id, subdomain, display_name FROM tenants WHERE id = $1 LIMIT 1`,
      [effectiveTenantId],
    );
    const tenant = tenantResult.rowCount ? tenantResult.rows[0] : null;

    // جلب صلاحيات الموظف إذا كان admin
    let employeePermissions = null;
    let employeeData = null;
    if (user.role === 'admin' || user.role === 'employee') {
      const employeeResult = await pool.query(
        `SELECT e.*, u.name as user_name, u.email as user_email 
         FROM employees e 
         JOIN users u ON e.user_id = u.id 
         WHERE e.user_id = $1 AND e.is_active = true`,
        [user.id],
      );
      if (employeeResult.rowCount && employeeResult.rowCount > 0) {
        employeeData = employeeResult.rows[0];
        employeePermissions = employeeData.permissions;
      }
    }

    res.json({
      success: true,
      ip_registered: ipRegistered,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        student_code: user.student_code ?? null,
        role: user.role,
        avatar: user.avatar,
        must_change_password: user.must_change_password === true,
      },
      /** Access Token (قصير العمر) — احفظه في الذاكرة فقط، ليس LocalStorage */
      token,
      token_type: 'Bearer',
      expires_in: config.ACCESS_TOKEN_TTL,
      /** الجلسة الطويلة محفوظة في HttpOnly Cookie (em_refresh) — لا تُرسل في JSON */
      tenant,
      employee_permissions: employeePermissions,
      employee_data: employeeData,
    });
  }),
);

// ==================== Auth Session Endpoints ====================

function extractBearerToken(req: import('express').Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.trim()) {
    const match = authHeader.trim().match(/^Bearer\s+(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  const xAccess = req.headers['x-access-token'];
  if (typeof xAccess === 'string' && xAccess.trim()) return xAccess.trim();
  return null;
}

const PUBLIC_USER_FIELDS = `id, name, email, phone, student_code, role, avatar, tenant_id, must_change_password, account_status, jti`;

/**
 * POST /auth/refresh
 * يقرأ الـ Refresh Token من HttpOnly Cookie فقط، يعمل Rotation، ويرجع Access Token جديد.
 */
router.post(
  '/auth/refresh',
  refreshLimiter,
  asyncWrapper(async (req, res) => {
    const rawToken = readRefreshCookie(req);
    if (!rawToken) {
      return res.status(401).json({
        message: 'Refresh token missing',
        code: 'MISSING_REFRESH_TOKEN',
      });
    }

    let rotation;
    try {
      rotation = await AuthSessionsService.rotateDeviceSession(rawToken, req);
    } catch (err) {
      // أي فشل → امسح الكوكي (جلسة ملغاة / توكن معاد استخدامه / منتهي)
      clearRefreshCookie(req, res);
      if (err instanceof HttpError) {
        return res.status(err.status).json({
          message: err.message,
          code: (err.details?.code as string) || 'INVALID_REFRESH_TOKEN',
        });
      }
      throw err;
    }

    const { device, refreshToken } = rotation;

    const userRes = await pool.query(
      `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1 LIMIT 1`,
      [device.user_id],
    );
    if (!userRes.rowCount) {
      await AuthSessionsService.revokeDevice(device.id, 'user_not_found');
      clearRefreshCookie(req, res);
      return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const user = userRes.rows[0];
    if (
      (user.role === 'teacher' || user.role === 'student') &&
      user.account_status &&
      user.account_status !== 'active'
    ) {
      await AuthSessionsService.revokeDevice(device.id, 'account_inactive');
      clearRefreshCookie(req, res);
      return res.status(403).json({
        message: 'Account is not active',
        code: user.role === 'teacher' ? 'TEACHER_ACCOUNT_INACTIVE' : 'STUDENT_ACCOUNT_INACTIVE',
      });
    }

    // Access Token جديد + تحديث الـ Refresh Cookie (Rotation)
    const accessToken = await generateToken(user, pool, {
      sessionTenantId: device.tenant_id ?? user.tenant_id,
      jti: user.jti,
    });
    setRefreshCookie(req, res, refreshToken, device.remember_me);

    res.json({
      token: accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        student_code: user.student_code ?? null,
        role: user.role,
        avatar: user.avatar,
        must_change_password: user.must_change_password === true,
      },
    });
  }),
);

/**
 * POST /auth/logout
 * يلغي جلسة الجهاز الحالي ويمسح الـ Refresh Cookie.
 */
router.post(
  '/auth/logout',
  asyncWrapper(async (req, res) => {
    const rawToken = readRefreshCookie(req);
    let deviceId: string | null = null;
    let userId: number | null = null;

    if (rawToken) {
      const revoked = await AuthSessionsService.revokeByToken(rawToken, 'logout');
      if (revoked) {
        deviceId = revoked.id;
        userId = revoked.user_id;
      }
    }

    clearRefreshCookie(req, res);
    AuthSessionsService.logLogout(userId, deviceId, req);
    res.json({ message: 'Logged out successfully' });
  }),
);

/**
 * POST /auth/logout-all
 * يلغي جميع جلسات المستخدم على كل الأجهزة (يتطلب Access Token صالح).
 */
router.post(
  '/auth/logout-all',
  authMiddleware([]),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const revokedCount = await AuthSessionsService.revokeAllForUser(userId, 'logout_all');
    clearRefreshCookie(req, res);
    res.json({ message: 'Logged out from all devices', revoked_sessions: revokedCount });
  }),
);

/**
 * GET /auth/me
 * يتحقق من الـ Access Token فقط — بدون Refresh.
 * منتهي؟ → 401 والـ Frontend يستدعي /auth/refresh.
 */
router.get(
  '/auth/me',
  asyncWrapper(async (req, res) => {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: 'Unauthorized', code: 'MISSING_TOKEN' });
    }

    let decoded: { id?: unknown; tid?: unknown; jti?: unknown };
    try {
      decoded = jwt.verify(token, config.SECRET_KEY) as { id?: unknown; tid?: unknown; jti?: unknown };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name;
      if (name === 'TokenExpiredError') {
        return res.status(401).json({ message: 'Access token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ message: 'Invalid token', code: 'INVALID_TOKEN' });
    }

    const userId = Number(decoded.id);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ message: 'Invalid token', code: 'INVALID_TOKEN' });
    }

    const userRes = await pool.query(
      `SELECT ${PUBLIC_USER_FIELDS} FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!userRes.rowCount) {
      return res.status(401).json({ message: 'User not found', code: 'USER_NOT_FOUND' });
    }

    const user = userRes.rows[0];
    if (isAccessSessionReplaced(decoded, user)) {
      return res.status(401).json(SESSION_REPLACED);
    }
    const tenantId = decoded.tid != null ? Number(decoded.tid) : user.tenant_id;
    let tenant = null;
    if (tenantId != null && Number.isInteger(Number(tenantId))) {
      const tenantRes = await pool.query(
        `SELECT id, subdomain, display_name FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId],
      );
      tenant = tenantRes.rowCount ? tenantRes.rows[0] : null;
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        student_code: user.student_code ?? null,
        role: user.role,
        avatar: user.avatar,
        must_change_password: user.must_change_password === true,
      },
      tenant,
    });
  }),
);

/**
 * GET /auth/sessions
 * قائمة أجهزة المستخدم النشطة (لإدارة الجلسات من الواجهة).
 */
router.get(
  '/auth/sessions',
  authMiddleware([]),
  asyncWrapper(async (req, res) => {
    const sessions = await AuthSessionsService.listActiveSessions(req.user!.id);
    res.json({ sessions });
  }),
);

router.post('/forgot-password', forgotPasswordLimiter, validate(ForgotPassword), async (req, res) => {
  const { email } = req.body;
  const tenantId = req.tenant!.id;

  const result = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
    email,
    tenantId,
  ]);
  if (!result.rowCount) return res.status(200).json({ message: 'If user exists, email was sent' });

  const token = crypto.randomBytes(32).toString('hex');
  await pool.query('INSERT INTO password_resets (user_id, token) VALUES ($1, $2)', [
    result.rows[0].id,
    token,
  ]);

  const resetLink = `${config.FRONTEND_HOST}/reset-password?token=${token}`;
  await sendEmail(
    email,
    'Password Reset',
    `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`,
  );

  res.status(200).json({ message: 'If user exists, email was sent' });
});

router.post('/reset-password', validate(ResetPassword), async (req, res) => {
  const { token, password } = req.body;

  const result = await pool.query('SELECT user_id FROM password_resets WHERE token = $1', [token]);
  if (!result.rowCount) return res.status(400).json({ message: 'Invalid or expired token' });

  const userId = result.rows[0].user_id;
  const hashed = await bcrypt.hash(password, 10);
  await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
  await pool.query('DELETE FROM password_resets WHERE token = $1', [token]);

  res.status(200).json({ message: 'Password updated successfully' });
});

// إنشاء أدمن جديد
router.post(
  '/register-admin',
  validate(RegisterAdminOrTeacher),
  asyncWrapper(async (req, res) => {
    const { name, email, phone, password, role } = req.body;

    // التحقق من عدم وجود المستخدم
    const tenantId = req.tenant!.id;
    let existingQuery;
    if (email) {
      existingQuery = await pool.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
        email,
        tenantId,
      ]);
    } else if (phone) {
      existingQuery = await pool.query('SELECT id FROM users WHERE phone = $1 AND tenant_id = $2', [
        phone,
        tenantId,
      ]);
    }

    if (existingQuery?.rowCount && existingQuery.rowCount > 0) {
      return res.status(400).json({
        message: 'User already exists with this email or phone',
      });
    }

    // تشفير كلمة المرور
    const hashedPassword = await bcrypt.hash(password, 10);

    // إنشاء المستخدم
    const userResult = await pool.query(
      `INSERT INTO users (name, email, phone, password, role, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, role, avatar`,
      [name, email, phone, hashedPassword, role || 'admin', tenantId],
    );

    const user = userResult.rows[0];

    // إنشاء employee record إذا كان admin
    if (user.role === 'admin') {
      await pool.query(
        `INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          user.id,
          user.name,
          user.email,
          user.phone,
          JSON.stringify([
            'can_add_teachers',
            'can_edit_teachers',
            'can_delete_teachers',
            'can_manage_students',
            'can_manage_courses',
            'can_manage_accounting',
            'can_manage_study_groups',
            'can_view_reports',
            'can_manage_employees',
            'can_manage_tasks',
          ]),
          user.id,
        ],
      );
    }

    // إنشاء token + جلسة جهاز واحدة (تلغي أي جلسة سابقة)
    const session = await AuthSessionsService.createDeviceSession({
      userId: user.id,
      tenantId,
      rememberMe: false,
      req,
    });
    const token = await generateToken(user, pool, { sessionTenantId: tenantId, jti: session.jti });
    setRefreshCookie(req, res, session.refreshToken, false);
    AuthSessionsService.logLogin(user.id, user.role, 'register', req);

    res.status(201).json({
      message: 'Admin created successfully',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
      },
      token,
    });
  }),
);
