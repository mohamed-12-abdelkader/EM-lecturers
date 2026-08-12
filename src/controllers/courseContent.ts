import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { CourseContentService, LectureData } from '../services/courseContent';
import { LectureAccessService } from '../services/lectureAccess';
import { logger } from '../utils';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import pool from '../db/pool';
import { CourseAccessControl } from '../services/courseAccessControl';

const router = Router();

// Configure multer for course content files
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'course-content-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit for course content
  },
});

// ===== إدارة المحاضرات =====

// 1. إنشاء محاضرة جديدة
router.post(
  '/lectures',
  authMiddleware(['admin', 'teacher', 'academy', 'academy_teacher']),
  async (req: Request, res: Response) => {
    try {
      const {
        course_id,
        title,
        description,
        content,
        video_url,
        video_duration,
        order_index,
        is_free,
      } = req.body;
      const teacherId = (req as any).user.id;
      const userRole = (req as any).user.role;

      if (!course_id || !title) {
        return res.status(400).json({ error: 'معرف الكورس وعنوان المحاضرة مطلوبان' });
      }

      // التحقق من ملكية الكورس (الأدمن لديه جميع الصلاحيات)
      if (userRole !== 'admin') {
        await CourseAccessControl.assertCanManageCourse(
          { id: teacherId, role: userRole, tenant_id: (req as any).user?.tenant_id },
          parseInt(course_id, 10),
        );
      }

      const lectureData: LectureData = {
        course_id: parseInt(course_id),
        title,
        description,
        content,
        video_url,
        video_duration: video_duration ? parseInt(video_duration) : undefined,
        order_index: order_index ? parseInt(order_index) : undefined,
        is_free: is_free !== 'false', // true افتراضياً
      };

      const lecture = await CourseContentService.createLecture(teacherId, lectureData);

      res.status(201).json({
        message: 'تم إنشاء المحاضرة بنجاح',
        lecture,
      });
    } catch (error) {
      logger.error('Error creating lecture:', error);
      res.status(500).json({ error: 'خطأ في إنشاء المحاضرة' });
    }
  },
);

// 2. تحديث محاضرة
router.put(
  '/lectures/:id',
  authMiddleware(['admin', 'teacher', 'academy', 'academy_teacher']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { title, description, content, video_url, video_duration, order_index, is_free } =
        req.body;
      const teacherId = (req as any).user.id;

      const lectureData: Partial<LectureData> = {};
      if (title !== undefined) lectureData.title = title;
      if (description !== undefined) lectureData.description = description;
      if (content !== undefined) lectureData.content = content;
      if (video_url !== undefined) lectureData.video_url = video_url;
      if (video_duration !== undefined) lectureData.video_duration = parseInt(video_duration);
      if (order_index !== undefined) lectureData.order_index = parseInt(order_index);
      if (is_free !== undefined) lectureData.is_free = is_free !== 'false';

      const lecture = await CourseContentService.updateLecture(
        parseInt(id),
        teacherId,
        lectureData,
      );

      res.json({
        message: 'تم تحديث المحاضرة بنجاح',
        lecture,
      });
    } catch (error: any) {
      logger.error('Error updating lecture:', error);
      res.status(500).json({
        error: 'خطأ في تحديث المحاضرة',
        details: error.message || 'Unknown error',
      });
    }
  },
);

// 3. حذف محاضرة
router.delete(
  '/lectures/:id',
  authMiddleware(['admin', 'teacher', 'academy', 'academy_teacher']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const teacherId = (req as any).user.id;

      await CourseContentService.deleteLecture(parseInt(id), teacherId);

      res.json({ message: 'تم حذف المحاضرة بنجاح' });
    } catch (error: any) {
      logger.error('Error deleting lecture:', error);
      res.status(500).json({
        error: 'خطأ في حذف المحاضرة',
        details: error.message || 'Unknown error',
      });
    }
  },
);

// 4. جلب محاضرة بواسطة ID
router.get(
  '/lectures/:id',
  authMiddleware(['student', 'teacher', 'academy', 'academy_teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const user = (req as any).user;

      const lecture = await CourseContentService.getLectureById(parseInt(id));

      if (!lecture) {
        return res.status(404).json({ error: 'المحاضرة غير موجودة' });
      }

      // التحقق من صلاحية الوصول للمحاضرة
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { canAccessLecture } = require('../utils/courseAccess');
      const hasAccess = await canAccessLecture(parseInt(id), user.id, user.role);

      if (!hasAccess) {
        if (user.role === 'student') {
          const modeAccess = await LectureAccessService.checkStudentLectureAccess(
            parseInt(id),
            user.id,
          );
          return res.status(403).json({
            error: modeAccess.message || 'ليس لديك صلاحية للوصول إلى هذه المحاضرة',
            can_access: false,
            status: modeAccess.status,
            access_status: modeAccess.status,
            lecture_access_mode: modeAccess.lecture_access_mode,
            activation: modeAccess.activation ?? null,
            expires_at: modeAccess.expires_at ?? null,
          });
        }
        return res.status(403).json({
          error: 'ليس لديك صلاحية للوصول إلى هذه المحاضرة',
        });
      }

      // جلب الملفات المرفقة
      const attachments = await CourseContentService.getLectureAttachments(parseInt(id));

      res.json({
        lecture: {
          ...lecture,
          attachments,
        },
      });
    } catch (error) {
      logger.error('Error fetching lecture:', error);
      res.status(500).json({ error: 'خطأ في جلب المحاضرة' });
    }
  },
);

