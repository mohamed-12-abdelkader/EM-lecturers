"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsTrackingService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
class AnalyticsTrackingService {
    static async startVideoSession(input) {
        const r = await pool_1.default.query(`INSERT INTO analytics_video_sessions
       (tenant_id, student_id, teacher_id, course_id, lecture_id, video_id, session_key, source, device_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, started_at`, [
            input.tenantId,
            input.studentId,
            input.teacherId ?? null,
            input.courseId ?? null,
            input.lectureId ?? null,
            input.videoId ?? null,
            input.sessionKey ?? null,
            input.source ?? 'player',
            input.deviceId ?? null,
        ]);
        return r.rows[0];
    }
    static async trackWatchEvent(input) {
        const session = await pool_1.default.query(`SELECT id FROM analytics_video_sessions
       WHERE id = $1 AND tenant_id = $2 AND student_id = $3
       LIMIT 1`, [input.sessionId, input.tenantId, input.studentId]);
        if (!session.rowCount)
            throw new utils_1.HttpError(404, 'Video session not found');
        await pool_1.default.query(`INSERT INTO analytics_watch_events
       (tenant_id, session_id, student_id, event_type, video_second, from_second, to_second, playback_rate, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`, [
            input.tenantId,
            input.sessionId,
            input.studentId,
            input.eventType,
            input.videoSecond ?? 0,
            input.fromSecond ?? null,
            input.toSecond ?? null,
            input.playbackRate ?? 1,
            JSON.stringify(input.metadata ?? {}),
        ]);
        if (input.eventType === 'progress' || input.eventType === 'complete') {
            await pool_1.default.query(`UPDATE analytics_video_sessions
         SET total_watch_seconds = GREATEST(total_watch_seconds, $1),
             completion_percentage = GREATEST(completion_percentage, $2),
             is_completed = CASE WHEN $3 = true THEN true ELSE is_completed END,
             updated_at = NOW()
         WHERE id = $4`, [
                Number(input.metadata?.totalWatchSeconds ?? 0),
                Number(input.metadata?.completionPercentage ?? 0),
                input.eventType === 'complete',
                input.sessionId,
            ]);
        }
    }
    static async endVideoSession(input) {
        const r = await pool_1.default.query(`UPDATE analytics_video_sessions
       SET ended_at = NOW(),
           total_watch_seconds = COALESCE($1, total_watch_seconds),
           completion_percentage = COALESCE($2, completion_percentage),
           is_completed = COALESCE($3, is_completed),
           updated_at = NOW()
       WHERE id = $4
         AND tenant_id = $5
         AND student_id = $6
       RETURNING id, ended_at, total_watch_seconds, completion_percentage, is_completed`, [
            input.totalWatchSeconds ?? null,
            input.completionPercentage ?? null,
            input.isCompleted ?? null,
            input.sessionId,
            input.tenantId,
            input.studentId,
        ]);
        if (!r.rowCount)
            throw new utils_1.HttpError(404, 'Video session not found');
        return r.rows[0];
    }
    static async logStudentActivity(input) {
        await pool_1.default.query(`INSERT INTO analytics_student_activity_logs
       (tenant_id, student_id, action_type, course_id, lecture_id, exam_id, meeting_id, duration_seconds, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`, [
            input.tenantId,
            input.studentId,
            input.actionType,
            input.courseId ?? null,
            input.lectureId ?? null,
            input.examId ?? null,
            input.meetingId ?? null,
            input.durationSeconds ?? 0,
            JSON.stringify(input.metadata ?? {}),
        ]);
    }
}
exports.AnalyticsTrackingService = AnalyticsTrackingService;
