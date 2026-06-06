import pool from '../db/pool';
import { uploadToCloudinary } from '../utils';

export class LessonQuestionsService {
  // إنشاء أسئلة دفعة واحدة للدرس
  static async createBulkQuestionsForLesson(lectureId: number, bulkText: string) {
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

      // إنشاء السؤال في جدول lesson_questions مع ربطه بجدول questions
      const lessonQuestionResult = await pool.query(
        `INSERT INTO lesson_questions (lecture_id, question_text, grade, question_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [lectureId, q.text, 1, questionId], // درجة واحدة لكل سؤال
      );

      const lessonQuestionId = lessonQuestionResult.rows[0].id;

      insertedQuestions.push({
        id: lessonQuestionId,
        text: q.text,
        choices: q.choices,
      });
    }

    return {
      success: true,
      inserted: insertedQuestions.length,
      questions: insertedQuestions,
      lectureId: lectureId,
    };
  }

  // جلب أسئلة درس معين بالتنسيق المطلوب (للدروس في بنك الأسئلة)
  static async getLessonQuestionsFormatted(lessonId: number) {
    // التحقق من وجود الدرس في بنك الأسئلة
    const lessonCheck = await pool.query(
      `SELECT l.*, c.subject_id, s.question_bank_id 
       FROM lessons l 
       JOIN chapters c ON l.chapter_id = c.id 
       JOIN subjects s ON c.subject_id = s.id 
       WHERE l.id = $1`,
      [lessonId],
    );

    if (!lessonCheck.rowCount) {
      throw new Error('الدرس غير موجود في بنك الأسئلة');
    }

    const allQuestions = [];

    console.log(`البحث عن الأسئلة للدرس: ${lessonId}`);

    // تم حذف هذا الاستعلام لتجنب التكرار - سيتم جلب الأسئلة الصورية من الاستعلام الرئيسي

    // تم حذف هذا الاستعلام لأنه يجلب أسئلة عامة لجميع الدروس

    // 1. جلب الأسئلة من الجدول الجديد (إذا كان موجوداً)
    try {
      const newTableResult = await pool.query(
        `SELECT 
          q.id,
          q.text,
          q.image,
          q.correct_answer,
          q.created_at,
          COALESCE(q.updated_at, q.created_at) as updated_at,
          q.options as question_options
         FROM questions q
         WHERE q.lesson_id = $1
         ORDER BY q.id`,
        [lessonId],
      );

      console.log(`الجدول الجديد: ${newTableResult.rowCount} سؤال`);

      if (newTableResult.rowCount && newTableResult.rowCount > 0) {
        console.log(
          'الأسئلة من الجدول الجديد:',
          newTableResult.rows.map((r) => ({ id: r.id, text: r.text, image: r.image })),
        );
        const newQuestions = newTableResult.rows.map((row) => {
          let options = ['أ', 'ب', 'ج', 'د']; // الخيارات الافتراضية
          let correct_answer = null;

          // إذا كان السؤال يحتوي على options في JSONB
          if (row.question_options && typeof row.question_options === 'object') {
            if (Array.isArray(row.question_options)) {
              options = row.question_options;
            } else if (
              row.question_options.options &&
              Array.isArray(row.question_options.options)
            ) {
              options = row.question_options.options;
            }
          }

          // تحديد الإجابة الصحيحة
          if (row.correct_answer) {
            const correctIndex = options.findIndex((option) => option === row.correct_answer);
            if (correctIndex !== -1) {
              correct_answer = correctIndex;
            }
          }

          return {
            id: row.id,
            lesson_id: lessonId,
            text: row.text || '',
            image: row.image,
            options: options,
            correct_answer: correct_answer,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        });

        allQuestions.push(...newQuestions);
      }
    } catch {
      // الجدول الجديد غير موجود، استمر للجدول القديم
      console.log('الجدول الجديد غير موجود، استخدام الجدول القديم');
    }

    // 1.5. جلب الأسئلة الصورية من جدول questions مع lesson_id
    try {
      const imageQuestionsResult = await pool.query(
        `SELECT 
          q.id,
          q.text,
          q.image,
          q.correct_answer,
          q.created_at,
          COALESCE(q.updated_at, q.created_at) as updated_at,
          q.options as question_options
         FROM questions q
         WHERE q.lesson_id = $1
         AND q.image IS NOT NULL 
         AND q.image != ''
         ORDER BY q.id`,
        [lessonId],
      );

      console.log(
        `الأسئلة الصورية من questions مع lesson_id: ${imageQuestionsResult.rowCount} سؤال`,
      );

      if (imageQuestionsResult.rowCount && imageQuestionsResult.rowCount > 0) {
        console.log(
          'الأسئلة الصورية:',
          imageQuestionsResult.rows.map((r) => ({ id: r.id, text: r.text, image: r.image })),
        );
        const imageQuestions = imageQuestionsResult.rows.map((row) => {
          let options = ['أ', 'ب', 'ج', 'د']; // الخيارات الافتراضية
          let correct_answer = null;

          // إذا كان السؤال يحتوي على options في JSONB
          if (row.question_options && Array.isArray(row.question_options)) {
            options = row.question_options;
          }

          // إذا كان هناك إجابة صحيحة
          if (row.correct_answer) {
            const correctIndex = options.indexOf(row.correct_answer);
            if (correctIndex !== -1) {
              correct_answer = correctIndex;
            }
          }

          return {
            id: row.id,
            lesson_id: lessonId,
            text: row.text || '',
            image: row.image,
            options: options,
            correct_answer: correct_answer,
            created_at: row.created_at,
            updated_at: row.updated_at,
          };
        });

        allQuestions.push(...imageQuestions);
      }
    } catch (error: any) {
      console.log('خطأ في جلب الأسئلة الصورية من questions مع lesson_id:', error.message);
    }

    // 2. جلب الأسئلة من الجدول القديم (lesson_questions)
    try {
      const oldTableResult = await pool.query(
        `SELECT 
          lq.id,
          lq.question_text as text,
          lq.question_image as image,
          lq.created_at,
          lq.updated_at,
          qc.text as choice_text,
          qc.is_correct
         FROM lesson_questions lq
         LEFT JOIN questions q ON lq.question_id = q.id
         LEFT JOIN question_choices qc ON q.id = qc.question_id
         WHERE lq.lecture_id = $1
         ORDER BY lq.id, qc.id`,
        [lessonId],
      );

      console.log(`الجدول القديم: ${oldTableResult.rowCount} سؤال`);

      if (oldTableResult.rowCount && oldTableResult.rowCount > 0) {
        // معالجة الأسئلة من الجدول القديم
        const questionsMap = new Map();

        oldTableResult.rows.forEach((row) => {
          if (!questionsMap.has(row.id)) {
            questionsMap.set(row.id, {
              id: row.id,
              lesson_id: lessonId,
              text: row.text || '',
              image: row.image,
              options: [],
              correct_answer: null,
              created_at: row.created_at,
              updated_at: row.updated_at,
            });
          }

          // إضافة الاختيار إذا كان موجوداً
          if (row.choice_text) {
            const question = questionsMap.get(row.id);
            question.options.push(row.choice_text);

            // إذا كان هذا الاختيار صحيح، احفظ فهرس الإجابة الصحيحة
            if (row.is_correct) {
              question.correct_answer = question.options.length - 1;
            }
          }
        });

        const oldQuestions = Array.from(questionsMap.values());
        allQuestions.push(...oldQuestions);
      }
    } catch (error: any) {
      console.log('خطأ في جلب الأسئلة من الجدول القديم:', error.message);
    }

    // تم حذف هذا الاستعلام لتجنب التكرار - سيتم جلب الأسئلة الصورية من الاستعلام الرئيسي

    // تم حذف هذا الاستعلام لتجنب التكرار - سيتم جلب الأسئلة الصورية من الاستعلام الرئيسي

    // تم حذف هذا الاستعلام لأنه يجلب أسئلة عامة لجميع الدروس

    // تم حذف هذا الاستعلام لأنه يجلب أسئلة عامة لجميع الدروس

    // تم حذف هذا الاستعلام لأنه يجلب أسئلة عامة لجميع الدروس

    // تم حذف هذا الاستعلام لأنه يجلب أسئلة عامة لجميع الدروس

    // 6. جلب الأسئلة من جدول exam_questions (إذا كانت مرتبطة بالدرس)
    try {
      const examQuestionsResult = await pool.query(
        `SELECT 
          eq.id,
          eq.question_text as text,
          eq.question_image as image,
          eq.created_at,
          eq.updated_at,
          qc.text as choice_text,
          qc.is_correct
         FROM exam_questions eq
         LEFT JOIN questions q ON eq.question_id = q.id
         LEFT JOIN question_choices qc ON q.id = qc.question_id
         WHERE eq.exam_id IN (
           SELECT id FROM exams WHERE lecture_id = $1
         )
         ORDER BY eq.id, qc.id`,
        [lessonId],
      );

      if (examQuestionsResult.rowCount && examQuestionsResult.rowCount > 0) {
        const questionsMap = new Map();

        examQuestionsResult.rows.forEach((row) => {
          if (!questionsMap.has(row.id)) {
            questionsMap.set(row.id, {
              id: row.id,
              lesson_id: lessonId,
              text: row.text || '',
              image: row.image,
              options: [],
              correct_answer: null,
              created_at: row.created_at,
              updated_at: row.updated_at,
            });
          }

          // إضافة الاختيار إذا كان موجوداً
          if (row.choice_text) {
            const question = questionsMap.get(row.id);
            question.options.push(row.choice_text);

            // إذا كان هذا الاختيار صحيح، احفظ فهرس الإجابة الصحيحة
            if (row.is_correct) {
              question.correct_answer = question.options.length - 1;
            }
          }
        });

        const examQuestions = Array.from(questionsMap.values());
        allQuestions.push(...examQuestions);
      }
    } catch (error: any) {
      console.log('خطأ في جلب الأسئلة من exam_questions:', error.message);
    }

    // إزالة التكرار بناءً على ID
    const uniqueQuestions = [];
    const seenIds = new Set();

    for (const question of allQuestions) {
      if (!seenIds.has(question.id)) {
        seenIds.add(question.id);
        uniqueQuestions.push(question);
      }
    }

    // ترتيب الأسئلة حسب تاريخ الإنشاء
    uniqueQuestions.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    console.log(`إجمالي الأسئلة المُرجعَة (بعد إزالة التكرار): ${uniqueQuestions.length}`);
    console.log(
      'الأسئلة:',
      uniqueQuestions.map((q) => ({ id: q.id, text: q.text, image: q.image })),
    );

    return uniqueQuestions;
  }

  // جلب أسئلة درس معين
  static async getLessonQuestions(lectureId: number) {
    // التحقق من وجود الدرس
    const lectureCheck = await pool.query(`SELECT l.* FROM lectures l WHERE l.id = $1`, [
      lectureId,
    ]);

    if (!lectureCheck.rowCount) {
      throw new Error('الدرس غير موجود');
    }

    // جلب الأسئلة مع الاختيارات
    const result = await pool.query(
      `SELECT 
        lq.id,
        lq.question_text as text,
        lq.grade,
        lq.question_image,
        q.id as question_id,
        q.text as question_text_from_questions,
        q.image as question_image_from_questions,
        qc.id as choice_id,
        qc.text as choice_text,
        qc.is_correct
       FROM lesson_questions lq
       LEFT JOIN questions q ON lq.question_id = q.id
       LEFT JOIN question_choices qc ON q.id = qc.question_id
       WHERE lq.lecture_id = $1
       ORDER BY lq.id, qc.id`,
      [lectureId],
    );

    if (!result.rowCount) {
      return [];
    }

    // تنظيم البيانات
    const questionsMap = new Map();

    result.rows.forEach((row) => {
      if (!questionsMap.has(row.id)) {
        // تحديد نوع السؤال بناءً على وجود الصورة أو النص
        const hasImage = row.question_image || row.question_image_from_questions;
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
          image: hasImage ? row.question_image || row.question_image_from_questions : null,
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

  // إنشاء أسئلة نصية للدرس في بنك الأسئلة
  static async createTextQuestionsForQuestionBankLesson(bulkText: string, lessonId: number) {
    // التحقق من وجود الدرس في بنك الأسئلة
    const lessonCheck = await pool.query(
      `SELECT l.*, c.subject_id, s.question_bank_id 
       FROM lessons l 
       JOIN chapters c ON l.chapter_id = c.id 
       JOIN subjects s ON c.subject_id = s.id 
       WHERE l.id = $1`,
      [lessonId],
    );

    if (!lessonCheck.rowCount) {
      throw new Error('الدرس غير موجود في بنك الأسئلة');
    }

    // تقسيم النص إلى كتل أسئلة
    const questionBlocks = bulkText
      .split(/\n\s*\n/)
      .map((b: string) => b.trim())
      .filter((b: string) => b.length > 0);

    const questions = [];

    for (const block of questionBlocks) {
      const lines = block
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);

      if (lines.length < 5) continue; // يجب أن يحتوي على سؤال + 4 اختيارات على الأقل

      const questionText = lines[0];
      const choices = lines.slice(1, 5).map((line: string) => {
        // إزالة A) B) C) D) من بداية السطر
        return line.replace(/^[A-D]\)\s*/, '');
      });

      // إنشاء السؤال في جدول questions
      const questionResult = await pool.query(
        `INSERT INTO questions (text, type, lesson_id, options, correct_answer) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING id, created_at, COALESCE(updated_at, created_at) as updated_at`,
        [
          questionText,
          'single_choice',
          lessonId,
          JSON.stringify(choices),
          null, // لا توجد إجابة صحيحة محددة بعد
        ],
      );

      const questionId = questionResult.rows[0].id;
      const createdAt = questionResult.rows[0].created_at;
      const updatedAt = questionResult.rows[0].updated_at;

      questions.push({
        id: questionId,
        lesson_id: lessonId,
        text: questionText,
        image: null,
        options: choices,
        correct_answer: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }

    return questions;
  }

  /**
   * إضافة أسئلة اختيار من متعدد دفعة واحدة لدرس في بنك الأسئلة.
   * يقبل النص بالتنسيق:
   * - سطر السؤال (يمكن أن يبدأ برقم أو إيموجي مثل 2️⃣)
   * - أربعة أسطر: أ) ... ب) ... ج) ... د) ...
   * - سطر اختياري: ✅ الإجابة الصحيحة: ب (أو أ/ج/د)
   */
  static async createBulkMcqForQuestionBankLesson(
    bulkText: string,
    lessonId: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    teacherId?: number,
  ): Promise<{ inserted: number; questions: { id: number; text: string; options: string[]; correct_answer: string | null }[] }> {
    const lessonCheck = await pool.query(
      `SELECT l.id, c.subject_id, s.question_bank_id 
       FROM lessons l 
       JOIN chapters c ON l.chapter_id = c.id 
       JOIN subjects s ON c.subject_id = s.id 
       WHERE l.id = $1`,
      [lessonId],
    );

    if (!lessonCheck.rowCount) {
      throw new Error('الدرس غير موجود في بنك الأسئلة');
    }

    const questionBlocks = bulkText
      .split(/\n\s*\n/)
      .map((b: string) => b.trim())
      .filter((b: string) => b.length > 0);

    const inserted: { id: number; text: string; options: string[]; correct_answer: string | null }[] = [];
    const invalidBlocks: number[] = [];

    for (let blockIndex = 0; blockIndex < questionBlocks.length; blockIndex++) {
      const block = questionBlocks[blockIndex];
      const lines = block
        .split('\n')
        .map((l: string) => l.trim())
        .filter((l: string) => l.length > 0);

      if (lines.length < 5) {
        invalidBlocks.push(blockIndex + 1);
        continue;
      }

      // السطر الأول: نص السؤال (إزالة رقم أو إيموجي من البداية مثل 2️⃣ أو ٣.)
      const rawFirst = lines[0].trim();
      const questionText = rawFirst
        .replace(/^\s*[٠-٩0-9][\s.)\uFE0F\u20E3]*\s*/, '')
        .trim() || rawFirst;

      const choiceMap: { أ?: string; ب?: string; ج?: string; د?: string } = {};
      let correctAnswer: string | null = null;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        const matchAr = line.match(/^([أبجد])[)\s:.]+\s*(.+)$/);
        if (matchAr) {
          const letter = matchAr[1] as 'أ' | 'ب' | 'ج' | 'د';
          choiceMap[letter] = matchAr[2].trim();
          continue;
        }
        const matchEn = line.match(/^([A-Da-d])[)\s:.]+\s*(.+)$/);
        if (matchEn) {
          const enToAr: Record<string, 'أ' | 'ب' | 'ج' | 'د'> = { A: 'أ', B: 'ب', C: 'ج', D: 'د' };
          const letter = enToAr[matchEn[1].toUpperCase()];
          choiceMap[letter] = matchEn[2].trim();
          continue;
        }
        const correctMatch = line.match(/الإجابة الصحيحة[:\s]*([أبجدA-Da-d])/);
        if (correctMatch) {
          const letter = correctMatch[1];
          correctAnswer = /[أبجد]/.test(letter) ? letter : { A: 'أ', B: 'ب', C: 'ج', D: 'د' }[letter.toUpperCase()] ?? letter;
        }
      }

      const optionsOrder: ('أ' | 'ب' | 'ج' | 'د')[] = ['أ', 'ب', 'ج', 'د'];
      const options = optionsOrder.map((key) => choiceMap[key] ?? '');

      if (options.some((o) => !o)) {
        invalidBlocks.push(blockIndex + 1);
        continue;
      }

      const questionResult = await pool.query(
        `INSERT INTO questions (text, type, lesson_id, options, correct_answer) 
         VALUES ($1, 'single_choice', $2, $3::jsonb, $4) 
         RETURNING id, text, correct_answer`,
        [questionText, lessonId, JSON.stringify(options), correctAnswer],
      );

      const row = questionResult.rows[0];
      inserted.push({
        id: row.id,
        text: row.text || questionText,
        options,
        correct_answer: row.correct_answer,
      });
    }

    if (invalidBlocks.length > 0 && inserted.length === 0) {
      throw new Error(
        `لم يُعرَف أي سؤال صالح. تأكد أن كل كتلة تحتوي على: سؤال ثم أربعة أسطر أ) ب) ج) د)، واختياريًا سطر "الإجابة الصحيحة: أ/ب/ج/د". كتل بها خطأ: ${invalidBlocks.join(', ')}`,
      );
    }

    return { inserted: inserted.length, questions: inserted };
  }

  // إنشاء أسئلة بالصور للدرس في بنك الأسئلة
  static async createImageQuestionsForQuestionBankLesson(
    files: Express.Multer.File[],
    lessonId: number,
  ) {
    const questions = [];

    // التحقق من وجود الدرس في بنك الأسئلة
    const lessonCheck = await pool.query(
      `SELECT l.*, c.subject_id, s.question_bank_id 
       FROM lessons l 
       JOIN chapters c ON l.chapter_id = c.id 
       JOIN subjects s ON c.subject_id = s.id 
       WHERE l.id = $1`,
      [lessonId],
    );

    if (!lessonCheck.rowCount) {
      throw new Error('الدرس غير موجود في بنك الأسئلة');
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const lesson = lessonCheck.rows[0];

    for (const file of files) {
      // رفع الصورة على Cloudinary
      const uploaded = await uploadToCloudinary(file.path);

      // إنشاء السؤال مباشرة في جدول questions مع ربطه بـ lesson_id
      // التحقق من وجود الجدول الجديد أولاً
      let questionResult;
      try {
        questionResult = await pool.query(
          `INSERT INTO questions (text, type, image, lesson_id, options, correct_answer) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING id, created_at, COALESCE(updated_at, created_at) as updated_at`,
          [
            '', // نص فارغ للسؤال الصوري
            'single_choice',
            uploaded.secure_url,
            lessonId,
            JSON.stringify(['أ', 'ب', 'ج', 'د']), // الخيارات كـ JSONB
            null, // لا توجد إجابة صحيحة محددة بعد
          ],
        );
      } catch (error: any) {
        // إذا فشل، جرب الجدول القديم
        if (error.message.includes('column "lesson_id" does not exist')) {
          // إنشاء السؤال في الجدول القديم
          questionResult = await pool.query(
            `INSERT INTO questions (text, type, image) 
             VALUES ($1, $2, $3) 
             RETURNING id, created_at`,
            [
              '', // نص فارغ للسؤال الصوري
              'single_choice',
              uploaded.secure_url,
            ],
          );

          // إنشاء الاختيارات في جدول question_choices
          const choices = ['أ', 'ب', 'ج', 'د'];
          for (const choice of choices) {
            await pool.query(
              `INSERT INTO question_choices (question_id, text, is_correct) VALUES ($1, $2, $3)`,
              [questionResult.rows[0].id, choice, false],
            );
          }

          // إضافة السؤال إلى جدول lesson_questions
          await pool.query(
            `INSERT INTO lesson_questions (lecture_id, question_text, question_image, question_id) 
             VALUES ($1, $2, $3, $4)`,
            [lessonId, '', uploaded.secure_url, questionResult.rows[0].id],
          );

          questionResult.rows[0].updated_at = questionResult.rows[0].created_at;
        } else {
          // إذا فشل كل شيء، أضف السؤال مباشرة في lesson_questions
          console.log('إضافة السؤال مباشرة في lesson_questions');
          questionResult = await pool.query(
            `INSERT INTO lesson_questions (lecture_id, question_text, question_image) 
             VALUES ($1, $2, $3) 
             RETURNING id, created_at, updated_at`,
            [lessonId, '', uploaded.secure_url],
          );
        }
      }

      const questionId = questionResult.rows[0].id;
      const createdAt = questionResult.rows[0].created_at;
      const updatedAt = questionResult.rows[0].updated_at;

      questions.push({
        id: questionId,
        lesson_id: lessonId,
        text: null,
        image: uploaded.secure_url,
        options: ['a', 'b', 'c', 'd'],
        correct_answer: null,
        created_at: createdAt,
        updated_at: updatedAt,
      });
    }

    return questions;
  }

  // إنشاء أسئلة بالصور للدرس (للدروس في الكورسات)
  static async createImageQuestionsForLesson(files: Express.Multer.File[], lectureId?: number) {
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

      // إذا تم تمرير lectureId، قم بربط السؤال بالدرس
      if (lectureId) {
        // التحقق من وجود الدرس
        const lectureCheck = await pool.query(`SELECT id FROM lectures WHERE id = $1`, [lectureId]);

        if (!lectureCheck.rowCount) {
          throw new Error('الدرس غير موجود');
        }

        const lessonQuestionResult = await pool.query(
          `INSERT INTO lesson_questions (lecture_id, question_text, grade, question_id, question_image) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [lectureId, '', 1, questionId, uploaded.secure_url], // نص فارغ بدلاً من null
        );

        const lessonQuestionId = lessonQuestionResult.rows[0].id;

        questions.push({
          id: lessonQuestionId,
          lesson_id: lectureId,
          text: '',
          image: uploaded.secure_url,
          options: ['أ', 'ب', 'ج', 'د'],
          correct_answer: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } else {
        // جلب الاختيارات المُنشأة
        const choicesResult = await pool.query(
          `SELECT id, text, is_correct FROM question_choices WHERE question_id = $1 ORDER BY id`,
          [questionId],
        );

        questions.push({
          id: questionId,
          text: '',
          image: uploaded.secure_url,
          type: 'image',
          choices: choicesResult.rows,
        });
      }
    }

    return questions;
  }

  // تعديل نص السؤال أو درجته أو صورته
  static async updateLessonQuestion(
    questionId: number,
    questionText?: string,
    _grade?: number,
    image?: string,
  ) {
    if (!questionText && !image) {
      throw new Error('يجب إرسال نص السؤال أو الصورة للتعديل');
    }

    const fields = [];
    const values = [];
    let i = 1;

    if (questionText !== undefined) {
      fields.push(`question_text = $${i++}`);
      values.push(questionText);
    }

    if (image !== undefined) {
      fields.push(`question_image = $${i++}`);
      values.push(encodeURIComponent(image));
    }

    // تحديث الدرجة إلى 1 دائماً
    fields.push(`grade = $${i++}`);
    values.push(1);

    values.push(questionId);

    const result = await pool.query(
      `UPDATE lesson_questions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }
    return result.rows[0];
  }

  // تحديد الإجابة الصحيحة
  static async setLessonQuestionCorrectAnswer(questionId: number, correctChoiceId: number) {
    let actualQuestionId = questionId;
    let isDirectQuestion = false;

    // أولاً، تحقق إذا كان السؤال موجود مباشرة في جدول questions
    const directQuestionRes = await pool.query(`SELECT id FROM questions WHERE id = $1`, [
      questionId,
    ]);

    if (directQuestionRes.rowCount && directQuestionRes.rowCount > 0) {
      // السؤال موجود مباشرة في جدول questions
      isDirectQuestion = true;
      actualQuestionId = questionId;
    } else {
      // جرب البحث في جدول lesson_questions
      const lessonQuestionRes = await pool.query(
        `SELECT question_id FROM lesson_questions WHERE id = $1`,
        [questionId],
      );

      if (!lessonQuestionRes.rowCount) {
        throw new Error('السؤال غير موجود');
      }

      actualQuestionId = lessonQuestionRes.rows[0].question_id;

      if (!actualQuestionId) {
        throw new Error('السؤال غير مرتبط بجدول الأسئلة');
      }
    }

    if (isDirectQuestion) {
      // للسؤال المباشر، استخدم جدول questions مع options JSONB
      const questionRes = await pool.query(`SELECT options FROM questions WHERE id = $1`, [
        actualQuestionId,
      ]);

      if (!questionRes.rowCount) {
        throw new Error('السؤال غير موجود');
      }

      const options = questionRes.rows[0].options;
      if (Array.isArray(options) && correctChoiceId >= 0 && correctChoiceId < options.length) {
        // تحديث correct_answer في جدول questions
        await pool.query(`UPDATE questions SET correct_answer = $1 WHERE id = $2`, [
          options[correctChoiceId],
          actualQuestionId,
        ]);
      } else {
        throw new Error('اختيار غير صحيح');
      }
    } else {
      // للسؤال القديم، استخدم جدول question_choices
      const choiceCheckRes = await pool.query(
        `SELECT id FROM question_choices WHERE id = $1 AND question_id = $2`,
        [correctChoiceId, actualQuestionId],
      );

      if (!choiceCheckRes.rowCount) {
        throw new Error('لم يتم العثور على الاختيار الصحيح لهذا السؤال');
      }

      // عيّن جميع الاختيارات is_correct = false
      await pool.query(`UPDATE question_choices SET is_correct = false WHERE question_id = $1`, [
        actualQuestionId,
      ]);

      // عيّن الاختيار الصحيح فقط
      await pool.query(
        `UPDATE question_choices SET is_correct = true WHERE id = $1 AND question_id = $2`,
        [correctChoiceId, actualQuestionId],
      );
    }

    return { message: 'تم تحديث الإجابة الصحيحة بنجاح' };
  }

  // جلب اختيارات السؤال
  static async getLessonQuestionChoices(questionId: number) {
    // أولاً، تحقق إذا كان السؤال موجود مباشرة في جدول questions
    const directQuestionRes = await pool.query(`SELECT id, options FROM questions WHERE id = $1`, [
      questionId,
    ]);

    if (directQuestionRes.rowCount && directQuestionRes.rowCount > 0) {
      // السؤال موجود مباشرة في جدول questions
      const question = directQuestionRes.rows[0];
      const options = question.options || ['أ', 'ب', 'ج', 'د'];

      return {
        question_id: questionId,
        choices: options.map((option: string, index: number) => ({
          id: index,
          text: option,
          is_correct: false, // سيتم تحديثه لاحقاً
        })),
      };
    }

    // جرب البحث في جدول lesson_questions
    const lessonQuestionRes = await pool.query(
      `SELECT question_id FROM lesson_questions WHERE id = $1`,
      [questionId],
    );

    if (!lessonQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const actualQuestionId = lessonQuestionRes.rows[0].question_id;

    if (!actualQuestionId) {
      throw new Error('السؤال غير مرتبط بجدول الأسئلة');
    }

    // جلب الاختيارات من جدول question_choices
    const choicesRes = await pool.query(
      `SELECT id, text, is_correct FROM question_choices WHERE question_id = $1 ORDER BY id`,
      [actualQuestionId],
    );

    return {
      question_id: questionId,
      choices: choicesRes.rows.map((choice: any) => ({
        id: choice.id,
        text: choice.text,
        is_correct: choice.is_correct,
      })),
    };
  }

  // تعديل سؤال من درس في بنك الأسئلة
  static async updateQuestionFromLesson(
    questionId: number,
    updateData: {
      text?: string;
      image?: string;
      options?: string[];
      correct_answer?: string;
    },
  ) {
    // أولاً، تحقق إذا كان السؤال موجود مباشرة في جدول questions
    const directQuestionRes = await pool.query(
      `SELECT id, lesson_id FROM questions WHERE id = $1`,
      [questionId],
    );

    if (directQuestionRes.rowCount && directQuestionRes.rowCount > 0) {
      // السؤال موجود مباشرة في جدول questions
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const question = directQuestionRes.rows[0];

      // تحديث السؤال في جدول questions
      const updateFields = [];
      const updateValues = [];
      let paramCount = 1;

      if (updateData.text !== undefined) {
        updateFields.push(`text = $${paramCount}`);
        updateValues.push(updateData.text);
        paramCount++;
      }

      if (updateData.image !== undefined) {
        updateFields.push(`image = $${paramCount}`);
        updateValues.push(updateData.image);
        paramCount++;
      }

      if (updateData.options !== undefined) {
        updateFields.push(`options = $${paramCount}`);
        updateValues.push(JSON.stringify(updateData.options));
        paramCount++;
      }

      if (updateData.correct_answer !== undefined) {
        updateFields.push(`correct_answer = $${paramCount}`);
        updateValues.push(updateData.correct_answer);
        paramCount++;
      }

      if (updateFields.length > 0) {
        updateFields.push(`updated_at = NOW()`);
        updateValues.push(questionId);

        await pool.query(
          `UPDATE questions SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
          updateValues,
        );
      }

      return { message: 'تم تحديث السؤال بنجاح' };
    }

    // جرب البحث في جدول lesson_questions
    const lessonQuestionRes = await pool.query(
      `SELECT question_id FROM lesson_questions WHERE id = $1`,
      [questionId],
    );

    if (!lessonQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const actualQuestionId = lessonQuestionRes.rows[0].question_id;

    if (!actualQuestionId) {
      throw new Error('السؤال غير مرتبط بجدول الأسئلة');
    }

    // تحديث السؤال في جدول questions
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (updateData.text !== undefined) {
      updateFields.push(`text = $${paramCount}`);
      updateValues.push(updateData.text);
      paramCount++;
    }

    if (updateData.image !== undefined) {
      updateFields.push(`image = $${paramCount}`);
      updateValues.push(updateData.image);
      paramCount++;
    }

    if (updateData.options !== undefined) {
      updateFields.push(`options = $${paramCount}`);
      updateValues.push(JSON.stringify(updateData.options));
      paramCount++;
    }

    if (updateData.correct_answer !== undefined) {
      updateFields.push(`correct_answer = $${paramCount}`);
      updateValues.push(updateData.correct_answer);
      paramCount++;
    }

    if (updateFields.length > 0) {
      updateFields.push(`updated_at = NOW()`);
      updateValues.push(actualQuestionId);

      await pool.query(
        `UPDATE questions SET ${updateFields.join(', ')} WHERE id = $${paramCount}`,
        updateValues,
      );
    }

    return { message: 'تم تحديث السؤال بنجاح' };
  }

  // حذف سؤال من درس في بنك الأسئلة
  static async deleteQuestionFromLesson(questionId: number) {
    // أولاً، تحقق إذا كان السؤال موجود مباشرة في جدول questions
    const directQuestionRes = await pool.query(
      `SELECT id, lesson_id FROM questions WHERE id = $1`,
      [questionId],
    );

    if (directQuestionRes.rowCount && directQuestionRes.rowCount > 0) {
      // السؤال موجود مباشرة في جدول questions
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const question = directQuestionRes.rows[0];

      // حذف السؤال من جدول questions
      await pool.query(`DELETE FROM questions WHERE id = $1`, [questionId]);

      return { message: 'تم حذف السؤال بنجاح' };
    }

    // جرب البحث في جدول lesson_questions
    const lessonQuestionRes = await pool.query(
      `SELECT question_id FROM lesson_questions WHERE id = $1`,
      [questionId],
    );

    if (!lessonQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const actualQuestionId = lessonQuestionRes.rows[0].question_id;

    if (!actualQuestionId) {
      throw new Error('السؤال غير مرتبط بجدول الأسئلة');
    }

    // حذف الاختيارات أولاً
    await pool.query(`DELETE FROM question_choices WHERE question_id = $1`, [actualQuestionId]);

    // حذف السؤال من جدول الأسئلة
    await pool.query(`DELETE FROM questions WHERE id = $1`, [actualQuestionId]);

    // حذف السؤال من جدول lesson_questions
    await pool.query(`DELETE FROM lesson_questions WHERE id = $1`, [questionId]);

    return { message: 'تم حذف السؤال بنجاح' };
  }

  // حذف سؤال (للتوافق مع الإصدارات السابقة)
  static async deleteLessonQuestion(questionId: number) {
    // أولاً، اجلب question_id من جدول lesson_questions
    const lessonQuestionRes = await pool.query(
      `SELECT question_id FROM lesson_questions WHERE id = $1`,
      [questionId],
    );

    if (!lessonQuestionRes.rowCount) {
      throw new Error('السؤال غير موجود');
    }

    const actualQuestionId = lessonQuestionRes.rows[0].question_id;

    // حذف الاختيارات أولاً (إذا كان السؤال مرتبط بجدول الأسئلة)
    if (actualQuestionId) {
      await pool.query(`DELETE FROM question_choices WHERE question_id = $1`, [actualQuestionId]);

      // حذف السؤال من جدول questions
      await pool.query(`DELETE FROM questions WHERE id = $1`, [actualQuestionId]);
    }

    // حذف السؤال من جدول lesson_questions
    const result = await pool.query(`DELETE FROM lesson_questions WHERE id = $1 RETURNING *`, [
      questionId,
    ]);
    if (!result.rowCount) {
      throw new Error('السؤال غير موجود');
    }
    return { message: 'تم حذف السؤال بنجاح' };
  }

  // جلب تفاصيل درس (بيانات الدرس + الأسئلة)
  static async getLessonDetails(lectureId: number) {
    // جلب بيانات الدرس
    const lectureRes = await pool.query('SELECT * FROM lectures WHERE id = $1', [lectureId]);
    if (!lectureRes.rowCount) {
      throw new Error('الدرس غير موجود');
    }
    const lecture = lectureRes.rows[0];

    // جلب الأسئلة
    let questions = [];
    try {
      questions = await this.getLessonQuestions(lectureId);
    } catch (_err) {
      questions = [];
    }

    return {
      lecture: {
        id: lecture.id,
        title: lecture.title,
        description: lecture.description,
        position: lecture.position,
        course_id: lecture.course_id,
        created_at: lecture.created_at,
      },
      questions,
    };
  }
}
