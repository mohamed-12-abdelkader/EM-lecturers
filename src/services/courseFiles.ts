import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
import pool from '../db/pool';
import { courseFilesConfig, resolveCoursePdfLocalDir } from '../config/courseFiles';
import { FileStorageService } from '../modules/myFiles/services/fileStorage.service';
import { CourseAccessControl } from './courseAccessControl';
import { CourseAccessService } from './courseAccess';
import { HttpError, logger } from '../utils';
import {
  buildCourseFileViewPath,
  sanitizeOriginalName,
  serializeCourseFile,
  type CourseFilePublic,
} from './courseFiles.serialize';

export type { CourseFilePublic };
export { sanitizeOriginalName, serializeCourseFile, buildCourseFileViewPath };

const PDF_MAGIC = Buffer.from('%PDF-');

export type CourseFileRow = {
  id: number;
  course_id: number;
  lecture_id: number | null;
  teacher_id: number | null;
  uploaded_by: number | null;
  name: string;
  title: string;
  description: string | null;
  original_name: string | null;
  file_url: string;
  file_key: string | null;
  file_size: number | null;
  file_type: string | null;
  mime_type: string | null;
  storage_provider: string;
  upload_status: string;
  delivery_type: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  storage_deleted_at: string | null;
};

export type RequestUser = {
  id: number;
  role: string;
  tenant_id?: number | null;
};

const FILE_SELECT = `
  id, course_id, lecture_id, teacher_id, uploaded_by, name, title, description, original_name,
  file_url, file_key, file_size, file_type, mime_type, storage_provider,
  upload_status, delivery_type, created_at, updated_at, deleted_at, storage_deleted_at
`;

function isMissingColumnError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  return err?.code === '42703' || String(err?.message || '').includes('does not exist');
}

export async function assertPdfFile(file: Express.Multer.File): Promise<{
  mimeType: string;
  originalName: string;
}> {
  const originalName = sanitizeOriginalName(file.originalname);
  const ext = path.extname(originalName).replace(/^\./, '').toLowerCase();
  if (ext !== 'pdf') {
    throw new HttpError(400, 'يُسمح بملفات PDF فقط');
  }

  if (file.size > courseFilesConfig.maxFileSizeBytes) {
    throw new HttpError(
      413,
      `حجم الملف أكبر من الحد المسموح (${courseFilesConfig.maxFileSizeMb}MB)`,
    );
  }

  const header = Buffer.alloc(5);
  const handle = await fs.open(file.path, 'r');
  try {
    await handle.read(header, 0, 5, 0);
  } finally {
    await handle.close();
  }
  if (!header.equals(PDF_MAGIC)) {
    throw new HttpError(400, 'محتوى الملف ليس PDF صالحاً');
  }

  const detected = await fileTypeFromFile(file.path);
  if (detected && detected.mime !== 'application/pdf') {
    throw new HttpError(400, 'تم رفض الملف: نوع المحتوى الفعلي ليس PDF');
  }

  const declared = (file.mimetype || '').toLowerCase();
  if (declared && !courseFilesConfig.allowedMimeTypes.has(declared) && declared !== 'application/octet-stream') {
    throw new HttpError(400, 'نوع MIME غير مسموح. يُسمح بملفات PDF فقط');
  }

  return { mimeType: 'application/pdf', originalName };
}

export class CourseFilesService {
  static buildViewPath(fileId: number): string {
    return buildCourseFileViewPath(fileId);
  }

  static serialize(file: CourseFileRow): CourseFilePublic {
    return serializeCourseFile(file);
  }

  static async assertCanManage(user: RequestUser, courseId: number): Promise<void> {
    await CourseAccessControl.assertCourseExists(courseId);
    await CourseAccessControl.assertCanManageCourse(user, courseId);
  }

  static async assertCanView(user: RequestUser, courseId: number): Promise<void> {
    await CourseAccessControl.assertCourseExists(courseId);

    if (user.role === 'admin') return;

    if (user.role === 'student') {
      const access = await CourseAccessService.checkStudentAccess(user.id, courseId);
      if (!access.hasAccess) {
        throw new HttpError(403, 'ليس لديك صلاحية الوصول إلى هذا الملف', {
          code: 'COURSE_FILE_FORBIDDEN',
          reason: access.reason,
        });
      }
      return;
    }

    const canManage = await CourseAccessControl.canManageCourse(user, courseId);
    if (!canManage) {
      throw new HttpError(403, 'ليس لديك صلاحية الوصول إلى هذا الملف', {
        code: 'COURSE_FILE_FORBIDDEN',
      });
    }
  }

