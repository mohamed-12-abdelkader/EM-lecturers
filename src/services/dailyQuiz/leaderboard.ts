import type { PoolClient } from 'pg';
import pool from '../../db/pool';
import { HttpError } from '../../utils';

function currentYearMonth(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class DailyQuizLeaderboard {
  static async upsertMonthly(
    client: PoolClient,
    params: {
      tenantId: number;
      gradeId: number;
      studentId: number;
      totalPoints: number;
      correctCount: number;
      durationMs: number;
      isFirst: boolean;
    },
  ) {
    const yearMonth = currentYearMonth();
    await client.query(
      `INSERT INTO daily_quiz_monthly_scores (
         tenant_id, grade_id, year_month, student_id,
         total_points, quizzes_participated, first_place_count,
         total_correct, total_duration_ms
       ) VALUES ($1,$2,$3,$4,$5,1,$6,$7,$8)
       ON CONFLICT (tenant_id, grade_id, year_month, student_id) DO UPDATE SET
         total_points = daily_quiz_monthly_scores.total_points + EXCLUDED.total_points,
         quizzes_participated = daily_quiz_monthly_scores.quizzes_participated + 1,
         first_place_count = daily_quiz_monthly_scores.first_place_count + EXCLUDED.first_place_count,
         total_correct = daily_quiz_monthly_scores.total_correct + EXCLUDED.total_correct,
         total_duration_ms = daily_quiz_monthly_scores.total_duration_ms + EXCLUDED.total_duration_ms,
         updated_at = NOW()`,
      [
        params.tenantId,
        params.gradeId,
        yearMonth,
        params.studentId,
        params.totalPoints,
        params.isFirst ? 1 : 0,
        params.correctCount,
        params.durationMs,
      ],
    );
  }

  static async getDaily(quizId: number, currentStudentId?: number, limit = 50) {
    const lim = Math.min(100, Math.max(1, limit));
    const rows = await pool.query(
      `SELECT
         ROW_NUMBER() OVER (
           ORDER BY r.total_points DESC, r.duration_ms ASC, r.created_at ASC
         ) AS rank,
         r.student_id,
         u.name AS student_name,
         u.avatar AS student_avatar,
         r.total_points,
         r.base_points,
         r.speed_bonus,
         r.duration_ms,
         r.correct_count,
         r.wrong_count,
         r.finish_rank,
         r.created_at AS submitted_at
       FROM daily_quiz_results r
       JOIN users u ON u.id = r.student_id
       WHERE r.quiz_id = $1
       ORDER BY r.total_points DESC, r.duration_ms ASC, r.created_at ASC
       LIMIT $2`,
      [quizId, lim],
    );

    let me = null;
    if (currentStudentId) {
      const meRes = await pool.query(
        `SELECT * FROM (
           SELECT
             ROW_NUMBER() OVER (
               ORDER BY r.total_points DESC, r.duration_ms ASC, r.created_at ASC
             ) AS rank,
             r.student_id,
             u.name AS student_name,
             u.avatar AS student_avatar,
             r.total_points,
             r.duration_ms,
             r.correct_count
           FROM daily_quiz_results r
           JOIN users u ON u.id = r.student_id
           WHERE r.quiz_id = $1
         ) t WHERE student_id = $2`,
        [quizId, currentStudentId],
      );
      me = meRes.rows[0] || null;
    }

    return {
      items: rows.rows.map((r) => ({
        ...r,
        is_current_user: currentStudentId ? r.student_id === currentStudentId : false,
      })),
      me,
      total_participants: (
        await pool.query(`SELECT COUNT(*)::int AS c FROM daily_quiz_results WHERE quiz_id = $1`, [
          quizId,
        ])
      ).rows[0].c,
    };
  }

  static async getMonthly(params: {
    tenantId: number;
    gradeId: number;
    yearMonth?: string;
    studentId?: number;
    limit?: number;
  }) {
    const yearMonth = params.yearMonth || currentYearMonth();
    const limit = Math.min(100, Math.max(1, params.limit || 100));

    const rows = await pool.query(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY m.total_points DESC, m.total_duration_ms ASC) AS rank,
         m.student_id,
         u.name AS student_name,
         u.avatar AS student_avatar,
         m.total_points,
         m.quizzes_participated,
         m.first_place_count,
         m.total_correct,
         m.total_duration_ms,
         CASE WHEN m.quizzes_participated > 0
           THEN ROUND(m.total_duration_ms::numeric / m.quizzes_participated)
           ELSE 0 END AS avg_duration_ms
       FROM daily_quiz_monthly_scores m
       JOIN users u ON u.id = m.student_id
       WHERE m.tenant_id = $1 AND m.grade_id = $2 AND m.year_month = $3
       ORDER BY m.total_points DESC, m.total_duration_ms ASC
       LIMIT $4`,
      [params.tenantId, params.gradeId, yearMonth, limit],
    );

    let me = null;
    if (params.studentId) {
      const meRes = await pool.query(
        `SELECT * FROM (
           SELECT
             ROW_NUMBER() OVER (ORDER BY m.total_points DESC, m.total_duration_ms ASC) AS rank,
             m.*
           FROM daily_quiz_monthly_scores m
           WHERE m.tenant_id = $1 AND m.grade_id = $2 AND m.year_month = $3
         ) t WHERE student_id = $4`,
        [params.tenantId, params.gradeId, yearMonth, params.studentId],
      );
      me = meRes.rows[0] || null;
    }

    return {
      year_month: yearMonth,
      items: rows.rows.map((r) => ({
        ...r,
        is_current_user: params.studentId ? r.student_id === params.studentId : false,
      })),
      me,
    };
  }

  /** أرشفة الشهر السابق وتصفير المادة الحيّة (يُستدعى من Job شهري) */
  static async archivePreviousMonth(now = new Date()) {
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const yearMonth = `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, '0')}`;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO daily_quiz_monthly_archive (
           tenant_id, grade_id, year_month, student_id, rank,
           total_points, quizzes_participated, first_place_count,
           total_correct, total_duration_ms
         )
         SELECT tenant_id, grade_id, year_month, student_id,
           ROW_NUMBER() OVER (
             PARTITION BY tenant_id, grade_id
             ORDER BY total_points DESC, total_duration_ms ASC
           ),
           total_points, quizzes_participated, first_place_count,
           total_correct, total_duration_ms
         FROM daily_quiz_monthly_scores
         WHERE year_month = $1
         ON CONFLICT (tenant_id, grade_id, year_month, student_id) DO NOTHING`,
        [yearMonth],
      );
      await client.query(`DELETE FROM daily_quiz_monthly_scores WHERE year_month = $1`, [
        yearMonth,
      ]);
      await client.query('COMMIT');
      return { archived_month: yearMonth };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async getArchive(tenantId: number, gradeId: number, yearMonth: string) {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) throw new HttpError(400, 'صيغة الشهر غير صحيحة');
    const rows = await pool.query(
      `SELECT a.*, u.name AS student_name, u.avatar AS student_avatar
       FROM daily_quiz_monthly_archive a
       JOIN users u ON u.id = a.student_id
       WHERE a.tenant_id = $1 AND a.grade_id = $2 AND a.year_month = $3
       ORDER BY a.rank ASC NULLS LAST
       LIMIT 100`,
      [tenantId, gradeId, yearMonth],
    );
    return { year_month: yearMonth, items: rows.rows };
  }
}
