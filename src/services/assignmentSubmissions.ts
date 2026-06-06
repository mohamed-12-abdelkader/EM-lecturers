import pool from '../db/pool';

export interface SubmissionAnswer {
  question_id: number;
  option_id: number; // ID الخيار المختار
}

export interface SubmitAssignmentData {
  answers: SubmissionAnswer[];
}

export class AssignmentSubmissionsService {
  // تسليم الواجب
  static async submitAssignment(
    assignmentId: number,
    studentId: number,
    data: SubmitAssignmentData,
  ) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // التحقق من وجود الواجب
      const assignmentCheck = await client.query(
        'SELECT id FROM package_subject_item_lesson_assignments WHERE id = $1',
        [assignmentId],
      );

      if (!assignmentCheck.rowCount) {
        throw new Error('الواجب غير موجود');
      }

      // التحقق من أن الطالب لم يسلم الواجب من قبل
      const existingSubmission = await client.query(
        'SELECT id FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2',
        [assignmentId, studentId],
      );

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      if (existingSubmission.rowCount > 0) {
        throw new Error('لقد قمت بتسليم هذا الواجب من قبل');
      }

      // جلب جميع أسئلة الواجب مع الخيارات الصحيحة
      const questionsResult = await client.query(
        `SELECT q.id, q.correct_option_id, q.correct_answer 
         FROM assignment_questions q 
         WHERE q.assignment_id = $1 
         ORDER BY q.order_index ASC, q.created_at ASC`,
        [assignmentId],
      );

      const questions = questionsResult.rows;
      const totalQuestions = questions.length;

      if (totalQuestions === 0) {
        throw new Error('لا توجد أسئلة في هذا الواجب');
      }

      // التحقق من أن عدد الإجابات يساوي عدد الأسئلة
      if (data.answers.length !== totalQuestions) {
        throw new Error(`يجب الإجابة على جميع الأسئلة (${totalQuestions} سؤال)`);
      }

      // إنشاء خريطة للإجابات (question_id -> option_id)
      const answersMap = new Map<number, number>();
      for (const answer of data.answers) {
        if (!answer.question_id || !answer.option_id) {
          throw new Error(`بيانات غير صحيحة: question_id و option_id مطلوبان`);
        }
        if (answersMap.has(answer.question_id)) {
          throw new Error(`إجابة مكررة للسؤال ${answer.question_id}`);
        }
        answersMap.set(answer.question_id, answer.option_id);
      }

      // التحقق من أن جميع الأسئلة لها إجابات
      for (const question of questions) {
        if (!answersMap.has(question.id)) {
          throw new Error(`إجابة مفقودة للسؤال ${question.id}`);
        }
      }

      // جلب جميع الخيارات المطلوبة دفعة واحدة
      const allOptionIds = new Set<number>();
      for (const question of questions) {
        const studentOptionId = answersMap.get(question.id)!;
        allOptionIds.add(studentOptionId);
        if (question.correct_option_id) {
          allOptionIds.add(question.correct_option_id);
        }
      }

      // جلب جميع الخيارات دفعة واحدة
      const optionsArray = Array.from(allOptionIds);
      let optionsMap = new Map<number, any>();
      if (optionsArray.length > 0) {
        const optionsResult = await client.query(
          `SELECT id, option_text, option_letter, question_id 
           FROM assignment_question_options 
           WHERE id = ANY($1::int[])`,
          [optionsArray],
        );
        optionsMap = new Map(optionsResult.rows.map((opt: any) => [opt.id, opt]));
      }

      // حساب النتائج
      let correctAnswers = 0;
      let wrongAnswers = 0;
      const submissionAnswers: any[] = [];

