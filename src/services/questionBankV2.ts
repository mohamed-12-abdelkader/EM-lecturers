import pool from '../db/pool';
import * as fs from 'fs';
import {
  QuestionV2,
  QuestionOption,
  QuestionMedia,
  QuestionPassage,
  OptionType,
  BulkTextQuestionsSchema,
  ImageChoicesQuestionSchema,
  QuestionMediaSchema,
  UpdateQuestionStatusSchema,
  CreatePassageWithQuestionsSchema
} from '../db/types/questionBankV2';
import { uploadToCloudinary } from '../utils';
import { z } from 'zod';

export class QuestionBankV2Service {
  // ============================================
  // 1. إضافة أسئلة نصية جماعية (Bulk Add)
  // ============================================
  static async createBulkTextQuestions(
    lessonId: number,
    userId: number,
    data: z.infer<typeof BulkTextQuestionsSchema>,
    userRole?: string
  ): Promise<QuestionV2[]> {
    const { questions } = data;
    const createdQuestions: QuestionV2[] = [];

    // التحقق من وجود الدرس وصلاحيات المستخدم
    await this.verifyLessonAccess(lessonId, userId, userRole);

    // بدء Transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const questionData of questions) {
        // إضافة السؤال
        const questionResult = await client.query(
          `INSERT INTO questions_v2 (
            question_text, question_type, lesson_id, teacher_id,
            correct_answer_index, explanation, difficulty_level, points, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
          RETURNING *`,
          [
            questionData.question_text,
            'text_only',
            lessonId,
            userId,
            questionData.correct_answer_index,
            questionData.explanation || null,
            questionData.difficulty_level,
            questionData.points
          ]
        );

        const question = questionResult.rows[0];
        const questionId = question.id;

        // إضافة الخيارات
        for (const option of questionData.options) {
          await client.query(
            `INSERT INTO question_options (
              question_id, option_index, option_type, text_content
            ) VALUES ($1, $2, $3, $4)`,
            [
              questionId,
              option.option_index,
              option.option_type,
              option.text_content
            ]
          );
        }

        // جلب السؤال مع خياراته
        const fullQuestion = await this.getQuestionById(questionId, client);
        if (fullQuestion) {
          createdQuestions.push(fullQuestion);
        }
      }

