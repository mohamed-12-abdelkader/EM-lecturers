"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const packageSubjectVideos_1 = require("../services/packageSubjectVideos");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectGroups_1 = require("../services/packageSubjectGroups");
const zod_1 = require("zod");
const router = (0, express_1.Router)();
exports.router = router;
// Schema للتحقق من البيانات
const CreateVideoSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, 'عنوان الفيديو مطلوب'),
    video_url: zod_1.z.string().url('رابط الفيديو غير صحيح'),
    duration_minutes: zod_1.z.number().int().min(0).optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
const UpdateVideoSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).optional(),
    video_url: zod_1.z.string().url().optional(),
    duration_minutes: zod_1.z.number().int().min(0).optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
});
// Helper function للتحقق من صلاحية المدرس على الدرس
async function checkLessonPermission(lessonId, userId, userRole) {
    if (userRole === 'admin') {
        return true;
    }
    if (userRole === 'teacher') {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
        if (!lesson?.group_id)
            return false;
        return await packageSubjectGroups_1.PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
    }
    return false;
}
// 1. إضافة فيديو للدرس
router.post('/lessons/:lessonId/videos', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const lessonId = parseInt(req.params.lessonId);
        if (isNaN(lessonId)) {
            return res.status(400).json({ error: 'Invalid lesson ID' });
        }
        // التحقق من وجود الدرس
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(lessonId);
        if (!lesson) {
            return res.status(404).json({ error: 'الدرس غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(lessonId, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لإضافة فيديو لهذا الدرس',
            });
        }
        // التحقق من صحة البيانات
        const parse = CreateVideoSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const video = await packageSubjectVideos_1.PackageSubjectVideosService.createVideo(lessonId, parse.data);
        res.status(201).json({
            success: true,
            message: 'تم إضافة الفيديو بنجاح',
            video,
        });
    }
    catch (error) {
        console.error('Error creating video:', error);
        res.status(500).json({ error: 'خطأ في إضافة الفيديو', message: error.message });
    }
}));
// 2. تحديث فيديو
router.put('/videos/:videoId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const videoId = parseInt(req.params.videoId);
        if (isNaN(videoId)) {
            return res.status(400).json({ error: 'Invalid video ID' });
        }
        // التحقق من وجود الفيديو
        const existingVideo = await packageSubjectVideos_1.PackageSubjectVideosService.getVideoById(videoId);
        if (!existingVideo) {
            return res.status(404).json({ error: 'الفيديو غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(existingVideo.lesson_id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لتعديل هذا الفيديو',
            });
        }
        // التحقق من صحة البيانات
        const parse = UpdateVideoSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const updatedVideo = await packageSubjectVideos_1.PackageSubjectVideosService.updateVideo(videoId, parse.data);
        res.json({
            success: true,
            message: 'تم تحديث الفيديو بنجاح',
            video: updatedVideo,
        });
    }
    catch (error) {
        console.error('Error updating video:', error);
        res.status(500).json({ error: 'خطأ في تحديث الفيديو', message: error.message });
    }
}));
// 3. حذف فيديو
router.delete('/videos/:videoId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const videoId = parseInt(req.params.videoId);
        if (isNaN(videoId)) {
            return res.status(400).json({ error: 'Invalid video ID' });
        }
        // التحقق من وجود الفيديو
        const existingVideo = await packageSubjectVideos_1.PackageSubjectVideosService.getVideoById(videoId);
        if (!existingVideo) {
            return res.status(404).json({ error: 'الفيديو غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkLessonPermission(existingVideo.lesson_id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لحذف هذا الفيديو',
            });
        }
        await packageSubjectVideos_1.PackageSubjectVideosService.deleteVideo(videoId);
        res.json({
            success: true,
            message: 'تم حذف الفيديو بنجاح',
        });
    }
    catch (error) {
        console.error('Error deleting video:', error);
        res.status(500).json({ error: 'خطأ في حذف الفيديو', message: error.message });
    }
}));
