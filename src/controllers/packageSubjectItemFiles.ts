import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectItemFilesService } from '../services/packageSubjectItemFiles';
import { PackageSubjectItemService } from '../services/packageSubjectItems';
import { PackageSubjectPermissionsService } from '../services/packageSubjectPermissions';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToCloudinary } from '../utils';

export const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/package-subject-files');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'subject-file-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const CreateFileSchema = z.object({
  name: z.string().min(1),
  file_url: z.string().url().optional(), // optional if uploading file
  order_index: z.number().int().min(0).optional(),
});

const UpdateFileSchema = z.object({
  name: z.string().min(1).optional(),
  file_url: z.string().url().optional(),
  order_index: z.number().int().min(0).optional(),
});

// Check read access (for students, teachers, admins)
async function checkReadAccess(subjectId: number, userId: number, userRole: string): Promise<boolean> {
  if (userRole === 'admin') return true;

  if (userRole === 'teacher') {
    return await PackageSubjectPermissionsService.hasPermission(subjectId, userId);
  }

  if (userRole === 'student') {
    const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
    if (!subject) return false;
    return await PackageActivationCodeService.isActivated(subject.package_id, userId);
  }

  return false;
}

// Check write access (for admins and authorized teachers)
async function checkWriteAccess(subjectId: number, userId: number, userRole: string): Promise<boolean> {
  if (userRole === 'admin') return true;

  if (userRole === 'teacher') {
    return await PackageSubjectPermissionsService.hasPermission(subjectId, userId);
  }

  return false;
}

// ========== Subject Files APIs ==========

// GET /api/package-subjects/:subjectId/files - Get files for subject
router.get(
  '/:subjectId/files',
  authMiddleware(['admin', 'teacher', 'student']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });

    const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
    if (!subject) return res.status(404).json({ error: 'المادة غير موجودة' });

    const user = (req as any).user;
    const hasAccess = await checkReadAccess(subjectId, user.id, user.role);
    if (!hasAccess) return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذه المادة' });

    const files = await PackageSubjectItemFilesService.getFilesBySubject(subjectId);
    return res.json({ files });
  })
);

// POST /api/package-subjects/:subjectId/files - Create file for subject
router.post(
  '/:subjectId/files',
  authMiddleware(['admin', 'teacher']),
  upload.single('file'),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });

    const subject = await PackageSubjectItemService.getPackageSubjectItem(subjectId);
    if (!subject) return res.status(404).json({ error: 'المادة غير موجودة' });

    const user = (req as any).user;
    const hasAccess = await checkWriteAccess(subjectId, user.id, user.role);
    if (!hasAccess) return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة ملفات لهذه المادة' });

    const file = req.file;
    let fileUrl = req.body.file_url;

    // If file is uploaded, upload to Cloudinary
    if (file) {
      try {
        const uploaded = await uploadToCloudinary(file.path);
        fileUrl = uploaded.secure_url;
        // Delete local file after upload
        fs.unlinkSync(file.path);
      } catch {
        return res.status(500).json({ error: 'فشل في رفع الملف' });
      }
    }

    if (!fileUrl) {
      return res.status(400).json({ error: 'يجب إرفاق ملف أو توفير رابط الملف' });
    }

    const parsed = CreateFileSchema.safeParse({
      name: req.body.name,
      file_url: fileUrl,
      order_index: req.body.order_index ? parseInt(req.body.order_index) : undefined,
    });

    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }

    const createdFile = await PackageSubjectItemFilesService.createFile(subjectId, {
      name: parsed.data.name,
      file_url: parsed.data.file_url!,
      file_size: file ? file.size : undefined,
      file_type: file ? file.mimetype : undefined,
      order_index: parsed.data.order_index,
    });

    // إرسال إشعار للطلاب المشتركين في الباقة
    try {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      const { NotificationService } = await import('../services/notifications');
      await NotificationService.notifyPackageFileAdded(
        subject.package_id,
        subjectId,
        createdFile.name,
        subject.name
      );
    } catch (notifError) {
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      logger.error('Error sending notification:', notifError);
    }

    return res.status(201).json({ success: true, file: createdFile });
  })
);

// PUT /api/package-subjects/files/:fileId - Update file
router.put(
  '/files/:fileId',
  authMiddleware(['admin', 'teacher']),
  upload.single('file'),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectItemFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const user = (req as any).user;
    const hasAccess = await checkWriteAccess(existing.subject_id, user.id, user.role);
    if (!hasAccess) return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الملف' });

    const file = req.file;
    let fileUrl = req.body.file_url;

    // If new file is uploaded, upload to Cloudinary
    if (file) {
      try {
        const uploaded = await uploadToCloudinary(file.path);
        fileUrl = uploaded.secure_url;
        // Delete local file after upload
        fs.unlinkSync(file.path);
      } catch {
        return res.status(500).json({ error: 'فشل في رفع الملف' });
      }
    }

    const updateData: any = {};
    if (req.body.name !== undefined) updateData.name = req.body.name;
    if (fileUrl !== undefined) updateData.file_url = fileUrl;
    if (req.body.order_index !== undefined) updateData.order_index = parseInt(req.body.order_index);
    if (file) {
      updateData.file_size = file.size;
      updateData.file_type = file.mimetype;
    }

    const parsed = UpdateFileSchema.safeParse(updateData);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }

    const updated = await PackageSubjectItemFilesService.updateFile(fileId, {
      ...parsed.data,
      file_size: file ? file.size : undefined,
      file_type: file ? file.mimetype : undefined,
    });

    return res.json({ success: true, file: updated });
  })
);

// DELETE /api/package-subjects/files/:fileId - Delete file
router.delete(
  '/files/:fileId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectItemFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const user = (req as any).user;
    const hasAccess = await checkWriteAccess(existing.subject_id, user.id, user.role);
    if (!hasAccess) return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا الملف' });

    await PackageSubjectItemFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
  })
);
