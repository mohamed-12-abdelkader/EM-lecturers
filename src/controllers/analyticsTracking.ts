import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { AnalyticsTrackingService } from '../services/analyticsTracking';

export const router = Router();

function tenantIdOrDefault(reqTenantId: number | undefined): number {
  return reqTenantId ?? 1;
}

router.post(
  '/video/session/start',
  authMiddleware(['student', 'admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      student_id: z.coerce.number().int().positive().optional(),
      teacher_id: z.coerce.number().int().positive().optional(),
      course_id: z.coerce.number().int().positive().optional(),
      lecture_id: z.coerce.number().int().positive().optional(),
      video_id: z.coerce.number().int().positive().optional(),
      session_key: z.string().min(3).optional(),
      source: z.string().min(2).optional(),
      device_id: z.string().min(2).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid payload');

    const user = req.user!;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId) throw new HttpError(400, 'student_id is required');

    const session = await AnalyticsTrackingService.startVideoSession({
      tenantId: tenantIdOrDefault(req.tenant?.id),
      studentId,
      teacherId: body.teacher_id ?? null,
      courseId: body.course_id ?? null,
      lectureId: body.lecture_id ?? null,
      videoId: body.video_id ?? null,
      sessionKey: body.session_key ?? null,
      source: body.source ?? 'player',
      deviceId: body.device_id ?? null,
    });

    res.status(201).json({ success: true, data: session });
  }),
);

router.post(
  '/video/event',
  authMiddleware(['student', 'admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      session_id: z.coerce.number().int().positive(),
      student_id: z.coerce.number().int().positive().optional(),
      event_type: z.enum(['play', 'pause', 'progress', 'seek', 'complete', 'heartbeat']),
      video_second: z.coerce.number().int().nonnegative().optional(),
      from_second: z.coerce.number().int().nonnegative().optional(),
      to_second: z.coerce.number().int().nonnegative().optional(),
      playback_rate: z.coerce.number().positive().optional(),
      metadata: z.record(z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid payload');

    const user = req.user!;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId) throw new HttpError(400, 'student_id is required');

    await AnalyticsTrackingService.trackWatchEvent({
      tenantId: tenantIdOrDefault(req.tenant?.id),
      sessionId: body.session_id,
      studentId,
      eventType: body.event_type,
      videoSecond: body.video_second ?? 0,
      fromSecond: body.from_second ?? null,
      toSecond: body.to_second ?? null,
      playbackRate: body.playback_rate ?? 1,
      metadata: body.metadata ?? {},
    });

    res.json({ success: true, message: 'Event tracked' });
  }),
);

router.post(
  '/video/session/end',
  authMiddleware(['student', 'admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      session_id: z.coerce.number().int().positive(),
      student_id: z.coerce.number().int().positive().optional(),
      total_watch_seconds: z.coerce.number().int().nonnegative().optional(),
      completion_percentage: z.coerce.number().min(0).max(100).optional(),
      is_completed: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid payload');

    const user = req.user!;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId) throw new HttpError(400, 'student_id is required');

    const session = await AnalyticsTrackingService.endVideoSession({
      tenantId: tenantIdOrDefault(req.tenant?.id),
      sessionId: body.session_id,
      studentId,
      totalWatchSeconds: body.total_watch_seconds,
      completionPercentage: body.completion_percentage,
      isCompleted: body.is_completed,
    });

    res.json({ success: true, data: session });
  }),
);

router.post(
  '/activity',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      student_id: z.coerce.number().int().positive().optional(),
      action_type: z.string().min(2),
      course_id: z.coerce.number().int().positive().optional(),
      lecture_id: z.coerce.number().int().positive().optional(),
      exam_id: z.coerce.number().int().positive().optional(),
      meeting_id: z.string().min(1).optional(),
      duration_seconds: z.coerce.number().int().nonnegative().optional(),
      metadata: z.record(z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, 'Invalid payload');

    const user = req.user!;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId) throw new HttpError(400, 'student_id is required');

    await AnalyticsTrackingService.logStudentActivity({
      tenantId: tenantIdOrDefault(req.tenant?.id),
      studentId,
      actionType: body.action_type,
      courseId: body.course_id ?? null,
      lectureId: body.lecture_id ?? null,
      examId: body.exam_id ?? null,
      meetingId: body.meeting_id ?? null,
      durationSeconds: body.duration_seconds ?? 0,
      metadata: body.metadata ?? {},
    });

    res.status(201).json({ success: true, message: 'Activity logged' });
  }),
);
