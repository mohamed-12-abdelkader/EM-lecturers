import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageSubjectGroupFilesService } from '../services/packageSubjectGroupFiles';

export const router = Router();

const CreateFileSchema = z.object({
  title: z.string().min(1),
  file_url: z.string().url(),
  order_index: z.number().int().min(0).optional(),
});

const UpdateFileSchema = z.object({
  title: z.string().min(1).optional(),
  file_url: z.string().url().optional(),
  order_index: z.number().int().min(0).optional(),
});

async function checkGroupPermission(groupId: number, userId: number, userRole: string) {
  if (userRole === 'admin') return true;
  if (userRole !== 'teacher') return false;
  return await PackageSubjectGroupsService.teacherOwnsGroup(groupId, userId);
}

// POST /api/subjects/:subjectId/groups/:groupId/group-files
router.post(
  '/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/group-files',
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

    const parsed = CreateFileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const file = await PackageSubjectGroupFilesService.createFile(groupId, parsed.data);
    return res.status(201).json({ success: true, file });
  })
);

// GET /api/subjects/:subjectId/groups/:groupId/group-files
router.get(
  '/subjects/:subjectId(\\d+)/groups/:groupId(\\d+)/group-files',
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

    const files = await PackageSubjectGroupFilesService.getFilesByGroup(groupId);
    return res.json({ success: true, group_id: groupId, files, total: files.length });
  })
);

// PUT /api/group-files/:fileId
router.put(
  '/group-files/:fileId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectGroupFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const group = await PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const user = (req as any).user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const updated = await PackageSubjectGroupFilesService.updateFile(fileId, parsed.data);
    return res.json({ success: true, file: updated });
  })
);

// DELETE /api/group-files/:fileId
router.delete(
  '/group-files/:fileId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectGroupFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const group = await PackageSubjectGroupsService.getGroupById(existing.group_id);
    if (!group) return res.status(404).json({ error: 'المجموعة غير موجودة' });

    const user = (req as any).user;
    const ok = await checkGroupPermission(existing.group_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    await PackageSubjectGroupFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
  })
);


