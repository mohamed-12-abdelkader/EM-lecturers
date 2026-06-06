import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectPermissionsService } from '../services/packageSubjectPermissions';
import { PackageSubjectItemService } from '../services/packageSubjectItems';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import { logger } from '../utils';
import pool from '../db/pool';

const router = Router();

// Middleware: Check Access (Read)
const checkReadAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const subjectId = parseInt((req.params.subjectId || req.params.id) as string);

    // This middleware is tricky because for creating a lesson, we need subjectId (params).
    // For deleting a lesson, we have lessonId. We need to fetch subjectId first.
    // Let's implement specific checks inside handlers for better granularity, or refine this.
    // For "Get Lessons by Subject":

    if (!subjectId) return next(); // Not a subject-based route, skip

    if (user.role === 'admin') return next();

    if (user.role === 'teacher') {
      const hasPermission = await PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
      if (!hasPermission) return res.status(403).json({ error: 'ليس لديك صلاحية لهذا المحتوى' });
      return next();
    }

    if (user.role === 'student') {
      // We need to find the packageId for this subjectId
      const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
      if (!subject) return res.status(404).json({ error: 'المادة غير موجودة' });

      const isActivated = await PackageActivationCodeService.isActivated(subject.package_id, user.id);
      if (!isActivated) return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً' });
      return next();
    }

    return res.status(403).json({ error: 'غير مصرح' });
  } catch (err) {
    next(err);
  }
};

// Middleware: Check Write Access (Admin & Authorized Teacher)
const checkWriteAccess = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    let subjectId: number | null = null;

    // Determine Subject ID based on route params
    if (req.params.subjectId) {
      subjectId = parseInt(req.params.subjectId);
    } else if (req.params.lessonId) {
      const lesson = await PackageSubjectLessonService.getLesson(parseInt(req.params.lessonId));
      if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });
      subjectId = lesson.subject_id;
    }

    if (!subjectId && req.body.subject_id) subjectId = req.body.subject_id;

    if (user.role === 'admin') return next();

    if (user.role === 'teacher') {
      if (!subjectId) return res.status(400).json({ error: 'معرف المادة مطلوب' });
      const hasPermission = await PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
      if (!hasPermission) return res.status(403).json({ error: 'ليس لديك صلاحية تعديل هذا المحتوى' });
      return next();
    }

    return res.status(403).json({ error: 'غير مصرح للإجراءات الإدارية' });
  } catch (err) {
    next(err);
  }
};


// 1. Get Lessons for a Subject (Admin, Teacher, Student)
router.get('/:subjectId/lessons', authMiddleware(['admin', 'teacher', 'student']), checkReadAccess, async (req: Request, res: Response) => {
  try {
    const subjectId = parseInt(req.params.subjectId);
    const user = (req as any).user;
    let lessons;

    if (user.role === 'student') {
      lessons = await PackageSubjectLessonService.getVisibleLessonsBySubject(subjectId);
    } else {
      lessons = await PackageSubjectLessonService.getLessonsBySubject(subjectId);
    }

    res.json({ lessons });
  } catch (error) {
    logger.error('Error fetching lessons:', error);
    res.status(500).json({ error: 'خطأ في جلب الدروس' });
  }
});

// 2. Create Lesson (Admin, Teacher)
router.post('/:subjectId/lessons', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const subjectId = parseInt(req.params.subjectId);
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم الدرس مطلوب' });

    const lesson = await PackageSubjectLessonService.createLesson(subjectId, name);
    
    // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان visible)
    try {
      const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
      if (subject) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
        const { NotificationService } = await import('../services/notifications');
        await NotificationService.notifyPackageLessonAdded(
          subject.package_id,
          subjectId,
          lesson.id,
          lesson.name,
          subject.name,
          lesson.is_visible || false
        );
      }
    } catch (notifError) {
      logger.error('Error sending notification:', notifError);
      // لا نوقف العملية إذا فشل الإشعار
    }
    
    res.status(201).json({ message: 'تم إنشاء الدرس بنجاح', lesson });
  } catch (error) {
    logger.error('Error creating lesson:', error);
    res.status(500).json({ error: 'خطأ في إنشاء الدرس' });
  }
});

// 3. Update Lesson (Admin, Teacher)
router.put('/lessons/:lessonId', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const { name } = req.body;
    const lesson = await PackageSubjectLessonService.updateLesson(lessonId, name);
    res.json({ message: 'تم تحديث الدرس', lesson });
  } catch {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

// 4. Delete Lesson (Admin, Teacher)
router.delete('/lessons/:lessonId', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    await PackageSubjectLessonService.deleteLesson(lessonId);
    res.json({ message: 'تم حذف الدرس' });
  } catch {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// 5. Add Video to Lesson
router.post('/lessons/:lessonId/videos', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const { name, link } = req.body;
    if (!name || !link) return res.status(400).json({ error: 'البيانات ناقصة' });

    const video = await PackageSubjectLessonService.addVideo(lessonId, name, link);
    
    // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان الدرس visible)
    try {
      const lesson = await PackageSubjectLessonService.getLesson(lessonId);
      if (lesson && lesson.is_visible) {
        const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
        if (subject) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
          const { NotificationService } = await import('../services/notifications');
          await NotificationService.notifyPackageVideoAdded(
            subject.package_id,
            lesson.subject_id,
            lessonId,
            video.id,
            video.name,
            lesson.name,
            subject.name,
            true // الفيديو visible لأن الدرس visible
          );
        }
      }
    } catch (notifError) {
      logger.error('Error sending notification:', notifError);
      // لا نوقف العملية إذا فشل الإشعار
    }
    
    res.status(201).json({ message: 'تم إضافة الفيديو', video });
  } catch {
    res.status(500).json({ error: 'خطأ في إضافة الفيديو' });
  }
});

