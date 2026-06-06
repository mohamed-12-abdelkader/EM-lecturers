import pool from '../db/pool';

export interface LessonFileData {
  title: string;
  file_url: string;
  order_index?: number;
}

export class PackageSubjectLessonFilesService {
  static async getFilesByLesson(lessonId: number) {
    const res = await pool.query(
      `SELECT * FROM package_subject_item_lesson_files
       WHERE lesson_id = $1
       ORDER BY order_index ASC, created_at ASC`,
      [lessonId]
    );
    return res.rows;
  }

  static async getFileById(fileId: number) {
    const res = await pool.query(
      `SELECT * FROM package_subject_item_lesson_files WHERE id = $1`,
      [fileId]
    );
    return res.rows[0] || null;
  }

  static async createFile(lessonId: number, data: LessonFileData) {
    const res = await pool.query(
      `INSERT INTO package_subject_item_lesson_files (lesson_id, title, file_url, order_index)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [lessonId, data.title, data.file_url, data.order_index ?? 0]
    );
    return res.rows[0];
  }

  static async updateFile(fileId: number, data: Partial<LessonFileData>) {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${i++}`);
      values.push(data.title);
    }
    if (data.file_url !== undefined) {
      updates.push(`file_url = $${i++}`);
      values.push(data.file_url);
    }
    if (data.order_index !== undefined) {
      updates.push(`order_index = $${i++}`);
      values.push(data.order_index ?? 0);
    }

    if (!updates.length) return await this.getFileById(fileId);

    updates.push(`updated_at = NOW()`);
    values.push(fileId);

    const res = await pool.query(
      `UPDATE package_subject_item_lesson_files
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async deleteFile(fileId: number) {
    const res = await pool.query(
      `DELETE FROM package_subject_item_lesson_files WHERE id = $1 RETURNING *`,
      [fileId]
    );
    return res.rows[0] || null;
  }
}












