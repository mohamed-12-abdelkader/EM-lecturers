import pool from '../db/pool';

export interface QuestionOption {
  option_text: string;
  option_letter: 'a' | 'b' | 'c' | 'd';
}

export interface TextQuestionData {
  question_text: string;
  options: QuestionOption[]; // 4 خيارات مع نص كل خيار
  correct_answer: 'a' | 'b' | 'c' | 'd'; // الحرف الصحيح
  order_index?: number;
}

export interface ImageQuestionData {
  image_urls: string[]; // حتى 10 صور
  options?: QuestionOption[]; // خيارات مخصصة (اختياري - افتراضي: أ، ب، ج، د)
  correct_answer?: 'a' | 'b' | 'c' | 'd'; // الحرف الصحيح (اختياري - افتراضي: a)
  order_index?: number;
}

export interface UpdateQuestionData {
  question_text?: string;
  option_a?: string;
  option_b?: string;
  option_c?: string;
  option_d?: string;
  correct_answer?: 'a' | 'b' | 'c' | 'd';
  order_index?: number;
  image_urls?: string[]; // للأسئلة بالصور
}

export class AssignmentQuestionsService {
  // جلب جميع أسئلة واجب معين
  static async getQuestionsByAssignment(assignmentId: number) {
    const questionsResult = await pool.query(
      `SELECT * FROM assignment_questions 
       WHERE assignment_id = $1 
       ORDER BY order_index ASC, created_at ASC`,
      [assignmentId],
    );

    const questions = questionsResult.rows;

    // جلب الخيارات والصور لكل سؤال
    for (const question of questions) {
      // جلب الخيارات مع IDs
      const optionsResult = await pool.query(
        `SELECT id, option_text, option_letter, order_index 
         FROM assignment_question_options 
         WHERE question_id = $1 
         ORDER BY order_index ASC, option_letter ASC`,
        [question.id],
      );
      question.options = optionsResult.rows;

      // جلب الصور إذا كان السؤال من نوع صورة
      if (question.question_type === 'image') {
        const imagesResult = await pool.query(
          `SELECT id, image_url, order_index 
           FROM assignment_question_images 
           WHERE question_id = $1 
           ORDER BY order_index ASC`,
          [question.id],
        );
        question.images = imagesResult.rows;
      } else {
        question.images = [];
      }
    }

    return questions;
  }

  // جلب سؤال محدد
  static async getQuestionById(questionId: number) {
    const questionResult = await pool.query('SELECT * FROM assignment_questions WHERE id = $1', [
      questionId,
    ]);

    if (questionResult.rows.length === 0) {
      return null;
    }

    const question = questionResult.rows[0];

    // جلب الخيارات مع IDs
    const optionsResult = await pool.query(
      `SELECT id, option_text, option_letter, order_index 
       FROM assignment_question_options 
       WHERE question_id = $1 
       ORDER BY order_index ASC, option_letter ASC`,
      [questionId],
    );
    question.options = optionsResult.rows;

    // جلب الصور إذا كان السؤال من نوع صورة
    if (question.question_type === 'image') {
      const imagesResult = await pool.query(
        `SELECT id, image_url, order_index 
         FROM assignment_question_images 
         WHERE question_id = $1 
         ORDER BY order_index ASC`,
        [questionId],
      );
      question.images = imagesResult.rows;
    } else {
      question.images = [];
    }

    return question;
  }

