import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectVideosService } from '../services/packageSubjectVideos';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { z } from 'zod';

const router = Router();

// Schema للتحقق من البيانات
const CreateVideoSchema = z.object({
  title: z.string().min(1, 'عنوان الفيديو مطلوب'),
  video_url: z.string().url('رابط الفيديو غير صحيح'),
  duration_minutes: z.number().int().min(0).optional(),
  order_index: z.number().int().min(0).optional(),
});

const UpdateVideoSchema = z.object({
  title: z.string().min(1).optional(),
  video_url: z.string().url().optional(),
  duration_minutes: z.number().int().min(0).optional(),
  order_index: z.number().int().min(0).optional(),
});

// Helper function للتحقق من صلاحية المدرس على الدرس
async function checkLessonPermission(lessonId: number, userId: number, userRole: string) {
  if (userRole === 'admin') {
    return true;
  }

  if (userRole === 'teacher') {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
    if (!lesson?.group_id) return false;
    return await PackageSubjectGroupsService.teacherOwnsGroup(lesson.group_id, userId);
  }

  return false;
}

// 1. إضافة فيديو للدرس
router.post(
  '/lessons/:lessonId/videos',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const lessonId = parseInt(req.params.lessonId);
      if (isNaN(lessonId)) {
        return res.status(400).json({ error: 'Invalid lesson ID' });
      }

      // التحقق من وجود الدرس
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const lesson = await PackageSubjectLessonService.getLessonById(lessonId);
      if (!lesson) {
        return res.status(404).json({ error: 'الدرس غير موجود' });
      }

      const user = (req as any).user;

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

      const video = await PackageSubjectVideosService.createVideo(lessonId, parse.data);

      res.status(201).json({
        success: true,
        message: 'تم إضافة الفيديو بنجاح',
        video,
      });
    } catch (error: any) {
      console.error('Error creating video:', error);
      res.status(500).json({ error: 'خطأ في إضافة الفيديو', message: error.message });
    }
  }),
);

// 2. تحديث فيديو
router.put(
  '/videos/:videoId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const videoId = parseInt(req.params.videoId);
      if (isNaN(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID' });
      }

      // التحقق من وجود الفيديو
      const existingVideo = await PackageSubjectVideosService.getVideoById(videoId);
      if (!existingVideo) {
        return res.status(404).json({ error: 'الفيديو غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(
        existingVideo.lesson_id,
        user.id,
        user.role,
      );
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

      const updatedVideo = await PackageSubjectVideosService.updateVideo(videoId, parse.data);

      res.json({
        success: true,
        message: 'تم تحديث الفيديو بنجاح',
        video: updatedVideo,
      });
    } catch (error: any) {
      console.error('Error updating video:', error);
      res.status(500).json({ error: 'خطأ في تحديث الفيديو', message: error.message });
    }
  }),
);

// 3. حذف فيديو
router.delete(
  '/videos/:videoId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    try {
      const videoId = parseInt(req.params.videoId);
      if (isNaN(videoId)) {
        return res.status(400).json({ error: 'Invalid video ID' });
      }

      // التحقق من وجود الفيديو
      const existingVideo = await PackageSubjectVideosService.getVideoById(videoId);
      if (!existingVideo) {
        return res.status(404).json({ error: 'الفيديو غير موجود' });
      }

      const user = (req as any).user;

      // التحقق من الصلاحيات
      const hasPermission = await checkLessonPermission(
        existingVideo.lesson_id,
        user.id,
        user.role,
      );
      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'ليس لديك صلاحية لحذف هذا الفيديو',
        });
      }

      await PackageSubjectVideosService.deleteVideo(videoId);

      res.json({
        success: true,
        message: 'تم حذف الفيديو بنجاح',
      });
    } catch (error: any) {
      console.error('Error deleting video:', error);
      res.status(500).json({ error: 'خطأ في حذف الفيديو', message: error.message });
    }
  }),
);

export { router };