      for (const question of questions) {
        const studentOptionId = answersMap.get(question.id)!;

        // التحقق من أن option_id موجود
        const studentOption = optionsMap.get(studentOptionId);
        if (!studentOption) {
          throw new Error(`الخيار المحدد (option_id: ${studentOptionId}) غير موجود`);
        }

        // التحقق من أن الخيار ينتمي للسؤال الصحيح
        if (studentOption.question_id !== question.id) {
          throw new Error(
            `الخيار المحدد (option_id: ${studentOptionId}) لا ينتمي للسؤال ${question.id}`,
          );
        }

        const isCorrect = studentOptionId === question.correct_option_id;
        const correctOption = question.correct_option_id
          ? optionsMap.get(question.correct_option_id)
          : null;

        if (isCorrect) {
          correctAnswers++;
        } else {
          wrongAnswers++;
        }

        submissionAnswers.push({
          question_id: question.id,
          student_option_id: studentOptionId,
          student_answer: studentOption.option_letter || null,
          correct_option_id: question.correct_option_id,
          correct_answer: correctOption?.option_letter || question.correct_answer,
          is_correct: isCorrect,
        });
      }

      // حساب النسبة المئوية
      const score = totalQuestions > 0 ? (correctAnswers / totalQuestions) * 100 : 0;
      const scoreRounded = Math.round(score * 100) / 100; // تقريب لرقمين عشريين

