import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageSubjectLessonExamsService } from '../services/packageSubjectLessonExams';

export const router = Router();

const CreateExamSchema = z.object({
  title: z.string().min(1),
  duration: z.number().int().min(0),
  total_marks: z.number().int().min(0),
});

const UpdateExamSchema = z.object({
  title: z.string().min(1).optional(),
  duration: z.number().int().min(0).optional(),
  total_marks: z.number().int().min(0).optional(),
  is_visible: z.boolean().optional(),
});

async function checkLessonPermission(lessonId: number, userId: number, userRole: string) {
  if (userRole === 'admin') return true;
  if (userRole !== 'teacher') return false;

  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
  if (!lesson?.group_id) return false;
  return await PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
}

// POST /api/lessons/:lessonId/exams
router.post(
  '/lessons/:lessonId/exams',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
    const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

    const user = (req as any).user;
    const ok = await checkLessonPermission(lessonId, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = CreateExamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const exam = await PackageSubjectLessonExamsService.createExam(lessonId, parsed.data);
    return res.status(201).json({ success: true, exam });
  })
);

// PUT /api/exams/:examId
router.put(
  '/exams/:examId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const user = (req as any).user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = UpdateExamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const updated = await PackageSubjectLessonExamsService.updateExam(examId, parsed.data);
    return res.json({ success: true, exam: updated });
  })
);

// PATCH /api/exams/:examId/visibility
router.patch(
  '/exams/:examId/visibility',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const parsed = z.object({ is_visible: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const user = (req as any).user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const updated = await PackageSubjectLessonExamsService.toggleExamVisibility(examId, parsed.data.is_visible);
    return res.json({ success: true, exam: updated });
  })
);

// DELETE /api/exams/:examId
router.delete(
  '/exams/:examId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectLessonExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const user = (req as any).user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    await PackageSubjectLessonExamsService.deleteExam(examId);
    return res.json({ success: true, message: 'تم حذف الامتحان بنجاح' });
  })
);












