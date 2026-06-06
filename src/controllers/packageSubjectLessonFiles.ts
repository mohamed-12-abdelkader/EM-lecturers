import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageSubjectLessonFilesService } from '../services/packageSubjectLessonFiles';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToCloudinary } from '../utils';

export const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/lesson-files');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'lesson-file-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
});

const CreateFileSchema = z.object({
  title: z.string().min(1),
  file_url: z.string().url().optional(), // optional if uploading file
  order_index: z.number().int().min(0).optional(),
});

const UpdateFileSchema = z.object({
  title: z.string().min(1).optional(),
  file_url: z.string().url().optional(),
  order_index: z.number().int().min(0).optional(),
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

// POST /api/lessons/:lessonId/files
router.post(
  '/lessons/:lessonId/files',
  authMiddleware(['admin', 'teacher']),
  upload.single('file'),
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
      title: req.body.title || req.body.name || file?.originalname || 'ملف',
      file_url: fileUrl,
      order_index: req.body.order_index ? parseInt(req.body.order_index) : undefined,
    });

    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
    const createdFile = await PackageSubjectLessonFilesService.createFile(lessonId, parsed.data);
    
    // إرسال إشعار للطلاب المشتركين في الباقة
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
      const { PackageSubjectItemService } = await import('../services/packageSubjectItems');
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
      const { PackageSubjectLessonService } = await import('../services/packageSubjectLessons');
      const lesson = await PackageSubjectLessonService.getLesson(lessonId);
      if (lesson) {
        const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
        if (subject) {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
          const { NotificationService } = await import('../services/notifications');
          await NotificationService.notifyPackageFileAdded(
            subject.package_id,
            lesson.subject_id,
            createdFile.title,
            subject.name,
            lessonId,
            lesson.name
          );
        }
      }
    } catch {
      // لا نوقف العملية إذا فشل الإشعار
    }
    
    return res.status(201).json({ success: true, file: createdFile });
  })
);

// PUT /api/files/:fileId
router.put(
  '/files/:fileId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectLessonFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const user = (req as any).user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const updated = await PackageSubjectLessonFilesService.updateFile(fileId, parsed.data);
    return res.json({ success: true, file: updated });
  })
);

// GET /api/lessons/:lessonId/files - Get files for lesson
router.get(
  '/lessons/:lessonId/files',
  authMiddleware(['admin', 'teacher', 'student']),
  asyncWrapper(async (req: Request, res: Response) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) return res.status(400).json({ error: 'Invalid lesson ID' });

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
    const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson) return res.status(404).json({ error: 'الدرس غير موجود' });

    // Check access for students
    const user = (req as any).user;
    if (user.role === 'student') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
      const { PackageSubjectItemService } = await import('../services/packageSubjectItems');
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
      const { PackageActivationCodeService } = await import('../services/packageActivationCodes');
      
      const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
      if (!subject) return res.status(404).json({ error: 'المادة غير موجودة' });
      
      const isActivated = await PackageActivationCodeService.isActivated(subject.package_id, user.id);
      if (!isActivated) {
        return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً للوصول إلى هذا الدرس' });
      }
    }

    const files = await PackageSubjectLessonFilesService.getFilesByLesson(lessonId);
    return res.json({ files });
  })
);

// DELETE /api/files/:fileId
router.delete(
  '/files/:fileId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId)) return res.status(400).json({ error: 'Invalid file ID' });

    const existing = await PackageSubjectLessonFilesService.getFileById(fileId);
    if (!existing) return res.status(404).json({ error: 'الملف غير موجود' });

    const user = (req as any).user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    await PackageSubjectLessonFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
  })
);












