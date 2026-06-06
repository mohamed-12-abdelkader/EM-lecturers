"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const competitions_1 = require("../services/competitions");
const authentication_1 = require("../middleware/authentication");
const bunny_1 = require("../services/bunny");
const router = (0, express_1.Router)();
exports.router = router;
// إعداد multer لرفع الملفات
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/competitions';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'competition-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('فقط ملفات الصور مسموح بها'));
        }
    },
});
// إنشاء مسابقة جديدة (أدمن فقط)
router.post('/', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const { title, description, duration, grade_id, is_visible, is_active } = req.body;
        if (!title || !duration || !grade_id) {
            return res.status(400).json({
                success: false,
                message: 'العنوان والمدة والصف الدراسي مطلوبون',
            });
        }
        let image_url = null;
        // رفع الصورة إذا تم توفيرها
        if (req.file) {
            try {
                const uploadResult = await (0, bunny_1.uploadToBunnyStorage)({
                    path: req.file.path,
                    ext: path_1.default.extname(req.file.originalname).substring(1),
                    mime: req.file.mimetype,
                    originalname: req.file.originalname,
                });
                image_url = uploadResult;
            }
            catch (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة',
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    error: uploadError.message,
                });
            }
        }
        const competitionData = {
            title,
            description: description || '',
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            image_url,
            duration: parseInt(duration),
            grade_id: parseInt(grade_id),
            is_visible: is_visible === 'true' || is_visible === true,
            is_active: is_active === 'true' || is_active === true,
        };
        const competition = await competitions_1.CompetitionsService.create(competitionData, req.user.id);
        res.status(201).json({
            success: true,
            message: 'تم إنشاء المسابقة بنجاح',
            data: competition,
        });
    }
    catch (error) {
        console.error('Error creating competition:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في إنشاء المسابقة',
            error: error.message,
        });
    }
});
// الحصول على جميع المسابقات (أدمن فقط)
router.get('/admin', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const competitions = await competitions_1.CompetitionsService.getAll();
        res.json({
            success: true,
            data: competitions,
        });
    }
    catch (error) {
        console.error('Error fetching competitions:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب المسابقات',
            error: error.message,
        });
    }
});
// الحصول على المسابقات المرئية (للطلاب)
router.get('/', async (req, res) => {
    try {
        const { grade_id } = req.query;
        let competitions;
        if (grade_id) {
            competitions = await competitions_1.CompetitionsService.getByGrade(parseInt(grade_id));
        }
        else {
            competitions = await competitions_1.CompetitionsService.getVisible();
        }
        res.json({
            success: true,
            data: competitions,
        });
    }
    catch (error) {
        console.error('Error fetching visible competitions:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب المسابقات',
            error: error.message,
        });
    }
});
// ===== واجهات الطالب =====
// جلب مسابقات الطالب - API جديد تماماً
router.get('/student', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        // التحقق من وجود المستخدم
        if (!req.user || !req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'بيانات المستخدم غير صحيحة',
            });
        }
        // استخراج معرف الطالب
        const studentId = parseInt(req.user.id.toString());
        // التحقق من صحة المعرف
        if (isNaN(studentId) || studentId <= 0) {
            return res.status(400).json({
                success: false,
                message: 'معرف الطالب غير صحيح',
            });
        }
        // جلب المسابقات المتاحة للطالب
        const competitions = await competitions_1.CompetitionsService.getStudentCompetitionsSimple(studentId);
        res.json({
            success: true,
            data: competitions,
            message: 'تم جلب المسابقات بنجاح',
        });
    }
    catch (error) {
        console.error('Error getting student competitions:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب مسابقات الطالب',
            error: error.message,
        });
    }
});
// الحصول على مسابقة بواسطة المعرف
router.get('/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const competition = await competitions_1.CompetitionsService.getById(id);
        if (!competition) {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        res.json({
            success: true,
            data: competition,
        });
    }
    catch (error) {
        console.error('Error fetching competition:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في جلب المسابقة',
            error: error.message,
        });
    }
});
// تحديث مسابقة (أدمن فقط)
router.put('/:id', (0, authentication_1.authMiddleware)(['admin']), upload.single('image'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        // التحقق من وجود المسابقة
        const existingCompetition = await competitions_1.CompetitionsService.getById(id);
        if (!existingCompetition) {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        const { title, description, duration, grade_id, is_visible, is_active } = req.body;
        let image_url = existingCompetition.image_url;
        // رفع صورة جديدة إذا تم توفيرها
        if (req.file) {
            try {
                const uploadResult = await (0, bunny_1.uploadToBunnyStorage)({
                    path: req.file.path,
                    ext: path_1.default.extname(req.file.originalname).substring(1),
                    mime: req.file.mimetype,
                    originalname: req.file.originalname,
                });
                image_url = uploadResult;
            }
            catch (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: 'فشل في رفع الصورة',
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-expect-error
                    error: uploadError.message,
                });
            }
        }
        const updateData = {};
        if (title)
            updateData.title = title;
        if (description !== undefined)
            updateData.description = description;
        if (duration)
            updateData.duration = parseInt(duration);
        if (grade_id)
            updateData.grade_id = parseInt(grade_id);
        if (is_visible !== undefined)
            updateData.is_visible = is_visible === 'true' || is_visible === true;
        if (is_active !== undefined)
            updateData.is_active = is_active === 'true' || is_active === true;
        if (image_url !== existingCompetition.image_url)
            updateData.image_url = image_url;
        const updatedCompetition = await competitions_1.CompetitionsService.update(id, updateData);
        res.json({
            success: true,
            message: 'تم تحديث المسابقة بنجاح',
            data: updatedCompetition,
        });
    }
    catch (error) {
        console.error('Error updating competition:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تحديث المسابقة',
            error: error.message,
        });
    }
});
// حذف مسابقة (أدمن فقط)
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        // التحقق من وجود المسابقة
        const exists = await competitions_1.CompetitionsService.exists(id);
        if (!exists) {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        await competitions_1.CompetitionsService.delete(id);
        res.json({
            success: true,
            message: 'تم حذف المسابقة بنجاح',
        });
    }
    catch (error) {
        console.error('Error deleting competition:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في حذف المسابقة',
            error: error.message,
        });
    }
});
// تغيير حالة الرؤية (أدمن فقط)
router.patch('/:id/toggle-visibility', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updatedCompetition = await competitions_1.CompetitionsService.toggleVisibility(id);
        if (!updatedCompetition) {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        res.json({
            success: true,
            message: `تم ${updatedCompetition.is_visible ? 'إظهار' : 'إخفاء'} المسابقة بنجاح`,
            data: updatedCompetition,
        });
    }
    catch (error) {
        console.error('Error toggling competition visibility:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تغيير حالة الرؤية',
            error: error.message,
        });
    }
});
// تغيير حالة النشاط (أدمن فقط)
router.patch('/:id/toggle-active', (0, authentication_1.authMiddleware)(['admin']), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updatedCompetition = await competitions_1.CompetitionsService.toggleActive(id);
        if (!updatedCompetition) {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        res.json({
            success: true,
            message: `تم ${updatedCompetition.is_active ? 'تفعيل' : 'إلغاء تفعيل'} المسابقة بنجاح`,
            data: updatedCompetition,
        });
    }
    catch (error) {
        console.error('Error toggling competition active status:', error);
        res.status(500).json({
            success: false,
            message: 'فشل في تغيير حالة النشاط',
            error: error.message,
        });
    }
});
// اشتراك الطالب في مسابقة (طالب فقط)
router.post('/:id/join', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const competitionId = parseInt(req.params.id);
        const studentId = req.user.id;
        if (isNaN(competitionId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المسابقة غير صحيح',
            });
        }
        const enrolled = await competitions_1.CompetitionsService.enrollStudent(competitionId, studentId);
        res.json({
            success: true,
            message: 'تم الاشتراك في المسابقة بنجاح',
            data: { joined: enrolled },
        });
    }
    catch (error) {
        console.error('Error enrolling student in competition:', error);
        if (error.message === 'المسابقة غير موجودة') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'فشل في الاشتراك في المسابقة',
            error: error.message,
        });
    }
});
// تفاصيل المسابقة للطالب المشترك (طالب فقط)
router.get('/:id/student-details', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const competitionId = parseInt(req.params.id);
        const studentId = req.user.id;
        if (isNaN(competitionId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المسابقة غير صحيح',
            });
        }
        const details = await competitions_1.CompetitionsService.getStudentCompetitionDetails(competitionId, studentId);
        res.json({
            success: true,
            data: details,
        });
    }
    catch (error) {
        console.error('Error getting student competition details:', error);
        if (error.message === 'يجب الاشتراك في المسابقة لعرض التفاصيل') {
            return res.status(403).json({
                success: false,
                message: error.message,
            });
        }
        if (error.message === 'المسابقة غير موجودة') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'فشل في جلب تفاصيل المسابقة',
            error: error.message,
        });
    }
});
// حل المسابقة وإرسال الإجابات
router.post('/:id/solve', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const competitionId = parseInt(req.params.id);
        const studentId = req.user.id;
        if (isNaN(competitionId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المسابقة غير صحيح',
            });
        }
        const { answers } = req.body;
        if (!answers || !Array.isArray(answers) || answers.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'يجب إرسال إجابات صحيحة',
            });
        }
        const result = await competitions_1.CompetitionsService.solveCompetition(competitionId, studentId, answers);
        res.json({
            success: true,
            message: 'تم حل المسابقة بنجاح',
            data: result,
        });
    }
    catch (error) {
        console.error('Error solving competition:', error);
        if (error.message === 'يجب الاشتراك في المسابقة لحلها') {
            return res.status(403).json({
                success: false,
                message: error.message,
            });
        }
        if (error.message === 'لقد قمت بحل هذه المسابقة مسبقاً') {
            return res.status(409).json({
                success: false,
                message: error.message,
            });
        }
        if (error.message === 'المسابقة غير موجودة') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'فشل في حل المسابقة',
            error: error.message,
        });
    }
});
// عرض نتيجة الطالب في المسابقة
router.get('/:id/student-result', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const competitionId = parseInt(req.params.id);
        const studentId = req.user.id;
        if (isNaN(competitionId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المسابقة غير صحيح',
            });
        }
        const result = await competitions_1.CompetitionsService.getStudentResult(competitionId, studentId);
        res.json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        console.error('Error getting student result:', error);
        if (error.message === 'لم تقم بحل هذه المسابقة بعد') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'فشل في جلب نتيجة الطالب',
            error: error.message,
        });
    }
});
// ترتيب الطلاب في مسابقة معينة (للطالب والأدمن)
router.get('/:id/leaderboard', (0, authentication_1.authMiddleware)(['student', 'admin']), async (req, res) => {
    try {
        const competitionId = parseInt(req.params.id);
        const userId = req.user.id;
        const userRole = req.user.role;
        if (isNaN(competitionId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المسابقة غير صحيح',
            });
        }
        // إذا كان المستخدم طالب، التحقق من اشتراكه في المسابقة
        if (userRole === 'student') {
            const isEnrolled = await competitions_1.CompetitionsService.isStudentEnrolled(competitionId, userId);
            if (!isEnrolled) {
                return res.status(403).json({
                    success: false,
                    message: 'يجب الاشتراك في المسابقة لعرض الترتيب',
                });
            }
        }
        const limit = parseInt(req.query.limit) || 10;
        const offset = parseInt(req.query.offset) || 0;
        const gradeId = req.query.grade_id ? parseInt(req.query.grade_id) : null;
        // للأدمن، يمكنه تصفية النتائج حسب الصف
        if (userRole === 'admin') {
            const leaderboard = await competitions_1.CompetitionsService.getCompetitionLeaderboardForAdmin(competitionId, gradeId, limit, offset);
            res.json({
                success: true,
                data: leaderboard,
            });
        }
        else {
            // للطالب، النتائج العادية
            const leaderboard = await competitions_1.CompetitionsService.getCompetitionLeaderboard(competitionId, limit, offset);
            res.json({
                success: true,
                data: leaderboard,
            });
        }
    }
    catch (error) {
        console.error('Error getting competition leaderboard:', error);
        if (error.message === 'المسابقة غير موجودة') {
            return res.status(404).json({
                success: false,
                message: 'المسابقة غير موجودة',
            });
        }
        res.status(500).json({
            success: false,
            message: 'فشل في جلب ترتيب الطلاب',
            error: error.message,
        });
    }
});
