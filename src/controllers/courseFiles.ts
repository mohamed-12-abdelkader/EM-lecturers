import fs from 'node:fs';
import path from 'node:path';
import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { parseNumberInput } from '../utils/requestParsers';
import { courseFilesConfig, resolveCoursePdfLocalPath } from '../config/courseFiles';
import { CourseFilesService, type RequestUser } from '../services/courseFiles';
import { FileStorageService } from '../modules/myFiles/services/fileStorage.service';
import { COURSE_CONTENT_ROLES } from '../services/courseAccessControl';
import { NotificationService } from '../services/notifications';
import pool from '../db/pool';
import rateLimit from 'express-rate-limit';

export const courseFilesByCourseRouter = Router();
export const courseFilesRouter = Router();

const VIEW_ROLES = ['student', 'teacher', 'academy', 'academy_teacher', 'admin'] as const;

const uploadDir = path.join(process.cwd(), courseFilesConfig.tempDir);
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, _file, cb) => cb(null, `pdf-${Date.now()}-${randomSuffix()}.pdf`),
  }),
  limits: { fileSize: courseFilesConfig.maxFileSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext !== '.pdf') {
      cb(new Error('يُسمح بملفات PDF فقط'));
      return;
    }
    cb(null, true);
  },
});

function randomSuffix(): string {
  return Math.round(Math.random() * 1e12).toString(36);
}

function requestUser(req: Request): RequestUser {
  const user = req.user!;
  return { id: user.id, role: user.role, tenant_id: user.tenant_id };
}

function handleServiceError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  return null;
}

function cleanupUpload(file?: Express.Multer.File) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => undefined);
}

function parseId(value: string | undefined, label: string): number {
  const id = parseNumberInput(value);
  if (!id || !Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, `${label} غير صالح`);
  }
  return id;
}

function attachAccessTokenFromQuery(req: Request, _res: Response, next: NextFunction) {
  if (!req.headers.authorization) {
    const token =
      (typeof req.query.access_token === 'string' && req.query.access_token) ||
      (typeof req.query.token === 'string' && req.query.token);
    if (token) req.headers.authorization = `Bearer ${token}`;
  }
  next();
}

function multerPdfUpload(req: Request, res: Response, next: NextFunction) {
  upload.single('file')(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          message: `حجم الملف أكبر من الحد المسموح (${courseFilesConfig.maxFileSizeMb}MB)`,
        });
      }
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err instanceof Error) {
      return res.status(400).json({ success: false, message: err.message });
    }
    next();
  });
}

export const courseFilesUploadRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'تم تجاوز حد رفع الملفات. حاول مرة أخرى لاحقاً.' },
});

export const courseFilesViewRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'تم تجاوز حد عرض الملفات. حاول مرة أخرى لاحقاً.' },
});

const UpdateFileSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
});

async function listLectureFiles(req: Request, res: Response) {
  const lectureId = parseId(req.params.lectureId, 'معرف المحاضرة');
  const { courseId } = await CourseFilesService.resolveLectureCourse(lectureId);
  await CourseFilesService.assertCanView(requestUser(req), courseId);
  const files = await CourseFilesService.listByLecture(lectureId);
  const data = files.map((file) => CourseFilesService.serialize(file));
  return res.json({
    success: true,
    data,
    files: data,
  });
}

async function uploadLectureFile(req: Request, res: Response) {
  const lectureId = parseId(req.params.lectureId, 'معرف المحاضرة');
  const uploaded = req.file;
  if (!uploaded) {
    return res.status(400).json({ success: false, message: 'يجب إرفاق ملف PDF في الحقل file' });
  }

  const { courseId, lectureTitle } = await CourseFilesService.resolveLectureCourse(lectureId);
  const title = String(req.body?.title ?? req.body?.name ?? '').trim();
  const description =
    req.body?.description === undefined || req.body?.description === ''
      ? null
      : String(req.body.description);

  try {
    const created = await CourseFilesService.createFromUpload({
      user: requestUser(req),
      courseId,
      lectureId,
      file: uploaded,
      title,
      description,
    });

    try {
      const courseRes = await pool.query(`SELECT title FROM courses WHERE id = $1`, [courseId]);
      await NotificationService.notifyFileAdded(
        courseId,
        lectureId,
        created.title,
        lectureTitle,
        courseRes.rows[0]?.title || '',
      );
    } catch (notifErr) {
      console.warn('Lecture file notification failed:', notifErr);
    }

    return res.status(201).json({
      success: true,
      message: 'تم رفع الملف بنجاح',
      data: CourseFilesService.serialize(created),
      file: CourseFilesService.serialize(created),
    });
  } catch (error) {
    cleanupUpload(uploaded);
    const handled = handleServiceError(res, error);
    if (handled) return handled;
    throw error;
  }
}

