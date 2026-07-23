import pool from '../db/pool';
import { uploadToCloudinary } from '../utils';
import { ExamFlowService } from './examFlow';

export class QuestionsManagementService {
  // إنشاء أسئلة دفعة واحدة من نص منسق
  static async createBulkQuestions(bulkText: string) {
    // تقسيم النص إلى كتل أسئلة
    const questionBlocks = bulkText
      .split(/\n\s*\n/)
      .map((b: string) => b.trim())
      .filter(Boolean);

    const questions: { question_text: string; options: Record<string, string> }[] = [];
    const invalidBlocks: number[] = [];

    questionBlocks.forEach((block: string, idx: number) => {
      const lines = block
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);

      if (lines.length < 5) {
        invalidBlocks.push(idx + 1);
        return;
      }

      const questionText = lines[0];
      const options: Record<string, string> = {};

      for (let i = 1; i < lines.length && Object.keys(options).length < 4; i++) {
        const line = lines[i];
        // يقبل أي بادئة A/B/C/D مع أي فاصل أو حتى بدون فاصل
        const match = line.match(/^[A-D][).:,-]?\s*(.+)$/i);
        if (match) {
          const optionKey = line[0].toUpperCase();
          options[optionKey] = match[1].trim();
        } else {
          // إذا لم يطابق النمط، اعتبره اختيار عادي
          const optionKey = String.fromCharCode(65 + Object.keys(options).length); // A, B, C, D
          options[optionKey] = line;
        }
      }

      if (questionText && Object.keys(options).length === 4) {
        questions.push({ question_text: questionText, options });
      } else {
        invalidBlocks.push(idx + 1);
      }
    });

    if (invalidBlocks.length > 0) {
      throw new Error(
        `هناك مشكلة في الأسئلة التالية: ${invalidBlocks.join(', ')}. تأكد أن كل سؤال يحتوي على نص وأربع اختيارات.`,
      );
    }

    // إدخال الأسئلة في قاعدة البيانات
    const insertedQuestions = [];
    for (const q of questions) {
      const result = await pool.query(
        `INSERT INTO questions_management (question_text, options) VALUES ($1, $2) RETURNING *`,
        [q.question_text, JSON.stringify(q.options)],
      );
      insertedQuestions.push(result.rows[0]);
    }

    return { success: true, inserted: insertedQuestions.length, questions: insertedQuestions };
  }

  // إنشاء أسئلة دفعة واحدة لامتحان محاضرة معينة
  static async createBulkQuestionsForLectureExam(examId: number, bulkText: string) {
    // التحقق من وجود الامتحان وأنه يخص المدرس
    const examCheck = await pool.query(
      `SELECT e.*, l.course_id, c.teacher_id 
       FROM exams e 
       JOIN lectures l ON e.lecture_id = l.id 
       JOIN courses c ON l.course_id = c.id 
       WHERE e.id = $1`,
      [examId],
    );

    if (!examCheck.rowCount) {
      throw new Error('امتحان المحاضرة غير موجود');
    }

    // تقسيم النص إلى كتل أسئلة
    const questionBlocks = bulkText
      .split(/\n\s*\n/)
      .map((b: string) => b.trim())
      .filter(Boolean);

    const questions: { text: string; choices: { text: string; is_correct: boolean }[] }[] = [];
    const invalidBlocks: number[] = [];

    questionBlocks.forEach((block: string, idx: number) => {
      const lines = block
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);

      if (lines.length < 5) {
        invalidBlocks.push(idx + 1);
        return;
      }

      const questionText = lines[0];
      const choices: { text: string; is_correct: boolean }[] = [];

      for (let i = 1; i < lines.length && choices.length < 4; i++) {
        const line = lines[i];
        // يقبل أي بادئة A/B/C/D مع أي فاصل أو حتى بدون فاصل
        const match = line.match(/^[A-D][).:,-]?\s*(.+)$/i);
        if (match) {
          choices.push({ text: match[1].trim(), is_correct: false });
        } else {
          // إذا لم يطابق النمط، اعتبره اختيار عادي
          choices.push({ text: line, is_correct: false });
        }
      }

      if (questionText && choices.length === 4) {
        questions.push({ text: questionText, choices });
      } else {
        invalidBlocks.push(idx + 1);
      }
    });

    if (invalidBlocks.length > 0) {
      throw new Error(
        `هناك مشكلة في الأسئلة التالية: ${invalidBlocks.join(', ')}. تأكد أن كل سؤال يحتوي على نص وأربع اختيارات.`,
      );
    }

    // إدخال الأسئلة في قاعدة البيانات
    const insertedQuestions = [];
    for (const q of questions) {
      // إنشاء السؤال في جدول questions أولاً
      const questionResult = await pool.query(
        `INSERT INTO questions (text, type) VALUES ($1, 'single_choice') RETURNING id`,
        [q.text],
      );

      const questionId = questionResult.rows[0].id;

      // إنشاء الاختيارات في جدول question_choices
      for (const choice of q.choices) {
        await pool.query(
          `INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`,
          [questionId, choice.text, choice.is_correct],
        );
      }

      // إنشاء السؤال في جدول exam_questions مع ربطه بجدول questions
      const examQuestionResult = await pool.query(
        `INSERT INTO exam_questions (exam_id, question_text, grade, question_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [examId, q.text, 1, questionId], // درجة واحدة لكل سؤال
      );

      const examQuestionId = examQuestionResult.rows[0].id;

      insertedQuestions.push({
        id: examQuestionId,
        text: q.text,
        choices: q.choices,
      });
    }

    return {
      success: true,
      inserted: insertedQuestions.length,
      questions: insertedQuestions,
      examId: examId,
    };
  }

  /**
   * إضافة مجموعة أسئلة لامتحان محاضرة من مصفوفة محلولة (نفس صيغة امتحان الكورس: سؤال + a. b. c. d. مع الإجابة الصحيحة).
   */
  static async createBulkQuestionsForLectureExamFromParsed(
    examId: number,
    teacherId: number,
    parsed: Array<{
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A' | 'B' | 'C' | 'D';
    }>,
  ) {
    const examCheck = await pool.query(
      `SELECT e.id, c.teacher_id FROM exams e
       JOIN lectures l ON e.lecture_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE e.id = $1 AND e.type IN ('exam', 'assignment')`,
      [examId],
    );
    if (!examCheck.rowCount) {
      throw new Error('امتحان المحاضرة غير موجود');
    }
    if (examCheck.rows[0].teacher_id !== teacherId) {
      throw new Error('غير مصرح لك بإضافة أسئلة لهذا الامتحان');
    }

    const inserted: { id: number; question_text: string; choices: { text: string; is_correct: boolean }[] }[] = [];

    for (const q of parsed) {
      const questionText = (q.questionText || '').trim();
      const optionA = (q.optionA || '').trim();
      const optionB = (q.optionB || '').trim();
      const optionC = (q.optionC || '').trim();
      const optionD = (q.optionD || '').trim();
      const correct = (q.correctAnswer || 'A').toUpperCase() as 'A' | 'B' | 'C' | 'D';
      if (!questionText || !optionA || !optionB || !optionC || !optionD) {
        throw new Error('كل سؤال يحتاج: questionText و optionA, optionB, optionC, optionD');
      }

      const questionResult = await pool.query(
        `INSERT INTO questions (text, type) VALUES ($1, 'single_choice') RETURNING id`,
        [questionText],
      );
      const questionId = questionResult.rows[0].id;

      const choices = [
        { key: 'A', text: optionA },
        { key: 'B', text: optionB },
        { key: 'C', text: optionC },
        { key: 'D', text: optionD },
      ];
      for (const ch of choices) {
        await pool.query(
          `INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`,
          [questionId, ch.text, ch.key === correct],
        );
      }

      const examQuestionResult = await pool.query(
        `INSERT INTO exam_questions (exam_id, question_text, grade, question_id) VALUES ($1, $2, 1, $3) RETURNING id`,
        [examId, questionText, questionId],
      );
      const examQuestionId = examQuestionResult.rows[0].id;

      inserted.push({
        id: examQuestionId,
        question_text: questionText,
        choices: choices.map((c) => ({ text: c.text, is_correct: c.key === correct })),
      });
    }

    return {
      success: true,
      inserted: inserted.length,
      questions: inserted,
      examId,
    };
  }

  // جلب أسئلة امتحان/واجب محاضرة معين
  static async getLectureExamQuestions(examId: number) {
    // التحقق من وجود الامتحان أو الواجب
    const examCheck = await pool.query(
      `SELECT e.* FROM exams e WHERE e.id = $1 AND e.type IN ('exam', 'assignment')`,
      [examId],
    );

    if (!examCheck.rowCount) {
      throw new Error('امتحان المحاضرة غير موجود');
    }

    // جلب الأسئلة مع الاختيارات
    const result = await pool.query(
      `SELECT 
        eq.id,
        eq.question_text as text,
        eq.grade,
        eq.image,
        q.id as question_id,
        q.text as question_text_from_questions,
        q.image as question_image_from_questions,
        qc.id as choice_id,
        qc.text as choice_text,
        qc.is_correct
       FROM exam_questions eq
       LEFT JOIN questions q ON eq.question_id = q.id
       LEFT JOIN question_choices qc ON q.id = qc.question_id
       WHERE eq.exam_id = $1
       ORDER BY eq.id, qc.id`,
      [examId],
    );

    if (!result.rowCount) {
      return [];
    }

    // تنظيم البيانات
    const questionsMap = new Map();

    result.rows.forEach((row) => {
      if (!questionsMap.has(row.id)) {
        // تحديد نوع السؤال بناءً على وجود الصورة أو النص
        const hasImage = row.image || row.question_image_from_questions;
        const hasText =
          (row.text && row.text.trim() !== '') ||
          (row.question_text_from_questions && row.question_text_from_questions.trim() !== '');

        let questionType = 'text';
        if (hasImage && !hasText) {
          questionType = 'image';
        }

        questionsMap.set(row.id, {
          id: row.id,
          type: questionType,
          text: hasText ? row.text || row.question_text_from_questions : null,
          image: hasImage ? row.image || row.question_image_from_questions : null,
          grade: row.grade,
          choices: [],
        });
      }

      // إضافة الاختيار فقط إذا كان موجوداً وليس فارغاً
      if (row.choice_id && row.choice_text) {
        const existingChoices = questionsMap.get(row.id).choices;
        // التحقق من عدم وجود اختيار مكرر
        const isDuplicate = existingChoices.some((choice: any) => choice.id === row.choice_id);
        if (!isDuplicate) {
          questionsMap.get(row.id).choices.push({
            id: row.choice_id,
            text: row.choice_text,
            is_correct: row.is_correct,
          });
        }
      }
    });

    // التحقق من أن كل سؤال يحتوي على 4 اختيارات فقط
    const questions = Array.from(questionsMap.values());
    questions.forEach((question) => {
      if (question.choices.length > 4) {
        question.choices = question.choices.slice(0, 4);
      }
    });

    return questions;
  }

  // جلب جميع الأسئلة
  static async getAllQuestions() {
    const result = await pool.query(`SELECT * FROM questions_management ORDER BY created_at DESC`);
    return result.rows.map((row) => ({
      id: row.id,
      questionText: row.question_text,
      options: row.options,
      correctOption: row.correct_option,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // تحديث الإجابة الصحيحة لسؤال
  static async updateCorrectAnswer(questionId: number, correctOption: string) {
    if (!['A', 'B', 'C', 'D'].includes(correctOption.toUpperCase())) {
      throw new Error('correctOption يجب أن يكون A, B, C, أو D');
    }

    const result = await pool.query(
      `UPDATE questions_management SET correct_option = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *`,
      [correctOption.toUpperCase(), questionId],
    );

    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    return {
      id: result.rows[0].id,
      questionText: result.rows[0].question_text,
      options: result.rows[0].options,
      correctOption: result.rows[0].correct_option,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  }

  // حذف سؤال
  static async deleteQuestion(questionId: number) {
    const result = await pool.query(`DELETE FROM questions_management WHERE id = $1 RETURNING *`, [
      questionId,
    ]);

    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    return { message: 'تم حذف السؤال بنجاح' };
  }

  // تحديث سؤال كامل
  static async updateQuestion(
    questionId: number,
    questionText: string,
    options: Record<string, string>,
  ) {
    // التحقق من أن الخيارات تحتوي على A, B, C, D
    const requiredOptions = ['A', 'B', 'C', 'D'];
    const providedOptions = Object.keys(options);

    if (!requiredOptions.every((opt) => providedOptions.includes(opt))) {
      throw new Error('يجب أن تحتوي الخيارات على A, B, C, D جميعاً');
    }

    const result = await pool.query(
      `UPDATE questions_management SET question_text = $1, options = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING *`,
      [questionText, JSON.stringify(options), questionId],
    );

    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    return {
      id: result.rows[0].id,
      questionText: result.rows[0].question_text,
      options: result.rows[0].options,
      correctOption: result.rows[0].correct_option,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  }

  // جلب سؤال واحد
  static async getQuestionById(questionId: number) {
    const result = await pool.query(`SELECT * FROM questions_management WHERE id = $1`, [
      questionId,
    ]);

    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const row = result.rows[0];
    return {
      id: row.id,
      questionText: row.question_text,
      options: row.options,
      correctOption: row.correct_option,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // تعديل نص السؤال أو درجته أو صورته
  static async updateLectureExamQuestion(
    questionId: number,
    questionText?: string,
    grade?: number,
    image?: string,
  ) {
    if (!questionText && !image && grade === undefined) {
      throw new Error('يجب إرسال نص السؤال أو الصورة أو الدرجة للتعديل');
    }

    const examQuestionRes = await pool.query(
      `SELECT question_id FROM exam_questions WHERE id = $1`,
      [questionId],
    );

    if (!examQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const questionIdInQuestions = examQuestionRes.rows[0].question_id;

    const fields = [];
    const values = [];
    let i = 1;

    if (questionText !== undefined) {
      fields.push(`question_text = $${i++}`);
      values.push(questionText);
    }

    if (image !== undefined) {
      fields.push(`image = $${i++}`);
      values.push(image); // image هو رابط Cloudinary مباشرة
    }

    if (grade !== undefined) {
      fields.push(`grade = $${i++}`);
      values.push(grade);
    }

    values.push(questionId);

    // تحديث exam_questions
    const result = await pool.query(
      `UPDATE exam_questions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );

    // إذا تم تحديث الصورة وكان السؤال مربوط بجدول questions، حدث الصورة هناك أيضاً
    if (image !== undefined && questionIdInQuestions) {
      await pool.query(`UPDATE questions SET image = $1 WHERE id = $2`, [
        image,
        questionIdInQuestions,
      ]);
    }

    // إذا تم تحديث النص وكان السؤال مربوط بجدول questions، حدث النص هناك أيضاً
    if (questionText !== undefined && questionIdInQuestions) {
      await pool.query(`UPDATE questions SET text = $1 WHERE id = $2`, [
        questionText,
        questionIdInQuestions,
      ]);
    }

    return result.rows[0];
  }

  // تحديد الإجابة الصحيحة (يدعم أسئلة V1 من questions وأسئلة V2 من بنك الأسئلة)
  static async setLectureExamQuestionCorrectAnswer(questionId: number, correctChoiceId: number) {
    const examQuestionRes = await pool.query(
      `SELECT question_id, question_id_v2 FROM exam_questions WHERE id = $1`,
      [questionId],
    );

    if (!examQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const row = examQuestionRes.rows[0];
    const actualQuestionId = row.question_id;
    const questionIdV2 = row.question_id_v2;

    // سؤال من بنك الأسئلة V2: تحديث correct_answer_index_override (0=أ، 1=ب، 2=ج، 3=د)
    if (questionIdV2 != null && actualQuestionId == null) {
      let optionIndex: number;
      if (correctChoiceId >= 0) {
        const optionRow = await pool.query(
          `SELECT option_index FROM question_options WHERE id = $1 AND question_id = $2`,
          [correctChoiceId, questionIdV2],
        );
        if (!optionRow.rowCount) {
          throw new Error('لم يتم العثور على الاختيار الصحيح لهذا السؤال');
        }
        optionIndex = optionRow.rows[0].option_index;
      } else {
        optionIndex = (-correctChoiceId) - 1;
        if (optionIndex < 0 || optionIndex > 3) {
          throw new Error('اختيار غير صحيح');
        }
      }
      try {
        await pool.query(
          `UPDATE exam_questions SET correct_answer_index_override = $1 WHERE id = $2`,
          [optionIndex, questionId],
        );
        return { message: 'تم تحديث الإجابة الصحيحة بنجاح' };
      } catch {
        throw new Error('تحديث الإجابة الصحيحة غير متاح. استخدم PATCH /api/exams/:examId/questions/:questionId/correct-answer');
      }
    }

    if (!actualQuestionId) {
      throw new Error('السؤال غير مرتبط بجدول الأسئلة');
    }

    const choiceCheckRes = await pool.query(
      `SELECT id FROM question_choices WHERE id = $1 AND question_id = $2`,
      [correctChoiceId, actualQuestionId],
    );

    if (!choiceCheckRes.rowCount) {
      throw new Error('لم يتم العثور على الاختيار الصحيح لهذا السؤال');
    }

    await pool.query(`UPDATE question_choices SET is_correct = false WHERE question_id = $1`, [
      actualQuestionId,
    ]);

    await pool.query(
      `UPDATE question_choices SET is_correct = true WHERE id = $1 AND question_id = $2`,
      [correctChoiceId, actualQuestionId],
    );

    return { message: 'تم تحديث الإجابة الصحيحة بنجاح' };
  }

  // حذف سؤال من امتحان المحاضرة (يدعم الأسئلة المضافة من البنك V1 و V2)
  static async deleteLectureExamQuestion(questionId: number) {
    const examQuestionRes = await pool.query(
      `SELECT question_id, question_id_v2 FROM exam_questions WHERE id = $1`,
      [questionId],
    );

    if (!examQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const actualQuestionId = examQuestionRes.rows[0].question_id;

    // إن كان السؤال مربوطاً بجدول questions (V1)، احذف الاختيارات والسؤال من الجدول
    if (actualQuestionId) {
      await pool.query(`DELETE FROM question_choices WHERE question_id = $1`, [actualQuestionId]);
      await pool.query(`DELETE FROM questions WHERE id = $1`, [actualQuestionId]);
    }

    // حذف الصف من exam_questions (سواء السؤال من V1 أو V2 من البنك)
    const result = await pool.query(`DELETE FROM exam_questions WHERE id = $1 RETURNING *`, [
      questionId,
    ]);
    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }
    return { message: 'تم حذف السؤال بنجاح' };
  }

  // إضافة سؤال جديد في امتحان المحاضرة مع صورة
  static async addQuestionToLectureExam(
    examId: number,
    questionText: string | null,
    imageFile: Express.Multer.File | null,
    grade: number = 1,
  ) {
    // التحقق من وجود الامتحان
    const examCheck = await pool.query(
      `SELECT id FROM exams WHERE id = $1 AND type IN ('exam', 'assignment')`,
      [examId],
    );

    if (!examCheck.rowCount) {
      throw new Error('امتحان المحاضرة غير موجود');
    }

    let imageUrl: string | null = null;

    // إذا تم رفع صورة، ارفعها على Cloudinary
    if (imageFile) {
      const uploaded = await uploadToCloudinary(imageFile.path);
      imageUrl = uploaded.secure_url;
    }

    // إنشاء السؤال في جدول questions
    const questionResult = await pool.query(
      `INSERT INTO questions (text, type, image) VALUES ($1, 'single_choice', $2) RETURNING id`,
      [questionText || '', imageUrl],
    );

    const questionId = questionResult.rows[0].id;

    // إنشاء الاختيارات الافتراضية (أ، ب، ج، د)
    const choices = [
      { text: 'أ', is_correct: false },
      { text: 'ب', is_correct: false },
      { text: 'ج', is_correct: false },
      { text: 'د', is_correct: false },
    ];

    for (const choice of choices) {
      await pool.query(
        `INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`,
        [questionId, choice.text, choice.is_correct],
      );
    }

    // ربط السؤال بالامتحان
    const examQuestionResult = await pool.query(
      `INSERT INTO exam_questions (exam_id, question_text, grade, question_id, image) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [examId, questionText || '', grade, questionId, imageUrl],
    );

    const examQuestion = examQuestionResult.rows[0];

    // جلب الاختيارات المُنشأة
    const choicesResult = await pool.query(
      `SELECT id, text, is_correct FROM question_choices WHERE question_id = $1 ORDER BY id`,
      [questionId],
    );

    return {
      id: examQuestion.id,
      exam_id: examQuestion.exam_id,
      question_text: examQuestion.question_text,
      image: examQuestion.image,
      grade: examQuestion.grade,
      question_id: examQuestion.question_id,
      choices: choicesResult.rows,
    };
  }

  // إنشاء أسئلة بالصور
  static async createImageQuestions(files: Express.Multer.File[], examId?: number) {
    const questions = [];

    for (const file of files) {
      // رفع الصورة على Cloudinary
      const uploaded = await uploadToCloudinary(file.path);

      // إنشاء السؤال في جدول questions
      const questionResult = await pool.query(
        `INSERT INTO questions (text, type, image) VALUES ($1, 'single_choice', $2) RETURNING id`,
        ['', uploaded.secure_url], // استخدام رابط Cloudinary
      );

      const questionId = questionResult.rows[0].id;

      // إنشاء الاختيارات الافتراضية (أ، ب، ج، د)
      const choices = [
        { text: 'أ', is_correct: false },
        { text: 'ب', is_correct: false },
        { text: 'ج', is_correct: false },
        { text: 'د', is_correct: false },
      ];

      for (const choice of choices) {
        await pool.query(
          `INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`,
          [questionId, choice.text, choice.is_correct],
        );
      }

      // إذا تم تمرير examId، قم بربط السؤال بالامتحان
      if (examId) {
        // التحقق من وجود الامتحان أو الواجب
        const examCheck = await pool.query(
          `SELECT id FROM exams WHERE id = $1 AND type IN ('exam', 'assignment')`,
          [examId],
        );

        if (!examCheck.rowCount) {
          throw new Error('امتحان المحاضرة غير موجود');
        }

        await pool.query(
          `INSERT INTO exam_questions (exam_id, question_text, grade, question_id) VALUES ($1, $2, $3, $4)`,
          [examId, '', 1, questionId], // نص فارغ بدلاً من null
        );
      }

      // جلب الاختيارات المُنشأة
      const choicesResult = await pool.query(
        `SELECT id, text, is_correct FROM question_choices WHERE question_id = $1 ORDER BY id`,
        [questionId],
      );

      questions.push({
        id: questionId,
        image: uploaded.secure_url, // استخدام رابط Cloudinary الفعلي
        choices: choicesResult.rows.map((choice) => ({
          id: choice.id,
          label: choice.text,
        })),
      });
    }

    return questions;
  }

  // تصحيح امتحان المحاضرة للطالب (المسار القديم)
  static async submitLectureExam(
    examId: number,
    studentId: number,
    answers: { questionId: number; choiceId: number }[],
  ) {
    const result = await ExamFlowService.submitAttempt({
      examId,
      studentId,
      answers,
      allowAutoStart: true,
    });

    return {
      success: true,
      totalGrade: result.totalGrade,
      maxGrade: result.maxGrade,
      passed: result.passed,
      wrongQuestions: result.wrongQuestions,
      showAnswers: result.released,
      releaseReason: result.releaseReason,
    };
  }
}
