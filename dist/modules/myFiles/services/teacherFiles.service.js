"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherFilesService = exports.FileCategoriesService = void 0;
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const file_type_1 = require("file-type");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse');
const appUrls_1 = require("../../../config/appUrls");
const config_1 = require("../config");
const fileCategories_repository_1 = require("../repositories/fileCategories.repository");
const teacherFiles_repository_1 = require("../repositories/teacherFiles.repository");
const fileStorage_service_1 = require("./fileStorage.service");
const utils_1 = require("../../../utils");
class FileCategoriesService {
    static async create(teacherId, name) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new utils_1.HttpError(400, 'اسم التصنيف مطلوب');
        try {
            return await fileCategories_repository_1.FileCategoriesRepository.create(teacherId, trimmed);
        }
        catch (error) {
            if (error?.code === '23505') {
                throw new utils_1.HttpError(409, 'يوجد تصنيف بنفس الاسم مسبقاً');
            }
            throw error;
        }
    }
    static async list(teacherId) {
        return fileCategories_repository_1.FileCategoriesRepository.listByTeacher(teacherId);
    }
    static async update(teacherId, id, name) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new utils_1.HttpError(400, 'اسم التصنيف مطلوب');
        const updated = await fileCategories_repository_1.FileCategoriesRepository.update(id, teacherId, trimmed);
        if (!updated)
            throw new utils_1.HttpError(404, 'التصنيف غير موجود');
        return updated;
    }
    static async delete(teacherId, id) {
        const category = await fileCategories_repository_1.FileCategoriesRepository.findById(id, teacherId);
        if (!category)
            throw new utils_1.HttpError(404, 'التصنيف غير موجود');
        const fileCount = await fileCategories_repository_1.FileCategoriesRepository.countFilesInCategory(id, teacherId);
        if (fileCount > 0) {
            throw new utils_1.HttpError(400, 'لا يمكن حذف التصنيف لأنه يحتوي على ملفات. انقل الملفات أو احذفها أولاً.');
        }
        const deleted = await fileCategories_repository_1.FileCategoriesRepository.delete(id, teacherId);
        if (!deleted)
            throw new utils_1.HttpError(404, 'التصنيف غير موجود');
        return { success: true };
    }
}
exports.FileCategoriesService = FileCategoriesService;
const MAX_EXTRACTED_TEXT_CHARS = 200_000;
class TeacherFilesService {
    static formatFileSize(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024)
            return `${size} B`;
        if (size < 1024 * 1024)
            return `${(size / 1024).toFixed(1)} KB`;
        if (size < 1024 * 1024 * 1024)
            return `${(size / (1024 * 1024)).toFixed(1)} MB`;
        return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }
    static getFileIconType(fileExtension, mimeType) {
        const ext = fileExtension.toLowerCase();
        if (ext === 'pdf' || mimeType === 'application/pdf')
            return 'pdf';
        if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext))
            return 'image';
        if (['doc', 'docx'].includes(ext))
            return 'document';
        if (['xls', 'xlsx'].includes(ext))
            return 'spreadsheet';
        if (['ppt', 'pptx'].includes(ext))
            return 'presentation';
        if (ext === 'zip')
            return 'archive';
        return 'file';
    }
    static getViewerComponent(previewType) {
        if (previewType === 'image')
            return 'image-viewer';
        if (previewType === 'pdf')
            return 'pdf-viewer';
        return 'download-only';
    }
    static buildAbsoluteFileUrl(fileId, action) {
        const base = (0, appUrls_1.getApiUrl)();
        return `${base}/teacher/files/${fileId}/${action}`;
    }
    static buildFileUrls(fileId) {
        return {
            view: this.buildAbsoluteFileUrl(fileId, 'view'),
            content: this.buildAbsoluteFileUrl(fileId, 'content'),
            download: this.buildAbsoluteFileUrl(fileId, 'download'),
            viewPath: this.buildViewPath(fileId),
            contentPath: this.buildContentPath(fileId),
            downloadPath: `/api/teacher/files/${fileId}/download`,
        };
    }
    static getPreviewType(fileExtension, mimeType) {
        const ext = fileExtension.toLowerCase();
        if (mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
            return 'image';
        }
        if (ext === 'pdf' || mimeType === 'application/pdf') {
            return 'pdf';
        }
        return 'none';
    }
    static buildViewPath(fileId) {
        return `/api/teacher/files/${fileId}/view`;
    }
    static buildContentPath(fileId) {
        return `/api/teacher/files/${fileId}/content`;
    }
    static async readFileBuffer(teacherId, id) {
        const file = await this.getById(teacherId, id);
        const buffer = await fileStorage_service_1.FileStorageService.readBuffer(file.file_key, file.file_url);
        return {
            buffer,
            file,
            previewType: this.getPreviewType(file.file_extension, file.mime_type),
        };
    }
    static async extractTextContent(buffer, previewType) {
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
    static async getFilePreview(teacherId, id, includeText = false) {
        const file = await this.getById(teacherId, id);
        const previewType = this.getPreviewType(file.file_extension, file.mime_type);
        const icon = this.getFileIconType(file.file_extension, file.mime_type);
        const viewerComponent = this.getViewerComponent(previewType);
        const urls = this.buildFileUrls(file.id);
        let content = null;
        if (includeText && previewType === 'pdf') {
            const buffer = await fileStorage_service_1.FileStorageService.readBuffer(file.file_key, file.file_url);
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
                badgeColor: previewType === 'pdf' ? 'red' : previewType === 'image' ? 'green' : 'gray',
            },
            urls,
            actions: {
                primary: previewType === 'none'
                    ? { type: 'download', label: 'تحميل الملف', url: urls.download }
                    : { type: 'view', label: 'عرض الملف', url: urls.view },
                secondary: previewType === 'pdf'
                    ? { type: 'content', label: 'قراءة النص', url: urls.content }
                    : null,
            },
            content,
        };
    }
    static async getFileContent(teacherId, id) {
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
    static async validateUploadedFile(file) {
        const ext = node_path_1.default.extname(file.originalname || '').replace(/^\./, '').toLowerCase();
        if (!ext)
            throw new utils_1.HttpError(400, 'امتداد الملف غير معروف');
        if (config_1.myFilesConfig.blockedExtensions.has(ext)) {
            throw new utils_1.HttpError(400, 'نوع الملف غير مسموح لأسباب أمنية');
        }
        if (!config_1.myFilesConfig.allowedExtensions.has(ext)) {
            throw new utils_1.HttpError(400, `نوع الملف غير مدعوم. الأنواع المسموحة: ${[...config_1.myFilesConfig.allowedExtensions].join(', ')}`);
        }
        const detected = await (0, file_type_1.fileTypeFromFile)(file.path);
        const mimeType = detected?.mime || file.mimetype || 'application/octet-stream';
        if (mimeType.startsWith('application/x-msdownload') || mimeType.includes('executable')) {
            throw new utils_1.HttpError(400, 'نوع الملف غير مسموح');
        }
        return { extension: ext, mimeType };
    }
    static buildStorageKey(extension) {
        return `${(0, node_crypto_1.randomUUID)()}.${extension}`;
    }
    static async ensureCategoryOwnership(teacherId, categoryId) {
        if (!categoryId)
            return;
        const category = await fileCategories_repository_1.FileCategoriesRepository.findById(categoryId, teacherId);
        if (!category)
            throw new utils_1.HttpError(400, 'التصنيف غير موجود أو لا يخصك');
    }
    static async uploadFile(input) {
        const { extension, mimeType } = await this.validateUploadedFile(input.file);
        await this.ensureCategoryOwnership(input.teacherId, input.categoryId);
        const storageKey = this.buildStorageKey(extension);
        const stored = await fileStorage_service_1.FileStorageService.upload(input.file.path, storageKey, mimeType);
        const created = await teacherFiles_repository_1.TeacherFilesRepository.create({
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
        const row = await teacherFiles_repository_1.TeacherFilesRepository.findById(created.id, input.teacherId);
        if (!row)
            throw new utils_1.HttpError(500, 'فشل حفظ الملف');
        return row;
    }
    static async list(query) {
        return teacherFiles_repository_1.TeacherFilesRepository.list(query);
    }
    static async getById(teacherId, id) {
        const file = await teacherFiles_repository_1.TeacherFilesRepository.findById(id, teacherId);
        if (!file)
            throw new utils_1.HttpError(404, 'الملف غير موجود');
        return file;
    }
    static async update(teacherId, id, fields) {
        await this.getById(teacherId, id);
        if (fields.categoryId !== undefined) {
            await this.ensureCategoryOwnership(teacherId, fields.categoryId);
        }
        const updated = await teacherFiles_repository_1.TeacherFilesRepository.update(id, teacherId, {
            name: fields.name?.trim(),
            description: fields.description,
            categoryId: fields.categoryId,
        });
        if (!updated)
            throw new utils_1.HttpError(404, 'الملف غير موجود');
        return updated;
    }
    static async delete(teacherId, id) {
        const file = await this.getById(teacherId, id);
        const deleted = await teacherFiles_repository_1.TeacherFilesRepository.softDelete(id, teacherId);
        if (!deleted)
            throw new utils_1.HttpError(404, 'الملف غير موجود');
        await fileStorage_service_1.FileStorageService.deleteStoredObject(file.file_key, file.file_url);
        return { success: true };
    }
    static async bulkDelete(teacherId, ids) {
        const uniqueIds = [...new Set(ids)];
        const files = await teacherFiles_repository_1.TeacherFilesRepository.findManyByIds(uniqueIds, teacherId);
        const deletedCount = await teacherFiles_repository_1.TeacherFilesRepository.bulkSoftDelete(files.map((f) => f.id), teacherId);
        for (const file of files) {
            await fileStorage_service_1.FileStorageService.deleteStoredObject(file.file_key, file.file_url);
        }
        return { deletedCount, requestedCount: uniqueIds.length };
    }
    static async download(teacherId, id) {
        const file = await this.getById(teacherId, id);
        await teacherFiles_repository_1.TeacherFilesRepository.incrementDownloads(id, teacherId);
        const downloadUrl = await fileStorage_service_1.FileStorageService.getDownloadUrl(file.file_key, file.file_url);
        return {
            downloadUrl,
            fileName: file.name,
            mimeType: file.mime_type,
            downloadsCount: file.downloads_count + 1,
        };
    }
    static async getStatistics(teacherId) {
        return teacherFiles_repository_1.TeacherFilesRepository.getStatistics(teacherId);
    }
    static serializeFile(file) {
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
exports.TeacherFilesService = TeacherFilesService;
