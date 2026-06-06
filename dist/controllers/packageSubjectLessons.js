"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectPermissions_1 = require("../services/packageSubjectPermissions");
const packageSubjectItems_1 = require("../services/packageSubjectItems");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const router = (0, express_1.Router)();
exports.router = router;
// Middleware: Check Access (Read)
const checkReadAccess = async (req, res, next) => {
    try {
        const user = req.user;
        const subjectId = parseInt((req.params.subjectId || req.params.id));
        // This middleware is tricky because for creating a lesson, we need subjectId (params).
        // For deleting a lesson, we have lessonId. We need to fetch subjectId first.
        // Let's implement specific checks inside handlers for better granularity, or refine this.
        // For "Get Lessons by Subject":
        if (!subjectId)
            return next(); // Not a subject-based route, skip
        if (user.role === 'admin')
            return next();
        if (user.role === 'teacher') {
            const hasPermission = await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission)
                return res.status(403).json({ error: 'ليس لديك صلاحية لهذا المحتوى' });
            return next();
        }
        if (user.role === 'student') {
            // We need to find the packageId for this subjectId
            const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
            if (!subject)
                return res.status(404).json({ error: 'المادة غير موجودة' });
            const isActivated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(subject.package_id, user.id);
            if (!isActivated)
                return res.status(403).json({ error: 'يجب تفعيل الباقة أولاً' });
            return next();
        }
        return res.status(403).json({ error: 'غير مصرح' });
    }
    catch (err) {
        next(err);
    }
};
// Middleware: Check Write Access (Admin & Authorized Teacher)
const checkWriteAccess = async (req, res, next) => {
    try {
        const user = req.user;
        let subjectId = null;
        // Determine Subject ID based on route params
        if (req.params.subjectId) {
            subjectId = parseInt(req.params.subjectId);
        }
        else if (req.params.lessonId) {
            const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLesson(parseInt(req.params.lessonId));
            if (!lesson)
                return res.status(404).json({ error: 'الدرس غير موجود' });
            subjectId = lesson.subject_id;
        }
        if (!subjectId && req.body.subject_id)
            subjectId = req.body.subject_id;
        if (user.role === 'admin')
            return next();
        if (user.role === 'teacher') {
            if (!subjectId)
                return res.status(400).json({ error: 'معرف المادة مطلوب' });
            const hasPermission = await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, user.id);
            if (!hasPermission)
                return res.status(403).json({ error: 'ليس لديك صلاحية تعديل هذا المحتوى' });
            return next();
        }
        return res.status(403).json({ error: 'غير مصرح للإجراءات الإدارية' });
    }
    catch (err) {
        next(err);
    }
};
// 1. Get Lessons for a Subject (Admin, Teacher, Student)
router.get('/:subjectId/lessons', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), checkReadAccess, async (req, res) => {
    try {
        const subjectId = parseInt(req.params.subjectId);
        const user = req.user;
        let lessons;
        if (user.role === 'student') {
            lessons = await packageSubjectLessons_1.PackageSubjectLessonService.getVisibleLessonsBySubject(subjectId);
        }
        else {
            lessons = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonsBySubject(subjectId);
        }
        res.json({ lessons });
    }
    catch (error) {
        utils_1.logger.error('Error fetching lessons:', error);
        res.status(500).json({ error: 'خطأ في جلب الدروس' });
    }
});
// 2. Create Lesson (Admin, Teacher)
router.post('/:subjectId/lessons', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const subjectId = parseInt(req.params.subjectId);
        const { name } = req.body;
        if (!name)
            return res.status(400).json({ error: 'اسم الدرس مطلوب' });
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.createLesson(subjectId, name);
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان visible)
        try {
            const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(subjectId);
            if (subject) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const { NotificationService } = await import('../services/notifications');
                await NotificationService.notifyPackageLessonAdded(subject.package_id, subjectId, lesson.id, lesson.name, subject.name, lesson.is_visible || false);
            }
        }
        catch (notifError) {
            utils_1.logger.error('Error sending notification:', notifError);
            // لا نوقف العملية إذا فشل الإشعار
        }
        res.status(201).json({ message: 'تم إنشاء الدرس بنجاح', lesson });
    }
    catch (error) {
        utils_1.logger.error('Error creating lesson:', error);
        res.status(500).json({ error: 'خطأ في إنشاء الدرس' });
    }
});
// 3. Update Lesson (Admin, Teacher)
router.put('/lessons/:lessonId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        const { name } = req.body;
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.updateLesson(lessonId, name);
        res.json({ message: 'تم تحديث الدرس', lesson });
    }
    catch {
        res.status(500).json({ error: 'خطأ في التحديث' });
    }
});
// 4. Delete Lesson (Admin, Teacher)
router.delete('/lessons/:lessonId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        await packageSubjectLessons_1.PackageSubjectLessonService.deleteLesson(lessonId);
        res.json({ message: 'تم حذف الدرس' });
    }
    catch {
        res.status(500).json({ error: 'خطأ في الحذف' });
    }
});
// 5. Add Video to Lesson
router.post('/lessons/:lessonId/videos', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        const { name, link } = req.body;
        if (!name || !link)
            return res.status(400).json({ error: 'البيانات ناقصة' });
        const video = await packageSubjectLessons_1.PackageSubjectLessonService.addVideo(lessonId, name, link);
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان الدرس visible)
        try {
            const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLesson(lessonId);
            if (lesson && lesson.is_visible) {
                const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
                if (subject) {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    await NotificationService.notifyPackageVideoAdded(subject.package_id, lesson.subject_id, lessonId, video.id, video.name, lesson.name, subject.name, true // الفيديو visible لأن الدرس visible
                    );
                }
            }
        }
        catch (notifError) {
            utils_1.logger.error('Error sending notification:', notifError);
            // لا نوقف العملية إذا فشل الإشعار
        }
        res.status(201).json({ message: 'تم إضافة الفيديو', video });
    }
    catch {
        res.status(500).json({ error: 'خطأ في إضافة الفيديو' });
    }
});
// 6. Delete Video
// Note: We need to look up lessonId from videoId to checkWriteAccess properly, or just trust admin/teacher context if strict ownership isn't critical.
// For strict checking, we'd need a helper or just query the video first.
router.delete('/videos/:videoId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        // Simple permission check (can be improved)
        const user = req.user;
        if (user.role !== 'admin' && user.role !== 'teacher')
            return res.status(403).json({ error: 'Unauthorized' });
        // TODO: For teacher, verify subject ownership via video -> lesson -> subject
        await packageSubjectLessons_1.PackageSubjectLessonService.deleteVideo(parseInt(req.params.videoId));
        res.json({ message: 'تم حذف الفيديو' });
    }
    catch {
        res.status(500).json({ error: 'خطأ في الحذف' });
    }
});
// 7. Add Assignment to Lesson
router.post('/lessons/:lessonId/assignments', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        const { name, question_count, total_marks } = req.body;
        const assignment = await packageSubjectLessons_1.PackageSubjectLessonService.addAssignment(lessonId, name, question_count || 0, total_marks || 0);
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا كان visible)
        try {
            const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLesson(lessonId);
            if (lesson) {
                const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
                if (subject) {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    await NotificationService.notifyPackageAssignmentAdded(subject.package_id, lesson.subject_id, lessonId, assignment.id, assignment.name, lesson.name, subject.name, assignment.is_visible || false);
                }
            }
        }
        catch (notifError) {
            utils_1.logger.error('Error sending notification:', notifError);
        }
        res.status(201).json({ message: 'تم إضافة الواجب', assignment });
    }
    catch {
        res.status(500).json({ error: 'خطأ في إضافة الواجب' });
    }
});
// 8. Delete Assignment
router.delete('/assignments/:assignmentId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        await packageSubjectLessons_1.PackageSubjectLessonService.deleteAssignment(parseInt(req.params.assignmentId));
        res.json({ message: 'تم حذف الواجب' });
    }
    catch {
        res.status(500).json({ error: 'خطأ في الحذف' });
    }
});
// 9. Toggle Lesson Visibility
router.put('/lessons/:lessonId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), checkWriteAccess, async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        const { is_visible } = req.body;
        if (typeof is_visible !== 'boolean') {
            return res.status(400).json({ error: 'is_visible must be a boolean' });
        }
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.toggleLessonVisibility(lessonId, is_visible);
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا أصبح visible)
        if (is_visible) {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
                if (subject) {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    await NotificationService.notifyPackageLessonAdded(subject.package_id, 
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    lesson.subject_id, lessonId, 
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    lesson.name, subject.name, true);
                }
            }
            catch (notifError) {
                utils_1.logger.error('Error sending notification:', notifError);
            }
        }
        res.json({ message: 'تم تحديث حالة الظهور', lesson });
    }
    catch {
        res.status(500).json({ error: 'خطأ في التحديث' });
    }
});
// 10. Toggle Assignment Visibility
router.put('/assignments/:assignmentId/visibility', (0, authentication_1.authMiddleware)(['admin', 'teacher']), async (req, res) => {
    try {
        // Permission check similar to others (needs improvement for strict teacher ownership)
        const user = req.user;
        if (user.role !== 'admin' && user.role !== 'teacher')
            return res.status(403).json({ error: 'Unauthorized' });
        const assignmentId = parseInt(req.params.assignmentId);
        const { is_visible } = req.body;
        if (typeof is_visible !== 'boolean') {
            return res.status(400).json({ error: 'is_visible must be a boolean' });
        }
        const assignment = await packageSubjectLessons_1.PackageSubjectLessonService.toggleAssignmentVisibility(assignmentId, is_visible);
        // إرسال إشعار للطلاب المشتركين في الباقة (فقط إذا أصبح visible)
        if (is_visible) {
            try {
                // جلب معلومات الواجب والدرس
                const assignmentResult = await pool_1.default.query('SELECT * FROM package_subject_assignments WHERE id = $1', [assignmentId]);
                if (assignmentResult.rows.length > 0) {
                    const assignmentData = assignmentResult.rows[0];
                    const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLesson(assignmentData.lesson_id);
                    if (lesson) {
                        const subject = await packageSubjectItems_1.PackageSubjectItemService.getPackageSubjectItem(lesson.subject_id);
                        if (subject) {
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            const { NotificationService } = await import('../services/notifications');
                            await NotificationService.notifyPackageAssignmentAdded(subject.package_id, lesson.subject_id, assignmentData.lesson_id, assignmentId, 
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            assignment.name, lesson.name, subject.name, true);
                        }
                    }
                }
            }
            catch (notifError) {
                utils_1.logger.error('Error sending notification:', notifError);
            }
        }
        res.json({ message: 'تم تحديث حالة الظهور', assignment });
    }
    catch {
        res.status(500).json({ error: 'خطأ في التحديث' });
    }
});
