import pool from '../db/pool';
import { TeacherPointsService } from './teacherPoints';
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
      // First view of this video only — idempotent reference_key prevents duplicates
      if (isFirstVideoView) {
        const teacherId = await TeacherPointsService.resolveTeacherIdForCourse(courseId);
        if (teacherId) {
          const result = await TeacherPointsService.awardVideoWatch({
            studentId: userId,
            teacherId,
            courseId,
            videoId,
            lectureId,
            lectureTitle,
          });
          lecturePointsAwarded = result.awarded;
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