  // إضافة سؤال نصي
  static async createTextQuestion(assignmentId: number, data: TextQuestionData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // التحقق من وجود 4 خيارات
      if (!data.options || data.options.length !== 4) {
        throw new Error('يجب إضافة 4 خيارات للسؤال');
      }

      // التحقق من وجود جميع الأحرف (a, b, c, d)
      const letters = data.options.map((opt) => opt.option_letter).sort();
      if (letters.join('') !== 'abcd') {
        throw new Error('يجب أن تكون الخيارات a, b, c, d');
      }

      // إدراج السؤال
      const questionResult = await client.query(
        `INSERT INTO assignment_questions 
         (assignment_id, question_type, question_text, option_a, option_b, option_c, option_d, correct_answer, order_index)
         VALUES ($1, 'text', $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          assignmentId,
          data.question_text,
          data.options.find((o) => o.option_letter === 'a')?.option_text || '',
          data.options.find((o) => o.option_letter === 'b')?.option_text || '',
          data.options.find((o) => o.option_letter === 'c')?.option_text || '',
          data.options.find((o) => o.option_letter === 'd')?.option_text || '',
          data.correct_answer,
          data.order_index || 0,
        ],
      );

      const question = questionResult.rows[0];

      // إدراج الخيارات مع IDs
      const options = [];
      for (let i = 0; i < data.options.length; i++) {
        const opt = data.options[i];
        const optionResult = await client.query(
          `INSERT INTO assignment_question_options 
           (question_id, option_text, option_letter, order_index)
           VALUES ($1, $2, $3, $4)
           RETURNING id, option_text, option_letter, order_index`,
          [question.id, opt.option_text, opt.option_letter, i],
        );
        options.push(optionResult.rows[0]);
      }

      // تحديث correct_option_id في السؤال
      const correctOption = options.find((o) => o.option_letter === data.correct_answer);
      if (correctOption) {
        await client.query('UPDATE assignment_questions SET correct_option_id = $1 WHERE id = $2', [
          correctOption.id,
          question.id,
        ]);
        question.correct_option_id = correctOption.id;
      }

      question.options = options;
      question.images = [];

      await client.query('COMMIT');
      return question;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // إضافة سؤال بصورة
  static async createImageQuestion(assignmentId: number, data: ImageQuestionData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // التحقق من عدد الصور (حد أقصى 10)
      if (data.image_urls.length === 0) {
        throw new Error('يجب إضافة صورة واحدة على الأقل');
      }
      if (data.image_urls.length > 10) {
        throw new Error('الحد الأقصى للصور هو 10 صور');
      }

      // الخيارات: إما مخصصة أو افتراضية (أ، ب، ج، د)
      const defaultOptions: QuestionOption[] = [
        { option_text: 'أ', option_letter: 'a' },
        { option_text: 'ب', option_letter: 'b' },
        { option_text: 'ج', option_letter: 'c' },
        { option_text: 'د', option_letter: 'd' },
      ];
      const options = data.options || defaultOptions;
      const correctAnswer = data.correct_answer || 'a';

      // التحقق من وجود 4 خيارات
      if (options.length !== 4) {
        throw new Error('يجب إضافة 4 خيارات للسؤال');
      }

      // التحقق من وجود جميع الأحرف (a, b, c, d)
      const letters = options.map((opt) => opt.option_letter).sort();
      if (letters.join('') !== 'abcd') {
        throw new Error('يجب أن تكون الخيارات a, b, c, d');
      }

      // إدراج السؤال
      const questionResult = await client.query(
        `INSERT INTO assignment_questions 
         (assignment_id, question_type, question_text, option_a, option_b, option_c, option_d, correct_answer, order_index)
         VALUES ($1, 'image', NULL, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          assignmentId,
          options.find((o) => o.option_letter === 'a')?.option_text || 'أ',
          options.find((o) => o.option_letter === 'b')?.option_text || 'ب',
          options.find((o) => o.option_letter === 'c')?.option_text || 'ج',
          options.find((o) => o.option_letter === 'd')?.option_text || 'د',
          correctAnswer,
          data.order_index || 0,
        ],
      );

      const question = questionResult.rows[0];

      // إدراج الخيارات مع IDs
      const questionOptions = [];
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const optionResult = await client.query(
          `INSERT INTO assignment_question_options 
           (question_id, option_text, option_letter, order_index)
           VALUES ($1, $2, $3, $4)
           RETURNING id, option_text, option_letter, order_index`,
          [question.id, opt.option_text, opt.option_letter, i],
        );
        questionOptions.push(optionResult.rows[0]);
      }

      // تحديث correct_option_id في السؤال
      const correctOption = questionOptions.find((o) => o.option_letter === correctAnswer);
      if (correctOption) {
        await client.query('UPDATE assignment_questions SET correct_option_id = $1 WHERE id = $2', [
          correctOption.id,
          question.id,
        ]);
        question.correct_option_id = correctOption.id;
      }

      // إدراج الصور
      const images = [];
      for (let i = 0; i < data.image_urls.length; i++) {
        const imageResult = await client.query(
          `INSERT INTO assignment_question_images (question_id, image_url, order_index)
           VALUES ($1, $2, $3)
           RETURNING id, image_url, order_index`,
          [question.id, data.image_urls[i], i],
        );
        images.push(imageResult.rows[0]);
      }

      question.options = questionOptions;
      question.images = images;