      await client.query('COMMIT');
      return createdQuestions;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // 2. إضافة سؤال باختيارات صور
  // ============================================
  static async createImageChoicesQuestion(
    userId: number,
    data: {
      question_text: string;
      lesson_id: number;
      options: Array<{ option_index: number; option_type: 'image' }>;
      correct_answer_index: number;
      explanation?: string;
      difficulty_level: 'easy' | 'medium' | 'hard';
      points: number;
    },
    optionFiles: Express.Multer.File[], // 4 ملفات للخيارات
    userRole?: string
  ): Promise<QuestionV2> {
    const { question_text, lesson_id, options, correct_answer_index, explanation, difficulty_level, points } = data;

    // التحقق من وجود الدرس وصلاحيات المستخدم
    await this.verifyLessonAccess(lesson_id, userId, userRole);

    // التحقق من وجود 4 ملفات
    if (!optionFiles || optionFiles.length !== 4) {
      throw new Error('يجب رفع 4 صور للخيارات');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // إضافة السؤال
      const questionResult = await client.query(
        `INSERT INTO questions_v2 (
          question_text, question_type, lesson_id, teacher_id,
          correct_answer_index, explanation, difficulty_level, points, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        RETURNING *`,
        [
          question_text,
          'image_choices',
          lesson_id,
          userId,
          correct_answer_index,
          explanation || null,
          difficulty_level,
          points
        ]
      );

      const question = questionResult.rows[0];
      const questionId = question.id;

      // رفع الصور وإضافة الخيارات
      for (let i = 0; i < 4; i++) {
        const file = optionFiles[i];
        const optionData = options[i];

        // رفع الصورة
        const uploaded = await uploadToCloudinary(file.path, { resource_type: 'image' });

        // إضافة الخيار
        await client.query(
          `INSERT INTO question_options (
            question_id, option_index, option_type, image_url
          ) VALUES ($1, $2, $3, $4)`,
          [
            questionId,
            optionData.option_index,
            'image',
            uploaded.secure_url
          ]
        );
      }

      await client.query('COMMIT');

      // جلب السؤال كامل
      const fullQuestion = await this.getQuestionById(questionId);
      if (!fullQuestion) {
        throw new Error('فشل في جلب السؤال بعد الإنشاء');
      }

      return fullQuestion;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================
  // قطعة + أسئلة MCQ (Passage with MCQs)
  // ============================================
  static async createPassageWithQuestions(
    userId: number,
    data: z.infer<typeof CreatePassageWithQuestionsSchema>,
    userRole?: string
  ): Promise<{ passage: QuestionPassage; questions: QuestionV2[] }> {
    const { lesson_id, title, content, questions: questionsData } = data;
    await this.verifyLessonAccess(lesson_id, userId, userRole);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const passageResult = await client.query(
        `INSERT INTO question_passages (lesson_id, title, content, order_index)
         VALUES ($1, $2, $3, 0) RETURNING *`,
        [lesson_id, title ?? null, content]
      );
      const passageRow = passageResult.rows[0];
      const passageId = passageRow.id;

      const createdQuestions: QuestionV2[] = [];
      for (const qData of questionsData) {
        const questionResult = await client.query(
          `INSERT INTO questions_v2 (
            question_text, question_type, lesson_id, teacher_id, passage_id,
            correct_answer_index, explanation, difficulty_level, points, status
          ) VALUES ($1, 'text_only', $2, $3, $4, $5, $6, $7, $8, 'pending')
          RETURNING *`,
          [
            qData.question_text,
            lesson_id,
            userId,
            passageId,
            qData.correct_answer_index,
            qData.explanation ?? null,
            qData.difficulty_level,
            qData.points
          ]
        );
        const qRow = questionResult.rows[0];
        for (const opt of qData.options) {
          await client.query(
            `INSERT INTO question_options (question_id, option_index, option_type, text_content)
             VALUES ($1, $2, $3, $4)`,
            [qRow.id, opt.option_index, opt.option_type, opt.text_content ?? '']
          );
        }
        const fullQ = await this.getQuestionById(qRow.id, client);
        if (fullQ) createdQuestions.push(fullQ);
      }

      await client.query('COMMIT');

      const passage: QuestionPassage = {
        id: passageRow.id,
        lesson_id: passageRow.lesson_id,
        title: passageRow.title,
        content: passageRow.content,
        order_index: passageRow.order_index,
        created_at: new Date(passageRow.created_at),
        updated_at: new Date(passageRow.updated_at || passageRow.created_at)
      };
      return { passage, questions: createdQuestions };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async getPassageById(passageId: number, client?: any): Promise<QuestionPassage | null> {
    const queryClient = client || pool;
    const r = await queryClient.query(
      `SELECT id, lesson_id, title, content, order_index, created_at, updated_at
       FROM question_passages WHERE id = $1`,
      [passageId]
    );
    if (r.rows.length === 0) return null;
    const row = r.rows[0];
    return {
      id: row.id,
      lesson_id: row.lesson_id,
      title: row.title,
      content: row.content,
      order_index: row.order_index,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at || row.created_at)
    };
  }

  static async getPassageWithQuestions(passageId: number): Promise<{ passage: QuestionPassage; questions: QuestionV2[] } | null> {
    const passage = await this.getPassageById(passageId);
    if (!passage) return null;
    const qResult = await pool.query(
      `SELECT id FROM questions_v2 WHERE passage_id = $1 ORDER BY id ASC`,
      [passageId]
    );
    const questions: QuestionV2[] = [];
    for (const row of qResult.rows) {
      const q = await this.getQuestionById(row.id);
      if (q) questions.push(q);
    }
    return { passage, questions };
  }

  /**
   * جلب كل القطع وأسئلتها الموجودة في الدرس
   */
  static async getLessonPassages(lessonId: number): Promise<{ passage: QuestionPassage; questions: QuestionV2[] }[]> {
    const passagesResult = await pool.query(
      `SELECT id FROM question_passages WHERE lesson_id = $1 ORDER BY order_index ASC, id ASC`,
      [lessonId]
    );
    const out: { passage: QuestionPassage; questions: QuestionV2[] }[] = [];
    for (const row of passagesResult.rows) {
      const item = await this.getPassageWithQuestions(row.id);
      if (item) out.push(item);
    }
    return out;
  }

  /**
   * إضافة أسئلة صورة فقط (Bulk) - كل سؤال = صورة + 4 اختيارات ثابتة (a,b,c,d).
   * نظام مستقل (Additive) بدون المساس ببقية الـ APIs.
   * يدعم حتى 20 صورة في طلب واحد؛ في حال فشل جزء يُرجع تقرير نجاح/فشل.
   */
  static async createBulkImageOnlyQuestions(
    lessonId: number,
    teacherId: number,
    files: Express.Multer.File[],
    meta: Array<{ correct_answer_index: number; difficulty_level?: string; points?: number }>,
    userRole?: string
  ): Promise<{
    added: number;
    failed: number;
    questions: QuestionV2[];
    errors: Array<{ index: number; message: string }>;
  }> {
    await this.verifyLessonAccess(lessonId, teacherId, userRole);
    const options = ['a', 'b', 'c', 'd'];
    const questions: QuestionV2[] = [];
    const errors: Array<{ index: number; message: string }> = [];
    // 1. Upload to Cloudinary concurrently to save time
    const uploadOutcomes = await Promise.allSettled(
      files.map((file) => uploadToCloudinary(file.path, { resource_type: 'image' }))
    );

    // 2. Insert into database sequentially to guarantee ID/created_at order
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const outcome = uploadOutcomes[index];

      const m = meta[index] ?? {};
      const correct_answer_index = Math.min(3, Math.max(0, m.correct_answer_index ?? 0));
      const difficulty_level = (m.difficulty_level === 'easy' || m.difficulty_level === 'hard' ? m.difficulty_level : 'medium') as 'easy' | 'medium' | 'hard';
      const points = Math.max(1, Math.min(100, m.points ?? 1));

      if (outcome.status === 'rejected') {
        const message = outcome.reason?.message || String(outcome.reason) || 'فشل رفع الصورة';
        errors.push({ index, message });
        if (file.path) {
          try { fs.unlinkSync(file.path); } catch (_) { }
        }
        continue;
      }

      const uploaded = outcome.value;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const qResult = await client.query(
          `INSERT INTO questions_v2 (
            question_text, question_type, lesson_id, teacher_id,
            correct_answer_index, difficulty_level, points, status
          ) VALUES ($1, 'text_with_image', $2, $3, $4, $5, $6, 'pending')
          RETURNING *`,
          ['', lessonId, teacherId, correct_answer_index, difficulty_level, points]
        );
        const q = qResult.rows[0];
        const questionId = q.id;
        for (let i = 0; i < 4; i++) {
          await client.query(
            `INSERT INTO question_options (question_id, option_index, option_type, text_content)
             VALUES ($1, $2, 'text', $3)`,
            [questionId, i, options[i]]
          );
        }
        await client.query(
          `INSERT INTO question_media (question_id, media_type, media_url, uploaded_by)
           VALUES ($1, 'image', $2, $3)`,
          [questionId, uploaded.secure_url, teacherId]
        );
        await client.query('COMMIT');
        const full = await this.getQuestionById(questionId);
        if (full) {
          questions.push(full);
        }
      } catch (e: any) {
        await client.query('ROLLBACK').catch(() => { });
        errors.push({ index, message: e?.message || String(e) || 'فشل غير معروف' });
      } finally {
        client.release();
        if (file.path) {
          try { fs.unlinkSync(file.path); } catch (_) { }
        }
      }
    }
    return {
      added: questions.length,
      failed: errors.length,
      questions,
      errors,
    };
  }

