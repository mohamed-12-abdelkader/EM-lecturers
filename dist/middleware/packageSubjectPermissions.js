"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkTeacherSubjectPermission = checkTeacherSubjectPermission;
exports.checkStudentPackageAccess = checkStudentPackageAccess;
const pool_1 = __importDefault(require("../db/pool"));
const packageSubjectPermissions_1 = require("../services/packageSubjectPermissions");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
/**
 * Middleware للتحقق من صلاحية المدرس على مادة معينة
 * يستخدم للأدمن والمدرسين
 */
async function checkTeacherSubjectPermission(req, res, next) {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // الأدمن لديه صلاحية كاملة
        if (user.role === 'admin') {
            return next();
        }
        // المدرسون يحتاجون للتحقق من الصلاحية
        if (user.role === 'teacher') {
            const subjectId = parseInt(req.params.subjectId || req.body.subjectId || req.params.id);
            if (isNaN(subjectId)) {
                return res.status(400).json({ error: 'Invalid subject ID' });
            }
            const hasPermission = await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'ليس لديك صلاحية للوصول إلى هذه المادة',
                });
            }
            return next();
        }
        return res.status(403).json({ error: 'Forbidden', message: 'غير مصرح لك بالوصول' });
    }
    catch (error) {
        console.error('Error checking teacher subject permission:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
/**
 * Middleware للتحقق من اشتراك الطالب في الباقة
 */
async function checkStudentPackageAccess(req, res, next) {
    try {
        const user = req.user;
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        // الأدمن والمدرسون لديهم صلاحية كاملة
        if (user.role === 'admin' || user.role === 'teacher') {
            return next();
        }
        // الطلاب يحتاجون للتحقق من الاشتراك
        if (user.role === 'student') {
            const subjectId = parseInt(req.params.subjectId || req.params.id);
            if (isNaN(subjectId)) {
                return res.status(400).json({ error: 'Invalid subject ID' });
            }
            // جلب package_id من المادة
            const subjectResult = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
            if (!subjectResult.rowCount) {
                return res.status(404).json({ error: 'المادة غير موجودة' });
            }
            const packageId = subjectResult.rows[0].package_id;
            // التحقق من تفعيل الباقة
            const isActivated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(packageId, user.id);
            if (!isActivated) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'يجب تفعيل الباقة أولاً للوصول إلى هذه المادة',
                });
            }
            return next();
        }
        return res.status(403).json({ error: 'Forbidden', message: 'غير مصرح لك بالوصول' });
    }
    catch (error) {
        console.error('Error checking student package access:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
