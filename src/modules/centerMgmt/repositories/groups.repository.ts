import pool from '../../../db/pool';
import type { GroupStatus, TcGroupListItem, TcGroupRow } from '../types';

export class GroupsRepository {
  static async create(input: {
    teacherId: number;
    name: string;
    gradeId?: number | null;
    subjectId?: number | null;
    days: string[];
    startTime?: string | null;
    endTime?: string | null;
    monthlyFee: number;
    studyStartDate?: string | null;
    notes?: string | null;
    status?: GroupStatus;
  }): Promise<TcGroupRow> {
    const result = await pool.query<TcGroupRow>(
      `INSERT INTO tc_groups (
         teacher_id, name, grade_id, subject_id, days,
         start_time, end_time, monthly_fee, study_start_date, notes, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.teacherId,
        input.name,
        input.gradeId ?? null,
        input.subjectId ?? null,
        input.days,
        input.startTime ?? null,
        input.endTime ?? null,
        input.monthlyFee,
        input.studyStartDate ?? null,
        input.notes ?? null,
        input.status ?? 'active',
      ],
    );
    return result.rows[0];
  }

  static async update(
    id: number,
    teacherId: number,
    patch: Partial<{
      name: string;
      gradeId: number | null;
      subjectId: number | null;
      days: string[];
      startTime: string | null;
      endTime: string | null;
      monthlyFee: number;
      studyStartDate: string | null;
      notes: string | null;
      status: GroupStatus;
    }>,
  ): Promise<TcGroupRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    const map: Array<[keyof typeof patch, string]> = [
      ['name', 'name'],
      ['gradeId', 'grade_id'],
      ['subjectId', 'subject_id'],
      ['days', 'days'],
      ['startTime', 'start_time'],
      ['endTime', 'end_time'],
      ['monthlyFee', 'monthly_fee'],
      ['studyStartDate', 'study_start_date'],
      ['notes', 'notes'],
      ['status', 'status'],
    ];

    for (const [key, column] of map) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }

    if (!fields.length) {
      return this.findById(id, teacherId);
    }

    fields.push('updated_at = NOW()');
    values.push(id, teacherId);

    const result = await pool.query<TcGroupRow>(
      `UPDATE tc_groups
       SET ${fields.join(', ')}
       WHERE id = $${values.length - 1} AND teacher_id = $${values.length} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  static async softDelete(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_groups
       SET deleted_at = NOW(), updated_at = NOW(), status = 'paused'
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async findById(id: number, teacherId: number): Promise<TcGroupListItem | null> {
    const result = await pool.query<TcGroupListItem>(
      `SELECT g.*,
              gr.name AS grade_name,
              s.name AS subject_name,
              (
                SELECT COUNT(*)::int
                FROM tc_student_groups sg
                WHERE sg.group_id = g.id AND sg.deleted_at IS NULL AND sg.status = 'active'
              ) AS students_count
       FROM tc_groups g
       LEFT JOIN grades gr ON gr.id = g.grade_id
       LEFT JOIN subjects s ON s.id = g.subject_id
       WHERE g.id = $1 AND g.teacher_id = $2 AND g.deleted_at IS NULL`,
      [id, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async list(
    teacherId: number,
    opts: { status?: GroupStatus; search?: string; page?: number; limit?: number } = {},
  ): Promise<{ items: TcGroupListItem[]; total: number }> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 50;
    const params: unknown[] = [teacherId];
    const where = ['g.teacher_id = $1', 'g.deleted_at IS NULL'];

    if (opts.status) {
      params.push(opts.status);
      where.push(`g.status = $${params.length}`);
    }
    if (opts.search?.trim()) {
      params.push(`%${opts.search.trim()}%`);
      where.push(`g.name ILIKE $${params.length}`);
    }

    const whereSql = where.join(' AND ');
    const countRes = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tc_groups g WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    params.push(limit, (page - 1) * limit);
    const listRes = await pool.query<TcGroupListItem>(
      `SELECT g.*,
              gr.name AS grade_name,
              s.name AS subject_name,
              (
                SELECT COUNT(*)::int
                FROM tc_student_groups sg
                WHERE sg.group_id = g.id AND sg.deleted_at IS NULL AND sg.status = 'active'
              ) AS students_count
       FROM tc_groups g
       LEFT JOIN grades gr ON gr.id = g.grade_id
       LEFT JOIN subjects s ON s.id = g.subject_id
       WHERE ${whereSql}
       ORDER BY g.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: listRes.rows, total };
  }

  static async countByTeacher(teacherId: number): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tc_groups
       WHERE teacher_id = $1 AND deleted_at IS NULL`,
      [teacherId],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