async function listCourseFiles(req: Request, res: Response) {
  const courseId = parseId(req.params.courseId, 'معرف الكورس');
  await CourseFilesService.assertCanView(requestUser(req), courseId);
  const files = await CourseFilesService.listByCourse(courseId);
  const data = files.map((file) => CourseFilesService.serialize(file));
  return res.json({
    success: true,
    data,
    files: data,
  });
}

async function uploadCourseFile(req: Request, res: Response) {
  const courseId = parseId(req.params.courseId, 'معرف الكورس');
  const uploaded = req.file;
  if (!uploaded) {
    return res.status(400).json({ success: false, message: 'يجب إرفاق ملف PDF في الحقل file' });
  }

  const title = String(req.body?.title ?? req.body?.name ?? '').trim();
  const description =
    req.body?.description === undefined || req.body?.description === ''
      ? null
      : String(req.body.description);

  try {
    const created = await CourseFilesService.createFromUpload({
      user: requestUser(req),
      courseId,
      file: uploaded,
      title,
      description,
    });

    try {
      const courseRes = await pool.query(`SELECT title FROM courses WHERE id = $1`, [courseId]);
      await NotificationService.notifyCourseStudents(courseId, {
        title: 'ملف جديد في الكورس',
        message: `تم إضافة ملف "${created.title}" في كورس "${courseRes.rows[0]?.title || ''}"`,
        type: 'file_added',
        course_id: courseId,
      });
    } catch (notifErr) {
      console.warn('Course file notification failed:', notifErr);
    }

    return res.status(201).json({
      success: true,
      message: 'تم رفع الملف بنجاح',
      data: CourseFilesService.serialize(created),
      file: CourseFilesService.serialize(created),
    });
  } catch (error) {
    cleanupUpload(uploaded);
    const handled = handleServiceError(res, error);
    if (handled) return handled;
    throw error;
  }
}

async function getCourseFile(req: Request, res: Response) {
  const fileId = parseId(req.params.fileId, 'معرف الملف');
  const file = await CourseFilesService.getAccessibleFile(requestUser(req), fileId);
  return res.json({
    success: true,
    data: CourseFilesService.serialize(file),
  });
}

async function patchCourseFile(req: Request, res: Response) {
  const fileId = parseId(req.params.fileId, 'معرف الملف');
  const parsed = UpdateFileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      message: 'بيانات غير صالحة',
      errors: parsed.error.errors,
    });
  }
  if (parsed.data.title === undefined && parsed.data.description === undefined) {
    return res.status(400).json({ success: false, message: 'لا توجد حقول للتعديل' });
  }
  const updated = await CourseFilesService.updateMetadata(
    requestUser(req),
    fileId,
    parsed.data,
    req.params.courseId ? parseId(req.params.courseId, 'معرف الكورس') : undefined,
  );
  return res.json({
    success: true,
    message: 'تم تحديث الملف بنجاح',
    data: CourseFilesService.serialize(updated),
  });
}

async function deleteCourseFile(req: Request, res: Response) {
  const fileId = parseId(req.params.fileId, 'معرف الملف');
  const expectedCourseId = req.params.courseId
    ? parseId(req.params.courseId, 'معرف الكورس')
    : undefined;
  await CourseFilesService.delete(requestUser(req), fileId, expectedCourseId);
  return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
}

function wantsJsonView(req: Request): boolean {
  return req.query.format === 'json' || req.query.mode === 'url';
}

function wantsRedirect(req: Request): boolean {
  const fetchDest = String(req.headers['sec-fetch-dest'] || '');
  return (
    req.query.redirect === 'true' ||
    req.query.redirect === '1' ||
    fetchDest === 'iframe' ||
    fetchDest === 'embed' ||
    fetchDest === 'object'
  );
}

/** طلب العارض داخل المنصة — لا يُرسل كتحميل PDF حتى لا يلتقطه IDM */
function isInAppPdfClient(req: Request): boolean {
  const accept = String(req.headers.accept || '').toLowerCase();
  const requestedWith = String(req.headers['x-requested-with'] || '');
  const client = String(req.query.client || '');
  return (
    req.method === 'POST' ||
    requestedWith === 'XMLHttpRequest' ||
    accept.includes('application/octet-stream') ||
    client === 'app'
  );
}

