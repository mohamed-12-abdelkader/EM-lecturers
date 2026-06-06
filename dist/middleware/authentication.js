"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.studentAuthMiddleware = studentAuthMiddleware;
exports.studentTeacherAuthMiddleware = studentTeacherAuthMiddleware;
exports.authOnlyMiddleware = authOnlyMiddleware;
exports.studentOnlyMiddleware = studentOnlyMiddleware;
exports.simpleAuthMiddleware = simpleAuthMiddleware;
const jwt = __importStar(require("jsonwebtoken"));
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
/**
 * مدرّس يملك كورسًا في المسار (/api/course/:id/...) وكل الطلاب المشتركين من نفس tenant الـ Host
 * (أو لا يوجد مشتركون بعد): يُسمح بالعمل حتى لو tid في التوكن أو users.tenant_id غير متزامنين.
 */
async function teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant) {
    if (user.role !== 'teacher')
        return false;
    const raw = (req.originalUrl || req.path || '').split('?')[0];
    const m = raw.match(/\/course\/(\d+)/);
    if (!m)
        return false;
    const courseId = Number(m[1]);
    if (!Number.isInteger(courseId) || courseId <= 0)
        return false;
    const owns = await pool_1.default.query(`SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1`, [
        courseId,
        user.id,
    ]);
    if (!owns.rowCount)
        return false;
    const crossTenantStudent = await pool_1.default.query(`SELECT 1 FROM enrollments e
     INNER JOIN users st ON st.id = e.user_id AND st.role = 'student'
     WHERE e.course_id = $1 AND st.tenant_id IS DISTINCT FROM $2
     LIMIT 1`, [courseId, tenant.id]);
    if (crossTenantStudent.rowCount)
        return false;
    return true;
}
async function assertRequestTenantMatchesUserAndToken(req, res, decoded, user) {
    const tenant = req.tenant;
    if (!tenant)
        return true;
    const tokenTid = decoded.tid !== undefined && decoded.tid !== null ? Number(decoded.tid) : null;
    const dbTenantMatchesHost = user.tenant_id != null && user.tenant_id === tenant.id;
    const userIsOwnerOfRequestTenant = async () => {
        const r = await pool_1.default.query('SELECT 1 FROM tenants WHERE id = $1 AND owner_user_id = $2 LIMIT 1', [tenant.id, user.id]);
        return Boolean(r.rowCount);
    };
    if (tokenTid === null) {
        // Old tokens without tid: allow when DB tenant matches host, or platform owner (even if users.tenant_id is stale).
        if (dbTenantMatchesHost)
            return true;
        if (tenant.id !== 1) {
            if (await userIsOwnerOfRequestTenant())
                return true;
            if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant))
                return true;
            res.status(401).json({ message: 'Re-authentication required for this host' });
            return false;
        }
    }
    else {
        if (Number.isNaN(tokenTid)) {
            res.status(401).json({ message: 'Session is not valid for this site' });
            return false;
        }
        // Wrong tid in token but DB says this user belongs to this host — trust DB (mis-issued tokens).
        if (tokenTid !== tenant.id) {
            if (dbTenantMatchesHost)
                return true;
            if (await userIsOwnerOfRequestTenant())
                return true;
            if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant))
                return true;
            res.status(401).json({ message: 'Session is not valid for this site' });
            return false;
        }
    }
    if (user.tenant_id != null && user.tenant_id !== tenant.id) {
        if (await userIsOwnerOfRequestTenant())
            return true;
        if (await teacherOwnedCourseAlignsWithRequestTenant(req, user, tenant))
            return true;
        res.status(403).json({ message: 'Forbidden: tenant mismatch' });
        return false;
    }
    return true;
}
function authMiddleware(roles = []) {
    return async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token)
            return res.status(401).json({ message: 'Unauthorized' });
        try {
            const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
            const { id, jti } = decoded;
            // التحقق من أن id موجود وصحيح
            if (!id || isNaN(Number(id))) {
                return res.status(401).json({
                    message: 'Invalid token: invalid user id',
                });
            }
            // Fetch user from DB
            const result = await pool_1.default.query('SELECT id, role, jti, tenant_id, account_status FROM users WHERE id = $1', [id]);
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
            if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                return;
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
        }
        catch (error) {
            // Auto-refresh for students if token is expired
            if (error?.name === 'TokenExpiredError') {
                try {
                    const decoded = jwt.verify(token, utils_1.config.SECRET_KEY, { ignoreExpiration: true });
                    const { id, jti } = decoded || {};
                    if (!id || isNaN(Number(id))) {
                        return res.status(401).json({ message: 'Invalid token: invalid user id' });
                    }
                    const result = await pool_1.default.query('SELECT id, role, jti, tenant_id, account_status FROM users WHERE id = $1', [id]);
                    if (!result.rowCount)
                        return res.status(401).json({ message: 'User not found' });
                    const user = result.rows[0];
                    if (user.role === 'teacher' && user.account_status && user.account_status !== 'active') {
                        return res.status(403).json({
                            message: 'Teacher account is not active',
                            code: 'TEACHER_ACCOUNT_INACTIVE',
                        });
                    }
                    if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                        return;
                    // Only students are auto-refreshed, and only if JTI matches current session
                    if (user.role === 'student') {
                        // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
                        const newToken = await (0, utils_1.generateToken)(user, pool_1.default, {
                            sessionTenantId: req.tenant?.id,
                        });
                        res.setHeader('X-Access-Token', newToken);
                        req.user = user;
                        return next();
                    }
                    // Non-students must reauthenticate when token expires
                    return res.status(401).json({ message: 'Token expired' });
                }
                catch (innerErr) {
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
function studentAuthMiddleware() {
    return authMiddleware(['student']);
}
// Middleware للطلاب والمعلمين
function studentTeacherAuthMiddleware() {
    return authMiddleware(['student', 'teacher']);
}
// Middleware بدون قيود على الأدوار (للمصادقة فقط)
function authOnlyMiddleware() {
    return async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token)
            return res.status(401).json({ message: 'Unauthorized' });
        try {
            const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
            const { id, jti } = decoded;
            // التحقق من أن id موجود وصحيح
            if (!id || isNaN(Number(id))) {
                return res.status(401).json({
                    message: 'Invalid token: invalid user id',
                });
            }
            // Fetch user from DB
            const result = await pool_1.default.query('SELECT id, role, jti, tenant_id FROM users WHERE id = $1', [id]);
            if (!result.rowCount) {
                return res.status(401).json({ message: 'User not found' });
            }
            const user = result.rows[0];
            if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                return;
            // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
            req.user = user;
            next();
        }
        catch (error) {
            // Auto-refresh for students if token is expired
            if (error?.name === 'TokenExpiredError') {
                try {
                    const decoded = jwt.verify(token, utils_1.config.SECRET_KEY, { ignoreExpiration: true });
                    const { id, jti } = decoded || {};
                    if (!id || isNaN(Number(id))) {
                        return res.status(401).json({ message: 'Invalid token: invalid user id' });
                    }
                    const result = await pool_1.default.query('SELECT id, role, jti, tenant_id FROM users WHERE id = $1', [
                        id,
                    ]);
                    if (!result.rowCount)
                        return res.status(401).json({ message: 'User not found' });
                    const user = result.rows[0];
                    if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                        return;
                    // Only students are auto-refreshed, and only if JTI matches current session
                    if (user.role === 'student') {
                        // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
                        const newToken = await (0, utils_1.generateToken)(user, pool_1.default, {
                            sessionTenantId: req.tenant?.id,
                        });
                        res.setHeader('X-Access-Token', newToken);
                        req.user = user;
                        return next();
                    }
                    // Non-students must reauthenticate when token expires
                    return res.status(401).json({ message: 'Token expired' });
                }
                catch (innerErr) {
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
function studentOnlyMiddleware() {
    return async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token)
            return res.status(401).json({ message: 'Unauthorized' });
        try {
            const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
            const { id, jti } = decoded;
            // التحقق من أن id موجود وصحيح
            if (!id || isNaN(Number(id))) {
                return res.status(401).json({
                    message: 'Invalid token: invalid user id',
                });
            }
            // Fetch user from DB
            const result = await pool_1.default.query('SELECT id, role, jti, tenant_id FROM users WHERE id = $1', [id]);
            if (!result.rowCount) {
                return res.status(401).json({ message: 'User not found' });
            }
            const user = result.rows[0];
            if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                return;
            // التحقق من أن المستخدم طالب
            if (user.role !== 'student') {
                return res.status(403).json({
                    message: 'Forbidden: Student access required',
                    details: {
                        user_role: user.role,
                        required_role: 'student',
                        user_id: user.id,
                    },
                });
            }
            // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
            req.user = user;
            next();
        }
        catch (error) {
            // Auto-refresh for students if token is expired
            if (error?.name === 'TokenExpiredError') {
                try {
                    const decoded = jwt.verify(token, utils_1.config.SECRET_KEY, { ignoreExpiration: true });
                    const { id, jti } = decoded || {};
                    if (!id || isNaN(Number(id))) {
                        return res.status(401).json({ message: 'Invalid token: invalid user id' });
                    }
                    const result = await pool_1.default.query('SELECT id, role, jti, tenant_id FROM users WHERE id = $1', [
                        id,
                    ]);
                    if (!result.rowCount)
                        return res.status(401).json({ message: 'User not found' });
                    const user = result.rows[0];
                    if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                        return;
                    // Only students are auto-refreshed (لا نتحقق من JTI)
                    if (user.role === 'student') {
                        const newToken = await (0, utils_1.generateToken)(user, pool_1.default, {
                            sessionTenantId: req.tenant?.id,
                        });
                        res.setHeader('X-Access-Token', newToken);
                        req.user = user;
                        return next();
                    }
                    // Non-students must reauthenticate when token expires
                    return res.status(401).json({ message: 'Token expired' });
                }
                catch (innerErr) {
                    console.error('JWT refresh error:', innerErr);
                    return res.status(401).json({ message: 'Invalid token' });
                }
            }
            console.error('JWT verification error:', error);
            return res.status(401).json({ message: 'Invalid token' });
        }
    };
}
// Middleware بدون قيود على الأدوار (للمصادقة فقط) - نسخة محسنة
function simpleAuthMiddleware() {
    return async (req, res, next) => {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token)
            return res.status(401).json({ message: 'Unauthorized' });
        try {
            const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
            const { id, jti } = decoded;
            if (!id || isNaN(Number(id))) {
                return res.status(401).json({ message: 'Invalid token: invalid user id' });
            }
            const result = await pool_1.default.query('SELECT id, role, jti, tenant_id FROM users WHERE id = $1', [id]);
            if (!result.rowCount) {
                return res.status(401).json({ message: 'User not found' });
            }
            const user = result.rows[0];
            if (!(await assertRequestTenantMatchesUserAndToken(req, res, decoded, user)))
                return;
            // لا نتحقق من JTI للطلاب (يسمح بتسجيل الدخول من أجهزة متعددة)
            req.user = user;
            next();
        }
        catch (error) {
            console.error('JWT verification error:', error);
            return res.status(401).json({ message: 'Invalid token' });
        }
    };
}
