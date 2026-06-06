import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import pool from '../db/pool';

export const router = Router();

/**
 * Delete an enrollment by enrollment id OR student id (user_id).
 * Allows: admin OR the teacher who owns the course.
 * الـ enrollmentId في الرابط يمكن أن يكون: id سجل الالتحاق، أو user_id الطالب (لتوافق مع قائمة الطلاب التي تعيد student_id).
 *
 * DELETE /api/courses/:courseId/enrollments/:enrollmentId
 */
router.delete(
  '/courses/:courseId/enrollments/:enrollmentId',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const courseId = Number(req.params.courseId);
    const paramId = Number(req.params.enrollmentId);

    if (Number.isNaN(courseId) || Number.isNaN(paramId)) {
      return res.status(400).json({ message: 'Invalid courseId or enrollmentId' });
    }

    // جلب الالتحاق: إما بـ id الالتحاق أو بـ (course_id + user_id) لأن العميل قد يرسل student_id
    let enrRes = await pool.query(
      `SELECT id, user_id, course_id
       FROM enrollments
       WHERE id = $1 AND course_id = $2`,
      [paramId, courseId],
    );
    if (!enrRes.rowCount) {
      enrRes = await pool.query(
        `SELECT id, user_id, course_id
         FROM enrollments
         WHERE course_id = $1 AND user_id = $2`,
        [courseId, paramId],
      );
    }

    if (!enrRes.rowCount) {
      return res.status(404).json({ message: 'Enrollment not found' });
    }

    const enrollment = enrRes.rows[0] as { id: number; user_id: number; course_id: number };
    const enrollmentId = enrollment.id;
    const studentId = enrollment.user_id;

    // المدرس: يجب أن يكون صاحب الكورس فقط. الأدمن: مسموح له دائماً.
    if (user.role === 'teacher') {
      const courseCheck = await pool.query(
        'SELECT 1 FROM courses WHERE id = $1 AND teacher_id = $2',
        [courseId, user.id],
      );
      if (!courseCheck.rowCount) {
        return res.status(403).json({
          message: 'غير مصرح: فقط صاحب الكورس (المدرس) يمكنه حذف الطالب من الكورس',
        });
      }
    }

    // Delete enrollment
    await pool.query('DELETE FROM enrollments WHERE id = $1', [enrollmentId]);

    // Best-effort cleanup of related data (same behavior as other removal endpoints)
    try {
      await pool.query(
        'DELETE FROM exam_submissions WHERE exam_id IN (SELECT id FROM exams WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1)) AND student_id = $2',
        [courseId, studentId],
      );
    } catch {
      // ignore (table might not exist)
    }
    try {
      await pool.query(
        'DELETE FROM lecture_views WHERE lecture_id IN (SELECT id FROM lectures WHERE course_id = $1) AND student_id = $2',
        [courseId, studentId],
      );
    } catch {
      // ignore (table might not exist)
    }
    try {
      await pool.query(
        'DELETE FROM attendance WHERE study_group_id IN (SELECT id FROM study_groups WHERE course_id = $1) AND student_id = $2',
        [courseId, studentId],
      );
    } catch {
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
  }),
);






