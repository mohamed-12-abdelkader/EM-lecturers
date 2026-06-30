"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseAccessService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
/**
 * Service للتحكم في الوصول إلى محتوى المقرر الدراسي
 */
class CourseAccessService {
    /** كورس مجاني — المحتوى متاح لأي طالب مسجّل دخول بدون enrollment */
    static async isFreePublicCourse(courseId) {
        const result = await pool_1.default.query(`SELECT COALESCE(is_free, FALSE) AS is_free FROM courses WHERE id = $1 LIMIT 1`, [courseId]);
        return result.rowCount ? result.rows[0].is_free === true : false;
    }
    /**
     * التحقق من صلاحية الطالب للوصول إلى محتوى المقرر
     */
    static async checkStudentAccess(studentId, courseId) {
        if (await this.isFreePublicCourse(courseId)) {
            return { hasAccess: true };
        }
        // جلب معلومات التسجيل
        const enrollmentResult = await pool_1.default.query(`SELECT 
        id, user_id, course_id, subscription_status, 
        is_blocked_by_teacher, blocked_at, blocked_by, expires_at, enrolled_at
       FROM enrollments
       WHERE user_id = $1 AND course_id = $2`, [studentId, courseId]);
        // إذا لم يكن الطالب مسجل في المقرر
        if (!enrollmentResult.rowCount) {
            return {
                hasAccess: false,
                message: 'غير مسجل في هذا المقرر الدراسي',
                reason: 'not_enrolled',
            };
        }
        const enrollment = enrollmentResult.rows[0];
        // التحقق من الحظر بواسطة المعلم
        if (enrollment.is_blocked_by_teacher) {
            return {
                hasAccess: false,
                message: 'تم حجب المحتوي لحين تجديد الاشتراك',
                reason: 'blocked',
            };
        }
        // التحقق من حالة الاشتراك
        if (enrollment.subscription_status === 'expired') {
            return {
                hasAccess: false,
                message: 'تم حجب المحتوي لحين تجديد الاشتراك',
                reason: 'expired',
            };
        }
        if (enrollment.subscription_status === 'suspended') {
            return {
                hasAccess: false,
                message: 'تم حجب المحتوي لحين تجديد الاشتراك',
                reason: 'suspended',
            };
        }
        // التحقق من انتهاء الصلاحية (إذا كان expires_at موجود)
        if (enrollment.expires_at) {
            const expiresAt = new Date(enrollment.expires_at);
            const now = new Date();
            if (now > expiresAt) {
                return {
                    hasAccess: false,
                    message: 'تم حجب المحتوي لحين تجديد الاشتراك',
                    reason: 'expired',
                };
            }
        }
        // التحقق من أن الحالة نشطة
        if (enrollment.subscription_status !== 'active') {
            return {
                hasAccess: false,
                message: 'تم حجب المحتوي لحين تجديد الاشتراك',
                reason: 'not_active',
            };
        }
        // الطالب لديه صلاحية الوصول
        return {
            hasAccess: true,
        };
    }
    /**
     * حظر محتوى المقرر لجميع الطلاب المسجلين
     */
    static async blockAllStudents(courseId, blockedBy) {
        const result = await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND is_blocked_by_teacher = FALSE`, [blockedBy, courseId]);
        return { blocked_count: result.rowCount || 0 };
    }
    /**
     * إلغاء حظر محتوى المقرر لجميع الطلاب
     */
    static async unblockAllStudents(courseId) {
        const result = await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND is_blocked_by_teacher = TRUE`, [courseId]);
        return { unblocked_count: result.rowCount || 0 };
    }
    /**
     * حظر محتوى المقرر لطالب محدد
     */
    static async blockStudent(courseId, studentId, blockedBy) {
        // التحقق من أن الطالب مسجل في المقرر
        const enrollmentCheck = await pool_1.default.query(`SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`, [courseId, studentId]);
        if (!enrollmentCheck.rowCount) {
            return {
                success: false,
                message: 'الطالب غير مسجل في هذا المقرر',
            };
        }
        // حظر المحتوى
        await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND user_id = $3`, [blockedBy, courseId, studentId]);
        return {
            success: true,
            message: 'تم حظر المحتوى للطالب بنجاح',
        };
    }
    /**
     * إلغاء حظر محتوى المقرر لطالب محدد
     */
    static async unblockStudent(courseId, studentId) {
        // التحقق من أن الطالب مسجل في المقرر
        const enrollmentCheck = await pool_1.default.query(`SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`, [courseId, studentId]);
        if (!enrollmentCheck.rowCount) {
            return {
                success: false,
                message: 'الطالب غير مسجل في هذا المقرر',
            };
        }
        // إلغاء حظر المحتوى
        await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND user_id = $2`, [courseId, studentId]);
        return {
            success: true,
            message: 'تم إلغاء حظر المحتوى للطالب بنجاح',
        };
    }
    /**
     * حظر محتوى المقرر لمجموعة من الطلاب
     */
    static async blockStudents(courseId, studentIds, blockedBy) {
        if (studentIds.length === 0) {
            return { blocked_count: 0, failed_count: 0 };
        }
        // التحقق من أن جميع الطلاب مسجلين في المقرر
        const enrolledCheck = await pool_1.default.query(`SELECT user_id FROM enrollments 
       WHERE course_id = $1 AND user_id = ANY($2::int[])`, [courseId, studentIds]);
        const enrolledIds = enrolledCheck.rows.map((row) => row.user_id);
        const failedCount = studentIds.length - enrolledIds.length;
        if (enrolledIds.length === 0) {
            return { blocked_count: 0, failed_count: failedCount };
        }
        // حظر المحتوى للطلاب المسجلين
        const result = await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = TRUE,
           blocked_at = NOW(),
           blocked_by = $1
       WHERE course_id = $2 AND user_id = ANY($3::int[]) AND is_blocked_by_teacher = FALSE`, [blockedBy, courseId, enrolledIds]);
        return {
            blocked_count: result.rowCount || 0,
            failed_count: failedCount,
        };
    }
    /**
     * إلغاء حظر محتوى المقرر لمجموعة من الطلاب
     */
    static async unblockStudents(courseId, studentIds) {
        if (studentIds.length === 0) {
            return { unblocked_count: 0, failed_count: 0 };
        }
        // التحقق من أن جميع الطلاب مسجلين في المقرر
        const enrolledCheck = await pool_1.default.query(`SELECT user_id FROM enrollments 
       WHERE course_id = $1 AND user_id = ANY($2::int[])`, [courseId, studentIds]);
        const enrolledIds = enrolledCheck.rows.map((row) => row.user_id);
        const failedCount = studentIds.length - enrolledIds.length;
        if (enrolledIds.length === 0) {
            return { unblocked_count: 0, failed_count: failedCount };
        }
        // إلغاء حظر المحتوى للطلاب المسجلين
        const result = await pool_1.default.query(`UPDATE enrollments
       SET is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL
       WHERE course_id = $1 AND user_id = ANY($2::int[]) AND is_blocked_by_teacher = TRUE`, [courseId, enrolledIds]);
        return {
            unblocked_count: result.rowCount || 0,
            failed_count: failedCount,
        };
    }
    /**
     * تحديث حالة الاشتراك عند تجديد الاشتراك
     */
    static async renewSubscription(courseId, studentId, expiresAt) {
        // التحقق من أن الطالب مسجل في المقرر
        const enrollmentCheck = await pool_1.default.query(`SELECT id FROM enrollments WHERE course_id = $1 AND user_id = $2`, [courseId, studentId]);
        if (!enrollmentCheck.rowCount) {
            return {
                success: false,
                message: 'الطالب غير مسجل في هذا المقرر',
            };
        }
        // تحديث حالة الاشتراك وإلغاء الحظر
        await pool_1.default.query(`UPDATE enrollments
       SET subscription_status = 'active',
           is_blocked_by_teacher = FALSE,
           blocked_at = NULL,
           blocked_by = NULL,
           expires_at = $1
       WHERE course_id = $2 AND user_id = $3`, [expiresAt || null, courseId, studentId]);
        return {
            success: true,
            message: 'تم تجديد الاشتراك وإعادة تفعيل المحتوى بنجاح',
        };
    }
    /**
     * جلب قائمة الطلاب المحظورين في المقرر
     */
    static async getBlockedStudents(courseId) {
        const result = await pool_1.default.query(`SELECT 
        e.user_id as student_id,
        u.name as student_name,
        u.email as student_email,
        e.blocked_at,
        e.blocked_by,
        blocker.name as blocked_by_name
       FROM enrollments e
       JOIN users u ON e.user_id = u.id
       LEFT JOIN users blocker ON e.blocked_by = blocker.id
       WHERE e.course_id = $1 AND e.is_blocked_by_teacher = TRUE
       ORDER BY e.blocked_at DESC`, [courseId]);
        return result.rows;
    }
}
exports.CourseAccessService = CourseAccessService;