      await client.query('COMMIT');
      return question;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // تحديث سؤال
  static async updateQuestion(questionId: number, data: UpdateQuestionData) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // جلب السؤال الحالي
      const currentQuestion = await this.getQuestionById(questionId);
      if (!currentQuestion) {
        throw new Error('السؤال غير موجود');
      }

      // تحديث بيانات السؤال
      const updates: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (data.question_text !== undefined) {
        updates.push(`question_text = $${paramIndex++}`);
        values.push(data.question_text);
      }
      if (data.option_a !== undefined) {
        updates.push(`option_a = $${paramIndex++}`);
        values.push(data.option_a);
      }
      if (data.option_b !== undefined) {
        updates.push(`option_b = $${paramIndex++}`);
        values.push(data.option_b);
      }
      if (data.option_c !== undefined) {
        updates.push(`option_c = $${paramIndex++}`);
        values.push(data.option_c);
      }
      if (data.option_d !== undefined) {
        updates.push(`option_d = $${paramIndex++}`);
        values.push(data.option_d);
      }
      if (data.correct_answer !== undefined) {
        updates.push(`correct_answer = $${paramIndex++}`);
        values.push(data.correct_answer);
      }
      if (data.order_index !== undefined) {
        updates.push(`order_index = $${paramIndex++}`);
        values.push(data.order_index);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        values.push(questionId);

        await client.query(
          `UPDATE assignment_questions 
           SET ${updates.join(', ')} 
           WHERE id = $${paramIndex}`,
          values,
        );
      }

      // تحديث الصور إذا كانت من نوع صورة وتم توفير image_urls
      if (currentQuestion.question_type === 'image' && data.image_urls !== undefined) {
        // التحقق من عدد الصور
        if (data.image_urls.length > 10) {
          throw new Error('الحد الأقصى للصور هو 10 صور');
        }

        // حذف الصور القديمة
        await client.query('DELETE FROM assignment_question_images WHERE question_id = $1', [
          questionId,
        ]);

        // إضافة الصور الجديدة
        for (let i = 0; i < data.image_urls.length; i++) {
          await client.query(
            `INSERT INTO assignment_question_images (question_id, image_url, order_index)
             VALUES ($1, $2, $3)`,
            [questionId, data.image_urls[i], i],
          );
        }
      }

      await client.query('COMMIT');

