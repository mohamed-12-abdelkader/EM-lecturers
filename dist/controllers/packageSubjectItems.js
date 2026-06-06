"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const packageSubjectItems_1 = require("../services/packageSubjectItems");
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for package subject item images
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'package-subject-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('فقط ملفات الصور مسموح بها!'));
        }
    },
});
// 1. جلب جميع مواد الباقة
router.get('/package/:packageId', async (req, res) => {
    try {
        const { packageId } = req.params;
        // التحقق من وجود الباقة
        const packageExists = await packageSubjectItems_1.PackageSubjectItemService.packageExists(parseInt(packageId));
        if (!packageExists) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        const items = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItems(parseInt(packageId));
        res.json({ items });
    }
    catch (error) {
        utils_1.logger.error('Error fetching package subject items:', error);
        res.status(500).json({ error: 'خطأ في جلب مواد الباقة' });
    }
});
// 2. جلب مادة باقة محددة
// جلب مادة باقة محددة مع التحقق من الصلاحيات
router.get('/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const item = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
        if (!item) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        // الأدمن: صلاحية كاملة
        if (user.role === 'admin') {
            return res.json({ item });
        }
        // المدرس: يجب أن يكون لديه صلاحية تدريس المادة
        if (user.role === 'teacher') {
            // eslint-disable-next-line prettier/prettier, @typescript-eslint/no-require-imports
            const hasPermission = await require('../services/packageSubjectPermissions').PackageSubjectPermissionsService.hasPermission(item.id, user.id);
            if (!hasPermission) {
                return res.status(403).json({ error: 'ليس لديك صلاحية للوصول إلى هذه المادة' });
            }
            return res.json({ item });
        }
        // الطالب: يجب أن يكون مفعل الباقة
        if (user.role === 'student') {
            const isActivated = 
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            await require('../services/packageActivationCodes').PackageActivationCodeService.isActivated(item.package_id, user.id);
            if (!isActivated) {
                return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً للوصول إلى المادة' });
            }
            return res.json({ item });
        }
        // أي دور آخر: مرفوض
        return res.status(403).json({ error: 'غير مصرح' });
    }
    catch (error) {
        utils_1.logger.error('Error fetching package subject item:', error);
        res.status(500).json({ error: 'خطأ في جلب المادة' });
    }
});
// 3. إنشاء مادة باقة جديدة (للأدمن فقط)
router.post('/package/:packageId', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { packageId } = req.params;
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'اسم المادة مطلوب' });
        }
        // التحقق من وجود الباقة
        const packageExists = await packageSubjectItems_1.PackageSubjectItemService.packageExists(parseInt(packageId));
        if (!packageExists) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        const file = req.file ?? null;
        const image = file ? (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url : undefined;
        const item = await packageSubjectItems_1.PackageSubjectItemService.createPackageSubjectItem(parseInt(packageId), name, image);
        res.status(201).json({
            message: 'تم إنشاء مادة الباقة بنجاح',
            item,
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating package subject item:', error);
        res.status(500).json({ error: 'خطأ في إنشاء مادة الباقة' });
    }
});
// 4. تحديث مادة باقة (للأدمن فقط)
router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name } = req.body;
        // التحقق من وجود المادة
        const existingItem = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
        if (!existingItem) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        // التحقق من أن name موجود إذا تم إرساله
        const updatedName = name !== undefined ? name.trim() : existingItem.name;
        if (!updatedName) {
            return res.status(400).json({ error: 'اسم المادة مطلوب' });
        }
        // رفع الصورة الجديدة إذا تم إرسالها، وإلا الاحتفاظ بالصورة القديمة
        const file = req.file ?? null;
        let imageUrl = existingItem.image || undefined;
        if (file) {
            try {
                const uploaded = await (0, utils_1.uploadToCloudinary)(file.path);
                imageUrl = uploaded.secure_url;
            }
            catch (error) {
                utils_1.logger.error('Error uploading image to Cloudinary:', error);
                return res.status(500).json({ error: 'فشل في رفع الصورة' });
            }
        }
        const item = await packageSubjectItems_1.PackageSubjectItemService.updatePackageSubjectItem(parseInt(id), updatedName, imageUrl);
        if (!item) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        res.json({
            success: true,
            message: 'تم تحديث مادة الباقة بنجاح',
            item,
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating package subject item:', error);
        res.status(500).json({ error: 'خطأ في تحديث مادة الباقة' });
    }
});
// 5. حذف مادة باقة (للأدمن فقط)
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        // جلب المادة قبل حذفها
        const existingItem = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(parseInt(id));
        if (!existingItem) {
            return res.status(404).json({
                success: false,
                error: 'المادة غير موجودة',
            });
        }
        await packageSubjectItems_1.PackageSubjectItemService.deletePackageSubjectItem(parseInt(id));
        // ملاحظة: الصور محفوظة على Cloudinary، لا حاجة لحذفها من النظام المحلي
        res.json({
            success: true,
            message: 'تم حذف مادة الباقة بنجاح',
            deleted_item: {
                id: existingItem.id,
                name: existingItem.name,
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting package subject item:', error);
        res.status(500).json({
            success: false,
            error: 'خطأ في حذف مادة الباقة',
        });
    }
});
