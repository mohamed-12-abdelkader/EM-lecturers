import pool from '../db/pool';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Video } from './packageSubjectLessons';

export class PackageSubjectVideosService {
  // جلب جميع الفيديوهات لدرس معين
  static async getVideosByLesson(lessonId: number) {
    const result = await pool.query(
      `SELECT * FROM package_subject_item_lesson_videos
       WHERE lesson_id = $1
       ORDER BY order_index ASC, created_at ASC`,
      [lessonId],
    );
    return result.rows;
  }

  // جلب فيديو محدد
  static async getVideoById(videoId: number) {
    const result = await pool.query(
      'SELECT * FROM package_subject_item_lesson_videos WHERE id = $1',
      [videoId],
    );
    return result.rows[0] || null;
  }

  // إضافة فيديو لدرس
  static async createVideo(lessonId: number, data: any) {
    const result = await pool.query(
      `INSERT INTO package_subject_item_lesson_videos
       (lesson_id, title, video_url, duration_minutes, order_index)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [lessonId, data.title, data.video_url, data.duration_minutes || null, data.order_index || 0],
    );
    return result.rows[0];
  }

  // تحديث فيديو
  static async updateVideo(videoId: number, data: Partial<any>) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.video_url !== undefined) {
      updates.push(`video_url = $${paramIndex++}`);
      values.push(data.video_url);
    }
    if (data.duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramIndex++}`);
      values.push(data.duration_minutes || null);
    }
    if (data.order_index !== undefined) {
      updates.push(`order_index = $${paramIndex++}`);
      values.push(data.order_index);
    }

    if (updates.length === 0) {
      return await this.getVideoById(videoId);
    }

    updates.push(`updated_at = NOW()`);
    values.push(videoId);

    const result = await pool.query(
      `UPDATE package_subject_item_lesson_videos
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values,
    );

    return result.rows[0] || null;
  }

  // حذف فيديو
  static async deleteVideo(videoId: number) {
    const result = await pool.query(
      'DELETE FROM package_subject_item_lesson_videos WHERE id = $1 RETURNING *',
      [videoId],
    );
    return result.rows[0] || null;
  }
}
