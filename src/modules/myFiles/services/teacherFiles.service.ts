import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileTypeFromFile } from 'file-type';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (
  buffer: Buffer,
) => Promise<{ text?: string; numpages?: number }>;
import { getApiUrl } from '../../../config/appUrls';
import { myFilesConfig } from '../config';
import { FileCategoriesRepository } from '../repositories/fileCategories.repository';
import { TeacherFilesRepository } from '../repositories/teacherFiles.repository';
import { FileStorageService } from './fileStorage.service';
import type { FileStatistics, ListFilesQuery, TeacherFileListItem } from '../types';
import { HttpError } from '../../../utils';

export class FileCategoriesService {
  static async create(teacherId: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new HttpError(400, 'اسم التصنيف مطلوب');
    try {
      return await FileCategoriesRepository.create(teacherId, trimmed);
    } catch (error: any) {
      if (error?.code === '23505') {
        throw new HttpError(409, 'يوجد تصنيف بنفس الاسم مسبقاً');
      }
      throw error;
    }
  }

  static async list(teacherId: number) {
    return FileCategoriesRepository.listByTeacher(teacherId);
  }

  static async update(teacherId: number, id: number, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new HttpError(400, 'اسم التصنيف مطلوب');
    const updated = await FileCategoriesRepository.update(id, teacherId, trimmed);
    if (!updated) throw new HttpError(404, 'التصنيف غير موجود');
    return updated;
  }

  static async delete(teacherId: number, id: number) {
    const category = await FileCategoriesRepository.findById(id, teacherId);
    if (!category) throw new HttpError(404, 'التصنيف غير موجود');

    const fileCount = await FileCategoriesRepository.countFilesInCategory(id, teacherId);
    if (fileCount > 0) {
      throw new HttpError(
        400,
        'لا يمكن حذف التصنيف لأنه يحتوي على ملفات. انقل الملفات أو احذفها أولاً.',
      );
    }

    const deleted = await FileCategoriesRepository.delete(id, teacherId);
    if (!deleted) throw new HttpError(404, 'التصنيف غير موجود');
    return { success: true };
  }
}

const MAX_EXTRACTED_TEXT_CHARS = 200_000;

export type FilePreviewType = 'image' | 'pdf' | 'none';
export type FileViewerComponent = 'image-viewer' | 'pdf-viewer' | 'download-only';
export type FileIconType = 'pdf' | 'image' | 'document' | 'spreadsheet' | 'presentation' | 'archive' | 'file';

export class TeacherFilesService {
  static formatFileSize(bytes: number): string {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  static getFileIconType(fileExtension: string, mimeType: string): FileIconType {
    const ext = fileExtension.toLowerCase();
    if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
    if (['doc', 'docx'].includes(ext)) return 'document';
    if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet';
    if (['ppt', 'pptx'].includes(ext)) return 'presentation';
    if (ext === 'zip') return 'archive';
    return 'file';
  }

  static getViewerComponent(previewType: FilePreviewType): FileViewerComponent {
    if (previewType === 'image') return 'image-viewer';
    if (previewType === 'pdf') return 'pdf-viewer';
    return 'download-only';
  }

  static buildAbsoluteFileUrl(fileId: number, action: 'view' | 'content' | 'download'): string {
    const base = getApiUrl();
    return `${base}/teacher/files/${fileId}/${action}`;
  }

  static buildFileUrls(fileId: number) {
    return {
      view: this.buildAbsoluteFileUrl(fileId, 'view'),
      content: this.buildAbsoluteFileUrl(fileId, 'content'),
      download: this.buildAbsoluteFileUrl(fileId, 'download'),
      viewPath: this.buildViewPath(fileId),
      contentPath: this.buildContentPath(fileId),
      downloadPath: `/api/teacher/files/${fileId}/download`,
    };
  }
  static getPreviewType(fileExtension: string, mimeType: string): FilePreviewType {
    const ext = fileExtension.toLowerCase();
    if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return 'image';
    }
    if (ext === 'pdf' || mimeType === 'application/pdf') {
      return 'pdf';
    }
    return 'none';
  }

  static buildViewPath(fileId: number): string {
    return `/api/teacher/files/${fileId}/view`;
  }

  static buildContentPath(fileId: number): string {
    return `/api/teacher/files/${fileId}/content`;
  }

  static async readFileBuffer(teacherId: number, id: number): Promise<{
    buffer: Buffer;
    file: TeacherFileListItem;
    previewType: FilePreviewType;
  }> {
    const file = await this.getById(teacherId, id);
    const buffer = await FileStorageService.readBuffer(file.file_key, file.file_url);
    return {
      buffer,
      file,
      previewType: this.getPreviewType(file.file_extension, file.mime_type),
    };
  }

