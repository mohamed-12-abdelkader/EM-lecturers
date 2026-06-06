"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
exports.router = (0, express_1.Router)();
/**
 * Delete an enrollment by enrollment id OR student id (user_id).
 * Allows: admin OR the teacher who owns the course.
 * الـ enrollmentId في الرابط يمكن أن يكون: id سجل الالتحاق، أو user_id الطالب (لتوافق مع قائمة الطلاب التي تعيد student_id).
 *
 * DELETE /api/courses/:courseId/enrollments/:enrollmentId
 */
exports.router.delete('/courses/:courseId/enrollments/:enrollmentId', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const courseId = Number(req.params.courseId);
    const paramId = Number(req.params.enrollmentId);
    if (Number.isNaN(courseId) || Number.isNaN(paramId)) {
        return res.status(400).json({ message: 'Invalid courseId or enrollmentId' });
    }
    // جلب الالتحاق: إما بـ id الالتحاق أو بـ (course_id + user_id) لأن العميل قد يرسل student_id
    let enrRes = await pool_1.default.query(`SELECT id, user_id, course_id
       FROM enrollments
       WHERE id = $1 AND course_id = $2`, [paramId, courseId]);
    if (!enrRes.rowCount) {
        enrRes = await pool_1.default.query(`SELECT id, user_id, course_id
         FROM enrollments
         WHERE course_id = $1 AND user_id = $2`, [courseId, paramId]);
    }
    if (!enrRes.rowCount) {
        return res.status(404).json({ message: 'Enrollment not found' });
    }
    const enrollment = enrRes.rows[0];
    const enrollmentId = enrollment.id;
    const studentId = enrollment.user_id;
    // المدرس: يجب أن يكون صاحب الكورس فقط. الأدمن: مسموح له دائماً.
    if (user.role === 'teacher') {
        const courseCheck = await pool_1.default.query('SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2', [courseId, user.id]);
        if (!courseCheck.rowCount) {
            return res.status(403).json({
                message: 'غير مصرح: فقط صاحب الكورس (المدرس) يمكنه حذف الطالب من الكورس',
            });
        }
    }
    // Delete enrollment
    await pool_1.default.query('DELETE FROM enrollments WHERE id = $1', [enrollmentId]);
    // Best-effort cleanup of related data (same behavior as other removal endpoints)
    try {
        await pool_1.default.query('DELETE FROM exam_submissions WHERE exam_id IN (SELECT id FROM exams WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1)) AND student_id = $2', [courseId, studentId]);
    }
    catch {
        // ignore (table might not exist)
    }
    try {
        await pool_1.default.query('DELETE FROM lecture_views WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1) AND student_id = $2', [courseId, studentId]);
    }
    catch {
        // ignore (table might not exist)
    }
    try {
        await pool_1.default.query('DELETE FROM attendance WHERE study_group_id IN (SELECT id FROM study_groups WHERE course_id = $1) AND student_id = $2', [courseId, studentId]);
    }
    catch {
        // ignore (table might not exist)
    }
    return res.json({
        message: 'Enrollment deleted successfully',
        details: {
            course_id: courseId,
            enrollment_id: enrollmentId,
            student_id: studentId,
        },
    });
}));
