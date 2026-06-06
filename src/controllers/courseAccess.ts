import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { CourseAccessService } from '../services/courseAccess';
import { z } from 'zod';
import pool from '../db/pool';

export const router = Router();

/**
 * ===== APIs للتحكم في الوصول إلى محتوى المقرر الدراسي =====
 * جميع هذه APIs مخصصة للمعلمين والأدمن فقط
 */

/**
 * 1. حظر محتوى المقرر لجميع الطلاب المسجلين
 * POST /courses/:courseId/block-all
 */
router.post(
  '/courses/:courseId/block-all',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بحظر محتوى هذا المقرر',
      });
    }

    // حظر المحتوى لجميع الطلاب
    const result = await CourseAccessService.blockAllStudents(courseId, user.id);

    res.json({
      success: true,
      message: `تم حظر المحتوى لـ ${result.blocked_count} طالب`,
      blocked_count: result.blocked_count,
    });
  }),
);

/**
 * 2. إلغاء حظر محتوى المقرر لجميع الطلاب
 * POST /courses/:courseId/unblock-all
 */
router.post(
  '/courses/:courseId/unblock-all',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بإلغاء حظر محتوى هذا المقرر',
      });
    }

    // إلغاء حظر المحتوى لجميع الطلاب
    const result = await CourseAccessService.unblockAllStudents(courseId);

    res.json({
      success: true,
      message: `تم إلغاء حظر المحتوى لـ ${result.unblocked_count} طالب`,
      unblocked_count: result.unblocked_count,
    });
  }),
);

/**
 * 3. حظر محتوى المقرر لطالب محدد
 * POST /courses/:courseId/block-student
 */
router.post(
  '/courses/:courseId/block-student',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بحظر محتوى هذا المقرر',
      });
    }

    // التحقق من البيانات المرسلة
    const schema = z.object({
      student_id: z.number().int().positive(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: parsed.error.errors,
      });
    }

    // حظر المحتوى للطالب
    const result = await CourseAccessService.blockStudent(
      courseId,
      parsed.data.student_id,
      user.id,
    );

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.json({
      success: true,
      message: result.message,
    });
  }),
);

/**
 * 4. إلغاء حظر محتوى المقرر لطالب محدد
 * POST /courses/:courseId/unblock-student
 */
router.post(
  '/courses/:courseId/unblock-student',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بإلغاء حظر محتوى هذا المقرر',
      });
    }

    // التحقق من البيانات المرسلة
    const schema = z.object({
      student_id: z.number().int().positive(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: parsed.error.errors,
      });
    }

    // إلغاء حظر المحتوى للطالب
    const result = await CourseAccessService.unblockStudent(courseId, parsed.data.student_id);

    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.message,
      });
    }

    res.json({
      success: true,
      message: result.message,
    });
  }),
);

/**
 * 5. حظر محتوى المقرر لمجموعة من الطلاب
 * POST /courses/:courseId/block-students
 */
router.post(
  '/courses/:courseId/block-students',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بحظر محتوى هذا المقرر',
      });
    }

    // التحقق من البيانات المرسلة
    const schema = z.object({
      student_ids: z.array(z.number().int().positive()).min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: parsed.error.errors,
      });
    }

    // حظر المحتوى للطلاب
    const result = await CourseAccessService.blockStudents(
      courseId,
      parsed.data.student_ids,
      user.id,
    );

    res.json({
      success: true,
      message: `تم حظر المحتوى لـ ${result.blocked_count} طالب`,
      blocked_count: result.blocked_count,
      failed_count: result.failed_count,
    });
  }),
);

/**
 * 6. إلغاء حظر محتوى المقرر لمجموعة من الطلاب
 * POST /courses/:courseId/unblock-students
 */
router.post(
  '/courses/:courseId/unblock-students',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بإلغاء حظر محتوى هذا المقرر',
      });
    }

    // التحقق من البيانات المرسلة
    const schema = z.object({
      student_ids: z.array(z.number().int().positive()).min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors: parsed.error.errors,
      });
    }

    // إلغاء حظر المحتوى للطلاب
    const result = await CourseAccessService.unblockStudents(courseId, parsed.data.student_ids);

    res.json({
      success: true,
      message: `تم إلغاء حظر المحتوى لـ ${result.unblocked_count} طالب`,
      unblocked_count: result.unblocked_count,
      failed_count: result.failed_count,
    });
  }),
);

/**
 * 7. جلب قائمة الطلاب المحظورين في المقرر
 * GET /courses/:courseId/blocked-students
 */
router.get(
  '/courses/:courseId/blocked-students',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        success: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // التحقق من وجود المقرر
    const courseCheck = await pool.query(`SELECT id, teacher_id FROM courses WHERE id = $1`, [
      courseId,
    ]);

    if (!courseCheck.rowCount) {
      return res.status(404).json({
        success: false,
        message: 'المقرر الدراسي غير موجود',
      });
    }

    // التحقق من أن المستخدم هو معلم المقرر أو أدمن
    const course = courseCheck.rows[0];
    if (user.role !== 'admin' && course.teacher_id !== user.id) {
      return res.status(403).json({
        success: false,
        message: 'غير مصرح لك بعرض قائمة الطلاب المحظورين',
      });
    }

    // جلب قائمة الطلاب المحظورين
    const blockedStudents = await CourseAccessService.getBlockedStudents(courseId);

    res.json({
      success: true,
      blocked_students: blockedStudents,
      count: blockedStudents.length,
    });
  }),
);

/**
 * 8. جلب محتوى المقرر الدراسي (مع التحقق من الصلاحية)
 * GET /courses/:courseId/content
 */
router.get(
  '/courses/:courseId/content',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = parseInt(req.params.courseId);
    const user = req.user!;

    // التحقق من صحة معرف المقرر
    if (!courseId || isNaN(courseId)) {
      return res.status(400).json({
        access: false,
        message: 'معرف المقرر الدراسي غير صحيح',
      });
    }

    // إذا كان المستخدم ليس طالباً، السماح بالوصول مباشرة
    if (user.role !== 'student') {
      // للمعلمين والأدمن: جلب المحتوى مباشرة
      
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CourseContentService } = require('../services/courseContent');
      const lectures = await CourseContentService.getCourseLectures(courseId);

      return res.json({
        access: true,
        content: {
          lectures,
        },
      });
    }

    // للطلاب: التحقق من صلاحية الوصول
    const accessCheck = await CourseAccessService.checkStudentAccess(user.id, courseId);

    // إذا لم يكن لديه صلاحية الوصول
    if (!accessCheck.hasAccess) {
      return res.status(403).json({
        access: false,
        message: accessCheck.message || 'تم حجب المحتوي لحين تجديد الاشتراك',
      });
    }

    // جلب محتوى المقرر
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { CourseContentService } = require('../services/courseContent');
      const lectures = await CourseContentService.getCourseLecturesWithLock(courseId, user.id);

      res.json({
        access: true,
        content: {
          lectures,
        },
      });
    } catch (error: any) {
      console.error('Error fetching course content:', error);
      return res.status(500).json({
        access: false,
        message: 'خطأ في جلب محتوى المقرر',
      });
    }
  }),
);