  static async extractTextContent(buffer: Buffer, previewType: FilePreviewType): Promise<{
    text: string | null;
    paragraphs: string[];
    pageCount: number | null;
    truncated: boolean;
    characterCount: number;
    supported: boolean;
    message?: string;
  }> {
    if (previewType === 'image') {
      return {
        text: null,
        paragraphs: [],
        pageCount: null,
        truncated: false,
        characterCount: 0,
        supported: false,
        message: 'الصور تُعرض عبر مسار العرض وليس كنص مستخرج',
      };
    }

    if (previewType !== 'pdf') {
      return {
        text: null,
        paragraphs: [],
        pageCount: null,
        truncated: false,
        characterCount: 0,
        supported: false,
        message: 'استخراج النص غير مدعوم لهذا النوع. استخدم التحميل أو العرض المباشر إن وُجد.',
      };
    }

    const parsed = await pdfParse(buffer);
    const rawText = (parsed.text || '').trim();
    const truncated = rawText.length > MAX_EXTRACTED_TEXT_CHARS;
    const text = truncated ? rawText.slice(0, MAX_EXTRACTED_TEXT_CHARS) : rawText;
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    return {
      text,
      paragraphs,
      pageCount: typeof parsed.numpages === 'number' ? parsed.numpages : null,
      truncated,
      characterCount: rawText.length,
      supported: true,
    };
  }

  static async getFilePreview(teacherId: number, id: number, includeText = false) {
    const file = await this.getById(teacherId, id);
    const previewType = this.getPreviewType(file.file_extension, file.mime_type);
    const icon = this.getFileIconType(file.file_extension, file.mime_type);
    const viewerComponent = this.getViewerComponent(previewType);
    const urls = this.buildFileUrls(file.id);

    let content: Awaited<ReturnType<typeof this.extractTextContent>> | null = null;
    if (includeText && previewType === 'pdf') {
      const buffer = await FileStorageService.readBuffer(file.file_key, file.file_url);
      content = await this.extractTextContent(buffer, previewType);
    }

    return {
      file: this.serializeFile(file),
      preview: {
        type: previewType,
        mode: previewType === 'none' ? 'download-only' : 'inline',
        viewerComponent,
        canPreviewInline: previewType !== 'none',
        canExtractText: previewType === 'pdf',
        requiresAuthHeader: true,
        iframeSupported: previewType !== 'none',
      },
      display: {
        icon,
        extensionLabel: file.file_extension.toUpperCase(),
        fileSizeLabel: this.formatFileSize(Number(file.file_size)),
        mimeTypeLabel: file.mime_type,
        badgeColor:
          previewType === 'pdf' ? 'red' : previewType === 'image' ? 'green' : 'gray',
      },
      urls,
      actions: {
        primary:
          previewType === 'none'
            ? { type: 'download', label: 'تحميل الملف', url: urls.download }
            : { type: 'view', label: 'عرض الملف', url: urls.view },
        secondary:
          previewType === 'pdf'
            ? { type: 'content', label: 'قراءة النص', url: urls.content }
            : null,
      },
      content,
    };
  }

  static async getFileContent(teacherId: number, id: number) {
    const preview = await this.getFilePreview(teacherId, id, true);
    return {
      file: preview.file,
      previewType: preview.preview.type,
      viewUrl: preview.urls.viewPath,
      contentUrl: preview.urls.contentPath,
      canPreviewInline: preview.preview.canPreviewInline,
      display: preview.display,
      urls: preview.urls,
      content: preview.content ?? {
        text: null,
        paragraphs: [],
        pageCount: null,
        truncated: false,
        characterCount: 0,
        supported: false,
        message: preview.preview.canExtractText
          ? 'لم يتم استخراج النص'
          : 'استخراج النص غير مدعوم لهذا النوع',
      },
    };
  }

  static async validateUploadedFile(file: Express.Multer.File): Promise<{
    extension: string;
    mimeType: string;
  }> {
    const ext = path.extname(file.originalname || '').replace(/^\./, '').toLowerCase();
    if (!ext) throw new HttpError(400, 'امتداد الملف غير معروف');

    if (myFilesConfig.blockedExtensions.has(ext)) {
      throw new HttpError(400, 'نوع الملف غير مسموح لأسباب أمنية');
    }
    if (!myFilesConfig.allowedExtensions.has(ext)) {
      throw new HttpError(400, `نوع الملف غير مدعوم. الأنواع المسموحة: ${[...myFilesConfig.allowedExtensions].join(', ')}`);
    }

    const detected = await fileTypeFromFile(file.path);
    const mimeType = detected?.mime || file.mimetype || 'application/octet-stream';

    if (mimeType.startsWith('application/x-msdownload') || mimeType.includes('executable')) {
      throw new HttpError(400, 'نوع الملف غير مسموح');
    }

    return { extension: ext, mimeType };
  }