async function viewCourseFile(req: Request, res: Response) {
  const fileId = parseId(req.params.fileId, 'معرف الملف');
  const file = await CourseFilesService.getAccessibleFile(requestUser(req), fileId);
  const mimeType = file.mime_type || file.file_type || 'application/pdf';
  const ttl = courseFilesConfig.signedUrlTtlSeconds;

  const inlineName = sanitizeContentDisposition(file.title || file.original_name || `file-${file.id}.pdf`);

  if (wantsJsonView(req) && !wantsRedirect(req)) {
    const signedUrl = file.file_key
      ? await FileStorageService.getSignedViewUrl(file.file_key, file.file_url, {
          provider: file.storage_provider,
          deliveryType: file.delivery_type,
          ttlSeconds: ttl,
        })
      : null;

    return res.json({
      success: true,
      data: {
        ...CourseFilesService.serialize(file),
        expiresIn: ttl,
        viewUrl: CourseFilesService.buildViewPath(file.id),
        signedViewUrl: signedUrl,
      },
    });
  }

  if (wantsRedirect(req) && !isInAppPdfClient(req) && file.file_key) {
    const signedUrl = await FileStorageService.getSignedViewUrl(file.file_key, file.file_url, {
      provider: file.storage_provider,
      deliveryType: file.delivery_type,
      ttlSeconds: ttl,
    });
    if (signedUrl) {
      res.setHeader('Cache-Control', 'private, no-store');
      return res.redirect(302, signedUrl);
    }
  }

  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Accept-Ranges', 'bytes');
  res.removeHeader('X-Frame-Options');

  if (isInAppPdfClient(req)) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline');
  } else {
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(inlineName)}`);
  }

  const localPath = resolveLocalCoursePdfPath(file);
  if (localPath && fs.existsSync(localPath)) {
    return res.sendFile(localPath, {
      acceptRanges: true,
      cacheControl: false,
      lastModified: true,
      etag: false,
      headers: {
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const { stream, contentLength } = await FileStorageService.openReadStream(
    file.file_key || '',
    file.file_url,
    {
      provider: file.storage_provider === 'legacy' ? undefined : file.storage_provider,
      deliveryType: file.delivery_type,
      ttlSeconds: ttl,
    },
  );

  if (contentLength) res.setHeader('Content-Length', String(contentLength));

  stream.on('error', (error) => {
    console.error('[CourseFiles] stream error', error);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: 'فشل قراءة الملف' });
    } else {
      res.destroy(error);
    }
  });
  stream.pipe(res);
}

function resolveLocalCoursePdfPath(file: {
  file_key?: string | null;
  file_url?: string | null;
  storage_provider?: string | null;
}): string | null {
  const url = String(file.file_url || '');
  const isLocal = url.startsWith('/uploads/') || file.storage_provider === 'local' || !file.storage_provider;
  if (!isLocal && !url.startsWith('/uploads/')) return null;
  try {
    return resolveCoursePdfLocalPath(file.file_key || '', file.file_url);
  } catch {
    return null;
  }
}

function sanitizeContentDisposition(name: string): string {
  const base = name.replace(/[\r\n"]+/g, '').trim() || 'document.pdf';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}

function wrap(handler: (req: Request, res: Response) => Promise<unknown>) {
  return asyncWrapper(async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      const handled = handleServiceError(res, error);
      if (handled) return handled;
      throw error;
    }
  });
}

/** GET + POST: الفرونت يجلب الـPDF عبر POST (arraybuffer) أو GET للـiframe */
export const courseFileViewHandlers = [
  attachAccessTokenFromQuery,
  authMiddleware([...VIEW_ROLES]),
  courseFilesViewRateLimit,
  wrap(viewCourseFile),
];

courseFilesByCourseRouter.get(
  '/lecture/:lectureId/files',
  authMiddleware([...VIEW_ROLES]),
  wrap(listLectureFiles),
);

courseFilesByCourseRouter.post(
  '/lecture/:lectureId/files',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  courseFilesUploadRateLimit,
  multerPdfUpload,
  wrap(uploadLectureFile),
);

courseFilesByCourseRouter.get(
  '/:courseId/files',
  authMiddleware([...VIEW_ROLES]),
  wrap(listCourseFiles),
);

courseFilesByCourseRouter.post(
  '/:courseId/files',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  courseFilesUploadRateLimit,
  multerPdfUpload,
  wrap(uploadCourseFile),
);

courseFilesByCourseRouter.delete(
  '/:courseId/files/:fileId',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  wrap(deleteCourseFile),
);

courseFilesByCourseRouter.patch(
  '/:courseId/files/:fileId',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  wrap(patchCourseFile),
);

courseFilesRouter.route('/:fileId/view').get(...courseFileViewHandlers).post(...courseFileViewHandlers).head(...courseFileViewHandlers);

courseFilesRouter.get(
  '/:fileId',
  authMiddleware([...VIEW_ROLES]),
  wrap(getCourseFile),
);

courseFilesRouter.patch(
  '/:fileId',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  wrap(patchCourseFile),
);

courseFilesRouter.delete(
  '/:fileId',
  authMiddleware([...COURSE_CONTENT_ROLES]),
  wrap(deleteCourseFile),
);
