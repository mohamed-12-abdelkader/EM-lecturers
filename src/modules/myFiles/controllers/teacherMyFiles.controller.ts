import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response, NextFunction } from 'express';
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
import { FileStorageService } from '../services/fileStorage.service';
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

function resolveTenantId(req: Request): number {
  const tenantId = req.tenant?.id;
  if (!tenantId) throw new HttpError(400, 'Tenant context is required');
  return tenantId;
}

function maybeUploadSingle(req: Request, res: Response, next: NextFunction) {
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('multipart/form-data')) {
    return upload.single('file')(req, res, next);
  }
  next();
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

const CreateDriveFileSchema = z.object({
  name: z.string().min(1).max(300),
  driveUrl: z.string().url().min(10),
  description: z.string().max(5000).optional().nullable(),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  fileExtension: z.string().max(20).optional(),
});

const BulkDriveLinksSchema = z.object({
  links: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        driveUrl: z.string().url().min(10),
        description: z.string().max(5000).optional().nullable(),
        fileExtension: z.string().max(20).optional(),
      }),
    )
    .min(1)
    .max(20),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
});

const UpdateFileSchema = z.object({
  name: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  categoryId: z.coerce.number().int().positive().optional().nullable(),
  driveUrl: z.string().url().min(10).optional(),
  fileExtension: z.string().max(20).optional(),
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
  maybeUploadSingle,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const tenantId = resolveTenantId(req);

    if (req.file) {
      const name = (req.body.name as string | undefined)?.trim() || req.file.originalname || 'file';
      const description = req.body.description as string | undefined;
      const categoryId =
        parseNumberInput(req.body.categoryId) ?? parseNumberInput(req.body.category_id) ?? null;

      try {
        const saved = await TeacherFilesService.uploadFile({
          teacherId,
          tenantId,
          file: req.file,
          name,
          description,
          categoryId,
        });

        return res.status(201).json({
          success: true,
          message: 'تم رفع الملف بنجاح',
          data: TeacherFilesService.serializeFile(saved),
        });
      } catch (error) {
        cleanupFiles(req.file);
        const handled = handleServiceError(res, error);
        if (handled) return handled;
        throw error;
      }
    }

    const parsed = CreateDriveFileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    try {
      const saved = await TeacherFilesService.createDriveFile({
        teacherId,
        name: parsed.data.name,
        driveUrl: parsed.data.driveUrl,
        description: parsed.data.description ?? undefined,
        categoryId: parsed.data.categoryId ?? null,
        fileExtension: parsed.data.fileExtension,
      });

      return res.status(201).json({
        success: true,
        message: 'تم إضافة رابط الملف بنجاح',
        data: TeacherFilesService.serializeFile(saved),
      });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.post(
  '/bulk-links',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesBulkUploadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const parsed = BulkDriveLinksSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.errors,
      });
    }

    const categoryId = parsed.data.categoryId ?? null;
    const baseDescription = parsed.data.description ?? undefined;
    const added = [];
    const errors: Array<{ name: string; error: string }> = [];

    for (const link of parsed.data.links) {
      try {
        const saved = await TeacherFilesService.createDriveFile({
          teacherId,
          name: link.name,
          driveUrl: link.driveUrl,
          description: link.description ?? baseDescription,
          categoryId,
          fileExtension: link.fileExtension,
        });
        added.push(TeacherFilesService.serializeFile(saved));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'فشل إضافة الرابط';
        errors.push({ name: link.name, error: message });
      }
    }

    return res.status(added.length > 0 ? 201 : 400).json({
      success: added.length > 0,
      message:
        added.length > 0
          ? `تم إضافة ${added.length} رابط بنجاح`
          : 'فشل إضافة جميع الروابط',
      data: { added, errors },
    });
  }),
);

