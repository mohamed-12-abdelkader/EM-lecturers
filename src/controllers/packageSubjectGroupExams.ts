import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageSubjectGroupExamsService } from '../services/packageSubjectGroupExams';

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

async function checkGroupPermission(groupId: number, userId: number, userRole: string) {
  if (userRole === 'admin') return true;
  if (userRole !== 'teacher') return false;
  return await PackageSubjectGroupsService.teacherOwnsGroup(groupId, userId);
}

// POST /api/subjects/:subjectId/groups/:groupId/package-group-exams
router.post(
  '/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/package-group-exams',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const user = (req as any).user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = CreateExamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const exam = await PackageSubjectGroupExamsService.createExam(groupId, parsed.data);
    return res.status(201).json({ success: true, exam });
  })
);

// GET /api/subjects/:subjectId/groups/:groupId/package-group-exams
router.get(
  '/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/package-group-exams',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const user = (req as any).user;
    const ok = await checkGroupPermission(groupId, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const exams = await PackageSubjectGroupExamsService.getExamsByGroup(groupId, false);
    return res.json({ success: true, group_id: groupId, exams, total: exams.length });
  })
);

// PUT /api/package-group-exams/:examId
router.put(
  '/package-group-exams/:examId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const group = await PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const user = (req as any).user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = UpdateExamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const updated = await PackageSubjectGroupExamsService.updateExam(examId, parsed.data);
    return res.json({ success: true, exam: updated });
  })
);

// PATCH /api/package-group-exams/:examId/visibility
router.patch(
  '/package-group-exams/:examId/visibility',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const parsed = z.object({ is_visible: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const group = await PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const user = (req as any).user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const updated = await PackageSubjectGroupExamsService.toggleExamVisibility(examId, parsed.data.is_visible);
    return res.json({ success: true, exam: updated });
  })
);

// DELETE /api/package-group-exams/:examId
router.delete(
  '/package-group-exams/:examId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const examId = parseInt(req.params.examId);
    if (isNaN(examId)) return res.status(400).json({ error: 'Invalid exam ID' });

    const existing = await PackageSubjectGroupExamsService.getExamById(examId);
    if (!existing) return res.status(404).json({ error: 'الامتحان غير موجود' });

    const group = await PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const user = (req as any).user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    await PackageSubjectGroupExamsService.deleteExam(examId);
    return res.json({ success: true, message: 'تم حذف الامتحان بنجاح' });
  })
);


