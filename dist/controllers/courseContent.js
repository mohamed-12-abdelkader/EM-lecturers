"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const courseContent_1 = require("../services/courseContent");
const subjectCourses_1 = require("../services/subjectCourses");
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for course content files
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
        cb(null, 'course-content-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit for course content
    },
});
// ===== إدارة المحاضرات =====
// 1. إنشاء محاضرة جديدة
router.post('/lectures', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { course_id, title, description, content, video_url, video_duration, order_index, is_free, } = req.body;
        const teacherId = req.user.id;
        const userRole = req.user.role;
        if (!course_id || !title) {
            return res.status(400).json({ error: 'معرف الكورس وعنوان المحاضرة مطلوبان' });
        }
        // التحقق من ملكية الكورس (الأدمن لديه جميع الصلاحيات)
        if (userRole === 'teacher') {
            const course = await subjectCourses_1.SubjectCourseService.getCourseById(parseInt(course_id));
            if (!course) {
                return res.status(404).json({ error: 'الكورس غير موجود' });
            }
            if (course.teacher_id !== teacherId) {
                return res.status(403).json({ error: 'لا يمكنك إضافة محاضرة لكورس مدرس آخر' });
            }
        }
        const lectureData = {
            course_id: parseInt(course_id),
            title,
            description,
            content,
            video_url,
            video_duration: video_duration ? parseInt(video_duration) : undefined,
            order_index: order_index ? parseInt(order_index) : undefined,
            is_free: is_free !== 'false', // true افتراضياً
        };
        const lecture = await courseContent_1.CourseContentService.createLecture(teacherId, lectureData);
        res.status(201).json({
            message: 'تم إنشاء المحاضرة بنجاح',
            lecture,
        });
    }
    catch (error) {
        utils_1.logger.error('Error creating lecture:', error);
        res.status(500).json({ error: 'خطأ في إنشاء المحاضرة' });
    }
});
// 2. تحديث محاضرة
router.put('/lectures/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const { title, description, content, video_url, video_duration, order_index, is_free } = req.body;
        const teacherId = req.user.id;
        const lectureData = {};
        if (title !== undefined)
            lectureData.title = title;
        if (description !== undefined)
            lectureData.description = description;
        if (content !== undefined)
            lectureData.content = content;
        if (video_url !== undefined)
            lectureData.video_url = video_url;
        if (video_duration !== undefined)
            lectureData.video_duration = parseInt(video_duration);
        if (order_index !== undefined)
            lectureData.order_index = parseInt(order_index);
        if (is_free !== undefined)
            lectureData.is_free = is_free !== 'false';
        const lecture = await courseContent_1.CourseContentService.updateLecture(parseInt(id), teacherId, lectureData);
        res.json({
            message: 'تم تحديث المحاضرة بنجاح',
            lecture,
        });
    }
    catch (error) {
        utils_1.logger.error('Error updating lecture:', error);
        res.status(500).json({
            error: 'خطأ في تحديث المحاضرة',
            details: error.message || 'Unknown error',
        });
    }
});
// 3. حذف محاضرة
router.delete('/lectures/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        const { id } = req.params;
        const teacherId = req.user.id;
        await courseContent_1.CourseContentService.deleteLecture(parseInt(id), teacherId);
        res.json({ message: 'تم حذف المحاضرة بنجاح' });
    }
    catch (error) {
        utils_1.logger.error('Error deleting lecture:', error);
        res.status(500).json({
            error: 'خطأ في حذف المحاضرة',
            details: error.message || 'Unknown error',
        });
    }
});
// 4. جلب محاضرة بواسطة ID
router.get('/lectures/:id', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), async (req, res) => {
    try {
        const { id } = req.params;
        const user = req.user;
        const lecture = await courseContent_1.CourseContentService.getLectureById(parseInt(id));
        if (!lecture) {
            return res.status(404).json({ error: 'المحاضرة غير موجودة' });
        }
        // التحقق من صلاحية الوصول للمحاضرة
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { canAccessLecture } = require('../utils/courseAccess');
        const hasAccess = await canAccessLecture(parseInt(id), user.id, user.role);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'ليس لديك صلاحية للوصول إلى هذه المحاضرة',
            });
        }
        // جلب الملفات المرفقة
        const attachments = await courseContent_1.CourseContentService.getLectureAttachments(parseInt(id));
        res.json({
            lecture: {
                ...lecture,
                attachments,
            },
        });
    }
    catch (error) {
        utils_1.logger.error('Error fetching lecture:', error);
        res.status(500).json({ error: 'خطأ في جلب المحاضرة' });
    }
});
// 5. جلب جميع محاضرات الكورس
router.get('/courses/:courseId/lectures', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), async (req, res) => {
    try {
        const { courseId } = req.params;
        const user = req.user;
        // التحقق من صلاحية الوصول للكورس
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { canAccessCourseContent } = require('../utils/courseAccess');
        const hasAccess = await canAccessCourseContent(parseInt(courseId), user.id, user.role);
        if (!hasAccess) {
            return res.status(403).json({
                error: 'ليس لديك صلاحية للوصول إلى هذا الكورس',
            });
        }
        const lectures = await courseContent_1.CourseContentService.getCourseLectures(parseInt(courseId));
        res.json({ lectures });
    }
    catch (error) {
        utils_1.logger.error('Error fetching course lectures:', error);
        res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
});
// 5.1 جلب محاضرات الكورس مع منطق القفل للطلاب (للجداول القديمة)
router.get('/courses/:courseId/lectures/student', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const { courseId } = req.params;
        const studentId = req.user.id;
        // التحقق من صلاحية الوصول للكورس (يدعم الكورسات العادية والكورسات في المواد الدراسية)
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { canAccessCourseContent } = require('../utils/courseAccess');
        const hasAccess = await canAccessCourseContent(parseInt(courseId), studentId, 'student');
        if (!hasAccess) {
            return res.status(403).json({
                error: 'ليس لديك صلاحية للوصول إلى هذا الكورس. يجب أن تكون مشترك في الكورس أو مفعل للباقة التي تحتوي على هذه المادة',
            });
        }
        const lectures = await courseContent_1.CourseContentService.getCourseLecturesWithLock(parseInt(courseId), studentId);
        res.json({ lectures });
    }
    catch (error) {
        utils_1.logger.error('Error fetching course lectures with lock:', error);
        res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
});
// 5.2 جلب محاضرات الكورس مع منطق القفل للطلاب (جدول lectures - قفل المحاضرات التالية حتى النجاح)
router.get('/old-courses/:courseId/lectures/student', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const { courseId } = req.params;
        const studentId = req.user.id;
        const lectures = await courseContent_1.CourseContentService.getCourseLecturesWithLock(parseInt(courseId, 10), studentId);
        res.json({ lectures });
    }
    catch (error) {
        utils_1.logger.error('Error fetching old course lectures with lock:', error);
        res.status(500).json({ error: 'خطأ في جلب محاضرات الكورس' });
    }
});
// ===== إدارة الملفات المرفقة =====
// 13. إضافة ملف مرفق للمحاضرة
router.post('/lectures/:lectureId/attachments', (0, authentication_1.authMiddleware)(['admin', 'teacher']), upload.single('file'), async (req, res) => {
    try {
        const { lectureId } = req.params;
        const { description } = req.body;
        const teacherId = req.user.id;
        if (!req.file) {
            return res.status(400).json({ error: 'الملف مطلوب' });
        }
        const attachmentData = {
            file_name: req.file.originalname,
            file_url: `/uploads/${req.file.filename}`,
            file_size: req.file.size,
            file_type: req.file.mimetype,
            description,
        };
        const attachment = await courseContent_1.CourseContentService.addLectureAttachment(parseInt(lectureId), teacherId, attachmentData);
        res.status(201).json({
            message: 'تم إضافة الملف المرفق بنجاح',
            attachment,
        });
    }
    catch (error) {
        utils_1.logger.error('Error adding lecture attachment:', error);
        res.status(500).json({ error: 'خطأ في إضافة الملف المرفق' });
    }
});
// 14. جلب ملفات مرفقة المحاضرة
router.get('/lectures/:lectureId/attachments', async (req, res) => {
    try {
        const { lectureId } = req.params;
        const attachments = await courseContent_1.CourseContentService.getLectureAttachments(parseInt(lectureId));
        res.json({ attachments });
    }
    catch (error) {
        utils_1.logger.error('Error fetching lecture attachments:', error);
        res.status(500).json({ error: 'خطأ في جلب الملفات المرفقة' });
    }
});
// ===== إحصائيات محتوى الكورس =====
// 15. جلب إحصائيات محتوى الكورس
router.get('/courses/:courseId/content-stats', async (req, res) => {
    try {
        const { courseId } = req.params;
        const stats = await courseContent_1.CourseContentService.getCourseContentStats(parseInt(courseId));
        res.json({ stats });
    }
    catch (error) {
        utils_1.logger.error('Error fetching course content stats:', error);
        res.status(500).json({ error: 'خطأ في جلب إحصائيات محتوى الكورس' });
    }
});