// 5. جلب جميع محاضرات الكورس
router.get(
  '/courses/:courseId/lectures',
  authMiddleware(['student', 'teacher', 'academy', 'academy_teacher', 'admin']),
  async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const user = (req as any).user;

      // التحقق من صلاحية الوصول للكورس
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { canAccessCourseContent } = require('../utils/courseAccess');
      const hasAccess = await canAccessCourseContent(parseInt(courseId), user.id, user.role);

      if (!hasAccess) {
        return res.status(403).json({
          error: 'ليس لديك صلاحية للوصول إلى هذا الكورس',
        });
      }

      const lectures = await CourseContentService.getCourseLectures(parseInt(courseId));

      res.json({ lectures });
    } catch (error) {
      logger.error('Error fetching course lectures:', error);
      res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
  },
);

// 5.1 جلب محاضرات الكورس مع منطق القفل للطلاب (للجداول القديمة)
router.get(
  '/courses/:courseId/lectures/student',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const studentId = (req as any).user.id;

      // التحقق من صلاحية الوصول للكورس (يدعم الكورسات العادية والكورسات في المواد الدراسية)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { canAccessCourseContent } = require('../utils/courseAccess');
      const hasAccess = await canAccessCourseContent(parseInt(courseId), studentId, 'student');

      if (!hasAccess) {
        return res.status(403).json({
          error:
            'ليس لديك صلاحية للوصول إلى هذا الكورس. يجب أن تكون مشترك في الكورس أو مفعل للباقة التي تحتوي على هذه المادة',
        });
      }

      const lectures = await CourseContentService.getCourseLecturesWithLock(
        parseInt(courseId),
        studentId,
      );

      res.json({ lectures });
    } catch (error) {
      logger.error('Error fetching course lectures with lock:', error);
      res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
  },
);

// 5.2 جلب محاضرات الكورس مع منطق القفل للطلاب (جدول lectures - قفل المحاضرات التالية حتى النجاح)
router.get(
  '/old-courses/:courseId/lectures/student',
  authMiddleware(['student']),
  async (req: Request, res: Response) => {
    try {
      const { courseId } = req.params;
      const studentId = (req as any).user.id;
      const lectures = await CourseContentService.getCourseLecturesWithLock(
        parseInt(courseId, 10),
        studentId,
      );
      res.json({ lectures });
    } catch (error) {
      logger.error('Error fetching old course lectures with lock:', error);
      res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
  },
);

// ===== إدارة الملفات المرفقة =====

// 13. إضافة ملف مرفق للمحاضرة
router.post(
  '/lectures/:lectureId/attachments',
  authMiddleware(['admin', 'teacher', 'academy', 'academy_teacher']),
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const { lectureId } = req.params;
      const { description } = req.body;
      const teacherId = (req as any).user.id;

      if (!req.file) {
        return res.status(400).json({ error: 'الملف مطلوب' });
      }

      const attachmentData = {
        file_name: req.file.originalname,
        file_url: `/uploads/${req.file.filename}`,
        file_size: req.file.size,
        file_type: req.file.mimetype,
        description,
      };

      const attachment = await CourseContentService.addLectureAttachment(
        parseInt(lectureId),
        teacherId,
        attachmentData,
      );

      res.status(201).json({
        message: 'تم إضافة الملف المرفق بنجاح',
        attachment,
      });
    } catch (error) {
      logger.error('Error adding lecture attachment:', error);
      res.status(500).json({ error: 'خطأ في إضافة الملف المرفق' });
    }
  },
);

// 14. جلب ملفات مرفقة المحاضرة
router.get('/lectures/:lectureId/attachments', async (req: Request, res: Response) => {
  try {
    const { lectureId } = req.params;
    const attachments = await CourseContentService.getLectureAttachments(parseInt(lectureId));

    res.json({ attachments });
  } catch (error) {
    logger.error('Error fetching lecture attachments:', error);
    res.status(500).json({ error: 'خطأ في جلب الملفات المرفقة' });
  }
});

// ===== إحصائيات محتوى الكورس =====

// 15. جلب إحصائيات محتوى الكورس
router.get('/courses/:courseId/content-stats', async (req: Request, res: Response) => {
  try {
    const { courseId } = req.params;
    const stats = await CourseContentService.getCourseContentStats(parseInt(courseId));

    res.json({ stats });
  } catch (error) {
    logger.error('Error fetching course content stats:', error);
    res.status(500).json({ error: 'خطأ في جلب إحصائيات محتوى الكورس' });
  }
});

export { router };