      // إدراج التسليم
      const submissionResult = await client.query(
        `INSERT INTO assignment_submissions 
         (assignment_id, student_id, total_questions, correct_answers, wrong_answers, score)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [assignmentId, studentId, totalQuestions, correctAnswers, wrongAnswers, scoreRounded],
      );

      const submission = submissionResult.rows[0];

      // إدراج إجابات الطالب دفعة واحدة (batch insert)
      if (submissionAnswers.length > 0) {
        const values = submissionAnswers
          .map((answer, index) => {
            const base = index * 7;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
          })
          .join(', ');

        const params = submissionAnswers.flatMap((answer) => [
          submission.id,
          answer.question_id,
          answer.student_answer,
          answer.student_option_id,
          answer.is_correct,
          answer.correct_answer,
          answer.correct_option_id,
        ]);

        await client.query(
          `INSERT INTO assignment_submission_answers 
           (submission_id, question_id, student_answer, student_option_id, is_correct, correct_answer, correct_option_id)
           VALUES ${values}`,
          params,
        );
      }

      await client.query('COMMIT');

      // إرجاع البيانات الأساسية مباشرة بدلاً من استدعاء getSubmissionById
      // (لتوفير الوقت وتجنب queries إضافية)
      return {
        id: submission.id,
        assignment_id: submission.assignment_id,
        student_id: submission.student_id,
        total_questions: submission.total_questions,
        correct_answers: submission.correct_answers,
        wrong_answers: submission.wrong_answers,
        score: submission.score,
        submitted_at: submission.submitted_at,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // جلب تسليم الطالب لواجب معين
  static async getStudentSubmission(assignmentId: number, studentId: number) {
    const submissionResult = await pool.query(
      `SELECT * FROM assignment_submissions 
       WHERE assignment_id = $1 AND student_id = $2`,
      [assignmentId, studentId],
    );

    if (!submissionResult.rowCount) {
      return null;
    }

    const submission = submissionResult.rows[0];

    // جلب إجابات الطالب مع تفاصيل الأسئلة والخيارات
    const answersResult = await pool.query(
      `SELECT 
         aqa.id,
         aqa.question_id,
         aqa.student_answer,
         aqa.student_option_id,
         aqa.is_correct,
         aqa.correct_answer,
         aqa.correct_option_id,
         aq.question_type,
         aq.question_text,
         aq.order_index
       FROM assignment_submission_answers aqa
       JOIN assignment_questions aq ON aqa.question_id = aq.id
       WHERE aqa.submission_id = $1
       ORDER BY aq.order_index ASC, aq.created_at ASC`,
      [submission.id],
    );

    const answers = answersResult.rows;

    // جلب الخيارات والصور لكل سؤال
    for (const answer of answers) {
      // جلب جميع خيارات السؤال
      const optionsResult = await pool.query(
        `SELECT id, option_text, option_letter, order_index 
         FROM assignment_question_options 
         WHERE question_id = $1 
         ORDER BY order_index ASC, option_letter ASC`,
        [answer.question_id],
      );
      answer.options = optionsResult.rows;

      // جلب معلومات الخيار المختار
      if (answer.student_option_id) {
        const studentOptionResult = await pool.query(
          'SELECT id, option_text, option_letter FROM assignment_question_options WHERE id = $1',
          [answer.student_option_id],
        );
        answer.student_option = studentOptionResult.rows[0] || null;
      }

      // جلب معلومات الخيار الصحيح
      if (answer.correct_option_id) {
        const correctOptionResult = await pool.query(
          'SELECT id, option_text, option_letter FROM assignment_question_options WHERE id = $1',
          [answer.correct_option_id],
        );
        answer.correct_option = correctOptionResult.rows[0] || null;
      }

      // جلب الصور للأسئلة بالصورة
      if (answer.question_type === 'image') {
        const imagesResult = await pool.query(
          `SELECT id, image_url, order_index 
           FROM assignment_question_images 
           WHERE question_id = $1 
           ORDER BY order_index ASC`,
          [answer.question_id],
        );
        answer.images = imagesResult.rows;
      } else {
        answer.images = [];
      }
    }

    submission.answers = answers;

    return submission;
  }

  // جلب تسليم بالمعرف
  static async getSubmissionById(submissionId: number) {
    const submissionResult = await pool.query(
      'SELECT * FROM assignment_submissions WHERE id = $1',
      [submissionId],
    );

    if (!submissionResult.rowCount) {
      return null;
    }

    const submission = submissionResult.rows[0];

    // جلب إجابات الطالب مع تفاصيل الأسئلة والخيارات
    const answersResult = await pool.query(
      `SELECT 
         aqa.id,
         aqa.question_id,
         aqa.student_answer,
         aqa.student_option_id,
         aqa.is_correct,
         aqa.correct_answer,
         aqa.correct_option_id,
         aq.question_type,
         aq.question_text
       FROM assignment_submission_answers aqa
       JOIN assignment_questions aq ON aqa.question_id = aq.id
       WHERE aqa.submission_id = $1
       ORDER BY aq.order_index ASC, aq.created_at ASC`,
      [submissionId],
    );

    const answers = answersResult.rows;

    // جلب الخيارات والصور لكل سؤال
    for (const answer of answers) {
      // جلب جميع خيارات السؤال
      const optionsResult = await pool.query(
        `SELECT id, option_text, option_letter, order_index 
         FROM assignment_question_options 
         WHERE question_id = $1 
         ORDER BY order_index ASC, option_letter ASC`,
        [answer.question_id],
      );
      answer.options = optionsResult.rows;

      // جلب معلومات الخيار المختار
      if (answer.student_option_id) {
        const studentOptionResult = await pool.query(
          'SELECT id, option_text, option_letter FROM assignment_question_options WHERE id = $1',
          [answer.student_option_id],
        );
        answer.student_option = studentOptionResult.rows[0] || null;
      }

      // جلب معلومات الخيار الصحيح
      if (answer.correct_option_id) {
        const correctOptionResult = await pool.query(
          'SELECT id, option_text, option_letter FROM assignment_question_options WHERE id = $1',
          [answer.correct_option_id],
        );
        answer.correct_option = correctOptionResult.rows[0] || null;
      }

      // جلب الصور للأسئلة بالصورة
      if (answer.question_type === 'image') {
        const imagesResult = await pool.query(
          `SELECT id, image_url, order_index 
           FROM assignment_question_images 
           WHERE question_id = $1 
           ORDER BY order_index ASC`,
          [answer.question_id],
        );
        answer.images = imagesResult.rows;
      } else {
        answer.images = [];
      }
    }

    submission.answers = answers;

    return submission;
  }

  // التحقق من أن الطالب سلم الواجب
  static async hasStudentSubmitted(assignmentId: number, studentId: number): Promise<boolean> {
    const result = await pool.query(
      'SELECT id FROM assignment_submissions WHERE assignment_id = $1 AND student_id = $2',
      [assignmentId, studentId],
    );
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    return result.rowCount > 0;
  }
}
