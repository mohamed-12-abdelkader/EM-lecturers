import pool from '../../db/pool';
import { HttpError } from '../../utils';
import { DailyQuizService } from './service';

export class DailyQuizStatsService {
  static async getQuizStats(quizId: number, teacherId: number, tenantId: number) {
    await DailyQuizService.assertTeacherOwns(quizId, teacherId, tenantId);

    const summary = await pool.query(
      `SELECT
         COUNT(*)::int AS participants,
         COALESCE(ROUND(AVG(score_percent)::numeric, 2), 0) AS avg_score_percent,
         COALESCE(ROUND(AVG(total_points)::numeric, 2), 0) AS avg_points,
         COALESCE(ROUND(AVG(duration_ms)::numeric, 0), 0) AS avg_duration_ms,
         COALESCE(SUM(CASE WHEN score_percent >= 50 THEN 1 ELSE 0 END), 0)::int AS pass_count
       FROM daily_quiz_results
       WHERE quiz_id = $1`,
      [quizId],
    );

    const participants = summary.rows[0].participants || 0;
    const passRate =
      participants > 0
        ? Math.round((summary.rows[0].pass_count / participants) * 10000) / 100
        : 0;

    const questions = await pool.query(
      `SELECT
         q.id,
         q.question_text,
         q.correct_answer,
         q.points,
         COUNT(a.id)::int AS answers_count,
         COALESCE(SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END), 0)::int AS correct_count,
         COALESCE(
           ROUND(
             100.0 * SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END) / NULLIF(COUNT(a.id), 0),
             2
           ),
           0
         ) AS correct_rate,
         COALESCE(SUM(CASE WHEN a.selected_answer = 'A' THEN 1 ELSE 0 END), 0)::int AS choose_a,
         COALESCE(SUM(CASE WHEN a.selected_answer = 'B' THEN 1 ELSE 0 END), 0)::int AS choose_b,
         COALESCE(SUM(CASE WHEN a.selected_answer = 'C' THEN 1 ELSE 0 END), 0)::int AS choose_c,
         COALESCE(SUM(CASE WHEN a.selected_answer = 'D' THEN 1 ELSE 0 END), 0)::int AS choose_d
       FROM daily_quiz_questions q
       LEFT JOIN daily_quiz_attempt_answers a ON a.question_id = q.id AND a.is_correct IS NOT NULL
       WHERE q.quiz_id = $1
       GROUP BY q.id
       ORDER BY q.question_order, q.id`,
      [quizId],
    );

    const withRates = questions.rows.filter((q) => q.answers_count > 0);
    const hardest = [...withRates].sort((a, b) => a.correct_rate - b.correct_rate)[0] || null;
    const easiest = [...withRates].sort((a, b) => b.correct_rate - a.correct_rate)[0] || null;

    const leaderboard = await pool.query(
      `SELECT
         ROW_NUMBER() OVER (ORDER BY r.total_points DESC, r.duration_ms ASC) AS rank,
         r.student_id, u.name AS student_name, u.avatar,
         r.total_points, r.correct_count, r.duration_ms, r.score_percent
       FROM daily_quiz_results r
       JOIN users u ON u.id = r.student_id
       WHERE r.quiz_id = $1
       ORDER BY r.total_points DESC, r.duration_ms ASC
       LIMIT 100`,
      [quizId],
    );

    return {
      summary: {
        ...summary.rows[0],
        success_rate: passRate,
      },
      hardest_question: hardest,
      easiest_question: easiest,
      questions: questions.rows,
      leaderboard: leaderboard.rows,
    };
  }

  /** تصدير CSV بسيط (Excel-friendly) */
  static async exportCsv(quizId: number, teacherId: number, tenantId: number): Promise<string> {
    const stats = await this.getQuizStats(quizId, teacherId, tenantId);
    const header = [
      'rank',
      'student_id',
      'student_name',
      'total_points',
      'correct_count',
      'duration_ms',
      'score_percent',
    ];
    const lines = [header.join(',')];
    for (const row of stats.leaderboard) {
      lines.push(
        [
          row.rank,
          row.student_id,
          `"${String(row.student_name || '').replace(/"/g, '""')}"`,
          row.total_points,
          row.correct_count,
          row.duration_ms,
          row.score_percent,
        ].join(','),
      );
    }
    return lines.join('\n');
  }

  static async exportPdfPayload(quizId: number, teacherId: number, tenantId: number) {
    const quiz = await DailyQuizService.assertTeacherOwns(quizId, teacherId, tenantId);
    const stats = await this.getQuizStats(quizId, teacherId, tenantId);
    return {
      title: quiz.title,
      generated_at: new Date().toISOString(),
      summary: stats.summary,
      hardest_question: stats.hardest_question,
      easiest_question: stats.easiest_question,
      leaderboard: stats.leaderboard,
      note: 'يمكن للواجهة توليد PDF من هذا الـ payload أو استخدام خدمة طباعة',
    };
  }
}
