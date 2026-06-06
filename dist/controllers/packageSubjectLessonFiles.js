"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const packageSubjectLessonFiles_1 = require("../services/packageSubjectLessonFiles");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_2 = require("../utils");
exports.router = (0, express_1.Router)();
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads/lesson-files');
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'lesson-file-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
});
const CreateFileSchema = zod_1.z.object({
    title: zod_1.z.string().min(1),
    file_url: zod_1.z.string().url().optional(), // optional if uploading file
    order_index: zod_1.z.number().int().min(0).optional(),
});
const UpdateFileSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).optional(),
    file_url: zod_1.z.string().url().optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
async function checkLessonPermission(lessonId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole !== 'teacher')
        return false;
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson?.group_id)
        return false;
    return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
}
// POST /api/lessons/:lessonId/files
exports.router.post('/lessons/:lessonId/files', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId))
        return res.status(400).json({ error: 'Invalid lesson ID' });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson)
        return res.status(404).json({ error: 'الدرس غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(lessonId, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const file = req.file;
    let fileUrl = req.body.file_url;
    // If file is uploaded, upload to Cloudinary
    if (file) {
        try {
            const uploaded = await (0, utils_2.uploadToCloudinary)(file.path);
            fileUrl = uploaded.secure_url;
            // Delete local file after upload
            fs_1.default.unlinkSync(file.path);
        }
        catch {
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
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const createdFile = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.createFile(lessonId, parsed.data);
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
                await NotificationService.notifyPackageFileAdded(subject.package_id, lesson.subject_id, createdFile.title, subject.name, lessonId, lesson.name);
            }
        }
    }
    catch {
        // لا نوقف العملية إذا فشل الإشعار
    }
    return res.status(201).json({ success: true, file: createdFile });
}));
// PUT /api/files/:fileId
exports.router.put('/files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    const parsed = UpdateFileSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    const updated = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.updateFile(fileId, parsed.data);
    return res.json({ success: true, file: updated });
}));
// GET /api/lessons/:lessonId/files - Get files for lesson
exports.router.get('/lessons/:lessonId/files', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId))
        return res.status(400).json({ error: 'Invalid lesson ID' });
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson)
        return res.status(404).json({ error: 'الدرس غير موجود' });
    // Check access for students
    const user = req.user;
    if (user.role === 'student') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { PackageSubjectItemService } = await import('../services/packageSubjectItems');
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { PackageActivationCodeService } = await import('../services/packageActivationCodes');
        const subject = await PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
        if (!subject)
            return res.status(404).json({ error: 'المادة غير موجودة' });
        const isActivated = await PackageActivationCodeService.isActivated(subject.package_id, user.id);
        if (!isActivated) {
            return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً للوصول إلى هذا الدرس' });
        }
    }
    const files = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.getFilesByLesson(lessonId);
    return res.json({ files });
}));
// DELETE /api/files/:fileId
exports.router.delete('/files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const user = req.user;
    const ok = await checkLessonPermission(existing.lesson_id, user.id, user.role);
    if (!ok)
        return res.status(403).json({ error: 'Forbidden' });
    await packageSubjectLessonFiles_1.PackageSubjectLessonFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
}));
