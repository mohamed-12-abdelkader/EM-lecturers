import pool from '../db/pool';

export class TeacherActivityLogService {
  static async log({
    teacher_id,
    action,
    entity_type,
    entity_id,
    description,
  }: {
    teacher_id: number;
    action: string;
    entity_type: string;
    entity_id?: any;
    description?: string;
  }) {
    await pool.query(
      `INSERT INTO teacher_activity_log (teacher_id, action, entity_type, entity_id, description)
       VALUES ($1, $2, $3, $4, $5)`,
      [teacher_id, action, entity_type, entity_id ?? null, description ?? null],
    );
  }

  static async getTeacherLog(teacher_id: number, limit = 20, offset = 0) {
    const result = await pool.query(
      `SELECT * FROM teacher_activity_log WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [teacher_id, limit, offset],
    );
    return result.rows;
  }
}
