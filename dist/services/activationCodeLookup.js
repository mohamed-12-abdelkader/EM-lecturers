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
exports.getActivationCodeDetails = getActivationCodeDetails;
exports.activateCourseByCodeForStudent = activateCourseByCodeForStudent;
const pool_1 = __importDefault(require("../db/pool"));
const ExpoPushService = __importStar(require("./expoPushService"));
/**
 * البحث عن كود التفعيل بالكود (للاستخدام من البوت أو الأدمن)
 * نفس منطق GET /api/course/admin/activation-code/:code
 */
async function getActivationCodeDetails(code) {
    const trimmed = (code || '').trim();
    if (!trimmed)
        return null;
    const codeRow = await pool_1.default.query(`SELECT 
      tic.id,
      tic.code,
      tic.course_id,
      tic.teacher_id,
      tic.max_uses,
      tic.uses,
      tic.expires_at,
      tic.created_at,
      c.title as course_title,
      u_teacher.name as teacher_name,
      u_teacher.email as teacher_email,
      u_teacher.phone as teacher_phone
     FROM teacher_invite_codes tic
     JOIN courses c ON tic.course_id = c.id
     JOIN users u_teacher ON tic.teacher_id = u_teacher.id
     WHERE tic.code = $1`, [trimmed]);
    if (!codeRow.rowCount)
        return null;
    const row = codeRow.rows[0];
    const isUsed = Number(row.uses) >= Number(row.max_uses);
    const isExpired = row.expires_at && new Date(row.expires_at) < new Date();
    const usagesRes = await pool_1.default.query(`SELECT icu.user_id, icu.used_at, u.name as user_name, u.email as user_email, u.phone as user_phone
     FROM invite_code_usages icu
     JOIN users u ON icu.user_id = u.id
     WHERE icu.code_id = $1
     ORDER BY icu.used_at DESC`, [row.id]);
    return {
        code: row.code,
        id: row.id,
        course: { id: row.course_id, title: row.course_title },
        teacher: {
            id: row.teacher_id,
            name: row.teacher_name,
            email: row.teacher_email ?? null,
            phone: row.teacher_phone ?? null,
        },
        max_uses: Number(row.max_uses),
        uses: Number(row.uses),
        is_used: isUsed,
        is_expired: !!isExpired,
        expires_at: row.expires_at ?? null,
        created_at: row.created_at ?? null,
        used_by: usagesRes.rows.map((u) => ({
            user_id: u.user_id,
            name: u.user_name,
            email: u.user_email ?? null,
            phone: u.user_phone ?? null,
            used_at: u.used_at ?? null,
        })),
    };
}
/**
 * تفعيل الكورس لطالب باستخدام كود التفعيل (للاستخدام من البوت أو الأدمن)
 */
async function activateCourseByCodeForStudent(studentId, code) {
    const trimmed = (code || '').trim();
    if (!trimmed)
        return { success: false, message: 'كود التفعيل مطلوب' };
    const details = await getActivationCodeDetails(trimmed);
    if (!details)
        return { success: false, message: 'الكود غير موجود' };
    if (details.is_expired)
        return { success: false, message: 'الكود منتهي الصلاحية' };
    if (details.is_used)
        return { success: false, message: 'الكود مستنفذ بالكامل' };
    const studentCheck = await pool_1.default.query('SELECT id FROM users WHERE id = $1 AND role = $2', [studentId, 'student']);
    if (!studentCheck.rowCount)
        return { success: false, message: 'الطالب غير موجود أو ليس حساب طالب' };
    const usageCheck = await pool_1.default.query('SELECT id FROM invite_code_usages WHERE user_id = $1 AND code_id = $2', [studentId, details.id]);
    if (usageCheck.rowCount && usageCheck.rowCount > 0) {
        return { success: false, message: 'هذا الطالب مفعّل له الكورس مسبقاً بهذا الكود' };
    }
    await pool_1.default.query('INSERT INTO invite_code_usages (user_id, code_id) VALUES ($1, $2)', [
        studentId,
        details.id,
    ]);
    await pool_1.default.query('UPDATE teacher_invite_codes SET uses = uses + 1 WHERE id = $1', [details.id]);
    await pool_1.default.query('INSERT INTO enrollments (user_id, course_id) VALUES ($1, $2) ON CONFLICT (user_id, course_id) DO NOTHING', [studentId, details.course.id]);
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const { ChatService } = await import('./chat');
        const gradeRes = await pool_1.default.query('SELECT grade_id, teacher_id FROM courses WHERE id = $1', [details.course.id]);
        if (gradeRes.rowCount) {
            const gradeId = gradeRes.rows[0].grade_id;
            const teacherId = gradeRes.rows[0].teacher_id;
            const group = await ChatService.getOrCreateTeacherGradeGroup(gradeId, teacherId);
            await ChatService.addMember(group.id, studentId, 'student');
        }
    }
    catch (err) {
        console.warn('activateCourseByCodeForStudent: chat group add failed', err);
    }
    try {
        await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, course_id) VALUES ($1, $2, $3, $4, $5)`, [
            studentId,
            'كورس جديد متاح',
            `تم تفعيل كورس "${details.course.title}" لك`,
            'course_opened',
            details.course.id,
        ]);
        ExpoPushService.sendPushNotification(studentId, 'كورس جديد متاح', `تم تفعيل كورس "${details.course.title}" لك`, { type: 'course_opened', course_id: details.course.id }).catch((e) => console.error('Expo push error:', e));
    }
    catch (_) {
        // ...
    }
    return {
        success: true,
        message: 'تم تفعيل الكورس بنجاح',
        course: { id: details.course.id, title: details.course.title },
    };
}
