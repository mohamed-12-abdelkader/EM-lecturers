import { Router, Request } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherVideoPlaybackService } from '../services/teacherVideoPlayback';

export const router = Router();

const UpdateSchema = z.object({
  video_playback_mode: z.enum(['website', 'player_app']),
});

function resolveTenantId(req: Request): number {
  const tenantId = req.tenant?.id;
  if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');
  return tenantId;
}

/**
 * GET /api/teacher/video-playback-settings
 * جلب إعداد عرض الفيديوهات لمنصة المدرس
 */
router.get(
  '/',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const settings = await TeacherVideoPlaybackService.getSettings(resolveTenantId(req));
    res.json({
      success: true,
      data: settings,
      options: [
        {
          value: 'website',
          label_ar: 'عرض داخل الموقع',
          description_ar: 'يشاهد الطالب الفيديو مباشرة من الموقع أو المتصفح.',
        },
        {
          value: 'player_app',
          label_ar: 'عرض داخل تطبيق الفيديوهات',
          description_ar:
            'لحماية المحتوى: يتم إخفاء رابط الفيديو من الموقع ويُشغَّل فقط عبر تطبيق عرض الفيديوهات.',
        },
      ],
    });
  }),
);

/**
 * PUT /api/teacher/video-playback-settings
 * تحديث إعداد عرض الفيديوهات
 *
 * Body:
 * { "video_playback_mode": "website" | "player_app" }
 */
router.put(
  '/',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const parsed = UpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const settings = await TeacherVideoPlaybackService.setSettings(
      resolveTenantId(req),
      parsed.data,
    );

    res.json({
      success: true,
      message:
        settings.video_playback_mode === 'player_app'
          ? 'تم تفعيل عرض الفيديوهات عبر التطبيق فقط'
          : 'تم تفعيل عرض الفيديوهات داخل الموقع',
      data: settings,
    });
  }),
);
