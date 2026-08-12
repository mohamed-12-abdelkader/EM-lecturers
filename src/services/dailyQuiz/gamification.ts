import type { PoolClient } from 'pg';
import pool from '../../db/pool';
import type { DailyQuizRow } from '../../db/types/dailyQuiz';
import { DailyQuizScoring } from './scoring';
import { NotificationDispatchService } from '../notificationDispatchService';

function todayDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayDateString(d = new Date()): string {
  const y = new Date(d);
  y.setUTCDate(y.getUTCDate() - 1);
  return y.toISOString().slice(0, 10);
}

export class DailyQuizGamification {
  static async ensureProfile(client: PoolClient, tenantId: number, studentId: number) {
    await client.query(
      `INSERT INTO daily_quiz_student_profiles (tenant_id, student_id)
       VALUES ($1, $2) ON CONFLICT (tenant_id, student_id) DO NOTHING`,
      [tenantId, studentId],
    );
  }

  static async applyAfterSubmit(
    client: PoolClient,
    params: {
      tenantId: number;
      studentId: number;
      quizId: number;
      attemptId: number;
      basePoints: number;
      speedBonus: number;
      totalPoints: number;
      finishRank: number;
      correctCount: number;
      totalQuestions: number;
    },
  ) {
    const {
      tenantId,
      studentId,
      quizId,
      attemptId,
      basePoints,
      speedBonus,
      totalPoints,
      finishRank,
      correctCount,
      totalQuestions,
    } = params;

    await this.ensureProfile(client, tenantId, studentId);
    const xpGain = DailyQuizScoring.computeXp(basePoints, speedBonus);
    const coinsGain = DailyQuizScoring.computeCoins(totalPoints);
    const today = todayDateString();
    const yesterday = yesterdayDateString();
    const perfect = correctCount === totalQuestions && totalQuestions > 0;

    const profileRes = await client.query(
      `SELECT * FROM daily_quiz_student_profiles WHERE tenant_id = $1 AND student_id = $2 FOR UPDATE`,
      [tenantId, studentId],
    );
    const profile = profileRes.rows[0];
    const lastDate = profile.last_participation_date
      ? String(profile.last_participation_date).slice(0, 10)
      : null;

    let streak = profile.current_streak || 0;
    let streakBroken = false;
    if (lastDate === today) {
      // نفس اليوم — لا نزيد الـ streak
    } else if (lastDate === yesterday) {
      streak += 1;
    } else if (!lastDate) {
      streak = 1;
    } else {
      streakBroken = streak > 0;
      streak = 1;
    }

    const newXp = (profile.xp || 0) + xpGain;
    const newLevel = DailyQuizScoring.levelFromXp(newXp);
    const leveledUp = newLevel > (profile.level || 1);

    await client.query(
      `UPDATE daily_quiz_student_profiles SET
         xp = $3,
         level = $4,
         coins = coins + $5,
         current_streak = $6,
         longest_streak = GREATEST(longest_streak, $6),
         last_participation_date = $7::date,
         best_daily_rank = CASE
           WHEN best_daily_rank IS NULL THEN $8
           ELSE LEAST(best_daily_rank, $8)
         END,
         total_quizzes = total_quizzes + 1,
         total_points_earned = total_points_earned + $9,
         total_first_places = total_first_places + $10,
         perfect_quizzes = perfect_quizzes + $11
       WHERE tenant_id = $1 AND student_id = $2`,
      [
        tenantId,
        studentId,
        newXp,
        newLevel,
        coinsGain,
        streak,
        today,
        finishRank,
        totalPoints,
        finishRank === 1 ? 1 : 0,
        perfect ? 1 : 0,
      ],
    );

    await client.query(
      `INSERT INTO daily_quiz_points_history
         (tenant_id, student_id, quiz_id, attempt_id, points, xp, coins, source_type, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'quiz_submit',$8)`,
      [
        tenantId,
        studentId,
        quizId,
        attemptId,
        totalPoints,
        xpGain,
        coinsGain,
        `نتيجة المسابقة اليومية #${quizId}`,
      ],
    );

    // منح الشارات
    await this.evaluateBadges(client, tenantId, studentId);

    if (streakBroken) {
      // يُرسل إشعار بعد الـ commit من الخارج إن لزم — نخزّن علامة في الوصف
      await client.query(
        `INSERT INTO daily_quiz_points_history
           (tenant_id, student_id, quiz_id, points, xp, coins, source_type, description)
         VALUES ($1,$2,$3,0,0,0,'streak_broken',$4)`,
        [tenantId, studentId, quizId, 'تم كسر سلسلة المشاركة اليومية'],
      );
    }

    if (leveledUp) {
      await client.query(
        `INSERT INTO daily_quiz_points_history
           (tenant_id, student_id, quiz_id, points, xp, coins, source_type, description)
         VALUES ($1,$2,$3,0,0,10,'level_up',$4)`,
        [tenantId, studentId, quizId, `وصلت للمستوى ${newLevel}`],
      );
      await client.query(
        `UPDATE daily_quiz_student_profiles SET coins = coins + 10
         WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, studentId],
      );
    }

    return { xpGain, coinsGain, newLevel, streak, streakBroken, leveledUp };
  }

  static async evaluateBadges(client: PoolClient, tenantId: number, studentId: number) {
    const profile = (
      await client.query(
        `SELECT * FROM daily_quiz_student_profiles WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, studentId],
      )
    ).rows[0];
    if (!profile) return;

