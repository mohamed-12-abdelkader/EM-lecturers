import type { PoolClient } from 'pg';
import pool from '../../db/pool';
import { HttpError } from '../../utils';
import type { DailyQuizQuestionRow, DailyQuizRow } from '../../db/types/dailyQuiz';
import { DailyQuizService } from './service';
import { DailyQuizScoring } from './scoring';
import { DailyQuizGamification } from './gamification';
import { DailyQuizLeaderboard } from './leaderboard';
import { StudentPointsService } from '../studentPoints';

type AnswerInput = { question_id: number; selected_answer?: string | null };

export class DailyQuizAttemptsService {
  static async startAttempt(params: {
    quizId: number;
    studentId: number;
    tenantId: number;
    ip?: string | null;
    userAgent?: string | null;
    deviceInfo?: Record<string, unknown> | null;
  }) {
    const { quizId, studentId, tenantId, ip, userAgent, deviceInfo } = params;
    const quiz = await DailyQuizService.getById(quizId, tenantId);
    if (!quiz || quiz.status !== 'published' || !quiz.is_visible) {
      throw new HttpError(404, 'المسابقة غير متاحة');
    }

    const gradeOk = await pool.query(
      `SELECT 1 FROM user_grades WHERE user_id = $1 AND grade_id = $2`,
      [studentId, quiz.grade_id],
    );
    if (!gradeOk.rowCount) throw new HttpError(403, 'هذه المسابقة ليست لصفك الدراسي');

    const window = DailyQuizService.windowState(quiz);
    if (window === 'upcoming') throw new HttpError(400, 'المسابقة لم تبدأ بعد');
    if (window === 'ended') throw new HttpError(400, 'انتهت المسابقة');

    const existing = await pool.query(
      `SELECT * FROM daily_quiz_attempts WHERE quiz_id = $1 AND student_id = $2`,
      [quizId, studentId],
    );
    if (existing.rowCount) {
      const attempt = existing.rows[0];
      if (attempt.status === 'submitted' || attempt.status === 'expired') {
        throw new HttpError(409, 'لقد شاركت في هذه المسابقة مسبقاً');
      }
      if (attempt.status === 'in_progress') {
        if (new Date(attempt.expires_at) <= new Date()) {
          return this.finalizeExpired(attempt.id, studentId, tenantId);
        }
        return this.getAttemptPayload(attempt.id, studentId, tenantId, false);
      }
    }

    const questions = (await pool.query<DailyQuizQuestionRow>(
      `SELECT * FROM daily_quiz_questions WHERE quiz_id = $1 ORDER BY question_order, id`,
      [quizId],
    )).rows;
    if (!questions.length) throw new HttpError(400, 'لا توجد أسئلة في المسابقة');

    const { questionOrder, optionOrders } = DailyQuizService.prepareShuffle(quiz, questions);
    const now = new Date();
    const durationEnd = new Date(now.getTime() + quiz.duration_seconds * 1000);
    const quizEnd = new Date(quiz.ends_at);
    const expiresAt = durationEnd < quizEnd ? durationEnd : quizEnd;
    const submitToken = DailyQuizService.newSubmitToken();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        `INSERT INTO daily_quiz_attempts (
           quiz_id, student_id, status, started_at, expires_at,
           question_order, option_orders, ip_address, user_agent, device_info, submit_token
         ) VALUES ($1,$2,'in_progress',$3,$4,$5::jsonb,$6::jsonb,$7,$8,$9::jsonb,$10)
         ON CONFLICT (quiz_id, student_id) DO NOTHING
         RETURNING *`,
        [
          quizId,
          studentId,
          now,
          expiresAt,
          JSON.stringify(questionOrder),
          JSON.stringify(optionOrders),
          ip || null,
          userAgent || null,
          deviceInfo ? JSON.stringify(deviceInfo) : null,
          submitToken,
        ],
      );

      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        throw new HttpError(409, 'لقد بدأت هذه المسابقة مسبقاً');
      }

      const attempt = inserted.rows[0];
      for (const qid of questionOrder) {
        await client.query(
          `INSERT INTO daily_quiz_attempt_answers (attempt_id, question_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [attempt.id, qid],
        );
      }
      await client.query('COMMIT');
      return this.getAttemptPayload(attempt.id, studentId, tenantId, false);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async autosave(
    attemptId: number,
    studentId: number,
    tenantId: number,
    answers: AnswerInput[],
  ) {
    const attempt = await this.requireOwnedAttempt(attemptId, studentId);
    if (attempt.status !== 'in_progress') {
      throw new HttpError(400, 'لا يمكن حفظ إجابات بعد الإرسال');
    }
    if (new Date(attempt.expires_at) <= new Date()) {
      return this.finalizeExpired(attemptId, studentId, tenantId);
    }

    const quiz = await DailyQuizService.getById(attempt.quiz_id, tenantId);
    if (!quiz || DailyQuizService.windowState(quiz) === 'ended') {
      return this.finalizeExpired(attemptId, studentId, tenantId);
    }

    const allowed = new Set((attempt.question_order as number[]) || []);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const ans of answers) {
        if (!allowed.has(ans.question_id)) continue;
        const selected =
          ans.selected_answer && ['A', 'B', 'C', 'D'].includes(String(ans.selected_answer).toUpperCase())
            ? String(ans.selected_answer).toUpperCase()
            : null;
        await client.query(
          `INSERT INTO daily_quiz_attempt_answers (attempt_id, question_id, selected_answer, answered_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET
             selected_answer = EXCLUDED.selected_answer,
             answered_at = NOW(),
             updated_at = NOW()`,
          [attemptId, ans.question_id, selected],
        );
      }
      await client.query(
        `UPDATE daily_quiz_attempts SET last_autosave_at = NOW() WHERE id = $1`,
        [attemptId],
      );
      await client.query('COMMIT');
      return { success: true, saved_at: new Date().toISOString() };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async submit(params: {
    attemptId: number;
    studentId: number;
    tenantId: number;
    answers?: AnswerInput[];
    submitToken?: string;
    forceExpired?: boolean;
  }) {
    const { attemptId, studentId, tenantId, answers = [], submitToken, forceExpired } = params;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const attemptRes = await client.query(
        `SELECT * FROM daily_quiz_attempts WHERE id = $1 AND student_id = $2 FOR UPDATE`,
        [attemptId, studentId],
      );
      if (!attemptRes.rowCount) throw new HttpError(404, 'المحاولة غير موجودة');
      const attempt = attemptRes.rows[0];

      if (attempt.status === 'submitted') {
        await client.query('COMMIT');
        return this.getResultPayload(attempt.quiz_id, studentId, tenantId);
      }

      if (submitToken && attempt.submit_token && submitToken !== attempt.submit_token) {
        throw new HttpError(409, 'رمز الإرسال غير صالح — أعد تحميل المحاولة');
      }

      const quizRes = await client.query(`SELECT * FROM daily_quizzes WHERE id = $1 FOR UPDATE`, [
        attempt.quiz_id,
      ]);
      const quiz = quizRes.rows[0] as DailyQuizRow;
      if (!quiz || quiz.tenant_id !== tenantId) throw new HttpError(404, 'المسابقة غير موجودة');

      const now = new Date();
      const expired =
        forceExpired ||
        now > new Date(attempt.expires_at) ||
        now > new Date(quiz.ends_at);

      // حفظ آخر إجابات قبل الاحتساب
      const allowed = new Set((attempt.question_order as number[]) || []);
      for (const ans of answers) {
        if (!allowed.has(ans.question_id)) continue;
        const selected =
          ans.selected_answer && ['A', 'B', 'C', 'D'].includes(String(ans.selected_answer).toUpperCase())
            ? String(ans.selected_answer).toUpperCase()
            : null;
        await client.query(
          `INSERT INTO daily_quiz_attempt_answers (attempt_id, question_id, selected_answer, answered_at)
           VALUES ($1,$2,$3,NOW())
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET
             selected_answer = COALESCE(EXCLUDED.selected_answer, daily_quiz_attempt_answers.selected_answer),
             answered_at = NOW(),
             updated_at = NOW()`,
          [attemptId, ans.question_id, selected],
        );
      }

      const questions = (
        await client.query<DailyQuizQuestionRow>(
          `SELECT * FROM daily_quiz_questions WHERE quiz_id = $1`,
          [quiz.id],
        )
      ).rows;
      const savedAnswers = (
        await client.query(
          `SELECT question_id, selected_answer FROM daily_quiz_attempt_answers WHERE attempt_id = $1`,
          [attemptId],
        )
      ).rows;

      const scored = DailyQuizScoring.scoreAnswers(questions, savedAnswers);
      const durationMs = Math.max(
        0,
        Math.min(
          now.getTime() - new Date(attempt.started_at).getTime(),
          quiz.duration_seconds * 1000,
        ),
      );

      // ترتيب الإنهاء = عدد المسلّمين الحاليين + 1
      const rankRes = await client.query(
        `SELECT COUNT(*)::int AS c FROM daily_quiz_results WHERE quiz_id = $1`,
        [quiz.id],
      );
      const finishRank = rankRes.rows[0].c + 1;
      const speedBonus = DailyQuizScoring.computeSpeedBonus(
        quiz,
        finishRank,
        durationMs,
        scored.correct_count > 0,
      );
      const totalPoints = scored.base_points + speedBonus;
      const scorePercent =
        scored.max_base_points > 0
          ? Math.round((scored.base_points / scored.max_base_points) * 10000) / 100
          : 0;

      for (const s of scored.scored) {
        await client.query(
          `UPDATE daily_quiz_attempt_answers
           SET is_correct = $3, points_awarded = $4, updated_at = NOW()
           WHERE attempt_id = $1 AND question_id = $2`,
          [attemptId, s.question_id, s.is_correct, s.points_awarded],
        );
      }

      await client.query(
        `UPDATE daily_quiz_attempts
         SET status = $2, submitted_at = $3, updated_at = NOW()
         WHERE id = $1`,
        [attemptId, expired ? 'expired' : 'submitted', now],
      );

      const resultIns = await client.query(
        `INSERT INTO daily_quiz_results (
           quiz_id, attempt_id, student_id,
           correct_count, wrong_count, unanswered_count,
           base_points, speed_bonus, total_points, score_percent,
           duration_ms, finish_rank
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (quiz_id, student_id) DO NOTHING
         RETURNING *`,
        [
          quiz.id,
          attemptId,
          studentId,
          scored.correct_count,
          scored.wrong_count,
          scored.unanswered_count,
          scored.base_points,
          speedBonus,
          totalPoints,
          scorePercent,
          durationMs,
          finishRank,
        ],
      );

      if (!resultIns.rowCount) {
        await client.query('COMMIT');
        return this.getResultPayload(quiz.id, studentId, tenantId);
      }

      const resultRow = resultIns.rows[0];
      await DailyQuizLeaderboard.upsertMonthly(client, {
        tenantId,
        gradeId: quiz.grade_id,
        studentId,
        totalPoints,
        correctCount: scored.correct_count,
        durationMs,
        isFirst: finishRank === 1,
      });

      await DailyQuizGamification.applyAfterSubmit(client, {
        tenantId,
        studentId,
        quizId: quiz.id,
        attemptId,
        basePoints: scored.base_points,
        speedBonus,
        totalPoints,
        finishRank,
        correctCount: scored.correct_count,
        totalQuestions: questions.length,
      });

      await client.query('COMMIT');

      // خارج الترانزاكشن: نقاط المنصة العامة + إشعارات
      void StudentPointsService.addPoints(
        studentId,
        Math.min(20, Math.max(1, Math.round(totalPoints / 50))),
        'exam_solved',
        quiz.id,
        `مسابقة يومية: ${quiz.title}`,
      ).catch(() => undefined);
      void DailyQuizGamification.notifyRankIfNeeded(tenantId, studentId, quiz, finishRank);

      return {
        result: resultRow,
        reveal_answers: DailyQuizService.canRevealAnswers(quiz, true),
        answers: scored.scored.map((s) => {
          const q = questions.find((qq) => qq.id === s.question_id);
          return {
            ...s,
            correct_answer: DailyQuizService.canRevealAnswers(quiz, true)
              ? q?.correct_answer
              : undefined,
          };
        }),
        leaderboard_preview: await DailyQuizLeaderboard.getDaily(quiz.id, studentId, 10),
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async finalizeExpired(attemptId: number, studentId: number, tenantId: number) {
    return this.submit({
      attemptId,
      studentId,
      tenantId,
      answers: [],
      forceExpired: true,
    });
  }

  static async getAttemptPayload(
    attemptId: number,
    studentId: number,
    tenantId: number,
    includeCorrect: boolean,
  ) {
    const attempt = await this.requireOwnedAttempt(attemptId, studentId);
    const quiz = await DailyQuizService.getById(attempt.quiz_id, tenantId);
    if (!quiz) throw new HttpError(404, 'المسابقة غير موجودة');

    if (attempt.status === 'in_progress' && new Date(attempt.expires_at) <= new Date()) {
      return this.finalizeExpired(attemptId, studentId, tenantId);
    }

    const questions = (
      await pool.query<DailyQuizQuestionRow>(
        `SELECT * FROM daily_quiz_questions WHERE quiz_id = $1`,
        [quiz.id],
      )
    ).rows;

    const answers = (
      await pool.query(
        `SELECT question_id, selected_answer FROM daily_quiz_attempt_answers WHERE attempt_id = $1`,
        [attemptId],
      )
    ).rows;

    const publicQuestions = DailyQuizService.buildPublicQuestions(
      questions,
      (attempt.question_order as number[]) || questions.map((q) => q.id),
      (attempt.option_orders as Record<string, Array<'A' | 'B' | 'C' | 'D'>>) || {},
    );

    const now = Date.now();
    const remainingMs = Math.max(0, new Date(attempt.expires_at).getTime() - now);

    return {
      attempt: {
        id: attempt.id,
        quiz_id: quiz.id,
        status: attempt.status,
        started_at: attempt.started_at,
        expires_at: attempt.expires_at,
        remaining_ms: remainingMs,
        submit_token: attempt.submit_token,
        allow_navigation: quiz.allow_navigation,
        last_autosave_at: attempt.last_autosave_at,
      },
      quiz: {
        id: quiz.id,
        title: quiz.title,
        duration_seconds: quiz.duration_seconds,
        max_points: quiz.max_points,
        questions_count: quiz.questions_count,
        ends_at: quiz.ends_at,
        teacher_name: quiz.teacher_name,
      },
      questions: publicQuestions,
      saved_answers: answers,
      correct_answers: includeCorrect
        ? questions.map((q) => ({ question_id: q.id, correct_answer: q.correct_answer }))
        : undefined,
    };
  }

  static async getResultPayload(quizId: number, studentId: number, tenantId: number) {
    const quiz = await DailyQuizService.getById(quizId, tenantId);
    if (!quiz) throw new HttpError(404, 'المسابقة غير موجودة');
    const result = await pool.query(
      `SELECT r.*, u.name AS student_name, u.avatar AS student_avatar
       FROM daily_quiz_results r
       JOIN users u ON u.id = r.student_id
       WHERE r.quiz_id = $1 AND r.student_id = $2`,
      [quizId, studentId],
    );
    if (!result.rowCount) throw new HttpError(404, 'لا توجد نتيجة');

    const reveal = DailyQuizService.canRevealAnswers(quiz, true);
    let review = null;
    if (reveal) {
      const answers = await pool.query(
        `SELECT a.question_id, a.selected_answer, a.is_correct, a.points_awarded,
                q.question_text, q.correct_answer, q.points
         FROM daily_quiz_attempt_answers a
         JOIN daily_quiz_questions q ON q.id = a.question_id
         WHERE a.attempt_id = $1
         ORDER BY q.question_order, q.id`,
        [result.rows[0].attempt_id],
      );
      review = answers.rows;
    }

    return {
      result: result.rows[0],
      reveal_answers: reveal,
      review,
      leaderboard: await DailyQuizLeaderboard.getDaily(quizId, studentId, 50),
    };
  }

  private static async requireOwnedAttempt(attemptId: number, studentId: number) {
    const result = await pool.query(
      `SELECT * FROM daily_quiz_attempts WHERE id = $1 AND student_id = $2`,
      [attemptId, studentId],
    );
    if (!result.rowCount) throw new HttpError(404, 'المحاولة غير موجودة');
    return result.rows[0];
  }
}