  static async listByCourse(courseId: number): Promise<CourseFileRow[]> {
    try {
      const result = await pool.query<CourseFileRow>(
        `SELECT ${FILE_SELECT}
         FROM course_files
         WHERE course_id = $1 AND deleted_at IS NULL AND lecture_id IS NULL
         ORDER BY created_at DESC, id DESC`,
        [courseId],
      );
      return result.rows;
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      const result = await pool.query<CourseFileRow>(
        `SELECT id, course_id, NULL::integer AS lecture_id, uploaded_by AS teacher_id, uploaded_by, name, name AS title,
                NULL::text AS description, name AS original_name, file_url, NULL::text AS file_key,
                file_size, file_type, file_type AS mime_type, 'legacy'::varchar AS storage_provider,
                'uploaded'::varchar AS upload_status, 'upload'::varchar AS delivery_type,
                created_at, updated_at, NULL::timestamptz AS deleted_at, NULL::timestamptz AS storage_deleted_at
         FROM course_files
         WHERE course_id = $1
         ORDER BY created_at DESC, id DESC`,
        [courseId],
      );
      return result.rows;
    }
  }

  static async listByLecture(lectureId: number): Promise<CourseFileRow[]> {
    try {
      const result = await pool.query<CourseFileRow>(
        `SELECT ${FILE_SELECT}
         FROM course_files
         WHERE lecture_id = $1 AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC`,
        [lectureId],
      );
      return result.rows;
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      return [];
    }
  }

  static async resolveLectureCourse(lectureId: number): Promise<{ courseId: number; lectureTitle: string }> {
    const result = await pool.query<{ course_id: number; title: string }>(
      `SELECT course_id, title FROM lectures WHERE id = $1 LIMIT 1`,
      [lectureId],
    );
    if (!result.rowCount) {
      throw new HttpError(404, 'المحاضرة غير موجودة');
    }
    return {
      courseId: result.rows[0].course_id,
      lectureTitle: result.rows[0].title,
    };
  }

  static async getById(fileId: number): Promise<CourseFileRow | null> {
    try {
      const result = await pool.query<CourseFileRow>(
        `SELECT ${FILE_SELECT}
         FROM course_files
         WHERE id = $1 AND deleted_at IS NULL`,
        [fileId],
      );
      return result.rowCount ? result.rows[0] : null;
    } catch (error) {
      if (!isMissingColumnError(error)) throw error;
      const result = await pool.query<CourseFileRow>(
        `SELECT id, course_id, NULL::integer AS lecture_id, uploaded_by AS teacher_id, uploaded_by, name, name AS title,
                NULL::text AS description, name AS original_name, file_url, NULL::text AS file_key,
                file_size, file_type, file_type AS mime_type, 'legacy'::varchar AS storage_provider,
                'uploaded'::varchar AS upload_status, 'upload'::varchar AS delivery_type,
                created_at, updated_at, NULL::timestamptz AS deleted_at, NULL::timestamptz AS storage_deleted_at
         FROM course_files WHERE id = $1`,
        [fileId],
      );
      return result.rowCount ? result.rows[0] : null;
    }
  }

  static async getAccessibleFile(user: RequestUser, fileId: number): Promise<CourseFileRow> {
    const file = await this.getById(fileId);
    if (!file) throw new HttpError(404, 'الملف غير موجود');
    await this.assertCanView(user, file.course_id);
    return file;
  }

  static async createFromUpload(input: {
    user: RequestUser;
    courseId: number;
    lectureId?: number | null;
    file: Express.Multer.File;
    title: string;
    description?: string | null;
  }): Promise<CourseFileRow> {
    await this.assertCanManage(input.user, input.courseId);

    if (input.lectureId) {
      const lecture = await this.resolveLectureCourse(input.lectureId);
      if (lecture.courseId !== input.courseId) {
        throw new HttpError(400, 'المحاضرة لا تنتمي لهذا الكورس');
      }
    }

    const title = input.title.trim();
    if (!title) throw new HttpError(400, 'عنوان الملف مطلوب');

    const { mimeType, originalName } = await assertPdfFile(input.file);
    const storageKey = `${randomUUID()}.pdf`;

    let stored;
    try {
      const uploadOptions: Parameters<typeof FileStorageService.upload>[3] = {
        access: 'authenticated',
        folder: courseFilesConfig.storageFolder,
      };

      if (FileStorageService.getProvider() === 'local') {
        uploadOptions.localDir = resolveCoursePdfLocalDir();
        uploadOptions.localUrlPrefix = courseFilesConfig.localPublicPrefix;
      }

      stored = await FileStorageService.upload(input.file.path, storageKey, mimeType, uploadOptions);
    } catch (error) {
      await fs.unlink(input.file.path).catch(() => undefined);
      logger.error({ err: error }, 'Course PDF storage upload failed');
      if (error instanceof HttpError) throw error;
      throw new HttpError(502, 'فشل رفع الملف إلى التخزين');
    }

    const storedProvider = stored.fileUrl.startsWith('/uploads/')
      ? 'local'
      : FileStorageService.getProvider();

    try {
      const result = await pool.query<CourseFileRow>(
        `INSERT INTO course_files (
           course_id, lecture_id, teacher_id, uploaded_by, name, title, description, original_name,
           file_url, file_key, file_size, file_type, mime_type,
           storage_provider, upload_status, delivery_type
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'uploaded',$15)
         RETURNING ${FILE_SELECT}`,
        [
          input.courseId,
          input.lectureId ?? null,
          input.user.id,
          input.user.id,
          title,
          title,
          input.description?.trim() || null,
          originalName,
          stored.fileUrl,
          stored.fileKey,
          input.file.size,
          mimeType,
          mimeType,
          storedProvider,
          stored.deliveryType || 'upload',
        ],
      );
      return result.rows[0];
    } catch (error) {
      await FileStorageService.deleteStoredObject(stored.fileKey, stored.fileUrl, {
        provider: storedProvider,
        deliveryType: stored.deliveryType,
      });
      if (isMissingColumnError(error)) {
        if (input.lectureId) {
          throw new HttpError(
            500,
            'جدول course_files يحتاج تحديث — شغّل الـ migration: 1778200000000_course_files_lecture_id.sql',
          );
        }
        throw new HttpError(
          500,
          'جدول course_files يحتاج تحديث — شغّل الـ migration: 1777000000000_enhance_course_files_pdf.sql',
        );
      }
      throw error;
    }
  }