  /**
   * التحقق من وجود السؤال في الجدول القديم (questions) - أسئلة الدرس/بنك الأسئلة
   */
  static async getLegacyQuestionById(questionId: number): Promise<{ id: number } | null> {
    const r = await pool.query(
      `SELECT id FROM questions WHERE id = $1`,
      [questionId]
    );
    if (r.rows.length === 0) return null;
    return r.rows[0];
  }

  // ============================================
  // 3. إضافة/تحديث صورة السؤال (Optional)
  // ============================================
  // يدعم أسئلة questions_v2 (جدول الموحد) وأسئلة questions (جدول الدرس/بنك الأسئلة)
  static async updateQuestionMedia(
    questionId: number,
    userId: number,
    mediaFile: Express.Multer.File,
    data: z.infer<typeof QuestionMediaSchema>,
    userRole?: string
  ): Promise<QuestionMedia> {
    const question = await this.getQuestionById(questionId);

    if (question) {
      // السؤال من جدول questions_v2
      if (userRole !== 'admin' && question.teacher_id !== userId) {
        throw new Error('ليس لديك صلاحية لتعديل هذا السؤال');
      }

      const uploaded = await uploadToCloudinary(mediaFile.path, { resource_type: 'image' });

      const result = await pool.query(
        `INSERT INTO question_media (
          question_id, media_type, media_url, media_name, media_size, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (question_id) DO UPDATE SET
          media_type = EXCLUDED.media_type,
          media_url = EXCLUDED.media_url,
          media_name = EXCLUDED.media_name,
          media_size = EXCLUDED.media_size,
          uploaded_by = EXCLUDED.uploaded_by
        RETURNING *`,
        [
          questionId,
          data.media_type,
          uploaded.secure_url,
          data.media_name || mediaFile.originalname,
          data.media_size || mediaFile.size,
          userId
        ]
      );

      if (question.question_type === 'text_only') {
        await pool.query(
          `UPDATE questions_v2 SET question_type = 'text_with_image' WHERE id = $1`,
          [questionId]
        );
      }

      return {
        id: result.rows[0].id,
        question_id: result.rows[0].question_id,
        media_type: result.rows[0].media_type,
        media_url: result.rows[0].media_url,
        media_name: result.rows[0].media_name,
        media_size: result.rows[0].media_size,
        uploaded_by: result.rows[0].uploaded_by,
        created_at: new Date(result.rows[0].created_at)
      };
    }

    // إن لم يُوجَد في questions_v2، التحقق من الجدول القديم (questions)
    const legacyQuestion = await this.getLegacyQuestionById(questionId);
    if (!legacyQuestion) {
      throw new Error('السؤال غير موجود');
    }
    // صلاحية التعديل: أي مدرس أو أدمن مسجل يمكنه إضافة صورة لسؤال الدرس

    const uploaded = await uploadToCloudinary(mediaFile.path, { resource_type: 'image' });
    await pool.query(`UPDATE questions SET image = $1 WHERE id = $2`, [uploaded.secure_url, questionId]);

    return {
      id: 0,
      question_id: questionId,
      media_type: data.media_type || 'image',
      media_url: uploaded.secure_url,
      media_name: data.media_name || mediaFile.originalname,
      media_size: data.media_size ?? mediaFile.size,
      uploaded_by: userId,
      created_at: new Date()
    };
  }

