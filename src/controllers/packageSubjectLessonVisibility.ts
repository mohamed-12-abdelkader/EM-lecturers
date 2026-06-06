import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';

// This router exists to provide a stable root-level path:
// PATCH /api/lessons/:lessonId/visibility
// (Without mounting the full packageSubjectLessons router at '/')
export const router = Router();

router.patch(
  '/lessons/:lessonId/visibility',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const existingLesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!existingLesson) return res.status(404).json({ error: 'الدرس غير موجود' });

    const user = (req as any).user;
    if (user.role === 'teacher') {
      if (!existingLesson.group_id) {
        return res
          .status(403)
          .json({ error: 'Forbidden', message: 'ليس لديك صلاحية للتحكم في إظهار هذا الدرس' });
      }
      const ok = await PackageSubjectGroupsService.teacherOwnsGroup(existingLesson.group_id, user.id);
      if (!ok) {
        return res
          .status(403)
          .json({ error: 'Forbidden', message: 'ليس لديك صلاحية للتحكم في إظهار هذا الدرس' });
      }
    }

    const parsed = z.object({ is_visible: z.boolean() }).safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }

    const updatedLesson = await PackageSubjectLessonService.toggleLessonVisibility(
      lessonId,
      parsed.data.is_visible
    );

    return res.json({
      success: true,
      message: parsed.data.is_visible ? 'تم إظهار الدرس بنجاح' : 'تم إخفاء الدرس بنجاح',
      lesson: updatedLesson,
    });
  })
);