// 6. Delete Video
// Note: We need to look up lessonId from videoId to checkWriteAccess properly, or just trust admin/teacher context if strict ownership isn't critical.
// For strict checking, we'd need a helper or just query the video first.
router.delete('/videos/:videoId', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    // Simple permission check (can be improved)
    const user = (req as any).user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.status(403).json({ error: 'Unauthorized' });

    // TODO: For teacher, verify subject ownership via video -> lesson -> subject

    await PackageSubjectLessonService.deleteVideo(parseInt(req.params.videoId));
    res.json({ message: 'تم حذف الفيديو' });
  } catch {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// 7. Add Assignment to Lesson
router.post('/lessons/:lessonId/assignments', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const { name, question_count, total_marks } = req.body;

    const assignment = await PackageSubjectLessonService.addAssignment(lessonId, name, question_count || 0, total_marks || 0);
    
    // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان visible)
    try {
      const lesson = await PackageSubjectLessonService.getLesson(lessonId);
      if (lesson) {
        const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
        if (subject) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
          const { NotificationService } = await import('../services/notifications');
          await NotificationService.notifyPackageAssignmentAdded(
            subject.package_id,
            lesson.subject_id,
            lessonId,
            assignment.id,
            assignment.name,
            lesson.name,
            subject.name,
            assignment.is_visible || false
          );
        }
      }
    } catch (notifError) {
      logger.error('Error sending notification:', notifError);
    }
    
    res.status(201).json({ message: 'تم إضافة الواجب', assignment });
  } catch {
    res.status(500).json({ error: 'خطأ في إضافة الواجب' });
  }
});

// 8. Delete Assignment
router.delete('/assignments/:assignmentId', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    await PackageSubjectLessonService.deleteAssignment(parseInt(req.params.assignmentId));
    res.json({ message: 'تم حذف الواجب' });
  } catch {
    res.status(500).json({ error: 'خطأ في الحذف' });
  }
});

// 9. Toggle Lesson Visibility
router.put('/lessons/:lessonId/visibility', authMiddleware(['admin', 'teacher']), checkWriteAccess, async (req: Request, res: Response) => {
  try {
    const lessonId = parseInt(req.params.lessonId);
    const { is_visible } = req.body;

    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ error: 'is_visible must be a boolean' });
    }

    const lesson = await PackageSubjectLessonService.toggleLessonVisibility(lessonId, is_visible);
    
    // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا أصبح visible)
    if (is_visible) {
      try {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
        const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
        if (subject) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
          const { NotificationService } = await import('../services/notifications');
          await NotificationService.notifyPackageLessonAdded(
            subject.package_id,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
            lesson.subject_id,
            lessonId,
              // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
            lesson.name,
            subject.name,
            true
          );
        }
      } catch (notifError) {
        logger.error('Error sending notification:', notifError);
      }
    }
    
    res.json({ message: 'تم تحديث حالة الظهور', lesson });
  } catch {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

// 10. Toggle Assignment Visibility
router.put('/assignments/:assignmentId/visibility', authMiddleware(['admin', 'teacher']), async (req: Request, res: Response) => {
  try {
    // Permission check similar to others (needs improvement for strict teacher ownership)
    const user = (req as any).user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.status(403).json({ error: 'Unauthorized' });

    const assignmentId = parseInt(req.params.assignmentId);
    const { is_visible } = req.body;

    if (typeof is_visible !== 'boolean') {
      return res.status(400).json({ error: 'is_visible must be a boolean' });
    }

    const assignment = await PackageSubjectLessonService.toggleAssignmentVisibility(assignmentId, is_visible);
    
    // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا أصبح visible)
    if (is_visible) {
      try {
        // جلب معلومات الواجب والدرس
        const assignmentResult = await pool.query(
          'SELECT * FROM package_subject_assignments WHERE id = $1',
          [assignmentId]
        );
        if (assignmentResult.rows.length > 0) {
          const assignmentData = assignmentResult.rows[0];
          const lesson = await PackageSubjectLessonService.getLesson(assignmentData.lesson_id);
          if (lesson) {
            const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
            if (subject) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
              const { NotificationService } = await import('../services/notifications');
              await NotificationService.notifyPackageAssignmentAdded(
                subject.package_id,
                lesson.subject_id,
                assignmentData.lesson_id,
                assignmentId,
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
                assignment.name,
                lesson.name,
                subject.name,
                true
              );
            }
          }
        }
      } catch (notifError) {
        logger.error('Error sending notification:', notifError);
      }
    }
    
    res.json({ message: 'تم تحديث حالة الظهور', assignment });
  } catch {
    res.status(500).json({ error: 'خطأ في التحديث' });
  }
});

export { router };