  static async updateMetadata(
    user: RequestUser,
    fileId: number,
    fields: { title?: string; description?: string | null },
    expectedCourseId?: number,
  ): Promise<CourseFileRow> {
    const file = await this.getById(fileId);
    if (!file) throw new HttpError(404, 'الملف غير موجود');
    if (expectedCourseId && file.course_id !== expectedCourseId) {
      throw new HttpError(404, 'الملف غير موجود');
    }
    await this.assertCanManage(user, file.course_id);

    const title = fields.title !== undefined ? fields.title.trim() : undefined;
    if (title !== undefined && !title) {
      throw new HttpError(400, 'عنوان الملف لا يمكن أن يكون فارغاً');
    }

    const result = await pool.query<CourseFileRow>(
      `UPDATE course_files
       SET title = COALESCE($2, title),
           name = COALESCE($2, name),
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${FILE_SELECT}`,
      [fileId, title ?? null, fields.description !== undefined, fields.description?.trim() ?? null],
    );
    if (!result.rowCount) throw new HttpError(404, 'الملف غير موجود');
    return result.rows[0];
  }

  static async delete(user: RequestUser, fileId: number, expectedCourseId?: number): Promise<CourseFileRow> {
    const file = await this.getById(fileId);
    if (!file) throw new HttpError(404, 'الملف غير موجود');
    if (expectedCourseId && file.course_id !== expectedCourseId) {
      throw new HttpError(404, 'الملف غير موجود');
    }
    await this.assertCanManage(user, file.course_id);

    const client = await pool.connect();
    let deleted: CourseFileRow;
    try {
      await client.query('BEGIN');
      const result = await client.query<CourseFileRow>(
        `UPDATE course_files
         SET deleted_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND deleted_at IS NULL
         RETURNING ${FILE_SELECT}`,
        [fileId],
      );
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        throw new HttpError(404, 'الملف غير موجود');
      }
      deleted = result.rows[0];
      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore
      }
      if (error instanceof HttpError) throw error;
      if (isMissingColumnError(error)) {
        const hard = await pool.query<CourseFileRow>(
          `DELETE FROM course_files WHERE id = $1 RETURNING
             id, course_id, NULL::integer AS lecture_id, uploaded_by AS teacher_id, uploaded_by, name, name AS title,
             NULL::text AS description, name AS original_name, file_url, NULL::text AS file_key,
             file_size, file_type, file_type AS mime_type, 'legacy'::varchar AS storage_provider,
             'uploaded'::varchar AS upload_status, 'upload'::varchar AS delivery_type,
             created_at, updated_at, NOW() AS deleted_at, NULL::timestamptz AS storage_deleted_at`,
          [fileId],
        );
        if (!hard.rowCount) throw new HttpError(404, 'الملف غير موجود');
        deleted = hard.rows[0];
      } else {
        throw error;
      }
    } finally {
      client.release();
    }

    try {
      if (deleted.file_key || deleted.file_url) {
        await FileStorageService.deleteStoredObject(deleted.file_key || '', deleted.file_url, {
          provider: deleted.storage_provider,
          deliveryType: deleted.delivery_type,
        });
      }
      await pool
        .query(`UPDATE course_files SET storage_deleted_at = NOW() WHERE id = $1`, [fileId])
        .catch(() => undefined);
    } catch (storageError) {
      console.error('[CourseFiles] Storage delete failed after DB soft-delete', {
        fileId,
        error: storageError,
      });
    }

    return deleted;
  }
}
