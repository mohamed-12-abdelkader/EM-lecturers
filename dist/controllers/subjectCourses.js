"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const subjectCourses_1 = require("../services/subjectCourses");
const teacherSubjects_1 = require("../services/teacherSubjects");
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for course images
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
        cb(null, 'course-' + uniqueSuffix + path_1.default.extname(file.originalname));
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
// 1. إنشاء كورس جديد
router.post('/', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('image'), async (req, res) => {
    try {
        const { subject_id, title, description, price, duration_hours, level, status } = req.body;
        const teacherId = req.user.id;
        const userRole = req.user.role;
        if (!subject_id || !title) {
            return res.status(400).json({ error: 'معرف المادة وعنوان الكورس مطلوبان' });
        }
        // التحقق من وجود المادة
        const subjectExists = await subjectCourses_1.SubjectCourseService.subjectExists(parseInt(subject_id));
        if (!subjectExists) {
            return res.status(404).json({ error: 'المادة غير موجودة' });
        }
        // التحقق من صلاحيات المدرس (الأدمن لديه جميع الصلاحيات)
        if (userRole === 'teacher') {
            const hasPermission = await teacherSubjects_1.TeacherSubjectService.checkTeacherPermission(teacherId, parseInt(subject_id), 'can_create_content');
            if (!hasPermission) {
                return res.status(403).json({ error: 'ليس لديك صلاحية لإنشاء محتوى لهذه المادة' });
            }
        }
        const file = req.file ?? null;
        const image = file ? (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url : undefined;
        const courseData = {
            subject_id: parseInt(subject_id),
            title,
            description,
            image,
            price: price ? parseFloat(price) : 0, // 0 يعني مجاني
            duration_hours: duration_hours ? parseInt(duration_hours) : 0,
            level: level || 'مبتدئ',
            status: status || 'draft',
        };
        const course = await subjectCourses_1.SubjectCourseService.createCourse(teacherId, courseData);
        res.status(201).json({
            message: 'تم إنشاء الكورس بنجاح',
            course,
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating course:', error);
        res.status(500).json({ error: 'خطأ في إنشاء الكورس' });
    }
});
// 2. تحديث كورس
router.put('/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('image'), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, price, duration_hours, level, status } = req.body;
        const teacherId = req.user.id;
        const userRole = req.user.role;
        // التحقق من ملكية الكورس أو صلاحيات الأدمن
        const existingCourse = await subjectCourses_1.SubjectCourseService.getCourseById(parseInt(id));
        if (!existingCourse) {
            return res.status(404).json({ error: 'الكورس غير موجود' });
        }
        if (userRole === 'teacher' && existingCourse.teacher_id !== teacherId) {
            return res.status(403).json({ error: 'لا يمكنك تعديل كورس مدرس آخر' });
        }
        const file = req.file ?? null;
        const image = file ? (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url : undefined;
        const courseData = {};
        if (title !== undefined)
            courseData.title = title;
        if (description !== undefined)
            courseData.description = description;
        if (image !== undefined)
            courseData.image = image;
        if (price !== undefined)
            courseData.price = parseFloat(price);
        if (duration_hours !== undefined)
            courseData.duration_hours = parseInt(duration_hours);
        if (level !== undefined)
            courseData.level = level;
        if (status !== undefined)
            courseData.status = status;
        const course = await subjectCourses_1.SubjectCourseService.updateCourse(parseInt(id), teacherId, courseData);
        res.json({
            message: 'تم تحديث الكورس بنجاح',
            course,
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating course:', error);
        res.status(500).json({ error: 'خطأ في تحديث الكورس' });
    }
});
// 3. حذف كورس
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const teacherId = req.user.id;
        const userRole = req.user.role;
        // التحقق من ملكية الكورس أو صلاحيات الأدمن
        const existingCourse = await subjectCourses_1.SubjectCourseService.getCourseById(parseInt(id));
        if (!existingCourse) {
            return res.status(404).json({ error: 'الكورس غير موجود' });
        }
        if (userRole === 'teacher' && existingCourse.teacher_id !== teacherId) {
            return res.status(403).json({ error: 'لا يمكنك حذف كورس مدرس آخر' });
        }
        await subjectCourses_1.SubjectCourseService.deleteCourse(parseInt(id), teacherId);
        // حذف الصورة إذا كانت موجودة
        if (existingCourse.image) {
            const imagePath = existingCourse.image.replace('/uploads/', 'uploads/');
            if (fs_1.default.existsSync(imagePath)) {
                fs_1.default.unlinkSync(imagePath);
            }
        }
        res.json({ message: 'تم حذف الكورس بنجاح' });
    }
    catch (error) {
        utils_1.logger.error('Error deleting course:', error);
        res.status(500).json({ error: 'خطأ في حذف الكورس' });
    }
});
// 4. جلب كورس بواسطة ID
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const course = await subjectCourses_1.SubjectCourseService.getCourseById(parseInt(id));
        if (!course) {
            return res.status(404).json({ error: 'الكورس غير موجود' });
        }
        res.json({ course });
    }
    catch (error) {
        utils_1.logger.error('Error fetching course:', error);
        res.status(500).json({ error: 'خطأ في جلب الكورس' });
    }
});
// 5. جلب كورسات مادة محددة
router.get('/subject/:subjectId', async (req, res) => {
    try {
        const { subjectId } = req.params;
        const { status } = req.query;
        const courses = await subjectCourses_1.SubjectCourseService.getCoursesBySubject(parseInt(subjectId), status);
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching subject courses:', error);
        res.status(500).json({ error: 'خطأ في جلب كورسات المادة' });
    }
});
// 6. جلب كورسات مدرس
router.get('/teacher/:teacherId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { teacherId } = req.params;
        const { status } = req.query;
        const user = req.user;
        // المدرس يمكنه رؤية كورساته فقط
        if (user.role === 'teacher' && user.id !== parseInt(teacherId)) {
            return res.status(403).json({ error: 'غير مصرح لك برؤية كورسات مدرس آخر' });
        }
        const courses = await subjectCourses_1.SubjectCourseService.getCoursesByTeacher(parseInt(teacherId), status);
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching teacher courses:', error);
        res.status(500).json({ error: 'خطأ في جلب كورسات المدرس' });
    }
});
// 7. جلب الكورسات المنشورة
router.get('/published/all', async (req, res) => {
    try {
        const courses = await subjectCourses_1.SubjectCourseService.getPublishedCourses();
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching published courses:', error);
        res.status(500).json({ error: 'خطأ في جلب الكورسات المنشورة' });
    }
});
// 7.1. جلب الكورسات المجانية
router.get('/free/all', async (req, res) => {
    try {
        const courses = await subjectCourses_1.SubjectCourseService.getFreeCourses();
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching free courses:', error);
        res.status(500).json({ error: 'خطأ في جلب الكورسات المجانية' });
    }
});
// 7.2. جلب الكورسات المدفوعة
router.get('/paid/all', async (req, res) => {
    try {
        const courses = await subjectCourses_1.SubjectCourseService.getPaidCourses();
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error fetching paid courses:', error);
        res.status(500).json({ error: 'خطأ في جلب الكورسات المدفوعة' });
    }
});
// 8. البحث في الكورسات
router.get('/search', async (req, res) => {
    try {
        const { q, subject_id, teacher_id, level, status, min_price, max_price } = req.query;
        if (!q) {
            return res.status(400).json({ error: 'مصطلح البحث مطلوب' });
        }
        const filters = {
            subject_id: subject_id ? parseInt(subject_id) : undefined,
            teacher_id: teacher_id ? parseInt(teacher_id) : undefined,
            level: level,
            status: status,
            min_price: min_price ? parseFloat(min_price) : undefined,
            max_price: max_price ? parseFloat(max_price) : undefined,
        };
        const courses = await subjectCourses_1.SubjectCourseService.searchCourses(q, filters);
        res.json({ courses });
    }
    catch (error) {
        utils_1.logger.error('Error searching courses:', error);
        res.status(500).json({ error: 'خطأ في البحث في الكورسات' });
    }
});
// 9. جلب إحصائيات الكورسات
router.get('/stats/:teacherId?', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { teacherId } = req.params;
        const user = req.user;
        // المدرس يمكنه رؤية إحصائياته فقط
        if (user.role === 'teacher' && teacherId && user.id !== parseInt(teacherId)) {
            return res.status(403).json({ error: 'غير مصرح لك برؤية إحصائيات مدرس آخر' });
        }
        const stats = await subjectCourses_1.SubjectCourseService.getCourseStats(teacherId ? parseInt(teacherId) : undefined);
        res.json({ stats });
    }
    catch (error) {
        utils_1.logger.error('Error fetching course stats:', error);
        res.status(500).json({ error: 'خطأ في جلب إحصائيات الكورسات' });
    }
});
