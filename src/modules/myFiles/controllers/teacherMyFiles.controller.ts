import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { parseNumberInput } from '../../../utils/requestParsers';
import { myFilesConfig, resolveLocalStorageDir } from '../config';
import {
  teacherFilesBulkUploadRateLimit,
  teacherFilesDownloadRateLimit,
  teacherFilesUploadRateLimit,
} from '../middleware/rateLimit';
import { FileCategoriesService, TeacherFilesService } from '../services/teacherFiles.service';
import type { ListFilesQuery } from '../types';

const MY_FILES_ROLES = ['teacher', 'admin'] as const;

const uploadDir = path.join(process.cwd(), 'uploads/my-files-temp');
fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(resolveLocalStorageDir(), { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: myFilesConfig.maxFileSizeBytes, files: myFilesConfig.maxBulkFiles },
});

function resolveTeacherId(req: Request): number {
  const user = req.user!;
  if (user.role === 'admin') {
    const adminTeacherId =
      parseNumberInput(req.query.teacher_id as string | undefined) ??
      parseNumberInput(req.body?.teacher_id) ??
      parseNumberInput(req.body?.teacherId);
    if (adminTeacherId) return adminTeacherId;
  }
  return user.id;
}

function cleanupFiles(files?: Express.Multer.File | Express.Multer.File[]) {
  if (!files) return;
  const list = Array.isArray(files) ? files : [files];
  for (const file of list) {
    if (file?.path) fs.promises.unlink(file.path).catch(() => undefined);
  }
}

function handleServiceError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({ success: false, message: error.message });
  }
  throw error;
}

const CreateCategorySchema = z.object({
  name: z.string().min(1).max(200),
});

const UpdateCategorySchema = z.object({
  name: z.string().min(1).max(200),
});

const UpdateFileSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
});

const BulkDeleteSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

function attachAccessTokenFromQuery(req: Request, _res: Response, next: () => void) {
  if (!req.headers.authorization) {
    const token =
      (typeof req.query.access_token === 'string' && req.query.access_token) ||
      (typeof req.query.token === 'string' && req.query.token);
    if (token) {
      req.headers.authorization = `Bearer ${token}`;
    }
  }
  next();
}

export const teacherFilesRouter = Router();
export const teacherFileCategoriesRouter = Router();

// ── Files ─────────────────────────────────────────────────────────────

teacherFilesRouter.post(
  '/',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesUploadRateLimit,
  upload.single('file'),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const file = req.file;

    const name = (req.body.name || req.body.fileName || file?.originalname || '').trim();
    if (!name) {
      cleanupFiles(file);
      return res.status(400).json({ success: false, message: 'اسم الملف مطلوب' });
    }
    if (!file) {
      return res.status(400).json({ success: false, message: 'الملف مطلوب' });
    }

    try {
      const categoryId =
        parseNumberInput(req.body.categoryId) ?? parseNumberInput(req.body.category_id) ?? null;

      const saved = await TeacherFilesService.uploadFile({
        teacherId,
        file,
        name,
        description: req.body.description,
        categoryId,
      });

      return res.status(201).json({
        success: true,
        message: 'File uploaded successfully',
        data: TeacherFilesService.serializeFile(saved),
      });
    } catch (error) {
      cleanupFiles(file);
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.post(
  '/bulk-upload',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesBulkUploadRateLimit,
  upload.array('files', myFilesConfig.maxBulkFiles),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      return res.status(400).json({ success: false, message: 'يجب رفع ملف واحد على الأقل' });
    }

    const categoryId =
      parseNumberInput(req.body.categoryId) ?? parseNumberInput(req.body.category_id) ?? null;
    const baseDescription = req.body.description as string | undefined;
    const uploaded = [];
    const errors: Array<{ fileName: string; error: string }> = [];

    for (const file of files) {
      try {
        const saved = await TeacherFilesService.uploadFile({
          teacherId,
          file,
          name: (req.body.namePrefix ? `${req.body.namePrefix} - ` : '') + (file.originalname || 'file'),
          description: baseDescription,
          categoryId,
        });
        uploaded.push(TeacherFilesService.serializeFile(saved));
      } catch (error: unknown) {
        cleanupFiles(file);
        const message = error instanceof Error ? error.message : 'Upload failed';
        errors.push({
          fileName: file.originalname,
          error: message,
        });
      }
    }

    return res.status(uploaded.length > 0 ? 201 : 400).json({
      success: uploaded.length > 0,
      message:
        uploaded.length > 0
          ? `تم رفع ${uploaded.length} ملف بنجاح`
          : 'فشل رفع جميع الملفات',
      data: { uploaded, errors },
    });
  }),
);