  // ============================================
  // 4. جلب سؤال مع خياراته وصوره
  // ============================================
  static async getQuestionById(
    questionId: number,
    client?: any
  ): Promise<QuestionV2 | null> {
    const queryClient = client || pool;

    const questionResult = await queryClient.query(
      `SELECT * FROM questions_v2 WHERE id = $1`,
      [questionId]
    );

    if (questionResult.rows.length === 0) {
      return null;
    }

    const question = questionResult.rows[0];

    // جلب الخيارات
    const optionsResult = await queryClient.query(
      `SELECT * FROM question_options WHERE question_id = $1 ORDER BY option_index ASC`,
      [questionId]
    );

    // جلب الصورة (إن وجدت)
    const mediaResult = await queryClient.query(
      `SELECT * FROM question_media WHERE question_id = $1 LIMIT 1`,
      [questionId]
    );

    const result: QuestionV2 = {
      id: question.id,
      question_text: question.question_text,
      question_type: question.question_type,
      lesson_id: question.lesson_id,
      teacher_id: question.teacher_id,
      correct_answer_index: question.correct_answer_index,
      explanation: question.explanation,
      difficulty_level: question.difficulty_level,
      points: question.points,
      status: question.status,
      approved_by: question.approved_by,
      approved_at: question.approved_at ? new Date(question.approved_at) : undefined,
      rejection_reason: question.rejection_reason,
      created_at: new Date(question.created_at),
      updated_at: new Date(question.updated_at),
      passage_id: question.passage_id ?? undefined,
      options: optionsResult.rows.map((row: any) => ({
        id: row.id,
        question_id: row.question_id,
        option_index: row.option_index,
        option_type: row.option_type,
        text_content: row.text_content,
        image_url: row.image_url,
        created_at: new Date(row.created_at)
      })),
      media: mediaResult.rows.length > 0 ? {
        id: mediaResult.rows[0].id,
        question_id: mediaResult.rows[0].question_id,
        media_type: mediaResult.rows[0].media_type,
        media_url: mediaResult.rows[0].media_url,
        media_name: mediaResult.rows[0].media_name,
        media_size: mediaResult.rows[0].media_size,
        uploaded_by: mediaResult.rows[0].uploaded_by,
        created_at: new Date(mediaResult.rows[0].created_at)
      } : undefined
    };

    if (question.passage_id) {
      const passage = await this.getPassageById(question.passage_id, queryClient);
      if (passage) result.passage = passage;
    }
    return result;
  }

