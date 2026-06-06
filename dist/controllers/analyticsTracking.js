"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const analyticsTracking_1 = require("../services/analyticsTracking");
exports.router = (0, express_1.Router)();
function tenantIdOrDefault(reqTenantId) {
    return reqTenantId ?? 1;
}
exports.router.post('/video/session/start', (0, authentication_1.authMiddleware)(['student', 'admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        student_id: zod_1.z.coerce.number().int().positive().optional(),
        teacher_id: zod_1.z.coerce.number().int().positive().optional(),
        course_id: zod_1.z.coerce.number().int().positive().optional(),
        lecture_id: zod_1.z.coerce.number().int().positive().optional(),
        video_id: zod_1.z.coerce.number().int().positive().optional(),
        session_key: zod_1.z.string().min(3).optional(),
        source: zod_1.z.string().min(2).optional(),
        device_id: zod_1.z.string().min(2).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new utils_1.HttpError(400, 'Invalid payload');
    const user = req.user;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId)
        throw new utils_1.HttpError(400, 'student_id is required');
    const session = await analyticsTracking_1.AnalyticsTrackingService.startVideoSession({
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
}));
exports.router.post('/video/event', (0, authentication_1.authMiddleware)(['student', 'admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        session_id: zod_1.z.coerce.number().int().positive(),
        student_id: zod_1.z.coerce.number().int().positive().optional(),
        event_type: zod_1.z.enum(['play', 'pause', 'progress', 'seek', 'complete', 'heartbeat']),
        video_second: zod_1.z.coerce.number().int().nonnegative().optional(),
        from_second: zod_1.z.coerce.number().int().nonnegative().optional(),
        to_second: zod_1.z.coerce.number().int().nonnegative().optional(),
        playback_rate: zod_1.z.coerce.number().positive().optional(),
        metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new utils_1.HttpError(400, 'Invalid payload');
    const user = req.user;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId)
        throw new utils_1.HttpError(400, 'student_id is required');
    await analyticsTracking_1.AnalyticsTrackingService.trackWatchEvent({
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
}));
exports.router.post('/video/session/end', (0, authentication_1.authMiddleware)(['student', 'admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        session_id: zod_1.z.coerce.number().int().positive(),
        student_id: zod_1.z.coerce.number().int().positive().optional(),
        total_watch_seconds: zod_1.z.coerce.number().int().nonnegative().optional(),
        completion_percentage: zod_1.z.coerce.number().min(0).max(100).optional(),
        is_completed: zod_1.z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new utils_1.HttpError(400, 'Invalid payload');
    const user = req.user;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId)
        throw new utils_1.HttpError(400, 'student_id is required');
    const session = await analyticsTracking_1.AnalyticsTrackingService.endVideoSession({
        tenantId: tenantIdOrDefault(req.tenant?.id),
        sessionId: body.session_id,
        studentId,
        totalWatchSeconds: body.total_watch_seconds,
        completionPercentage: body.completion_percentage,
        isCompleted: body.is_completed,
    });
    res.json({ success: true, data: session });
}));
exports.router.post('/activity', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        student_id: zod_1.z.coerce.number().int().positive().optional(),
        action_type: zod_1.z.string().min(2),
        course_id: zod_1.z.coerce.number().int().positive().optional(),
        lecture_id: zod_1.z.coerce.number().int().positive().optional(),
        exam_id: zod_1.z.coerce.number().int().positive().optional(),
        meeting_id: zod_1.z.string().min(1).optional(),
        duration_seconds: zod_1.z.coerce.number().int().nonnegative().optional(),
        metadata: zod_1.z.record(zod_1.z.unknown()).optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        throw new utils_1.HttpError(400, 'Invalid payload');
    const user = req.user;
    const body = parsed.data;
    const studentId = user.role === 'student' ? user.id : body.student_id;
    if (!studentId)
        throw new utils_1.HttpError(400, 'student_id is required');
    await analyticsTracking_1.AnalyticsTrackingService.logStudentActivity({
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
}));
