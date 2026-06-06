"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkAnyPermission = exports.checkPermission = void 0;
exports.employeeHasAnyPermission = employeeHasAnyPermission;
const pool_1 = __importDefault(require("../db/pool"));
function normalizePermissions(raw) {
    let permissions = raw;
    // بعض البيئات/المدخلات القديمة قد تخزن JSON كنص
    if (typeof permissions === 'string') {
        try {
            permissions = JSON.parse(permissions);
        }
        catch {
            permissions = [];
        }
    }
    if (Array.isArray(permissions)) {
        return { asArray: permissions.map((p) => String(p)), asObject: {} };
    }
    if (permissions && typeof permissions === 'object') {
        // دعم شكل { permissions: [...] } أو { permissions: {...} }
        if (Array.isArray(permissions.permissions)) {
            return { asArray: permissions.permissions.map((p) => String(p)), asObject: permissions };
        }
        if (permissions.permissions && typeof permissions.permissions === 'object') {
            return { asArray: [], asObject: permissions.permissions };
        }
        return { asArray: [], asObject: permissions };
    }
    return { asArray: [], asObject: {} };
}
function isTruthyPermissionValue(v) {
    if (v === true || v === 1)
        return true;
    if (typeof v === 'string') {
        const s = v.trim().toLowerCase();
        return ['true', '1', 'yes', 'y', 'on', 'enabled', 'allow', 'allowed', 'active', 'checked'].includes(s);
    }
    return false;
}
function collectEnabledPermissionKeys(raw, collector) {
    if (raw == null)
        return;
    let value = raw;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        }
        catch {
            collector.add(value.toLowerCase());
            return;
        }
    }
    if (Array.isArray(value)) {
        for (const item of value) {
            collectEnabledPermissionKeys(item, collector);
        }
        return;
    }
    if (typeof value === 'object') {
        const obj = value;
        const possibleName = obj.name ?? obj.permission ?? obj.key ?? obj.code ?? obj.id ?? obj.slug ?? obj.value ?? null;
        const possibleEnabled = obj.enabled ?? obj.allowed ?? obj.allow ?? obj.is_active ?? obj.checked ?? obj.active ?? true;
        if (typeof possibleName === 'string' && possibleName.trim().length > 0 && isTruthyPermissionValue(possibleEnabled)) {
            collector.add(possibleName.trim().toLowerCase());
        }
        for (const [k, v] of Object.entries(obj)) {
            if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
                if (isTruthyPermissionValue(v)) {
                    collector.add(k.toLowerCase());
                }
            }
            else {
                // إذا كانت الصلاحية ممثلة كـ object/array (مثلاً { can_manage_general_courses: { view: true } })
                // نعتبر وجود الكيان نفسه إشارة تفعيل، ثم نغوص داخله.
                collector.add(k.toLowerCase());
                collectEnabledPermissionKeys(v, collector);
            }
        }
    }
}
function hasAnyPermissionInRaw(rawPermissions, requiredPermissions) {
    const normalized = normalizePermissions(rawPermissions);
    const required = requiredPermissions.map((p) => p.toLowerCase());
    // wildcard/global permission
    if (normalized.asArray.some((p) => ['*', 'all', 'full_access'].includes(p.toLowerCase())))
        return true;
    if (Object.entries(normalized.asObject).some(([k, v]) => ['*', 'all', 'full_access'].includes(k.toLowerCase()) && isTruthyPermissionValue(v)))
        return true;
    // fast-path existing normalization
    if (normalized.asArray.length > 0 && required.some((p) => normalized.asArray.map((x) => x.toLowerCase()).includes(p))) {
        return true;
    }
    if (required.some((p) => isTruthyPermissionValue(normalized.asObject[p]))) {
        return true;
    }
    // deep extraction fallback
    const extracted = new Set();
    collectEnabledPermissionKeys(rawPermissions, extracted);
    if (required.some((p) => extracted.has(p)))
        return true;
    // semantic fallback for general courses
    for (const key of extracted) {
        if ((key.includes('general') && key.includes('course')) || (key.includes('كورس') && key.includes('عام'))) {
            if (required.some((p) => p.includes('general') && p.includes('course')))
                return true;
        }
    }
    return false;
}
async function employeeHasAnyPermission(userId, requiredPermissions) {
    const result = await pool_1.default.query(`SELECT permissions FROM employees WHERE user_id = $1 AND is_active = true`, [userId]);
    if (result.rowCount === 0)
        return false;
    return hasAnyPermissionInRaw(result.rows[0].permissions, requiredPermissions);
}
const checkPermission = (requiredPermission) => {
    return async (req, res, next) => {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ success: false, message: 'غير مصرح' });
            }
            // الأدمن والمعلم يمران تلقائياً (المعلم يكون محمياً بـ authMiddleware مسبقاً)
            if (user.role === 'admin' || user.role === 'teacher') {
                return next();
            }
            // إذا كان الموظف لديه رول "employee"
            if (user.role === 'employee') {
                const result = await pool_1.default.query(`SELECT permissions FROM employees WHERE user_id = $1 AND is_active = true`, [user.id]);
                if (result.rowCount === 0) {
                    return res.status(403).json({ success: false, message: 'حساب الموظف غير مفعل أو غير موجود' });
                }
                const hasPermission = hasAnyPermissionInRaw(result.rows[0].permissions, [requiredPermission]);
                if (hasPermission) {
                    return next();
                }
            }
            return res.status(403).json({ success: false, message: 'لا تملك الصلاحية للقيام بهذه العملية' });
        }
        catch (error) {
            console.error('Permission middleware error:', error);
            return res.status(500).json({ success: false, message: 'خطأ داخلي أثناء التحقق من الصلاحيات' });
        }
    };
};
exports.checkPermission = checkPermission;
const checkAnyPermission = (requiredPermissions) => {
    return async (req, res, next) => {
        try {
            const user = req.user;
            if (!user) {
                return res.status(401).json({ success: false, message: 'غير مصرح' });
            }
            // الأدمن والمعلم يمران تلقائياً
            if (user.role === 'admin' || user.role === 'teacher') {
                return next();
            }
            if (user.role === 'employee') {
                const result = await pool_1.default.query(`SELECT permissions FROM employees WHERE user_id = $1 AND is_active = true`, [user.id]);
                if (result.rowCount === 0) {
                    return res.status(403).json({ success: false, message: 'حساب الموظف غير مفعل أو غير موجود' });
                }
                const hasPermission = hasAnyPermissionInRaw(result.rows[0].permissions, requiredPermissions);
                if (hasPermission) {
                    return next();
                }
            }
            return res.status(403).json({
                success: false,
                message: 'لا تملك الصلاحية للقيام بهذه العملية',
            });
        }
        catch (error) {
            console.error('Permission middleware error:', error);
            return res.status(500).json({ success: false, message: 'خطأ داخلي أثناء التحقق من الصلاحيات' });
        }
    };
};
exports.checkAnyPermission = checkAnyPermission;
