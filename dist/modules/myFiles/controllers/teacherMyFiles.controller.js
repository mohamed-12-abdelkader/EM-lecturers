"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teacherFileCategoriesRouter = exports.teacherFilesRouter = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const authentication_1 = require("../../../middleware/authentication");
const utils_1 = require("../../../utils");
const requestParsers_1 = require("../../../utils/requestParsers");
const config_1 = require("../config");
const rateLimit_1 = require("../middleware/rateLimit");
const teacherFiles_service_1 = require("../services/teacherFiles.service");
const MY_FILES_ROLES = ['teacher', 'admin'];
const uploadDir = node_path_1.default.join(process.cwd(), 'uploads/my-files-temp');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
node_fs_1.default.mkdirSync((0, config_1.resolveLocalStorageDir)(), { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = node_path_1.default.extname(file.originalname || '').toLowerCase();
        cb(null, `tmp-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: config_1.myFilesConfig.maxFileSizeBytes, files: config_1.myFilesConfig.maxBulkFiles },
});
function resolveTeacherId(req) {
    const user = req.user;
    if (user.role === 'admin') {
        const adminTeacherId = (0, requestParsers_1.parseNumberInput)(req.query.teacher_id) ??
            (0, requestParsers_1.parseNumberInput)(req.body?.teacher_id) ??
            (0, requestParsers_1.parseNumberInput)(req.body?.teacherId);
        if (adminTeacherId)
            return adminTeacherId;
    }
    return user.id;
}
function cleanupFiles(files) {
    if (!files)
        return;
    const list = Array.isArray(files) ? files : [files];
    for (const file of list) {
        if (file?.path)
            node_fs_1.default.promises.unlink(file.path).catch(() => undefined);
    }
}
function handleServiceError(res, error) {
    if (error instanceof utils_1.HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    throw error;
}
const CreateCategorySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
});
const UpdateCategorySchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(200),
});
const UpdateFileSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(300).optional(),
    description: zod_1.z.string().max(5000).optional().nullable(),
    categoryId: zod_1.z.coerce.number().int().positive().optional().nullable(),
});
const BulkDeleteSchema = zod_1.z.object({
    ids: zod_1.z.array(zod_1.z.coerce.number().int().positive()).min(1).max(100),
});
function attachAccessTokenFromQuery(req, _res, next) {
    if (!req.headers.authorization) {
        const token = (typeof req.query.access_token === 'string' && req.query.access_token) ||
            (typeof req.query.token === 'string' && req.query.token);
        if (token) {
            req.headers.authorization = `Bearer ${token}`;
        }
    }
    next();
}
exports.teacherFilesRouter = (0, express_1.Router)();
exports.teacherFileCategoriesRouter = (0, express_1.Router)();
// ── Files ─────────────────────────────────────────────────────────────
exports.teacherFilesRouter.post('/', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesUploadRateLimit, upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
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
        const categoryId = (0, requestParsers_1.parseNumberInput)(req.body.categoryId) ?? (0, requestParsers_1.parseNumberInput)(req.body.category_id) ?? null;
        const saved = await teacherFiles_service_1.TeacherFilesService.uploadFile({
            teacherId,
            file,
            name,
            description: req.body.description,
            categoryId,
        });
        return res.status(201).json({
            success: true,
            message: 'File uploaded successfully',
            data: teacherFiles_service_1.TeacherFilesService.serializeFile(saved),
        });
    }
    catch (error) {
        cleanupFiles(file);
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.post('/bulk-upload', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesBulkUploadRateLimit, upload.array('files', config_1.myFilesConfig.maxBulkFiles), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const files = req.files;
    if (!files?.length) {
        return res.status(400).json({ success: false, message: 'يجب رفع ملف واحد على الأقل' });
    }
    const categoryId = (0, requestParsers_1.parseNumberInput)(req.body.categoryId) ?? (0, requestParsers_1.parseNumberInput)(req.body.category_id) ?? null;
    const baseDescription = req.body.description;
    const uploaded = [];
    const errors = [];
    for (const file of files) {
        try {
            const saved = await teacherFiles_service_1.TeacherFilesService.uploadFile({
                teacherId,
                file,
                name: (req.body.namePrefix ? `${req.body.namePrefix} - ` : '') + (file.originalname || 'file'),
                description: baseDescription,
                categoryId,
            });
            uploaded.push(teacherFiles_service_1.TeacherFilesService.serializeFile(saved));
        }
        catch (error) {
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
        message: uploaded.length > 0
            ? `تم رفع ${uploaded.length} ملف بنجاح`
            : 'فشل رفع جميع الملفات',
        data: { uploaded, errors },
    });
}));
exports.teacherFilesRouter.get('/statistics', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const stats = await teacherFiles_service_1.TeacherFilesService.getStatistics(teacherId);
    return res.json({ success: true, data: stats });
}));
exports.teacherFilesRouter.get('/', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const sortBy = req.query.sortBy || 'created_at';
    const sortOrder = req.query.sortOrder === 'asc' ? 'asc' : 'desc';
    const query = {
        teacherId,
        page,
        limit,
        search: req.query.search,
        categoryId: (0, requestParsers_1.parseNumberInput)(req.query.categoryId) ??
            (0, requestParsers_1.parseNumberInput)(req.query.category_id) ??
            undefined,
        fileType: req.query.fileType,
        sortBy: ['created_at', 'name', 'file_size', 'downloads_count'].includes(sortBy)
            ? sortBy
            : 'created_at',
        sortOrder,
    };
    const result = await teacherFiles_service_1.TeacherFilesService.list(query);
    return res.json({
        success: true,
        data: {
            items: result.items.map(teacherFiles_service_1.TeacherFilesService.serializeFile),
            pagination: {
                page,
                limit,
                total: result.total,
                totalPages: Math.ceil(result.total / limit) || 1,
            },
        },
    });
}));
exports.teacherFilesRouter.get('/:id/download', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesDownloadRateLimit, (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    try {
        const result = await teacherFiles_service_1.TeacherFilesService.download(teacherId, id);
        return res.json({
            success: true,
            data: {
                downloadUrl: result.downloadUrl,
                fileName: result.fileName,
                mimeType: result.mimeType,
                downloadsCount: result.downloadsCount,
            },
        });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.get('/:id/view', attachAccessTokenFromQuery, (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesDownloadRateLimit, (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    try {
        const { buffer, file, previewType } = await teacherFiles_service_1.TeacherFilesService.readFileBuffer(teacherId, id);
        if (previewType === 'none') {
            const preview = await teacherFiles_service_1.TeacherFilesService.getFilePreview(teacherId, id, false);
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
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.get('/:id/preview', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesDownloadRateLimit, (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    const includeText = req.query.includeText === 'true' ||
        req.query.include_text === 'true' ||
        req.query.text === 'true';
    try {
        const data = await teacherFiles_service_1.TeacherFilesService.getFilePreview(teacherId, id, includeText);
        return res.json({ success: true, data });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.get('/:id/content', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), rateLimit_1.teacherFilesDownloadRateLimit, (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    try {
        const payload = await teacherFiles_service_1.TeacherFilesService.getFileContent(teacherId, id);
        return res.json({ success: true, data: payload });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.get('/:id', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    try {
        const file = await teacherFiles_service_1.TeacherFilesService.getById(teacherId, id);
        return res.json({ success: true, data: teacherFiles_service_1.TeacherFilesService.serializeFile(file) });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.put('/:id', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صالحة',
            errors: parsed.error.errors,
        });
    }
    try {
        const updated = await teacherFiles_service_1.TeacherFilesService.update(teacherId, id, {
            name: parsed.data.name,
            description: parsed.data.description,
            categoryId: parsed.data.categoryId ?? undefined,
        });
        return res.json({
            success: true,
            message: 'تم تحديث الملف بنجاح',
            data: teacherFiles_service_1.TeacherFilesService.serializeFile(updated),
        });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFilesRouter.delete('/bulk', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = BulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صالحة',
            errors: parsed.error.errors,
        });
    }
    const result = await teacherFiles_service_1.TeacherFilesService.bulkDelete(teacherId, parsed.data.ids);
    return res.json({
        success: true,
        message: `تم حذف ${result.deletedCount} ملف`,
        data: result,
    });
}));
exports.teacherFilesRouter.delete('/:id', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف الملف غير صالح' });
    try {
        await teacherFiles_service_1.TeacherFilesService.delete(teacherId, id);
        return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
// ── Categories ──────────────────────────────────────────────────────────
exports.teacherFileCategoriesRouter.post('/', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
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
        const category = await teacherFiles_service_1.FileCategoriesService.create(teacherId, parsed.data.name);
        return res.status(201).json({
            success: true,
            message: 'تم إنشاء التصنيف بنجاح',
            data: category,
        });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFileCategoriesRouter.get('/', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const categories = await teacherFiles_service_1.FileCategoriesService.list(teacherId);
    return res.json({ success: true, data: categories });
}));
exports.teacherFileCategoriesRouter.put('/:id', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });
    const parsed = UpdateCategorySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'بيانات غير صالحة',
            errors: parsed.error.errors,
        });
    }
    try {
        const category = await teacherFiles_service_1.FileCategoriesService.update(teacherId, id, parsed.data.name);
        return res.json({
            success: true,
            message: 'تم تحديث التصنيف بنجاح',
            data: category,
        });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
exports.teacherFileCategoriesRouter.delete('/:id', (0, authentication_1.authMiddleware)([...MY_FILES_ROLES]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const id = (0, requestParsers_1.parseNumberInput)(req.params.id);
    if (!id)
        return res.status(400).json({ success: false, message: 'معرف التصنيف غير صالح' });
    try {
        await teacherFiles_service_1.FileCategoriesService.delete(teacherId, id);
        return res.json({ success: true, message: 'تم حذف التصنيف بنجاح' });
    }
    catch (error) {
        const handled = handleServiceError(res, error);
        if (handled)
            return handled;
        throw error;
    }
}));
