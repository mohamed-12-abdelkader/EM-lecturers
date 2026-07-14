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
import {
  inferExtensionFromName,
  mimeTypeFromExtension,
  parseGoogleDriveLink,
} from '../utils/googleDriveLink';
import {
  fetchGoogleDriveFileBuffer,
  fetchGoogleDriveThumbnailBuffer,
} from '../utils/googleDriveFetch';
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
  static isDriveFile(file: Pick<TeacherFileListItem, 'source_type' | 'file_key'>): boolean {
    return file.source_type === 'drive' || file.file_key.startsWith('drive:');
  }

  static getDriveUrls(file: Pick<TeacherFileListItem, 'drive_url' | 'file_url'>) {
    const driveUrl = file.drive_url || file.file_url;
    try {
      const parsed = parseGoogleDriveLink(driveUrl);
      return parsed;
    } catch {
      return {
        driveUrl,
        viewUrl: driveUrl,
        previewUrl: driveUrl,
        embedUrl: driveUrl,
      };
    }
  }

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
      open: this.buildAbsoluteFileUrl(fileId, 'view'),
      content: this.buildAbsoluteFileUrl(fileId, 'content'),
      download: this.buildAbsoluteFileUrl(fileId, 'download'),
      viewPath: this.buildViewPath(fileId),
      openPath: this.buildViewPath(fileId),
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
    if (this.isDriveFile(file)) {
      throw new HttpError(400, 'ملفات Google Drive تُعرض عبر الرابط المباشر وليس عبر البروكسي');
    }
    const buffer = await FileStorageService.readBuffer(file.file_key, file.file_url);
    return {
      buffer,
      file,
      previewType: this.getPreviewType(file.file_extension, file.mime_type),
    };
  }

  /** بيانات ثنائية للعرض على السبورة — يدعم الملفات المرفوعة وملفات Drive (PDF/صور) */
  static async readFileBufferForBoard(teacherId: number, id: number): Promise<{
    buffer: Buffer;
    file: TeacherFileListItem;
    previewType: FilePreviewType;
  }> {
    const file = await this.getById(teacherId, id);
    const previewType = this.getPreviewType(file.file_extension, file.mime_type);

    if (previewType !== 'pdf' && previewType !== 'image') {
      throw new HttpError(415, 'لا يمكن عرض هذا النوع على السبورة. يدعم PDF والصور فقط.');
    }

    if (this.isDriveFile(file)) {
      const driveUrl = file.drive_url || file.file_url;
      const parsed = parseGoogleDriveLink(driveUrl);
      if (parsed.resourceKind !== 'file') {
        throw new HttpError(
          415,
          'مستندات Google (Docs/Sheets/Slides) لا يمكن عرضها على السبورة للرسم.',
        );
      }

      try {
        const buffer = await fetchGoogleDriveFileBuffer(parsed.fileId);
        return { buffer, file, previewType };
      } catch (downloadError) {
        try {
          const buffer = await fetchGoogleDriveThumbnailBuffer(parsed.fileId);
          return { buffer, file, previewType: 'image' as const };
        } catch {
          throw downloadError;
        }
      }
    }

    const buffer = await FileStorageService.readBuffer(file.file_key, file.file_url);
    return { buffer, file, previewType };
  }

  /** صورة معاينة للسبورة — مفيدة لملفات Drive عند فشل التحميل الكامل */
  static async readThumbnailBufferForBoard(teacherId: number, id: number): Promise<{
    buffer: Buffer;
    file: TeacherFileListItem;
  }> {
    const file = await this.getById(teacherId, id);
    const previewType = this.getPreviewType(file.file_extension, file.mime_type);

    if (previewType !== 'pdf' && previewType !== 'image') {
      throw new HttpError(415, 'لا يمكن عرض هذا النوع على السبورة.');
    }

    if (this.isDriveFile(file)) {
      const driveUrl = file.drive_url || file.file_url;
      const parsed = parseGoogleDriveLink(driveUrl);
      if (parsed.resourceKind !== 'file') {
        throw new HttpError(415, 'لا يمكن إنشاء معاينة لهذا النوع من Google Drive.');
      }
      const buffer = await fetchGoogleDriveThumbnailBuffer(parsed.fileId);
      return { buffer, file };
    }

    const { buffer } = await this.readFileBufferForBoard(teacherId, id);
    return { buffer, file };
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
    const urls = this.buildFileUrls(file.id);

    let content: Awaited<ReturnType<typeof this.extractTextContent>> | null = null;
    if (includeText && previewType === 'pdf' && !this.isDriveFile(file)) {
      const buffer = await FileStorageService.readBuffer(file.file_key, file.file_url);
      content = await this.extractTextContent(buffer, previewType);
    }

    const driveUrls = this.isDriveFile(file) ? this.getDriveUrls(file) : null;
    const canPreviewInline = this.isDriveFile(file) || previewType !== 'none';

    return {
      file: this.serializeFile(file),
      preview: {
        type: this.isDriveFile(file) ? 'drive' : previewType,
        mode: canPreviewInline ? 'inline' : 'download-only',
        viewerComponent: this.isDriveFile(file)
          ? 'drive-embed'
          : this.getViewerComponent(previewType),
        canPreviewInline,
        canExtractText: previewType === 'pdf' && !this.isDriveFile(file),
        requiresAuthHeader: !this.isDriveFile(file),
        iframeSupported: canPreviewInline,
        driveUrl: driveUrls?.driveUrl ?? null,
        drivePreviewUrl: driveUrls?.previewUrl ?? null,
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
        primary: canPreviewInline
          ? {
              type: this.isDriveFile(file) ? 'drive' : 'view',
              label: this.isDriveFile(file) ? 'فتح من Google Drive' : 'عرض الملف',
              url: driveUrls?.previewUrl ?? urls.view,
            }
          : { type: 'download', label: 'تحميل الملف', url: urls.download },
        secondary:
          previewType === 'pdf' && !this.isDriveFile(file)
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

  static async getEmbedInfo(teacherId: number, id: number, accessToken?: string | null) {
    const file = await this.getById(teacherId, id);
    const previewType = this.getPreviewType(file.file_extension, file.mime_type);
    const urls = this.buildFileUrls(file.id);
    const tokenQuery = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : '';
    const proxyOpenUrl = `${urls.view}${tokenQuery}`;

    if (this.isDriveFile(file)) {
      const drive = this.getDriveUrls(file);
      return {
        file: this.serializeFile(file),
        previewType: 'drive',
        mimeType: file.mime_type,
        canPreviewInline: true,
        recommendedIframeSrc: drive.previewUrl,
        proxyOpenUrl: drive.previewUrl,
        directOpenUrl: drive.viewUrl,
        fetchOpenUrl: drive.viewUrl,
        driveUrl: drive.driveUrl,
        drivePreviewUrl: drive.previewUrl,
        contentUrl: null,
        downloadUrl: drive.viewUrl,
        usage: {
          iframe: `<iframe src="${drive.previewUrl}" style="width:100%;height:80vh;border:0" title="${file.name}" allow="autoplay" />`,
          fetchBlob: null,
          image: null,
          openInDrive: drive.viewUrl,
        },
      };
    }

    const directUrl = await FileStorageService.getDirectAccessUrl(file.file_key, file.file_url);

    return {
      file: this.serializeFile(file),
      previewType,
      mimeType: file.mime_type,
      canPreviewInline: previewType !== 'none',
      /** الأفضل لـ iframe — رابط CDN موقّع (سريع) */
      recommendedIframeSrc: directUrl || proxyOpenUrl,
      /** رابط بروكسي عبر API — يعمل دائماً مع access_token */
      proxyOpenUrl,
      /** رابط CDN مباشر إن وُجد */
      directOpenUrl: directUrl,
      /** للعرض بـ fetch + blob */
      fetchOpenUrl: urls.view,
      contentUrl: urls.content,
      downloadUrl: urls.download,
      usage: {
        iframe: directUrl
          ? `<iframe src="${directUrl}" style="width:100%;height:80vh;border:0" title="${file.name}" />`
          : `<iframe src="${proxyOpenUrl}" style="width:100%;height:80vh;border:0" title="${file.name}" />`,
        fetchBlob: `fetch('${urls.view}', { headers: { Authorization: 'Bearer TOKEN' } }).then(r => r.blob()).then(b => { iframe.src = URL.createObjectURL(b) })`,
        image: previewType === 'image'
          ? `<img src="${proxyOpenUrl}" alt="${file.name}" />`
          : null,
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

  static async createDriveFile(input: {
    teacherId: number;
    name: string;
    driveUrl: string;
    description?: string;
    categoryId?: number | null;
    fileExtension?: string;
  }): Promise<TeacherFileListItem> {
    const name = input.name.trim();
    if (!name) throw new HttpError(400, 'اسم الملف مطلوب');

    const parsed = parseGoogleDriveLink(input.driveUrl);
    await this.ensureCategoryOwnership(input.teacherId, input.categoryId);

    const extension = (input.fileExtension || inferExtensionFromName(name, 'link'))
      .replace(/^\./, '')
      .toLowerCase();
    const mimeType = mimeTypeFromExtension(extension);

    const created = await TeacherFilesRepository.create({
      teacherId: input.teacherId,
      name,
      description: input.description?.trim() || null,
      fileUrl: parsed.driveUrl,
      fileKey: `drive:${parsed.fileId}`,
      fileSize: 0,
      fileExtension: extension,
      mimeType,
      categoryId: input.categoryId ?? null,
      sourceType: 'drive',
      driveUrl: parsed.driveUrl,
    });

    const row = await TeacherFilesRepository.findById(created.id, input.teacherId);
    if (!row) throw new HttpError(500, 'فشل حفظ رابط الملف');
    return row;
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
      sourceType: 'upload',
      driveUrl: null,
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
    fields: {
      name?: string;
      description?: string | null;
      categoryId?: number | null;
      driveUrl?: string;
      fileExtension?: string;
    },
  ) {
    const existing = await this.getById(teacherId, id);
    if (fields.categoryId !== undefined) {
      await this.ensureCategoryOwnership(teacherId, fields.categoryId);
    }

    const patch: Parameters<typeof TeacherFilesRepository.update>[2] = {
      name: fields.name?.trim(),
      description: fields.description,
      categoryId: fields.categoryId,
    };

    if (fields.driveUrl !== undefined) {
      if (!this.isDriveFile(existing)) {
        throw new HttpError(400, 'لا يمكن تغيير الرابط إلا لملفات Google Drive');
      }
      const parsed = parseGoogleDriveLink(fields.driveUrl);
      patch.driveUrl = parsed.driveUrl;
      patch.fileUrl = parsed.driveUrl;
      patch.fileKey = `drive:${parsed.fileId}`;
      if (fields.fileExtension) {
        const ext = fields.fileExtension.replace(/^\./, '').toLowerCase();
        patch.fileExtension = ext;
        patch.mimeType = mimeTypeFromExtension(ext);
      }
    }

    const updated = await TeacherFilesRepository.update(id, teacherId, patch);
    if (!updated) throw new HttpError(404, 'الملف غير موجود');
    return updated;
  }

  static async delete(teacherId: number, id: number) {
    const file = await this.getById(teacherId, id);
    const deleted = await TeacherFilesRepository.softDelete(id, teacherId);
    if (!deleted) throw new HttpError(404, 'الملف غير موجود');
    if (!this.isDriveFile(file)) {
      await FileStorageService.deleteStoredObject(file.file_key, file.file_url);
    }
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
      if (!this.isDriveFile(file)) {
        await FileStorageService.deleteStoredObject(file.file_key, file.file_url);
      }
    }
    return { deletedCount, requestedCount: uniqueIds.length };
  }

  static async download(teacherId: number, id: number) {
    const file = await this.getById(teacherId, id);
    await TeacherFilesRepository.incrementDownloads(id, teacherId);

    if (this.isDriveFile(file)) {
      const drive = this.getDriveUrls(file);
      return {
        downloadUrl: drive.viewUrl,
        driveUrl: drive.driveUrl,
        fileName: file.name,
        mimeType: file.mime_type,
        downloadsCount: file.downloads_count + 1,
      };
    }

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
    const isDrive = TeacherFilesService.isDriveFile(file);
    const drive = isDrive ? TeacherFilesService.getDriveUrls(file) : null;
    const previewType = TeacherFilesService.getPreviewType(file.file_extension, file.mime_type);
    const urls = TeacherFilesService.buildFileUrls(file.id);
    const storageProvider = isDrive ? 'google_drive' : FileStorageService.getProvider();
    const driveUrl = file.drive_url || (isDrive ? file.file_url : null);

    return {
      id: file.id,
      teacherId: file.teacher_id,
      name: file.name,
      description: file.description,
      sourceType: file.source_type ?? (isDrive ? 'drive' : 'upload'),
      driveUrl,
      drivePreviewUrl: drive?.previewUrl ?? null,
      driveViewUrl: drive?.viewUrl ?? null,
      fileUrl: isDrive ? driveUrl : file.file_url,
      fileKey: file.file_key,
      storageProvider,
      fileSize: Number(file.file_size),
      fileSizeLabel: TeacherFilesService.formatFileSize(Number(file.file_size)),
      fileExtension: file.file_extension,
      mimeType: file.mime_type,
      categoryId: file.category_id,
      categoryName: file.category_name,
      downloadsCount: file.downloads_count,
      previewType: isDrive ? 'drive' : previewType,
      icon: isDrive ? 'document' : TeacherFilesService.getFileIconType(file.file_extension, file.mime_type),
      viewerComponent: isDrive ? 'drive-embed' : TeacherFilesService.getViewerComponent(previewType),
      canPreviewInline: isDrive || previewType !== 'none',
      viewUrl: isDrive ? drive?.previewUrl ?? driveUrl : urls.viewPath,
      contentUrl: isDrive ? null : urls.contentPath,
      downloadUrl: isDrive ? drive?.viewUrl ?? driveUrl : urls.downloadPath,
      openUrl: isDrive ? drive?.previewUrl ?? driveUrl : urls.viewPath,
      absoluteViewUrl: isDrive ? drive?.previewUrl ?? driveUrl : urls.view,
      absoluteContentUrl: isDrive ? null : urls.content,
      absoluteDownloadUrl: isDrive ? drive?.viewUrl ?? driveUrl : urls.download,
      createdAt: file.created_at,
      updatedAt: file.updated_at,
    };
  }
}
