import { Router } from 'express';
import pool from '../db/pool';
import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { asyncWrapper, config, generateToken, sendEmail } from '../utils';
import { validate } from '../middleware/validateReq';
import { ForgotPassword, Login, ResetPassword, RegisterAdminOrTeacher } from './auth.modules';

export const router = Router();

router.post(
  '/login',
  validate(Login),
  asyncWrapper(async (req, res) => {
    const { email, phone, password, device_ip } = req.body;
    const tenantId = req.tenant!.id;

    let userQuery;
    if (email) {
      const emailNorm = String(email).trim().toLowerCase();
      userQuery = await pool.query(
        `SELECT * FROM users WHERE lower(trim(email)) = $1 AND tenant_id = $2`,
        [emailNorm, tenantId],
      );
    } else {
      userQuery = await pool.query('SELECT * FROM users WHERE phone = $1 AND tenant_id = $2', [
        phone,
        tenantId,
      ]);
    }

    if (!userQuery.rowCount && tenantId === 1) {
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
      // Better diagnostics on default host: account may exist under another tenant.
      if (tenantId === 1 && email) {
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
          const row = crossTenant.rows[0] as { tenant_id: number | null; subdomain: string | null };
          if (row.tenant_id && row.tenant_id !== 1) {
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
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Device IP binding logic for students only
    if (user.role === 'student') {
      // Case A: Student already has a saved IP
      if (user.device_ip) {
        // IP is required for students with saved IP
        if (!device_ip) {
          return res.status(400).json({
            success: false,
            message: 'device_ip is required for this account',
          });
        }
        // Compare saved IP with sent IP
        if (user.device_ip !== device_ip) {
          return res.status(403).json({
            success: false,
            message: 'غير مسموح لك بتسجيل الدخول من جهاز مختلف',
          });
        }
      } else {
        // Case B: Student has NO saved IP (old accounts)
        // If device_ip is provided, save it
        if (device_ip) {
          await pool.query('UPDATE users SET device_ip = $1 WHERE id = $2', [device_ip, user.id]);
          // Update user object to reflect the change
          user.device_ip = device_ip;
        }
        // Allow login even without device_ip for old accounts
      }
    }

    const token = await generateToken(user, pool, { sessionTenantId: tenantId });

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
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
      },
      token,
      employee_permissions: employeePermissions,
      employee_data: employeeData,
    });
  }),
);

router.post('/forgot-password', validate(ForgotPassword), async (req, res) => {
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

    // إنشاء token
    const token = await generateToken(user, pool, { sessionTenantId: tenantId });

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
