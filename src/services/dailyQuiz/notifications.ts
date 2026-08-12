import pool from '../../db/pool';
import { NotificationDispatchService } from '../notificationDispatchService';
import { DailyQuizLeaderboard } from './leaderboard';
import { logger } from '../../utils';

async function markSent(quizId: number, eventType: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO daily_quiz_notification_log (quiz_id, event_type)
     VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`,
    [quizId, eventType],
  );
  return (result.rowCount ?? 0) > 0;
}

async function studentIdsForQuiz(quizId: number): Promise<number[]> {
  const result = await pool.query(
    `SELECT DISTINCT ug.user_id
     FROM daily_quizzes q
     JOIN user_grades ug ON ug.grade_id = q.grade_id
     JOIN users u ON u.id = ug.user_id AND u.role = 'student'
     WHERE q.id = $1 AND (u.tenant_id IS NULL OR u.tenant_id = q.tenant_id)`,
    [quizId],
  );
  return result.rows.map((r) => r.user_id);
}

export class DailyQuizNotificationJob {
  /** يُستدعى كل دقيقة تقريباً */
  static async run(): Promise<void> {
    const now = new Date();

    // بدء المسابقة (خلال آخر دقيقتين)
    const starting = await pool.query(
      `SELECT * FROM daily_quizzes
       WHERE status = 'published' AND is_visible = TRUE
         AND starts_at <= $1
         AND starts_at > $1 - INTERVAL '2 minutes'
         AND ends_at > $1`,
      [now],
    );
    for (const quiz of starting.rows) {
      if (!(await markSent(quiz.id, 'started'))) continue;
      const ids = await studentIdsForQuiz(quiz.id);
      if (!ids.length) continue;
      await NotificationDispatchService.dispatchToUsers(ids, {
        title: '🔥 المسابقة اليومية بدأت',
        body: `«${quiz.title}» متاحة الآن — ابدأ قبل أن ينتهي الوقت!`,
        type: 'daily_quiz_started',
        url: `/daily-quiz/${quiz.id}`,
      });
    }

    // قبل الانتهاء بـ 10 دقائق (± دقيقة)
    const ending = await pool.query(
      `SELECT * FROM daily_quizzes
       WHERE status = 'published' AND is_visible = TRUE
         AND ends_at - INTERVAL '10 minutes' <= $1
         AND ends_at - INTERVAL '9 minutes' > $1
         AND ends_at > $1`,
      [now],
    );
    for (const quiz of ending.rows) {
      if (!(await markSent(quiz.id, 'ending_soon'))) continue;
      const ids = await studentIdsForQuiz(quiz.id);
      const pending = await pool.query(
        `SELECT u.user_id
         FROM UNNEST($1::int[]) AS u(user_id)
         WHERE NOT EXISTS (
           SELECT 1 FROM daily_quiz_results r
           WHERE r.quiz_id = $2 AND r.student_id = u.user_id
         )`,
        [ids, quiz.id],
      );
      const pendingIds = pending.rows.map((r) => r.user_id);
      if (!pendingIds.length) continue;
      await NotificationDispatchService.dispatchToUsers(pendingIds, {
        title: '⏰ باقي 10 دقائق',
        body: `المسابقة «${quiz.title}» تنتهي قريباً`,
        type: 'daily_quiz_ending_soon',
        url: `/daily-quiz/${quiz.id}`,
      });
    }

    // إعلان النتائج بعد الانتهاء
    const ended = await pool.query(
      `SELECT * FROM daily_quizzes
       WHERE status = 'published'
         AND ends_at <= $1
         AND ends_at > $1 - INTERVAL '15 minutes'`,
      [now],
    );
    for (const quiz of ended.rows) {
      if (!(await markSent(quiz.id, 'results_ready'))) continue;
      const ids = (
        await pool.query(`SELECT student_id FROM daily_quiz_results WHERE quiz_id = $1`, [quiz.id])
      ).rows.map((r) => r.student_id);
      if (!ids.length) continue;
      await NotificationDispatchService.dispatchToUsers(ids, {
        title: '🏆 النتائج جاهزة',
        body: `اطلع على ترتيب «${quiz.title}» الآن`,
        type: 'daily_quiz_results',
        url: `/daily-quiz/${quiz.id}/leaderboard`,
      });
    }

    // أرشفة شهرية في أول يوم من الشهر (خلال الساعة الأولى UTC)
    if (now.getUTCDate() === 1 && now.getUTCHours() === 0 && now.getUTCMinutes() < 5) {
      try {
        await DailyQuizLeaderboard.archivePreviousMonth(now);
      } catch (e) {
        logger.error({ err: e }, 'daily quiz monthly archive failed');
      }
    }
  }
}
