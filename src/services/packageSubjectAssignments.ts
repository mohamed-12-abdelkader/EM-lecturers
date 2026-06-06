import pool from '../db/pool';
import { Assignment } from './packageSubjectLessons';

export class PackageSubjectAssignmentsService {
  // جلب جميع الواجبات لدرس معين
  static async getAssignmentsByLesson(lessonId: number, forStudent: boolean = false) {
    let query = `
      SELECT * FROM package_subject_item_lesson_assignments
      WHERE lesson_id = $1
    `;

    // للطلاب: عرض فقط الواجبات المرئية
    if (forStudent) {
      query += ` AND is_visible = true`;
    }

    query += ` ORDER BY created_at ASC`;

    const result = await pool.query(query, [lessonId]);
    return result.rows;
  }

  // جلب واجب محدد
  static async getAssignmentById(assignmentId: number) {
    const result = await pool.query(
      'SELECT * FROM package_subject_item_lesson_assignments WHERE id = $1',
      [assignmentId],
    );
    return result.rows[0] || null;
  }

  // إضافة واجب لدرس
  static async createAssignment(lessonId: number, data: Assignment) {
    const result = await pool.query(
      `INSERT INTO package_subject_item_lesson_assignments
       (lesson_id, name, questions_count, duration_minutes, is_visible)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        lessonId,
        data.name,
        data.question_count || 0,
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        data.duration_minutes || 0,
        false, // الواجب يكون مخفي افتراضياً
      ],
    );
    return result.rows[0];
  }

  // تحديث واجب
  static async updateAssignment(
    assignmentId: number,
    data: Partial<Assignment & { is_visible?: boolean }>,
  ) {
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.question_count !== undefined) {
      updates.push(`questions_count = $${paramIndex++}`);
      values.push(data.question_count);
    }
     // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
    if (data.duration_minutes !== undefined) {
      updates.push(`duration_minutes = $${paramIndex++}`);
       // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
      values.push(data.duration_minutes);
    }
    if (data.is_visible !== undefined) {
      updates.push(`is_visible = $${paramIndex++}`);
      values.push(data.is_visible);
    }

    if (updates.length === 0) {
      return await this.getAssignmentById(assignmentId);
    }

    updates.push(`updated_at = NOW()`);
    values.push(assignmentId);

    const result = await pool.query(
      `UPDATE package_subject_item_lesson_assignments
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      values,
    );

    return result.rows[0] || null;
  }

  // التحكم في إظهار/إخفاء الواجب
  static async toggleAssignmentVisibility(assignmentId: number, isVisible: boolean) {
    const result = await pool.query(
      `UPDATE package_subject_item_lesson_assignments 
       SET is_visible = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [isVisible, assignmentId],
    );
    return result.rows[0] || null;
  }

  // حذف واجب
  static async deleteAssignment(assignmentId: number) {
    const result = await pool.query(
      'DELETE FROM package_subject_item_lesson_assignments WHERE id = $1 RETURNING *',
      [assignmentId],
    );
    return result.rows[0] || null;
  }
}
