import crypto from 'crypto';
import pool from '../../db/pool';
import { HttpError } from '../../utils';
import type {
  CreateDailyQuizInput,
  DailyQuizQuestionInput,
  DailyQuizQuestionRow,
  DailyQuizRow,
  PublicQuizQuestion,
  UpdateDailyQuizInput,
} from '../../db/types/dailyQuiz';

const QUIZ_SELECT = `
  q.*,
  g.name AS grade_name,
  u.name AS teacher_name,
  u.avatar AS teacher_avatar
`;

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class DailyQuizService {
  static async assertTeacherOwns(
    quizId: number,
    teacherId: number,
    tenantId: number,
  ): Promise<DailyQuizRow> {
    const quiz = await this.getById(quizId, tenantId);
    if (!quiz) throw new HttpError(404, 'المسابقة غير موجودة');
    if (quiz.teacher_id !== teacherId) throw new HttpError(403, 'غير مصرح لك بهذه المسابقة');
    return quiz;
  }

  static async create(
    input: CreateDailyQuizInput,
    teacherId: number,
    tenantId: number,
  ): Promise<DailyQuizRow> {
    const gradeCheck = await pool.query(
      `SELECT 1 FROM teacher_grades WHERE teacher_id = $1 AND grade_id = $2`,
      [teacherId, input.grade_id],
    );
    if (!gradeCheck.rowCount) {
      throw new HttpError(400, 'الصف الدراسي غير مرتبط بحسابك');
    }

    const result = await pool.query<DailyQuizRow>(
      `INSERT INTO daily_quizzes (
         tenant_id, teacher_id, grade_id, title, description,
         starts_at, ends_at, duration_seconds, max_points, allow_one_attempt,
         questions_target, shuffle_questions, shuffle_options, allow_navigation,
         show_answers_mode, scoring_mode, rank_bonus_start, rank_bonus_step,
         rank_bonus_min, time_ratio_max_bonus, status, is_visible
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
       ) RETURNING *`,
      [
        tenantId,
        teacherId,
        input.grade_id,
        input.title.trim(),
        input.description ?? null,
        new Date(input.starts_at),
        new Date(input.ends_at),
        input.duration_seconds,
        input.max_points,
        input.allow_one_attempt,
        input.questions_target ?? 0,
        input.shuffle_questions,
        input.shuffle_options,
        input.allow_navigation,
        input.show_answers_mode,
        input.scoring_mode,
        input.rank_bonus_start,
        input.rank_bonus_step,
        input.rank_bonus_min,
        input.time_ratio_max_bonus,
        input.status,
        input.is_visible,
      ],
    );
    return result.rows[0];
  }

  static async update(
    quizId: number,
    teacherId: number,
    tenantId: number,
    input: UpdateDailyQuizInput,
  ): Promise<DailyQuizRow> {
    const existing = await this.assertTeacherOwns(quizId, teacherId, tenantId);

    const attempts = await pool.query(
      `SELECT COUNT(*)::int AS c FROM daily_quiz_attempts WHERE quiz_id = $1`,
      [quizId],
    );
    if (attempts.rows[0].c > 0) {
      const locked = ['starts_at', 'ends_at', 'duration_seconds', 'grade_id', 'scoring_mode'];
      for (const key of locked) {
        if ((input as Record<string, unknown>)[key] !== undefined) {
          throw new HttpError(400, `لا يمكن تعديل ${key} بعد بدء مشاركات الطلاب`);
        }
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    const map: Record<string, unknown> = { ...input };
    if (map.starts_at) map.starts_at = new Date(String(map.starts_at));
    if (map.ends_at) map.ends_at = new Date(String(map.ends_at));
    if (typeof map.title === 'string') map.title = map.title.trim();

    for (const [key, value] of Object.entries(map)) {
      if (value === undefined) continue;
      fields.push(`${key} = $${i++}`);
      values.push(value);
    }
    if (!fields.length) return existing;

    values.push(quizId, tenantId, teacherId);
    const result = await pool.query<DailyQuizRow>(
      `UPDATE daily_quizzes SET ${fields.join(', ')}
       WHERE id = $${i++} AND tenant_id = $${i++} AND teacher_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new HttpError(404, 'المسابقة غير موجودة');
    return result.rows[0];
  }

  static async delete(quizId: number, teacherId: number, tenantId: number): Promise<void> {
    await this.assertTeacherOwns(quizId, teacherId, tenantId);
    await pool.query(
      `DELETE FROM daily_quizzes WHERE id = $1 AND teacher_id = $2 AND tenant_id = $3`,
      [quizId, teacherId, tenantId],
    );
  }

  static async getById(quizId: number, tenantId?: number): Promise<DailyQuizRow | null> {
    const params: unknown[] = [quizId];
    let where = 'q.id = $1';
    if (tenantId != null) {
      params.push(tenantId);
      where += ` AND q.tenant_id = $2`;
    }
    const result = await pool.query(
      `SELECT ${QUIZ_SELECT}
       FROM daily_quizzes q
       LEFT JOIN grades g ON g.id = q.grade_id
       LEFT JOIN users u ON u.id = q.teacher_id
       WHERE ${where}`,
      params,
    );
    return result.rows[0] || null;
  }

  static async listForTeacher(
    teacherId: number,
    tenantId: number,
    opts: { grade_id?: number; status?: string; page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, opts.page || 1);
    const limit = Math.min(50, Math.max(1, opts.limit || 20));
    const offset = (page - 1) * limit;
    const params: unknown[] = [teacherId, tenantId];
    const where = ['q.teacher_id = $1', 'q.tenant_id = $2'];
    if (opts.grade_id) {
      params.push(opts.grade_id);
      where.push(`q.grade_id = $${params.length}`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`q.status = $${params.length}`);
    }

    const countRes = await pool.query(
      `SELECT COUNT(*)::int AS total FROM daily_quizzes q WHERE ${where.join(' AND ')}`,
      params,
    );
    params.push(limit, offset);
    const rows = await pool.query(
      `SELECT ${QUIZ_SELECT}
       FROM daily_quizzes q
       LEFT JOIN grades g ON g.id = q.grade_id
       LEFT JOIN users u ON u.id = q.teacher_id
       WHERE ${where.join(' AND ')}
       ORDER BY q.starts_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.rows, total: countRes.rows[0].total, page, limit };
  }

  static async publish(quizId: number, teacherId: number, tenantId: number) {
    const quiz = await this.assertTeacherOwns(quizId, teacherId, tenantId);
    if (quiz.questions_count < 1) {
      throw new HttpError(400, 'أضف سؤالاً واحداً على الأقل قبل النشر');
    }
    const result = await pool.query(
      `UPDATE daily_quizzes SET status = 'published'
       WHERE id = $1 RETURNING *`,
      [quizId],
    );
    return result.rows[0];
  }

  static async addQuestion(
    quizId: number,
    teacherId: number,
    tenantId: number,
    input: DailyQuizQuestionInput,
  ): Promise<DailyQuizQuestionRow> {
    await this.assertTeacherOwns(quizId, teacherId, tenantId);
    const order =
      input.question_order ??
      (
        await pool.query(
          `SELECT COALESCE(MAX(question_order), -1) + 1 AS n FROM daily_quiz_questions WHERE quiz_id = $1`,
          [quizId],
        )
      ).rows[0].n;

    const result = await pool.query<DailyQuizQuestionRow>(
      `INSERT INTO daily_quiz_questions (
         quiz_id, question_text, question_image_url,
         option_a, option_b, option_c, option_d,
         option_a_image_url, option_b_image_url, option_c_image_url, option_d_image_url,
         correct_answer, points, question_order
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [
        quizId,
        input.question_text.trim(),
        input.question_image_url ?? null,
        input.option_a,
        input.option_b,
        input.option_c,
        input.option_d,
        input.option_a_image_url ?? null,
        input.option_b_image_url ?? null,
        input.option_c_image_url ?? null,
        input.option_d_image_url ?? null,
        input.correct_answer,
        input.points,
        order,
      ],
    );
    return result.rows[0];
  }

  static async addQuestionsBulk(
    quizId: number,
    teacherId: number,
    tenantId: number,
    questions: DailyQuizQuestionInput[],
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await this.assertTeacherOwns(quizId, teacherId, tenantId);
      const created: DailyQuizQuestionRow[] = [];
      let order = (
        await client.query(
          `SELECT COALESCE(MAX(question_order), -1) + 1 AS n FROM daily_quiz_questions WHERE quiz_id = $1`,
          [quizId],
        )
      ).rows[0].n;

      for (const input of questions) {
        const result = await client.query<DailyQuizQuestionRow>(
          `INSERT INTO daily_quiz_questions (
             quiz_id, question_text, question_image_url,
             option_a, option_b, option_c, option_d,
             option_a_image_url, option_b_image_url, option_c_image_url, option_d_image_url,
             correct_answer, points, question_order
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING *`,
          [
            quizId,
            input.question_text.trim(),
            input.question_image_url ?? null,
            input.option_a,
            input.option_b,
            input.option_c,
            input.option_d,
            input.option_a_image_url ?? null,
            input.option_b_image_url ?? null,
            input.option_c_image_url ?? null,
            input.option_d_image_url ?? null,
            input.correct_answer,
            input.points,
            input.question_order ?? order++,
          ],
        );
        created.push(result.rows[0]);
      }
      await client.query('COMMIT');
      return created;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async updateQuestion(
    quizId: number,
    questionId: number,
    teacherId: number,
    tenantId: number,
    input: Partial<DailyQuizQuestionInput>,
  ) {
    await this.assertTeacherOwns(quizId, teacherId, tenantId);
    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) continue;
      fields.push(`${key} = $${i++}`);
      values.push(value);
    }
    if (!fields.length) {
      const cur = await pool.query(`SELECT * FROM daily_quiz_questions WHERE id = $1 AND quiz_id = $2`, [
        questionId,
        quizId,
      ]);
      return cur.rows[0];
    }
    values.push(questionId, quizId);
    const result = await pool.query(
      `UPDATE daily_quiz_questions SET ${fields.join(', ')}
       WHERE id = $${i++} AND quiz_id = $${i}
       RETURNING *`,
      values,
    );
    if (!result.rowCount) throw new HttpError(404, 'السؤال غير موجود');
    return result.rows[0];
  }

  static async deleteQuestion(
    quizId: number,
    questionId: number,
    teacherId: number,
    tenantId: number,
  ) {
    await this.assertTeacherOwns(quizId, teacherId, tenantId);
    const result = await pool.query(
      `DELETE FROM daily_quiz_questions WHERE id = $1 AND quiz_id = $2`,
      [questionId, quizId],
    );
    if (!result.rowCount) throw new HttpError(404, 'السؤال غير موجود');
  }

  static async listQuestions(quizId: number, includeCorrect = false) {
    const result = await pool.query<DailyQuizQuestionRow>(
      `SELECT * FROM daily_quiz_questions WHERE quiz_id = $1 ORDER BY question_order ASC, id ASC`,
      [quizId],
    );
    if (includeCorrect) return result.rows;
    return result.rows.map((q) => {
      const { correct_answer: _c, ...rest } = q;
      return rest;
    });
  }

  /** بطاقة المسابقة للطالب في الصفحة الرئيسية */
  static async getActiveCardForStudent(studentId: number, tenantId: number) {
    const now = new Date();
    const result = await pool.query(
      `SELECT ${QUIZ_SELECT},
         CASE
           WHEN q.starts_at > $3 THEN 'upcoming'
           WHEN q.ends_at < $3 THEN 'ended'
           ELSE 'live'
         END AS availability,
         EXTRACT(EPOCH FROM (q.starts_at - $3))::int AS seconds_to_start,
         EXTRACT(EPOCH FROM (q.ends_at - $3))::int AS seconds_to_end,
         EXISTS (
           SELECT 1 FROM daily_quiz_attempts a
           WHERE a.quiz_id = q.id AND a.student_id = $1
             AND a.status IN ('submitted', 'expired')
         ) AS already_submitted,
         (
           SELECT a.id FROM daily_quiz_attempts a
           WHERE a.quiz_id = q.id AND a.student_id = $1 AND a.status = 'in_progress'
           LIMIT 1
         ) AS active_attempt_id
       FROM daily_quizzes q
       INNER JOIN user_grades ug ON ug.grade_id = q.grade_id AND ug.user_id = $1
       LEFT JOIN grades g ON g.id = q.grade_id
       LEFT JOIN users u ON u.id = q.teacher_id
       WHERE q.tenant_id = $2
         AND q.status = 'published'
         AND q.is_visible = TRUE
         AND q.ends_at >= $3 - INTERVAL '6 hours'
       ORDER BY
         CASE WHEN q.starts_at <= $3 AND q.ends_at >= $3 THEN 0
              WHEN q.starts_at > $3 THEN 1 ELSE 2 END,
         q.starts_at ASC
       LIMIT 5`,
      [studentId, tenantId, now],
    );

    return result.rows.map((row) => {
      const availability = row.availability as string;
      const already = Boolean(row.already_submitted);
      return {
        id: row.id,
        title: row.title,
        teacher_name: row.teacher_name,
        teacher_avatar: row.teacher_avatar,
        grade_name: row.grade_name,
        questions_count: row.questions_count,
        duration_seconds: row.duration_seconds,
        max_points: row.max_points,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        availability,
        seconds_to_start: Math.max(0, row.seconds_to_start || 0),
        seconds_to_end: Math.max(0, row.seconds_to_end || 0),
        already_submitted: already,
        active_attempt_id: row.active_attempt_id,
        can_start: availability === 'live' && !already,
        show_countdown: availability === 'upcoming',
      };
    });
  }

  static buildPublicQuestions(
    questions: DailyQuizQuestionRow[],
    questionOrder: number[],
    optionOrders: Record<string, Array<'A' | 'B' | 'C' | 'D'>>,
  ): PublicQuizQuestion[] {
    const byId = new Map(questions.map((q) => [q.id, q]));
    const ordered = questionOrder.map((id) => byId.get(id)).filter(Boolean) as DailyQuizQuestionRow[];

    return ordered.map((q) => {
      const keys = optionOrders[String(q.id)] || (['A', 'B', 'C', 'D'] as const);
      const textMap = { A: q.option_a, B: q.option_b, C: q.option_c, D: q.option_d };
      const imgMap = {
        A: q.option_a_image_url,
        B: q.option_b_image_url,
        C: q.option_c_image_url,
        D: q.option_d_image_url,
      };
      return {
        id: q.id,
        question_text: q.question_text,
        question_image_url: q.question_image_url,
        points: q.points,
        options: keys.map((key) => ({
          key,
          text: textMap[key],
          image_url: imgMap[key],
        })),
      };
    });
  }

  static prepareShuffle(quiz: DailyQuizRow, questions: DailyQuizQuestionRow[]) {
    const ids = questions.map((q) => q.id);
    const questionOrder = quiz.shuffle_questions ? shuffleInPlace([...ids]) : ids;
    const optionOrders: Record<string, Array<'A' | 'B' | 'C' | 'D'>> = {};
    for (const q of questions) {
      const opts: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      optionOrders[String(q.id)] = quiz.shuffle_options ? shuffleInPlace([...opts]) : opts;
    }
    return { questionOrder, optionOrders };
  }

  static newSubmitToken(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  static windowState(quiz: DailyQuizRow, now = new Date()) {
    if (now < new Date(quiz.starts_at)) return 'upcoming' as const;
    if (now > new Date(quiz.ends_at)) return 'ended' as const;
    return 'live' as const;
  }

  static canRevealAnswers(quiz: DailyQuizRow, submitted: boolean, now = new Date()) {
    if (quiz.show_answers_mode === 'never') return false;
    if (quiz.show_answers_mode === 'after_submit') return submitted;
    return now >= new Date(quiz.ends_at);
  }
}