teacherFilesRouter.get(
  '/statistics',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const stats = await TeacherFilesService.getStatistics(teacherId);
    return res.json({ success: true, data: stats });
  }),
);

teacherFilesRouter.get(
  '/',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const sortBy = (req.query.sortBy as ListFilesQuery['sortBy']) || 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';

    const query: ListFilesQuery = {
      teacherId,
      page,
      limit,
      search: req.query.search as string | undefined,
      categoryId:
        parseNumberInput(req.query.categoryId as string | undefined) ??
        parseNumberInput(req.query.category_id as string | undefined) ??
        undefined,
      fileType: req.query.fileType as string | undefined,
      sortBy: ['created_at', 'name', 'file_size', 'downloads_count'].includes(sortBy)
        ? sortBy
        : 'created_at',
      sortOrder,
    };

    const result = await TeacherFilesService.list(query);
    return res.json({
      success: true,
      data: {
        items: result.items.map(TeacherFilesService.serializeFile),
        pagination: {
          page,
          limit,
          total: result.total,
          totalPages: Math.ceil(result.total / limit) || 1,
        },
      },
    });
  }),
);

teacherFilesRouter.get(
  '/:id/download',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const result = await TeacherFilesService.download(teacherId, id);
      return res.json({
        success: true,
        data: {
          downloadUrl: result.downloadUrl,
          fileName: result.fileName,
          mimeType: result.mimeType,
          downloadsCount: result.downloadsCount,
        },
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id/view',
  attachAccessTokenFromQuery,
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const { buffer, file, previewType } = await TeacherFilesService.readFileBuffer(teacherId, id);
      if (previewType === 'none') {
        const preview = await TeacherFilesService.getFilePreview(teacherId, id, false);
        return res.status(415).json({
          success: false,
          message: 'لا يمكن عرض هذا النوع داخل الموقع. استخدم التحميل.',
          data: preview,
        });
      }

      const safeName = (file.name || `file-${id}`).replace(/[^\w\u0600-\u06FF.\-() ]+/g, '_');
      res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(safeName)}.${file.file_extension}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(buffer);
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id/preview',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    const includeText =
      req.query.includeText === 'true' ||
      req.query.include_text === 'true' ||
      req.query.text === 'true';

    try {
      const data = await TeacherFilesService.getFilePreview(teacherId, id, includeText);
      return res.json({ success: true, data });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id/content',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const payload = await TeacherFilesService.getFileContent(teacherId, id);
      return res.json({ success: true, data: payload });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const file = await TeacherFilesService.getById(teacherId, id);
      return res.json({ success: true, data: TeacherFilesService.serializeFile(file) });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.put(
  '/:id',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    try {
      const updated = await TeacherFilesService.update(teacherId, id, {
        name: parsed.data.name,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId ?? undefined,
      });
      return res.json({
        success: true,
        message: 'تم تحديث الملف بنجاح',
        data: TeacherFilesService.serializeFile(updated),
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.delete(
  '/bulk',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const parsed = BulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    const result = await TeacherFilesService.bulkDelete(teacherId, parsed.data.ids);
    return res.json({
      success: true,
      message: `تم حذف ${result.deletedCount} ملف`,
      data: result,
    });
  }),
);

teacherFilesRouter.delete(
  '/:id',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      await TeacherFilesService.delete(teacherId, id);
      return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

// ── Categories ──────────────────────────────────────────────────────────

teacherFileCategoriesRouter.post(
  '/',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const parsed = CreateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    try {
      const category = await FileCategoriesService.create(teacherId, parsed.data.name);
      return res.status(201).json({
        success: true,
        message: 'تم إنشاء التصنيف بنجاح',
        data: category,
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFileCategoriesRouter.get(
  '/',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const categories = await FileCategoriesService.list(teacherId);
    return res.json({ success: true, data: categories });
  }),
);

teacherFileCategoriesRouter.put(
  '/:id',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });

    const parsed = UpdateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    try {
      const category = await FileCategoriesService.update(teacherId, id, parsed.data.name);
      return res.json({
        success: true,
        message: 'تم تحديث التصنيف بنجاح',
        data: category,
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFileCategoriesRouter.delete(
  '/:id',
  authMiddleware([...MY_FILES_ROLES]),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });

    try {
      await FileCategoriesService.delete(teacherId, id);
      return res.json({ success: true, message: 'تم حذف التصنيف بنجاح' });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);