/** @deprecated استخدم POST /bulk-links */
teacherFilesRouter.post(
  '/bulk-upload',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesBulkUploadRateLimit,
  upload.array('files', myFilesConfig.maxBulkFiles),
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const tenantId = resolveTenantId(req);
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
          tenantId,
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
        items: result.items.map((file) => TeacherFilesService.serializeFile(file)),
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

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const fromQuery =
    (typeof req.query.access_token === 'string' && req.query.access_token) ||
    (typeof req.query.token === 'string' && req.query.token);
  return fromQuery || null;
}

const streamFileView = asyncWrapper(async (req: Request, res: Response) => {
  const teacherId = resolveTeacherId(req);
  const id = parseNumberInput(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

  try {
    const file = await TeacherFilesService.getById(teacherId, id);

    if (TeacherFilesService.isDriveFile(file)) {
      const drive = TeacherFilesService.getDriveUrls(file);
      res.setHeader('Cache-Control', 'private, max-age=300');
      return res.redirect(302, drive.previewUrl);
    }

    const previewType = TeacherFilesService.getPreviewType(file.file_extension, file.mime_type);
    if (previewType === 'none') {
      const preview = await TeacherFilesService.getFilePreview(teacherId, id, false);
      return res.status(415).json({
        success: false,
        message: 'لا يمكن عرض هذا النوع داخل الموقع. استخدم التحميل.',
        data: preview,
      });
    }

    const fetchDest = String(req.headers['sec-fetch-dest'] || '');
    const wantsRedirect =
      req.query.redirect === 'true' ||
      req.query.redirect === '1' ||
      fetchDest === 'iframe' ||
      fetchDest === 'embed' ||
      fetchDest === 'object';

    if (wantsRedirect) {
      const directUrl = await FileStorageService.getDirectAccessUrl(file.file_key, file.file_url);
      if (directUrl) {
        res.setHeader('Cache-Control', 'private, max-age=300');
        return res.redirect(302, directUrl);
      }
    }

    const { buffer } = await TeacherFilesService.readFileBuffer(teacherId, id);

    const baseName = (file.name || `file-${id}`).replace(/[^\w\u0600-\u06FF.\-() ]+/g, '_');
    const ext = file.file_extension.toLowerCase();
    const fileName = baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    return res.send(buffer);
  } catch (error) {
    const handled = handleServiceError(res, error);
    if (handled) return handled;
    throw error;
  }
});

teacherFilesRouter.get(
  '/:id/embed',
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const data = await TeacherFilesService.getEmbedInfo(teacherId, id, extractBearerToken(req));
      return res.json({ success: true, data });
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id/thumbnail',
  attachAccessTokenFromQuery,
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const { buffer } = await TeacherFilesService.readThumbnailBufferForBoard(teacherId, id);
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.send(buffer);
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  }),
);

teacherFilesRouter.get(
  '/:id/board',
  attachAccessTokenFromQuery,
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = resolveTeacherId(req);
    const id = parseNumberInput(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });

    try {
      const { buffer, file, previewType } = await TeacherFilesService.readFileBufferForBoard(teacherId, id);

      const baseName = (file.name || `file-${id}`).replace(/[^\w\u0600-\u06FF.\-() ]+/g, '_');
      const ext = file.file_extension.toLowerCase();
      const fileName = baseName.toLowerCase().endsWith(`.${ext}`) ? baseName : `${baseName}.${ext}`;

      const contentType =
        previewType === 'image' && !file.mime_type.startsWith('image/')
          ? 'image/jpeg'
          : file.mime_type || 'application/octet-stream';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.send(buffer);
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
  streamFileView,
);

/** alias لـ /view — فتح الملف مباشرة */
teacherFilesRouter.get(
  '/:id/open',
  attachAccessTokenFromQuery,
  authMiddleware([...MY_FILES_ROLES]),
  teacherFilesDownloadRateLimit,
  streamFileView,
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
        driveUrl: parsed.data.driveUrl,
        fileExtension: parsed.data.fileExtension,
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
