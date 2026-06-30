"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const pool_1 = __importDefault(require("../db/pool"));
const bcrypt_1 = __importDefault(require("bcrypt"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const utils_1 = require("../utils");
const validateReq_1 = require("../middleware/validateReq");
const auth_modules_1 = require("./auth.modules");
const teacherManagedStudents_1 = require("../services/teacherManagedStudents");
exports.router = (0, express_1.Router)();
exports.router.post('/login', (0, validateReq_1.validate)(auth_modules_1.Login), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { email, phone, student_code, password, device_ip } = req.body;
    let effectiveTenantId = req.tenant.id;
    const staffRoles = ['teacher', 'admin', 'employee'];
    if (student_code && !email && !phone) {
        const explicitSlug = (req.body.subdomain ?? req.body.tenant_subdomain);
        if (effectiveTenantId === 1 && explicitSlug) {
            const tRes = await pool_1.default.query(`SELECT id FROM tenants WHERE subdomain = $1 AND is_active = TRUE LIMIT 1`, [String(explicitSlug).trim().toLowerCase()]);
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
    const queryUserByTenant = async (tenantId) => {
        if (student_code) {
            const user = await teacherManagedStudents_1.TeacherManagedStudentsService.findStudentByCode(student_code, tenantId);
            return { rowCount: user ? 1 : 0, rows: user ? [user] : [] };
        }
        if (email) {
            const emailNorm = String(email).trim().toLowerCase();
            return pool_1.default.query(`SELECT * FROM users WHERE lower(trim(email)) = $1 AND tenant_id = $2`, [
                emailNorm,
                tenantId,
            ]);
        }
        return pool_1.default.query('SELECT * FROM users WHERE phone = $1 AND tenant_id = $2', [phone, tenantId]);
    };
    let userQuery = await queryUserByTenant(effectiveTenantId);
    // المدرس/الأدمن/الموظف: يُحدَّد الـ tenant تلقائياً من البريد أو الهاتف (بدون subdomain)
    if (!userQuery.rowCount && (email || phone)) {
        let globalStaffQuery;
        if (email) {
            const emailNorm = String(email).trim().toLowerCase();
            globalStaffQuery = await pool_1.default.query(`SELECT u.*, t.subdomain AS tenant_subdomain
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id AND t.is_active = true
           WHERE lower(trim(u.email)) = $1 AND u.role::text = ANY($2::text[])`, [emailNorm, staffRoles]);
        }
        else {
            globalStaffQuery = await pool_1.default.query(`SELECT u.*, t.subdomain AS tenant_subdomain
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id AND t.is_active = true
           WHERE u.phone = $1 AND u.role::text = ANY($2::text[])`, [phone, staffRoles]);
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
            userQuery = await pool_1.default.query(`SELECT * FROM users WHERE lower(trim(email)) = $1 AND tenant_id IS NULL LIMIT 1`, [emailNorm]);
        }
        else {
            userQuery = await pool_1.default.query(`SELECT * FROM users WHERE phone = $1 AND tenant_id IS NULL LIMIT 1`, [phone]);
        }
        // Auto-link legacy account to default tenant after first successful lookup.
        if (userQuery.rowCount) {
            await pool_1.default.query(`UPDATE users SET tenant_id = 1 WHERE id = $1 AND tenant_id IS NULL`, [
                userQuery.rows[0].id,
            ]);
            userQuery.rows[0].tenant_id = 1;
        }
    }
    if (!userQuery.rowCount) {
        // للطالب فقط: تلميح بوجود الحساب على منصة أخرى
        if (effectiveTenantId === 1 && email) {
            const emailNorm = String(email).trim().toLowerCase();
            const crossTenant = await pool_1.default.query(`SELECT u.id, u.role, u.tenant_id, t.subdomain
           FROM users u
           LEFT JOIN tenants t ON t.id = u.tenant_id
           WHERE lower(trim(u.email)) = $1
           LIMIT 1`, [emailNorm]);
            if (crossTenant.rowCount) {
                const row = crossTenant.rows[0];
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
    const registrationSettings = await teacherManagedStudents_1.TeacherManagedStudentsService.getRegistrationSettings(effectiveTenantId);
    const studentCodeOnlyLogin = user.role === 'student' &&
        !!student_code &&
        !email &&
        !phone &&
        registrationSettings.registration_mode === 'teacher_registration';
    if (!studentCodeOnlyLogin) {
        if (!password) {
            return res.status(400).json({ message: 'password is required' });
        }
        const validPassword = await bcrypt_1.default.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
    }
    else if (password) {
        const validPassword = await bcrypt_1.default.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
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
        }
        else {
            // Case B: Student has NO saved IP (old accounts)
            // If device_ip is provided, save it
            if (device_ip) {
                await pool_1.default.query('UPDATE users SET device_ip = $1 WHERE id = $2', [device_ip, user.id]);
                // Update user object to reflect the change
                user.device_ip = device_ip;
            }
            // Allow login even without device_ip for old accounts
        }
    }
    const token = await (0, utils_1.generateToken)(user, pool_1.default, { sessionTenantId: effectiveTenantId });
    const tenantResult = await pool_1.default.query(`SELECT id, subdomain, display_name FROM tenants WHERE id = $1 LIMIT 1`, [effectiveTenantId]);
    const tenant = tenantResult.rowCount ? tenantResult.rows[0] : null;
    // جلب صلاحيات الموظف إذا كان admin
    let employeePermissions = null;
    let employeeData = null;
    if (user.role === 'admin' || user.role === 'employee') {
        const employeeResult = await pool_1.default.query(`SELECT e.*, u.name as user_name, u.email as user_email 
         FROM employees e 
         JOIN users u ON e.user_id = u.id 
         WHERE e.user_id = $1 AND e.is_active = true`, [user.id]);
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
            student_code: user.student_code ?? null,
            role: user.role,
            avatar: user.avatar,
            must_change_password: user.must_change_password === true,
        },
        token,
        tenant,
        employee_permissions: employeePermissions,
        employee_data: employeeData,
    });
}));
exports.router.post('/forgot-password', (0, validateReq_1.validate)(auth_modules_1.ForgotPassword), async (req, res) => {
    const { email } = req.body;
    const tenantId = req.tenant.id;
    const result = await pool_1.default.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
        email,
        tenantId,
    ]);
    if (!result.rowCount)
        return res.status(200).json({ message: 'If user exists, email was sent' });
    const token = node_crypto_1.default.randomBytes(32).toString('hex');
    await pool_1.default.query('INSERT INTO password_resets (user_id, token) VALUES ($1, $2)', [
        result.rows[0].id,
        token,
    ]);
    const resetLink = `${utils_1.config.FRONTEND_HOST}/reset-password?token=${token}`;
    await (0, utils_1.sendEmail)(email, 'Password Reset', `<p>Click <a href="${resetLink}">here</a> to reset your password.</p>`);
    res.status(200).json({ message: 'If user exists, email was sent' });
});
exports.router.post('/reset-password', (0, validateReq_1.validate)(auth_modules_1.ResetPassword), async (req, res) => {
    const { token, password } = req.body;
    const result = await pool_1.default.query('SELECT user_id FROM password_resets WHERE token = $1', [token]);
    if (!result.rowCount)
        return res.status(400).json({ message: 'Invalid or expired token' });
    const userId = result.rows[0].user_id;
    const hashed = await bcrypt_1.default.hash(password, 10);
    await pool_1.default.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, userId]);
    await pool_1.default.query('DELETE FROM password_resets WHERE token = $1', [token]);
    res.status(200).json({ message: 'Password updated successfully' });
});
// إنشاء أدمن جديد
exports.router.post('/register-admin', (0, validateReq_1.validate)(auth_modules_1.RegisterAdminOrTeacher), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { name, email, phone, password, role } = req.body;
    // التحقق من عدم وجود المستخدم
    const tenantId = req.tenant.id;
    let existingQuery;
    if (email) {
        existingQuery = await pool_1.default.query('SELECT id FROM users WHERE email = $1 AND tenant_id = $2', [
            email,
            tenantId,
        ]);
    }
    else if (phone) {
        existingQuery = await pool_1.default.query('SELECT id FROM users WHERE phone = $1 AND tenant_id = $2', [
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
    const hashedPassword = await bcrypt_1.default.hash(password, 10);
    // إنشاء المستخدم
    const userResult = await pool_1.default.query(`INSERT INTO users (name, email, phone, password, role, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, phone, role, avatar`, [name, email, phone, hashedPassword, role || 'admin', tenantId]);
    const user = userResult.rows[0];
    // إنشاء employee record إذا كان admin
    if (user.role === 'admin') {
        await pool_1.default.query(`INSERT INTO employees (user_id, name, email, phone, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`, [
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
        ]);
    }
    // إنشاء token
    const token = await (0, utils_1.generateToken)(user, pool_1.default, { sessionTenantId: tenantId });
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
}));
