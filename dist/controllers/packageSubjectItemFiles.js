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
const packageSubjectItemFiles_1 = require("../services/packageSubjectItemFiles");
const packageSubjectItems_1 = require("../services/packageSubjectItems");
const packageSubjectPermissions_1 = require("../services/packageSubjectPermissions");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_2 = require("../utils");
exports.router = (0, express_1.Router)();
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path_1.default.join(__dirname, '../../uploads/package-subject-files');
        fs_1.default.mkdirSync(uploadDir, { recursive: true });
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'subject-file-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
    },
});
const CreateFileSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    file_url: zod_1.z.string().url().optional(), // optional if uploading file
    order_index: zod_1.z.number().int().min(0).optional(),
});
const UpdateFileSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).optional(),
    file_url: zod_1.z.string().url().optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
// Check read access (for students, teachers, admins)
async function checkReadAccess(subjectId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole === 'teacher') {
        return await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, userId);
    }
    if (userRole === 'student') {
        const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
        if (!subject)
            return false;
        return await packageActivationCodes_1.PackageActivationCodeService.isActivated(subject.package_id, userId);
    }
    return false;
}
// Check write access (for admins and authorized teachers)
async function checkWriteAccess(subjectId, userId, userRole) {
    if (userRole === 'admin')
        return true;
    if (userRole === 'teacher') {
        return await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, userId);
    }
    return false;
}
// ========== Subject Files APIs ==========
// GET /api/package-subjects/:subjectId/files - Get files for subject
exports.router.get('/:subjectId/files', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
    if (!subject)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const user = req.user;
    const hasAccess = await checkReadAccess(subjectId, user.id, user.role);
    if (!hasAccess)
        return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذه المادة' });
    const files = await packageSubjectItemFiles_1.PackageSubjectItemFilesService.getFilesBySubject(subjectId);
    return res.json({ files });
}));
// POST /api/package-subjects/:subjectId/files - Create file for subject
exports.router.post('/:subjectId/files', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId))
        return res.status(400).json({ error: 'Invalid subject ID' });
    const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
    if (!subject)
        return res.status(404).json({ error: 'المادة غير موجودة' });
    const user = req.user;
    const hasAccess = await checkWriteAccess(subjectId, user.id, user.role);
    if (!hasAccess)
        return res.status(403).json({ error: 'ليس لديك صلاحية لإضافة ملفات لهذه المادة' });
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
        name: req.body.name,
        file_url: fileUrl,
        order_index: req.body.order_index ? parseInt(req.body.order_index) : undefined,
    });
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }
    const createdFile = await packageSubjectItemFiles_1.PackageSubjectItemFilesService.createFile(subjectId, {
        name: parsed.data.name,
        file_url: parsed.data.file_url,
        file_size: file ? file.size : undefined,
        file_type: file ? file.mimetype : undefined,
        order_index: parsed.data.order_index,
    });
    // إرسال إشعار للطلاب المشتركين في الباقة
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { NotificationService } = await import('../services/notifications');
        await NotificationService.notifyPackageFileAdded(subject.package_id, subjectId, createdFile.name, subject.name);
    }
    catch (notifError) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        logger.error('Error sending notification:', notifError);
    }
    return res.status(201).json({ success: true, file: createdFile });
}));
// PUT /api/package-subjects/files/:fileId - Update file
exports.router.put('/files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectItemFiles_1.PackageSubjectItemFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const user = req.user;
    const hasAccess = await checkWriteAccess(existing.subject_id, user.id, user.role);
    if (!hasAccess)
        return res.status(403).json({ error: 'ليس لديك صلاحية لتعديل هذا الملف' });
    const file = req.file;
    let fileUrl = req.body.file_url;
    // If new file is uploaded, upload to Cloudinary
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
    const updateData = {};
    if (req.body.name !== undefined)
        updateData.name = req.body.name;
    if (fileUrl !== undefined)
        updateData.file_url = fileUrl;
    if (req.body.order_index !== undefined)
        updateData.order_index = parseInt(req.body.order_index);
    if (file) {
        updateData.file_size = file.size;
        updateData.file_type = file.mimetype;
    }
    const parsed = UpdateFileSchema.safeParse(updateData);
    if (!parsed.success) {
        return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });
    }
    const updated = await packageSubjectItemFiles_1.PackageSubjectItemFilesService.updateFile(fileId, {
        ...parsed.data,
        file_size: file ? file.size : undefined,
        file_type: file ? file.mimetype : undefined,
    });
    return res.json({ success: true, file: updated });
}));
// DELETE /api/package-subjects/files/:fileId - Delete file
exports.router.delete('/files/:fileId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const fileId = parseInt(req.params.fileId);
    if (isNaN(fileId))
        return res.status(400).json({ error: 'Invalid file ID' });
    const existing = await packageSubjectItemFiles_1.PackageSubjectItemFilesService.getFileById(fileId);
    if (!existing)
        return res.status(404).json({ error: 'الملف غير موجود' });
    const user = req.user;
    const hasAccess = await checkWriteAccess(existing.subject_id, user.id, user.role);
    if (!hasAccess)
        return res.status(403).json({ error: 'ليس لديك صلاحية لحذف هذا الملف' });
    await packageSubjectItemFiles_1.PackageSubjectItemFilesService.deleteFile(fileId);
    return res.json({ success: true, message: 'تم حذف الملف بنجاح' });
}));
