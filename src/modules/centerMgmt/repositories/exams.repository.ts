import pool from '../../../db/pool';
import type {
  TcExamRosterStudent,
  TcGroupExamGradeInput,
  TcGroupExamGradeRow,
  TcGroupExamListItem,
  TcGroupExamRow,
  TcStudentExamGrade,
} from '../types';

function toNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function percentage(score: number | null, total: number, isAbsent: boolean): number | null {
  if (isAbsent || score == null || total <= 0) return null;
  return Math.round((score / total) * 10000) / 100;
}

export class ExamsRepository {
  static async create(input: {
    teacherId: number;
    groupId: number;
    title: string;
    totalGrade: number;
    examDate?: string | null;
    notes?: string | null;
  }): Promise<TcGroupExamRow> {
    const result = await pool.query<TcGroupExamRow>(
      `INSERT INTO tc_group_exams (teacher_id, group_id, title, total_grade, exam_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.teacherId,
        input.groupId,
        input.title,
        input.totalGrade,
        input.examDate ?? null,
        input.notes ?? null,
      ],
    );
    return result.rows[0];
  }

  static async update(
    examId: number,
    teacherId: number,
    patch: Partial<{
      title: string;
      totalGrade: number;
      examDate: string | null;
      notes: string | null;
    }>,
  ): Promise<TcGroupExamRow | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Array<[keyof typeof patch, string]> = [
      ['title', 'title'],
      ['totalGrade', 'total_grade'],
      ['examDate', 'exam_date'],
      ['notes', 'notes'],
    ];
    for (const [key, column] of map) {
      if (patch[key] !== undefined) {
        values.push(patch[key]);
        fields.push(`${column} = $${values.length}`);
      }
    }
    if (!fields.length) return this.findById(examId, teacherId);

    fields.push('updated_at = NOW()');
    values.push(examId, teacherId);
    const result = await pool.query<TcGroupExamRow>(
      `UPDATE tc_group_exams
       SET ${fields.join(', ')}
       WHERE id = $${values.length - 1}
         AND teacher_id = $${values.length}
         AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    return result.rows[0] ?? null;
  }

  static async softDelete(examId: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE tc_group_exams
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [examId, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async findById(examId: number, teacherId: number): Promise<TcGroupExamRow | null> {
    const result = await pool.query<TcGroupExamRow>(
      `SELECT * FROM tc_group_exams
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [examId, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async listByGroup(groupId: number, teacherId: number): Promise<TcGroupExamListItem[]> {
    const result = await pool.query<
      TcGroupExamRow & {
        group_name: string;
        students_count: number;
        graded_count: number;
        absent_count: number;
        average_score: string | null;
      }
    >(
      `SELECT
         e.*,
         g.name AS group_name,
         (
           SELECT COUNT(*)::int
           FROM tc_student_groups sg
           WHERE sg.group_id = e.group_id
             AND sg.deleted_at IS NULL
             AND sg.status = 'active'
         ) AS students_count,
         COUNT(gr.id) FILTER (WHERE gr.is_absent = FALSE AND gr.score IS NOT NULL)::int AS graded_count,
         COUNT(gr.id) FILTER (WHERE gr.is_absent = TRUE)::int AS absent_count,
         ROUND(AVG(gr.score) FILTER (WHERE gr.is_absent = FALSE AND gr.score IS NOT NULL)::numeric, 2) AS average_score
       FROM tc_group_exams e
       JOIN tc_groups g ON g.id = e.group_id
       LEFT JOIN tc_group_exam_grades gr ON gr.exam_id = e.id
       WHERE e.group_id = $1 AND e.teacher_id = $2 AND e.deleted_at IS NULL
       GROUP BY e.id, g.name
       ORDER BY e.exam_date DESC NULLS LAST, e.id DESC`,
      [groupId, teacherId],
    );

    return result.rows.map((row) => ({
      ...row,
      average_score: toNumber(row.average_score),
    }));
  }

  static async roster(examId: number, teacherId: number): Promise<TcExamRosterStudent[]> {
    const exam = await this.findById(examId, teacherId);
    if (!exam) return [];
    const total = Number(exam.total_grade);

    const result = await pool.query<{
      student_id: number;
      full_name: string;
      student_code: string;
      member_no: number | null;
      score: string | null;
      is_absent: boolean | null;
      notes: string | null;
    }>(
      `SELECT
         st.id AS student_id,
         st.full_name,
         COALESCE(sg.member_no::text, st.student_code) AS student_code,
         sg.member_no,
         gr.score,
         gr.is_absent,
         gr.notes
       FROM tc_student_groups sg
       JOIN tc_students st ON st.id = sg.student_id AND st.deleted_at IS NULL
       LEFT JOIN tc_group_exam_grades gr ON gr.exam_id = $1 AND gr.student_id = st.id
       WHERE sg.group_id = $2 AND sg.deleted_at IS NULL AND sg.status = 'active'
       ORDER BY sg.member_no ASC NULLS LAST, st.full_name ASC`,
      [examId, exam.group_id],
    );

    return result.rows.map((row) => {
      const score = toNumber(row.score);
      const isAbsent = row.is_absent === true;
      const recorded = row.score != null || row.is_absent != null;
      return {
        student_id: row.student_id,
        full_name: row.full_name,
        student_code: row.student_code,
        member_no: row.member_no,
        score,
        is_absent: isAbsent,
        notes: row.notes,
        percentage: percentage(score, total, isAbsent),
        recorded,
      };
    });
  }

  static async upsertGrades(input: {
    teacherId: number;
    examId: number;
    recordedBy: number;
    grades: TcGroupExamGradeInput[];
  }): Promise<TcGroupExamGradeRow[]> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const saved: TcGroupExamGradeRow[] = [];
      for (const g of input.grades) {
        const isAbsent = g.is_absent === true;
        const score = isAbsent ? null : g.score ?? null;
        const result = await client.query<TcGroupExamGradeRow>(
          `INSERT INTO tc_group_exam_grades (
             teacher_id, exam_id, student_id, score, is_absent, notes, recorded_by
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (exam_id, student_id)
           DO UPDATE SET
             score = EXCLUDED.score,
             is_absent = EXCLUDED.is_absent,
             notes = EXCLUDED.notes,
             recorded_by = EXCLUDED.recorded_by,
             updated_at = NOW()
           RETURNING *`,
          [
            input.teacherId,
            input.examId,
            g.student_id,
            score,
            isAbsent,
            g.notes ?? null,
            input.recordedBy,
          ],
        );
        saved.push(result.rows[0]);
      }
      await client.query('COMMIT');
      return saved;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  static async deleteGrade(examId: number, studentId: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM tc_group_exam_grades
       WHERE exam_id = $1 AND student_id = $2 AND teacher_id = $3`,
      [examId, studentId, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async listByStudent(studentId: number, teacherId: number): Promise<TcStudentExamGrade[]> {
    const result = await pool.query<{
      exam_id: number;
      title: string;
      group_id: number;
      group_name: string;
      total_grade: string;
      exam_date: string | null;
      score: string | null;
      is_absent: boolean;
      notes: string | null;
      recorded_at: Date;
    }>(
      `SELECT
         e.id AS exam_id,
         e.title,
         e.group_id,
         g.name AS group_name,
         e.total_grade,
         e.exam_date,
         gr.score,
         gr.is_absent,
         gr.notes,
         gr.updated_at AS recorded_at
       FROM tc_group_exam_grades gr
       JOIN tc_group_exams e ON e.id = gr.exam_id AND e.deleted_at IS NULL
       JOIN tc_groups g ON g.id = e.group_id AND g.deleted_at IS NULL
       WHERE gr.student_id = $1 AND gr.teacher_id = $2
       ORDER BY e.exam_date DESC NULLS LAST, e.id DESC`,
      [studentId, teacherId],
    );

    return result.rows.map((row) => {
      const total = Number(row.total_grade);
      const score = toNumber(row.score);
      return {
        exam_id: row.exam_id,
        title: row.title,
        group_id: row.group_id,
        group_name: row.group_name,
        total_grade: total,
        exam_date: row.exam_date,
        score,
        is_absent: row.is_absent,
        notes: row.notes,
        percentage: percentage(score, total, row.is_absent),
        recorded_at: row.recorded_at,
      };
    });
  }
}