      // جلب السؤال المحدث
      return await this.getQuestionById(questionId);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * تحديث الإجابة/الإجابات الصحيحة (1 أو 2 حروف من a–d).
   * يقبل حرفاً واحداً أو مصفوفة من حرف أو حرفين مميزين.
   */
  static async updateCorrectAnswer(
    questionId: number,
    correctAnswer:
      | 'a'
      | 'b'
      | 'c'
      | 'd'
      | Array<'a' | 'b' | 'c' | 'd' | string>,
  ) {
    const unique = [
      ...new Set(
        (Array.isArray(correctAnswer) ? correctAnswer : [correctAnswer])
          .map((v) => String(v).trim().toLowerCase())
          .filter((v) => ['a', 'b', 'c', 'd'].includes(v)),
      ),
    ] as Array<'a' | 'b' | 'c' | 'd'>;

    if (unique.length < 1 || unique.length > 2) {
      throw Object.assign(
        new Error('correctAnswers must contain 1 or 2 distinct letters from a, b, c, d'),
        { status: 400 },
      );
    }

    const primary = unique[0];
    const secondary = unique[1] ?? null;

    // مزامنة correct_option_id(_2) من حروف الإجابات
    const optionsResult = await pool.query(
      `SELECT id, option_letter FROM assignment_question_options WHERE question_id = $1`,
      [questionId],
    );
    const byLetter = new Map(
      optionsResult.rows.map((o: { id: number; option_letter: string }) => [
        String(o.option_letter).toLowerCase(),
        o.id,
      ]),
    );
    const correctOptionId = byLetter.get(primary) ?? null;
    const correctOptionId2 = secondary ? byLetter.get(secondary) ?? null : null;

    let result;
    try {
      result = await pool.query(
        `UPDATE assignment_questions
         SET correct_answer = $1,
             correct_answer_2 = $2,
             correct_option_id = COALESCE($3, correct_option_id),
             correct_option_id_2 = $4,
             updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [primary, secondary, correctOptionId, correctOptionId2, questionId],
      );
    } catch (err: any) {
      // أعمدة الإجابة الثانية قد تكون غير موجودة قبل تشغيل migration
      if (
        err?.message?.includes('correct_answer_2') ||
        err?.message?.includes('correct_option_id_2')
      ) {
        if (unique.length > 1) {
          throw Object.assign(
            new Error(
              'Second correct answer is not available. Run migration 1779300000000_dual_correct_answers_assignment_lecture.',
            ),
            { status: 501 },
          );
        }
        result = await pool.query(
          `UPDATE assignment_questions
           SET correct_answer = $1,
               correct_option_id = COALESCE($2, correct_option_id),
               updated_at = NOW()
           WHERE id = $3
           RETURNING *`,
          [primary, correctOptionId, questionId],
        );
      } else {
        throw err;
      }
    }

    if (result.rows.length === 0) {
      return null;
    }

    const question = result.rows[0];
    question.correct_answers = unique;

    // جلب الصور إذا كان السؤال من نوع صورة
    if (question.question_type === 'image') {
      const imagesResult = await pool.query(
        `SELECT id, image_url, order_index 
         FROM assignment_question_images 
         WHERE question_id = $1 
         ORDER BY order_index ASC`,
        [questionId],
      );
      question.images = imagesResult.rows;
    } else {
      question.images = [];
    }

    return question;
  }

  /**
   * حذف سؤال من الواجب وإعادة احتساب كل التسليمات السابقة.
   * لا يحذف السؤال من أي مصدر خارج الواجب.
   */
  static async deleteQuestion(questionId: number) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const qRes = await client.query<{ id: number; assignment_id: number }>(
        `SELECT id, assignment_id FROM assignment_questions WHERE id = $1 FOR UPDATE`,
        [questionId],
      );
      if (!qRes.rowCount) {
        await client.query('ROLLBACK');
        return null;
      }

      const deletedQuestionId = Number(qRes.rows[0].id);
      const assignmentId = Number(qRes.rows[0].assignment_id);

      const result = await client.query(
        `DELETE FROM assignment_questions WHERE id = $1 RETURNING *`,
        [deletedQuestionId],
      );

      const remainingCountRes = await client.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM assignment_questions WHERE assignment_id = $1`,
        [assignmentId],
      );
      const remainingQuestionCount = Number(remainingCountRes.rows[0]?.cnt ?? 0);

      const { recomputeAssignmentSubmissionAfterQuestionDelete } = await import(
        './examQuestionDeleteRegrade.js'
      );

      const submissionsRes = await client.query(
        `SELECT id, total_questions, correct_answers, wrong_answers, score
         FROM assignment_submissions
         WHERE assignment_id = $1`,
        [assignmentId],
      );

      let submissionsUpdated = 0;
      for (const sub of submissionsRes.rows) {
        const answersRes = await client.query<{ is_correct: boolean }>(
          `SELECT is_correct FROM assignment_submission_answers WHERE submission_id = $1`,
          [sub.id],
        );
        const recomputed = recomputeAssignmentSubmissionAfterQuestionDelete({
          remainingQuestionCount,
          remainingAnswers: answersRes.rows.map((a) => ({ isCorrect: !!a.is_correct })),
        });

        if (
          Number(sub.total_questions) !== recomputed.totalQuestions ||
          Number(sub.correct_answers) !== recomputed.correctAnswers ||
          Number(sub.wrong_answers) !== recomputed.wrongAnswers ||
          Number(sub.score) !== recomputed.score
        ) {
          await client.query(
            `UPDATE assignment_submissions
             SET total_questions = $1,
                 correct_answers = $2,
                 wrong_answers = $3,
                 score = $4
             WHERE id = $5`,
            [
              recomputed.totalQuestions,
              recomputed.correctAnswers,
              recomputed.wrongAnswers,
              recomputed.score,
              sub.id,
            ],
          );
          submissionsUpdated += 1;
        }
      }

      await client.query('COMMIT');
      const deleted = result.rows[0] || null;
      if (deleted) {
        (deleted as any).regrade = {
          assignmentId,
          deletedQuestionId,
          submissionsUpdated,
          remainingQuestionCount,
        };
      }
      return deleted;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // التحقق من وجود الواجب
  static async getAssignmentById(assignmentId: number) {
    const result = await pool.query(
      'SELECT * FROM package_subject_item_lesson_assignments WHERE id = $1',
      [assignmentId],
    );
    return result.rows[0] || null;
  }
}
