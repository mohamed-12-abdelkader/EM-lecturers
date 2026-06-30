"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VideoViewTrackingService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const studentPoints_1 = require("./studentPoints");
const watchProgress_1 = require("./watchProgress");
class VideoViewTrackingService {
    static async trackStudentVideoView(input) {
        const { userId, videoId, lectureId, courseId, lectureTitle, watchDuration = 0, completionPercentage = 0, isCompleted = false, updateProgress = false, } = input;
        const existingView = await pool_1.default.query('SELECT id FROM video_views WHERE user_id = $1 AND video_id = $2', [userId, videoId]);
        const isFirstVideoView = existingView.rows.length === 0;
        if (updateProgress) {
            await pool_1.default.query(`INSERT INTO video_views (user_id, video_id, lecture_id, course_id, watch_duration, completion_percentage, is_completed, viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, video_id)
         DO UPDATE SET
           watch_duration = EXCLUDED.watch_duration,
           completion_percentage = EXCLUDED.completion_percentage,
           is_completed = EXCLUDED.is_completed,
           viewed_at = NOW(),
           updated_at = NOW()`, [userId, videoId, lectureId, courseId, watchDuration, completionPercentage, isCompleted]);
        }
        else {
            await pool_1.default.query(`INSERT INTO video_views (user_id, video_id, lecture_id, course_id, watch_duration, completion_percentage, is_completed, viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, video_id)
         DO UPDATE SET
           viewed_at = NOW(),
           updated_at = NOW()`, [userId, videoId, lectureId, courseId, watchDuration, completionPercentage, isCompleted]);
        }
        await pool_1.default.query(`INSERT INTO lecture_views (user_id, lecture_id, viewed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, lecture_id)
       DO UPDATE SET viewed_at = NOW()`, [userId, lectureId]);
        const lectureWatchPercentage = await (0, watchProgress_1.syncLectureWatchCompletion)(userId, lectureId);
        let lecturePointsAwarded = false;
        try {
            const hasPoints = await studentPoints_1.StudentPointsService.hasLecturePoints(userId, lectureId);
            if (!hasPoints) {
                const lectureVideosCount = await pool_1.default.query(`SELECT COUNT(DISTINCT vv.video_id) as watched_count
           FROM video_views vv
           WHERE vv.user_id = $1 AND vv.lecture_id = $2`, [userId, lectureId]);
                const totalVideosCount = await pool_1.default.query(`SELECT COUNT(*) as total_count
           FROM lecture_videos
           WHERE lecture_id = $1`, [lectureId]);
                const watchedCount = parseInt(lectureVideosCount.rows[0].watched_count) || 0;
                const totalCount = parseInt(totalVideosCount.rows[0].total_count) || 0;
                const watchPercentage = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;
                if (watchPercentage >= 33.33 || watchedCount > 0) {
                    await studentPoints_1.StudentPointsService.addLectureWatchPoints(userId, lectureId, lectureTitle);
                    lecturePointsAwarded = true;
                }
            }
        }
        catch (pointsError) {
            console.error('Error adding lecture points:', pointsError);
        }
        return {
            viewTracked: true,
            lectureViewTracked: true,
            isFirstVideoView,
            lecturePointsAwarded,
            lectureWatchPercentage,
        };
    }
}
exports.VideoViewTrackingService = VideoViewTrackingService;