  static buildStorageKey(extension: string): string {
    return `${randomUUID()}.${extension}`;
  }

  static async ensureCategoryOwnership(teacherId: number, categoryId?: number | null) {
    if (!categoryId) return;
    const category = await FileCategoriesRepository.findById(categoryId, teacherId);
    if (!category) throw new HttpError(400, 'التصنيف غير موجود أو لا يخصك');
  }

  static async uploadFile(input: {
    teacherId: number;
    file: Express.Multer.File;
    name: string;
    description?: string;
    categoryId?: number | null;
  }): Promise<TeacherFileListItem> {
    const { extension, mimeType } = await this.validateUploadedFile(input.file);
    await this.ensureCategoryOwnership(input.teacherId, input.categoryId);

    const storageKey = this.buildStorageKey(extension);
    const stored = await FileStorageService.upload(input.file.path, storageKey, mimeType);

    const created = await TeacherFilesRepository.create({
      teacherId: input.teacherId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      fileUrl: stored.fileUrl,
      fileKey: stored.fileKey,
      fileSize: input.file.size,
      fileExtension: extension,
      mimeType,
      categoryId: input.categoryId ?? null,
    });

    const row = await TeacherFilesRepository.findById(created.id, input.teacherId);
    if (!row) throw new HttpError(500, 'فشل حفظ الملف');
    return row;
  }

  static async list(query: ListFilesQuery) {
    return TeacherFilesRepository.list(query);
  }

  static async getById(teacherId: number, id: number): Promise<TeacherFileListItem> {
    const file = await TeacherFilesRepository.findById(id, teacherId);
    if (!file) throw new HttpError(404, 'الملف غير موجود');
    return file;
  }

  static async update(
    teacherId: number,
    id: number,
    fields: { name?: string; description?: string | null; categoryId?: number | null },
  ) {
    await this.getById(teacherId, id);
    if (fields.categoryId !== undefined) {
      await this.ensureCategoryOwnership(teacherId, fields.categoryId);
    }
    const updated = await TeacherFilesRepository.update(id, teacherId, {
      name: fields.name?.trim(),
      description: fields.description,
      categoryId: fields.categoryId,
    });
    if (!updated) throw new HttpError(404, 'الملف غير موجود');
    return updated;
  }

  static async delete(teacherId: number, id: number) {
    const file = await this.getById(teacherId, id);
    const deleted = await TeacherFilesRepository.softDelete(id, teacherId);
    if (!deleted) throw new HttpError(404, 'الملف غير موجود');
    await FileStorageService.deleteStoredObject(file.file_key, file.file_url);
    return { success: true };
  }

  static async bulkDelete(teacherId: number, ids: number[]) {
    const uniqueIds = [...new Set(ids)];
    const files = await TeacherFilesRepository.findManyByIds(uniqueIds, teacherId);
    const deletedCount = await TeacherFilesRepository.bulkSoftDelete(
      files.map((f) => f.id),
      teacherId,
    );
    for (const file of files) {
      await FileStorageService.deleteStoredObject(file.file_key, file.file_url);
    }
    return { deletedCount, requestedCount: uniqueIds.length };
  }

  static async download(teacherId: number, id: number) {
    const file = await this.getById(teacherId, id);
    await TeacherFilesRepository.incrementDownloads(id, teacherId);
    const downloadUrl = await FileStorageService.getDownloadUrl(file.file_key, file.file_url);
    return {
      downloadUrl,
      fileName: file.name,
      mimeType: file.mime_type,
      downloadsCount: file.downloads_count + 1,
    };
  }

  static async getStatistics(teacherId: number): Promise<FileStatistics> {
    return TeacherFilesRepository.getStatistics(teacherId);
  }

  static serializeFile(file: TeacherFileListItem) {
    const previewType = this.getPreviewType(file.file_extension, file.mime_type);
    const urls = this.buildFileUrls(file.id);
    return {
      id: file.id,
      teacherId: file.teacher_id,
      name: file.name,
      description: file.description,
      fileUrl: file.file_url,
      fileKey: file.file_key,
      fileSize: Number(file.file_size),
      fileSizeLabel: this.formatFileSize(Number(file.file_size)),
      fileExtension: file.file_extension,
      mimeType: file.mime_type,
      categoryId: file.category_id,
      categoryName: file.category_name,
      downloadsCount: file.downloads_count,
      previewType,
      icon: this.getFileIconType(file.file_extension, file.mime_type),
      viewerComponent: this.getViewerComponent(previewType),
      canPreviewInline: previewType !== 'none',
      viewUrl: urls.viewPath,
      contentUrl: urls.contentPath,
      downloadUrl: urls.downloadPath,
      absoluteViewUrl: urls.view,
      absoluteContentUrl: urls.content,
      absoluteDownloadUrl: urls.download,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    };
  }
}