  /**
   * جلب أسئلة الدرس من الجدول القديم (questions) - المُضافة عبر lesson-questions bulk
   */
  static async getLegacyLessonQuestions(lessonId: number): Promise<QuestionV2[]> {
    const r = await pool.query(
      `SELECT id, text, options, correct_answer, image, lesson_id, created_at, updated_at
       FROM questions WHERE lesson_id = $1 ORDER BY id ASC`,
      [lessonId]
    );
    const out: QuestionV2[] = [];
    const correctMap: Record<string, number> = {
      أ: 0, ب: 1, ج: 2, د: 3, هـ: 4, ه: 4,
      A: 0, B: 1, C: 2, D: 3, E: 4,
      a: 0, b: 1, c: 2, d: 3, e: 4,
      '1': 0, '2': 1, '3': 2, '4': 3, '5': 4,
    };
    for (const row of r.rows) {
      const opts = row.options;
      const optionsList: string[] = Array.isArray(opts)
        ? opts
        : opts && typeof opts === 'object' && !Array.isArray(opts)
          ? Object.values(opts)
          : [];
      const correctAnswerIndex =
        row.correct_answer != null
          ? correctMap[String(row.correct_answer).trim()] ?? 0
          : 0;
      const options: QuestionOption[] = optionsList.slice(0, 5).map((text_content: string, i: number) => ({
        id: 0,
        question_id: row.id,
        option_index: i,
        option_type: 'text' as OptionType,
        text_content: text_content ?? '',
        created_at: new Date(row.created_at)
      }));
      const q: QuestionV2 = {
        id: row.id,
        question_text: row.text ?? '',
        question_type: row.image ? 'text_with_image' : 'text_only',
        lesson_id: row.lesson_id,
        teacher_id: 0,
        correct_answer_index: correctAnswerIndex,
        difficulty_level: 'medium',
        points: 1,
        status: 'approved',
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at || row.created_at),
        options,
        media:
          row.image != null && String(row.image).trim() !== ''
            ? {
              id: 0,
              question_id: row.id,
              media_type: 'image' as const,
              media_url: row.image,
              uploaded_by: 0,
              created_at: new Date(row.created_at)
            }
            : undefined
      };
      out.push(q);
    }
    return out;
  }

  // ============================================
  // 5. جلب أسئلة الدرس (من questions_v2 + الجدول القديم questions)
  // ============================================
  static async getLessonQuestions(
    lessonId: number,
    status?: string,
    limit: number = 500,
    offset: number = 0
  ): Promise<{ questions: QuestionV2[]; total: number }> {
    let whereClause = 'WHERE lesson_id = $1';
    const params: any[] = [lessonId];
    let paramIndex = 2;

    if (status) {
      whereClause += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    // جلب من questions_v2
    const questionsResult = await pool.query(
      `SELECT * FROM questions_v2 ${whereClause} ORDER BY created_at DESC`,
      params
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM questions_v2 ${whereClause}`,
      params
    );
    const v2Total = parseInt(countResult.rows[0].total);

    const questions: QuestionV2[] = [];
    for (const question of questionsResult.rows) {
      const fullQuestion = await this.getQuestionById(question.id);
      if (fullQuestion) {
        questions.push(fullQuestion);
      }
    }

    // جلب أسئلة الجدول القديم (المُضافة عبر /lesson-questions/lessons/:id/questions/bulk)
    const legacyQuestions = await this.getLegacyLessonQuestions(lessonId);
    const legacyTotal = legacyQuestions.length;

    // دمج وترتيب حسب id ثم تطبيق limit/offset
    const merged = [...legacyQuestions, ...questions].sort((a, b) => a.id - b.id);
    const total = v2Total + legacyTotal;
    const paginated = merged.slice(offset, offset + limit);

    return { questions: paginated, total };
  }

  // ============================================
  // 6. تحديث حالة السؤال (Admin)
  // ============================================
  static async updateQuestionStatus(
    questionId: number,
    adminId: number,
    data: z.infer<typeof UpdateQuestionStatusSchema>
  ): Promise<QuestionV2> {
    const question = await this.getQuestionById(questionId);
    if (!question) {
      throw new Error('السؤال غير موجود');
    }

    if (question.status !== 'pending') {
      throw new Error('السؤال تمت مراجعته بالفعل');
    }

    const updateData: any = {
      status: data.status,
      approved_by: data.status === 'approved' ? adminId : null,
      approved_at: data.status === 'approved' ? new Date() : null,
      rejection_reason: data.status === 'rejected' ? data.rejection_reason : null
    };

    await pool.query(
      `UPDATE questions_v2 
       SET status = $1, approved_by = $2, approved_at = $3, rejection_reason = $4, updated_at = NOW()
       WHERE id = $5`,
      [updateData.status, updateData.approved_by, updateData.approved_at, updateData.rejection_reason, questionId]
    );

    const updatedQuestion = await this.getQuestionById(questionId);
    if (!updatedQuestion) {
      throw new Error('فشل في تحديث السؤال');
    }

    return updatedQuestion;
  }

  // ============================================
  // 6b. تحديث الإجابة الصحيحة لسؤال (Admin)
  // ============================================
  static async updateQuestionCorrectAnswer(
    questionId: number,
    correct_answer_index: number
  ): Promise<QuestionV2> {
    const question = await this.getQuestionById(questionId);
    if (!question) {
      throw new Error('السؤال غير موجود');
    }

    const index = Math.min(3, Math.max(0, correct_answer_index));

    await pool.query(
      `UPDATE questions_v2 SET correct_answer_index = $1, updated_at = NOW() WHERE id = $2`,
      [index, questionId]
    );

    const updated = await this.getQuestionById(questionId);
    if (!updated) {
      throw new Error('فشل في تحديث السؤال');
    }
    return updated;
  }

  // ============================================
  // 7. حذف سؤال
  // ============================================
  static async deleteQuestion(questionId: number, userId: number, userRole?: string): Promise<void> {
    const question = await this.getQuestionById(questionId);
    if (!question) {
      throw new Error('السؤال غير موجود');
    }

    // الأدمن لديه صلاحيات كاملة
    if (userRole !== 'admin' && question.teacher_id !== userId) {
      throw new Error('ليس لديك صلاحية لحذف هذا السؤال');
    }

    await pool.query('DELETE FROM questions_v2 WHERE id = $1', [questionId]);
  }

  // ============================================
  // Helper Methods
  // ============================================
  static async verifyLessonAccess(lessonId: number, userId: number, userRole?: string): Promise<void> {
    // التحقق من وجود الدرس
    const lessonResult = await pool.query(
      `SELECT l.id, c.subject_id, s.question_bank_id
       FROM lessons l
       JOIN chapters c ON c.id = l.chapter_id
       JOIN subjects s ON s.id = c.subject_id
       WHERE l.id = $1`,
      [lessonId]
    );

    if (lessonResult.rows.length === 0) {
      throw new Error('الدرس غير موجود');
    }

    const lesson = lessonResult.rows[0];

    // الأدمن لديه صلاحيات كاملة
    if (userRole === 'admin') {
      return;
    }

    // إذا كان الموظف لديه صلاحية إدارة بنك الأسئلة بالكامل
    if (userRole === 'employee') {
      const result = await pool.query(
        `SELECT permissions FROM employees WHERE user_id = $1 AND is_active = true`,
        [userId]
      );
      if ((result.rowCount ?? 0) > 0) {
        const permissions = result.rows[0].permissions || [];
        let hasPermission = false;
        if (Array.isArray(permissions)) {
          hasPermission = permissions.includes('question_bank_management');
        } else if (typeof permissions === 'object') {
          hasPermission = !!permissions['question_bank_management'];
        }
        if (hasPermission) return;
      }
    }

    // التحقق من صلاحيات المدرس
    const permissionResult = await pool.query(
      `SELECT id FROM teacher_permissions
       WHERE teacher_id = $1 AND subject_id = $2 AND is_active = true`,
      [userId, lesson.subject_id]
    );

    if (permissionResult.rows.length === 0) {
      throw new Error('ليس لديك صلاحية لإضافة أسئلة لهذه المادة');
    }
  }
}