    const badges = (await client.query(`SELECT * FROM daily_quiz_badges WHERE is_active = TRUE`))
      .rows;

    for (const badge of badges) {
      const c = badge.criteria || {};
      let earned = false;
      if (c.first_places && profile.total_first_places >= c.first_places) earned = true;
      if (c.streak && profile.current_streak >= c.streak) earned = true;
      if (c.perfect_quizzes && profile.perfect_quizzes >= c.perfect_quizzes) earned = true;
      if (c.quizzes && profile.total_quizzes >= c.quizzes) earned = true;
      if (c.total_points && profile.total_points_earned >= c.total_points) earned = true;
      if (c.min_speed_bonus) {
        const sped = await client.query(
          `SELECT 1 FROM daily_quiz_results r
           JOIN daily_quizzes q ON q.id = r.quiz_id
           WHERE r.student_id = $1 AND q.tenant_id = $2 AND r.speed_bonus >= $3
           LIMIT 1`,
          [studentId, tenantId, c.min_speed_bonus],
        );
        if (sped.rowCount) earned = true;
      }

      if (!earned) continue;
      await client.query(
        `INSERT INTO daily_quiz_student_badges (tenant_id, student_id, badge_id)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [tenantId, studentId, badge.id],
      );
    }
  }

  static async getAchievements(studentId: number, tenantId: number) {
    await pool.query(
      `INSERT INTO daily_quiz_student_profiles (tenant_id, student_id)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [tenantId, studentId],
    );

    const profile = (
      await pool.query(
        `SELECT * FROM daily_quiz_student_profiles WHERE tenant_id = $1 AND student_id = $2`,
        [tenantId, studentId],
      )
    ).rows[0];

    const badges = (
      await pool.query(
        `SELECT b.*, sb.earned_at
         FROM daily_quiz_student_badges sb
         JOIN daily_quiz_badges b ON b.id = sb.badge_id
         WHERE sb.tenant_id = $1 AND sb.student_id = $2
         ORDER BY sb.earned_at DESC`,
        [tenantId, studentId],
      )
    ).rows;

    const progress = DailyQuizScoring.xpProgress(profile.xp || 0);

    return {
      total_points: profile.total_points_earned,
      xp: profile.xp,
      level: profile.level,
      coins: profile.coins,
      level_progress: progress,
      current_streak: profile.current_streak,
      longest_streak: profile.longest_streak,
      total_quizzes: profile.total_quizzes,
      best_daily_rank: profile.best_daily_rank,
      total_first_places: profile.total_first_places,
      perfect_quizzes: profile.perfect_quizzes,
      badges,
      medals: {
        gold: profile.total_first_places,
        cups: Math.floor((profile.total_first_places || 0) / 5),
      },
    };
  }

  static async notifyRankIfNeeded(
    tenantId: number,
    studentId: number,
    quiz: DailyQuizRow,
    finishRank: number,
  ) {
    try {
      if (finishRank <= 3) {
        await NotificationDispatchService.dispatchToUser({
          user_id: studentId,
          title: '🏆 ترتيب رائع!',
          body: `حصلت على المركز ${finishRank} في «${quiz.title}»`,
          type: 'daily_quiz_rank',
          url: `/daily-quiz/${quiz.id}/leaderboard`,
          metadata: { quiz_id: quiz.id, rank: finishRank, tenant_id: tenantId },
        });
      }
    } catch {
      // ignore notification failures
    }
  }
}
