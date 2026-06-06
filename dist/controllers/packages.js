"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const packageSubjectItems_1 = require("../services/packageSubjectItems");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const QRCodeService_1 = require("../services/QRCodeService");
const packageSubjectPermissions_1 = require("../services/packageSubjectPermissions");
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for file uploads
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
        cb(null, 'package-' + uniqueSuffix + path_1.default.extname(file.originalname));
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
// 1. إنشاء باقة دراسية جديدة (للأدمن فقط)
router.post('/', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { name, price, grade_id } = req.body;
        // التحقق من البيانات المطلوبة
        if (!name || !price || !grade_id) {
            return res.status(400).json({
                error: 'الاسم والسعر والصف الدراسي مطلوبون',
            });
        }
        const file = req.file ?? null;
        const image = file ? (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url : null;
        // التحقق من وجود الصف الدراسي
        const gradeExists = await pool_1.default.query('SELECT id, name FROM grades WHERE id = $1', [grade_id]);
        if (gradeExists.rows.length === 0) {
            return res.status(400).json({
                error: 'الصف الدراسي غير موجود',
            });
        }
        const result = await pool_1.default.query(`INSERT INTO packages (name, image, price, grade_id) 
         VALUES ($1, $2, $3, $4) 
         RETURNING *`, [name, image, price, grade_id]);
        const packageData = result.rows[0];
        // إضافة اسم الصف الدراسي للاستجابة
        packageData.grade_name = gradeExists.rows[0].name;
        res.status(201).json({
            message: 'تم إنشاء الباقة بنجاح',
            package: packageData,
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating package:', error);
        res.status(500).json({ error: 'خطأ في إنشاء الباقة' });
    }
});
// 2. عرض جميع الباقات الدراسية
router.get('/', async (req, res) => {
    try {
        const { limit = 20, offset = 0, grade_id } = req.query;
        let query = `
      SELECT p.*, g.name as grade_name 
      FROM packages p 
      LEFT JOIN grades g ON p.grade_id = g.id 
    `;
        const values = [];
        let paramCount = 1;
        // فلترة حسب الصف الدراسي
        if (grade_id) {
            query += ` WHERE p.grade_id = $${paramCount++}`;
            values.push(parseInt(grade_id));
        }
        query += ` ORDER BY p.created_at DESC LIMIT $${paramCount++} OFFSET $${paramCount++}`;
        values.push(parseInt(limit), parseInt(offset));
        const result = await pool_1.default.query(query, values);
        // إضافة المواد لكل باقة
        const packagesWithSubjects = await Promise.all(result.rows.map(async (pkg) => {
            const subjects = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItems(pkg.id);
            return {
                ...pkg,
                image: pkg.image,
                subjects,
            };
        }));
        res.json({
            packages: packagesWithSubjects,
            pagination: {
                limit: parseInt(limit),
                offset: parseInt(offset),
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching packages:', error);
        res.status(500).json({ error: 'خطأ في جلب الباقات' });
    }
});
// 3. إنشاء أكواد تفعيل للباقة (للأدمن فقط)
router.post('/:id/activation-codes', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const { count, expires_at } = req.body;
        // التحقق من البيانات المطلوبة
        if (!count || typeof count !== 'number' || count < 1 || count > 100) {
            return res.status(400).json({
                error: 'العدد يجب أن يكون بين 1 و 100',
            });
        }
        const packageId = parseInt(id);
        const userId = req.user.id;
        // التحقق من وجود الباقة
        const packageResult = await pool_1.default.query('SELECT id, name FROM packages WHERE id = $1', [packageId]);
        if (packageResult.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        const packageName = packageResult.rows[0].name;
        const activationCodes = [];
        const errors = [];
        // إنشاء الأكواد المطلوبة
        for (let i = 0; i < count; i++) {
            try {
                const code = await packageActivationCodes_1.PackageActivationCodeService.create({
                    package_id: packageId,
                    max_uses: 1,
                    expires_at: expires_at || undefined,
                }, userId);
                // إنشاء QR code
                try {
                    const qrCode = await QRCodeService_1.QRCodeService.generateQRCode({
                        activation_code: code.code,
                        package_id: packageId,
                        expires_at: code.expires_at || undefined,
                        created_at: code.created_at,
                    });
                    activationCodes.push({
                        id: code.id,
                        code: code.code,
                        package_id: packageId,
                        package_name: packageName,
                        max_uses: code.max_uses,
                        uses: code.uses,
                        expires_at: code.expires_at,
                        created_at: code.created_at,
                        qr_code: qrCode,
                    });
                }
                catch (qrError) {
                    utils_1.logger.error('Error generating QR code:', qrError);
                    // نضيف الكود بدون QR code
                    activationCodes.push({
                        id: code.id,
                        code: code.code,
                        package_id: packageId,
                        package_name: packageName,
                        max_uses: code.max_uses,
                        uses: code.uses,
                        expires_at: code.expires_at,
                        created_at: code.created_at,
                        qr_code: null,
                        qr_error: 'فشل في إنشاء QR code',
                    });
                }
            }
            catch (error) {
                utils_1.logger.error('Error creating activation code:', error);
                errors.push({
                    index: i,
                    error: error.message || 'خطأ في إنشاء الكود',
                });
            }
        }
        res.status(201).json({
            message: `تم إنشاء ${activationCodes.length} كود تفعيل بنجاح`,
            total_created: activationCodes.length,
            total_requested: count,
            package_id: packageId,
            package_name: packageName,
            activation_codes: activationCodes,
            errors: errors.length > 0 ? errors : undefined,
        });
    }
    catch {
        res.status(500).json({ error: 'خطأ في إنشاء أكواد التفعيل' });
    }
});
// 3.1. عرض أكواد تفعيل الباقة (للأدمن فقط)
router.get('/:id/activation-codes', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const packageId = parseInt(id);
        // التحقق من وجود الباقة
        const packageResult = await pool_1.default.query('SELECT id, name FROM packages WHERE id = $1', [packageId]);
        if (packageResult.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        const { name: packageName } = packageResult.rows[0];
        const codes = await packageActivationCodes_1.PackageActivationCodeService.getByPackage(packageId);
        // تحسين شكل الاستجابة
        const formattedCodes = codes.map((code) => ({
            ...code,
            is_used: code.uses >= code.max_uses,
            is_expired: code.expires_at ? new Date(code.expires_at) < new Date() : false,
        }));
        res.json({
            package_id: packageId,
            package_name: packageName,
            activation_codes: formattedCodes,
            total: formattedCodes.length,
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching activation codes:', error);
        res.status(500).json({ error: 'خطأ في جلب أكواد التفعيل' });
    }
});
// 4. تفعيل الباقة بالكود (للطالب فقط) - يجب أن يكون قبل /:id
router.post('/activate', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const { package_id, code } = req.body;
        // التحقق من البيانات المطلوبة
        if (!package_id || !code) {
            return res.status(400).json({
                message: 'package_id و code مطلوبان',
            });
        }
        const studentId = req.user.id;
        const packageId = parseInt(package_id);
        const result = await packageActivationCodes_1.PackageActivationCodeService.activate(packageId, code, studentId);
        if (!result.success) {
            return res.status(400).json({
                message: result.message,
            });
        }
        res.json({
            message: result.message,
            package: result.package,
        });
    }
    catch (error) {
        utils_1.logger.error('Error activating package:', error);
        res.status(500).json({ message: error.message || 'خطأ في تفعيل الباقة' });
    }
});
// 5. جلب قائمة المدرسين المصرح لهم بمادة معينة (للأدمن فقط) - يجب أن يكون قبل /subjects/:id
router.get('/subjects/:id/permissions', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const subjectId = parseInt(id);
        // التحقق من وجود المادة
        const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
        if (!subject) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        // جلب قائمة المدرسين المصرح لهم
        const permissions = await packageSubjectPermissions_1.PackageSubjectPermissionsService.getTeachersWithPermission(subjectId);
        res.json({
            subject_id: subjectId,
            subject_name: subject.name,
            permissions,
            total: permissions.length,
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching subject permissions:', error);
        res.status(500).json({ error: 'خطأ في جلب صلاحيات المادة' });
    }
});
// 5.1 إعطاء صلاحية لمدرس على مادة باقة (للأدمن فقط)
router.post('/subjects/:subjectId/permissions', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const subjectId = parseInt(req.params.subjectId);
        const { teacherId } = req.body;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const grantedBy = req.user.id;
        if (isNaN(subjectId) || !teacherId) {
            return res.status(400).json({ error: 'معرف المادة أو المدرس غير صحيح' });
        }
        const permission = await packageSubjectPermissions_1.PackageSubjectPermissionsService.grantPermission(subjectId, teacherId, grantedBy);
        res.status(201).json({ success: true, message: 'تم إعطاء صلاحية المدرس بنجاح', permission });
    }
    catch (error) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        res.status(500).json({ error: 'خطأ في إعطاء الصلاحية', details: error.message });
    }
});
// 5.2 حذف صلاحية مدرس من مادة باقة (للأدمن فقط)
router.delete('/subjects/:subjectId/permissions/:teacherId', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const subjectId = parseInt(req.params.subjectId);
        const teacherId = parseInt(req.params.teacherId);
        if (isNaN(subjectId) || isNaN(teacherId)) {
            return res.status(400).json({ error: 'معرف المادة أو المدرس غير صحيح' });
        }
        const ok = await packageSubjectPermissions_1.PackageSubjectPermissionsService.revokePermission(subjectId, teacherId);
        if (!ok) {
            return res.status(404).json({ error: 'الصلاحية غير موجودة' });
        }
        res.json({ success: true, message: 'تم حذف صلاحية المدرس من المادة بنجاح' });
    }
    catch {
        res.status(500).json({ error: 'خطأ في حذف الصلاحية' });
    }
});
// 6. جلب تفاصيل مادة دراسية (للأدمن والطالب المشترك والمدرس المصرح له) - يجب أن يكون قبل /:id
router.get('/subjects/:id', (0, authentication_1.authMiddleware)(['admin', 'student', 'teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const subjectId = parseInt(id);
        const user = req.user;
        // جلب تفاصيل المادة مع معلومات الباقة
        const subject = await packageSubjectItems_1.PackageSubjectItemService.getSubjectWithPackage(subjectId);
        if (!subject) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        // التحقق من الصلاحيات
        if (user.role === 'student') {
            // التحقق من تفعيل الباقة
            const isActivated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(subject.package_id, user.id);
            if (!isActivated) {
                return res.status(403).json({
                    error: 'يجب تفعيل الباقة أولاً للوصول إلى هذه المادة',
                });
            }
        }
        else if (user.role === 'teacher') {
            // التحقق من صلاحية المدرس
            const hasPermission = await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission) {
                return res.status(403).json({
                    error: 'ليس لديك صلاحية للوصول إلى هذه المادة',
                });
            }
        }
        // للأدمن: لا حاجة للتحقق، لديه صلاحية كاملة
        const response = {
            subject: {
                id: subject.id,
                name: subject.name,
                image: subject.image,
                package_id: subject.package_id,
                package_name: subject.package_name,
                package_price: subject.package_price,
                package_image: subject.package_image,
                grade_id: subject.grade_id,
                grade_name: subject.grade_name,
                created_at: subject.created_at,
            },
        };
        // للأدمن فقط: إضافة قائمة المدرسين المصرح لهم
        if (user.role === 'admin') {
            const permissions = await packageSubjectPermissions_1.PackageSubjectPermissionsService.getTeachersWithPermission(subjectId);
            response.permissions = permissions;
        }
        res.json(response);
    }
    catch (error) {
        utils_1.logger.error('Error fetching package subject:', error);
        res.status(500).json({ error: 'خطأ في جلب تفاصيل المادة' });
    }
});
// 7. تفعيل الباقة بمسح QR Code (للطالب فقط) - يجب أن يكون قبل /:id
router.post('/scan-qr-activate', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const { qr_data } = req.body;
        if (!qr_data) {
            return res.status(400).json({
                success: false,
                message: 'QR code data is required',
            });
        }
        // Parse QR code data
        const qrCodeData = QRCodeService_1.QRCodeService.parseQRCodeData(qr_data);
        if (!qrCodeData) {
            return res.status(400).json({
                success: false,
                message: 'Invalid QR code format',
            });
        }
        // Validate QR code data
        if (!QRCodeService_1.QRCodeService.validateQRCodeData(qrCodeData)) {
            return res.status(400).json({
                success: false,
                message: 'QR code is expired or invalid',
            });
        }
        // Check if QR code is for package activation
        if (!qrCodeData.package_id) {
            return res.status(400).json({
                success: false,
                message: 'Invalid QR code for package activation',
            });
        }
        const studentId = req.user.id;
        const packageId = qrCodeData.package_id;
        // Activate package using the code from QR
        const result = await packageActivationCodes_1.PackageActivationCodeService.activate(packageId, qrCodeData.activation_code, studentId);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
            });
        }
        res.json({
            success: true,
            message: result.message,
            package: result.package,
        });
    }
    catch (error) {
        utils_1.logger.error('Error processing QR code activation:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'خطأ في تفعيل الباقة بمسح QR code',
        });
    }
});
// 8. جلب الطلاب الذين لديهم باقة محددة (للأدمن فقط)
router.get('/:id/students', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const packageId = parseInt(id);
        // التحقق من وجود الباقة
        const packageResult = await pool_1.default.query('SELECT id, name FROM packages WHERE id = $1', [packageId]);
        if (packageResult.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        const students = await packageActivationCodes_1.PackageActivationCodeService.getPackageStudents(packageId);
        res.json({
            package_id: packageId,
            package_name: packageResult.rows[0].name,
            students,
            total: students.length,
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching package students:', error);
        res.status(500).json({ error: 'خطأ في جلب طلاب الباقة' });
    }
});
// 9. عرض باقة محددة
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool_1.default.query(`SELECT p.*, g.name as grade_name 
       FROM packages p 
       LEFT JOIN grades g ON p.grade_id = g.id 
       WHERE p.id = $1`, [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        // إضافة المواد للباقة
        const subjects = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItems(parseInt(id));
        const packageWithSubjects = {
            ...result.rows[0],
            image: result.rows[0].image,
            subjects,
        };
        res.json({ package: packageWithSubjects });
    }
    catch (error) {
        utils_1.logger.error('Error fetching package:', error);
        res.status(500).json({ error: 'خطأ في جلب الباقة' });
    }
});
// 10. تحديث باقة دراسية (للأدمن فقط)
router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, price, grade_id } = req.body;
        const file = req.file ?? null;
        const image = file ? (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url : null;
        // التحقق من وجود الباقة
        const existingPackage = await pool_1.default.query('SELECT * FROM packages WHERE id = $1', [id]);
        if (existingPackage.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        // التحقق من وجود الصف الدراسي إذا تم توفيره
        if (grade_id) {
            const gradeExists = await pool_1.default.query('SELECT id FROM grades WHERE id = $1', [grade_id]);
            if (gradeExists.rows.length === 0) {
                return res.status(400).json({
                    error: 'الصف الدراسي غير موجود',
                });
            }
        }
        // بناء query التحديث
        const updateFields = [];
        const values = [];
        let paramCount = 1;
        if (name !== undefined) {
            updateFields.push(`name = $${paramCount++}`);
            values.push(name);
        }
        if (price !== undefined) {
            updateFields.push(`price = $${paramCount++}`);
            values.push(price);
        }
        if (grade_id !== undefined) {
            updateFields.push(`grade_id = $${paramCount++}`);
            values.push(grade_id);
        }
        if (image) {
            updateFields.push(`image = $${paramCount++}`);
            values.push(image);
        }
        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'لا توجد بيانات للتحديث' });
        }
        values.push(id);
        const result = await pool_1.default.query(`UPDATE packages SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`, values);
        res.json({
            message: 'تم تحديث الباقة بنجاح',
            package: result.rows[0],
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating package:', error);
        res.status(500).json({ error: 'خطأ في تحديث الباقة' });
    }
});
// 11. حذف باقة دراسية (للأدمن فقط)
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const { id } = req.params;
        // التحقق من وجود الباقة
        const existingPackage = await pool_1.default.query('SELECT * FROM packages WHERE id = $1', [id]);
        if (existingPackage.rows.length === 0) {
            return res.status(404).json({ error: 'الباقة غير موجودة' });
        }
        await pool_1.default.query('DELETE FROM packages WHERE id = $1', [id]);
        res.json({ message: 'تم حذف الباقة بنجاح' });
    }
    catch (error) {
        utils_1.logger.error('Error deleting package:', error);
        res.status(500).json({ error: 'خطأ في حذف الباقة' });
    }
});
