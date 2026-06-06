import pool from '../db/pool';

export interface LessonExamData {
  title: string;
  duration: number;
  total_marks: number;
}

export class PackageSubjectLessonExamsService {
  static async getExamsByLesson(lessonId: number, forStudent: boolean = false) {
    let query = `
      SELECT * FROM package_subject_item_lesson_exams
      WHERE lesson_id = $1
    `;
    if (forStudent) query += ` AND is_visible = true`;
    query += ` ORDER BY created_at ASC`;
    const res = await pool.query(query, [lessonId]);
    return res.rows;
  }

  static async getExamById(examId: number) {
    const res = await pool.query(
      `SELECT * FROM package_subject_item_lesson_exams WHERE id = $1`,
      [examId]
    );
    return res.rows[0] || null;
  }

  static async createExam(lessonId: number, data: LessonExamData) {
    const res = await pool.query(
      `INSERT INTO package_subject_item_lesson_exams (lesson_id, title, duration_minutes, total_marks, is_visible)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [lessonId, data.title, data.duration ?? 0, data.total_marks ?? 0, false]
    );
    return res.rows[0];
  }

  static async updateExam(
    examId: number,
    data: Partial<LessonExamData & { is_visible?: boolean }>
  ) {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (data.title !== undefined) {
      updates.push(`title = $${i++}`);
      values.push(data.title);
    }
    if (data.duration !== undefined) {
      updates.push(`duration_minutes = $${i++}`);
      values.push(data.duration ?? 0);
    }
    if (data.total_marks !== undefined) {
      updates.push(`total_marks = $${i++}`);
      values.push(data.total_marks ?? 0);
    }
    if (data.is_visible !== undefined) {
      updates.push(`is_visible = $${i++}`);
      values.push(data.is_visible);
    }

    if (!updates.length) return await this.getExamById(examId);

    updates.push(`updated_at = NOW()`);
    values.push(examId);

    const res = await pool.query(
      `UPDATE package_subject_item_lesson_exams
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async deleteExam(examId: number) {
    const res = await pool.query(
      `DELETE FROM package_subject_item_lesson_exams WHERE id = $1 RETURNING *`,
      [examId]
    );
    return res.rows[0] || null;
  }

  static async toggleExamVisibility(examId: number, isVisible: boolean) {
    const res = await pool.query(
      `UPDATE package_subject_item_lesson_exams
       SET is_visible = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [isVisible, examId]
    );
    return res.rows[0] || null;
  }
}












