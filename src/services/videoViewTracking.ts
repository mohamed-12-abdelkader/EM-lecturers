import pool from '../db/pool';
import { StudentPointsService } from './studentPoints';
import { syncLectureWatchCompletion } from './watchProgress';

export interface TrackVideoViewInput {
  userId: number;
  videoId: number;
  lectureId: number;
  courseId: number;
  lectureTitle?: string;
  watchDuration?: number;
  completionPercentage?: number;
  isCompleted?: boolean;
  updateProgress?: boolean;
}

export interface TrackVideoViewResult {
  viewTracked: boolean;
  lectureViewTracked: boolean;
  isFirstVideoView: boolean;
  lecturePointsAwarded: boolean;
  lectureWatchPercentage: number;
}

export class VideoViewTrackingService {
  static async trackStudentVideoView(
    input: TrackVideoViewInput,
  ): Promise<TrackVideoViewResult> {
    const {
      userId,
      videoId,
      lectureId,
      courseId,
      lectureTitle,
      watchDuration = 0,
      completionPercentage = 0,
      isCompleted = false,
      updateProgress = false,
    } = input;

    const existingView = await pool.query(
      'SELECT id FROM video_views WHERE user_id = $1 AND video_id = $2',
      [userId, videoId],
    );
    const isFirstVideoView = existingView.rows.length === 0;

    if (updateProgress) {
      await pool.query(
        `INSERT INTO video_views (user_id, video_id, lecture_id, course_id, watch_duration, completion_percentage, is_completed, viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, video_id)
         DO UPDATE SET
           watch_duration = EXCLUDED.watch_duration,
           completion_percentage = EXCLUDED.completion_percentage,
           is_completed = EXCLUDED.is_completed,
           viewed_at = NOW(),
           updated_at = NOW()`,
        [userId, videoId, lectureId, courseId, watchDuration, completionPercentage, isCompleted],
      );
    } else {
      await pool.query(
        `INSERT INTO video_views (user_id, video_id, lecture_id, course_id, watch_duration, completion_percentage, is_completed, viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (user_id, video_id)
         DO UPDATE SET
           viewed_at = NOW(),
           updated_at = NOW()`,
        [userId, videoId, lectureId, courseId, watchDuration, completionPercentage, isCompleted],
      );
    }

    await pool.query(
      `INSERT INTO lecture_views (user_id, lecture_id, viewed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, lecture_id)
       DO UPDATE SET viewed_at = NOW()`,
      [userId, lectureId],
    );

    const lectureWatchPercentage = await syncLectureWatchCompletion(userId, lectureId);

    let lecturePointsAwarded = false;
    try {
      const hasPoints = await StudentPointsService.hasLecturePoints(userId, lectureId);

      if (!hasPoints) {
        const lectureVideosCount = await pool.query(
          `SELECT COUNT(DISTINCT vv.video_id) as watched_count
           FROM video_views vv
           WHERE vv.user_id = $1 AND vv.lecture_id = $2`,
          [userId, lectureId],
        );

        const totalVideosCount = await pool.query(
          `SELECT COUNT(*) as total_count
           FROM lecture_videos
           WHERE lecture_id = $1`,
          [lectureId],
        );

        const watchedCount = parseInt(lectureVideosCount.rows[0].watched_count) || 0;
        const totalCount = parseInt(totalVideosCount.rows[0].total_count) || 0;
        const watchPercentage = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;

        if (watchPercentage >= 33.33 || watchedCount > 0) {
          await StudentPointsService.addLectureWatchPoints(userId, lectureId, lectureTitle);
          lecturePointsAwarded = true;
        }
      }
    } catch (pointsError) {
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
