import pool from '../db/pool';
import { HttpError } from '../utils';

interface RequestUser {
  id: number;
  role: string;
}

interface CreateTextQuestionInput {
  examId: number;
  questionText: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctAnswer: 'A' | 'B' | 'C' | 'D';
  questionImage?: string | null;
  createdBy: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface CreateImageQuestionInput {
  examId: number;
  questionImage: string;
  createdBy: number;
}

interface UpdateQuestionInput {
  questionText?: string;
  questionImage?: string | null;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
}

export class CourseLevelExamQuestionsService {
  /**
   * Verify that the exam belongs to the teacher
   */
  private static async verifyExamOwnership(examId: number, teacherId: number): Promise<void> {
    const examRes = await pool.query(
      `SELECT e.*, c.teacher_id 
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`,
      [examId],
    );

    if (!examRes.rowCount) {
      throw new HttpError(404, 'Exam not found');
    }

    const exam = examRes.rows[0];
    if (exam.teacher_id !== teacherId) {
      throw new HttpError(403, 'You are not allowed to manage questions for this exam');
    }
  }

  /**
   * Verify that the question belongs to an exam owned by the teacher
   */
  private static async verifyQuestionOwnership(
    questionId: number,
    teacherId: number,
  ): Promise<number> {
    const questionRes = await pool.query(
      `SELECT q.exam_id, c.teacher_id
       FROM course_level_exam_questions q
       JOIN course_level_exams e ON q.exam_id = e.id
       JOIN courses c ON e.course_id = c.id
       WHERE q.id = $1`,
      [questionId],
    );

    if (!questionRes.rowCount) {
      throw new HttpError(404, 'Question not found');
    }

    const question = questionRes.rows[0];
    if (question.teacher_id !== teacherId) {
      throw new HttpError(403, 'You are not allowed to manage this question');
    }

    return question.exam_id;
  }

  /**
   * Create a text-based question
   */
  static async createTextQuestion(requester: RequestUser, input: CreateTextQuestionInput) {
    await this.verifyExamOwnership(input.examId, requester.id);

    // Validate all options are provided
    if (!input.optionA || !input.optionB || !input.optionC || !input.optionD) {
      throw new HttpError(400, 'All options (A, B, C, D) are required for TEXT questions');
    }

    // Validate correct answer
    if (!['A', 'B', 'C', 'D'].includes(input.correctAnswer)) {
      throw new HttpError(400, 'correctAnswer must be one of A, B, C, or D');
    }

    const result = await pool.query(
      `INSERT INTO course_level_exam_questions (
        exam_id,
        type,
        question_text,
        question_image,
        option_a,
        option_b,
        option_c,
        option_d,
        correct_answer,
        created_by
      ) VALUES ($1, 'TEXT', $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        input.examId,
        input.questionText,
        input.questionImage || null,
        input.optionA,
        input.optionB,
        input.optionC,
        input.optionD,
        input.correctAnswer,
        input.createdBy,
      ],
    );

    return result.rows[0];
  }

  /**
   * Parse bulk question text format (سطر سطر — يعمل مع أو بدون سطر فاضي بين الأسئلة):
   * سطر السؤال
   * a. الخيار الأول
   * b. الخيار الثاني
   * c. الخيار الثالث
   * d. الخيار الرابع
   * (ثم سؤال تالي أو سطر فاضي)
   */
  static parseBulkQuestionText(
    text: string,
    correctAnswers?: ('A' | 'B' | 'C' | 'D')[],
  ): Array<{
    questionText: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: 'A' | 'B' | 'C' | 'D';
  }> {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const questions: Array<{
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A' | 'B' | 'C' | 'D';
    }> = [];

    let questionLines: string[] = [];
    const optionMap: Record<string, string> = {};

    const pushIfComplete = (index: number) => {
      const A = optionMap['A'], B = optionMap['B'], C = optionMap['C'], D = optionMap['D'];
      const questionText = questionLines.join(' ').trim();
      if (questionText && A && B && C && D) {
        const correctAnswer = (correctAnswers && correctAnswers[index] != null
          ? correctAnswers[index]
          : 'A') as 'A' | 'B' | 'C' | 'D';
        questions.push({
          questionText,
          optionA: A,
          optionB: B,
          optionC: C,
          optionD: D,
          correctAnswer: ['A', 'B', 'C', 'D'].includes(correctAnswer) ? correctAnswer : 'A',
        });
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const optionMatch = line.match(/^([a-dA-D])\.\s*(.+)$/);

      if (optionMatch) {
        const letter = optionMatch[1].toUpperCase();
        optionMap[letter] = optionMatch[2].trim();
        if (letter === 'D') {
          pushIfComplete(questions.length);
          questionLines = [];
          optionMap['A'] = optionMap['B'] = optionMap['C'] = optionMap['D'] = '';
        }
      } else {
        if (optionMap['A'] || optionMap['B'] || optionMap['C'] || optionMap['D']) {
          pushIfComplete(questions.length);
          questionLines = [];
          optionMap['A'] = optionMap['B'] = optionMap['C'] = optionMap['D'] = '';
        }
        questionLines.push(line);
      }
    }

    pushIfComplete(questions.length);
    return questions;
  }

  /**
   * Create multiple text-based questions in one request (نفس شكل السؤال الواحد)
   */
  static async createTextQuestionsBulk(
    requester: RequestUser,
    examId: number,
    questions: Array<{
      questionText: string;
      optionA: string;
      optionB: string;
      optionC: string;
      optionD: string;
      correctAnswer: 'A' | 'B' | 'C' | 'D';
    }>,
  ) {
    if (!questions.length) {
      throw new HttpError(400, 'يجب إرسال مصفوفة أسئلة غير فارغة');
    }
    await this.verifyExamOwnership(examId, requester.id);

    const created: any[] = [];
    for (const q of questions) {
      const questionText = (q.questionText || '').trim();
      const optionA = (q.optionA || '').trim();
      const optionB = (q.optionB || '').trim();
      const optionC = (q.optionC || '').trim();
      const optionD = (q.optionD || '').trim();
      const correctAnswer = (q.correctAnswer || '').toUpperCase() as 'A' | 'B' | 'C' | 'D';

      if (!questionText || !optionA || !optionB || !optionC || !optionD) {
        throw new HttpError(400, 'كل سؤال يحتاج: questionText, optionA, optionB, optionC, optionD');
      }
      if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
        throw new HttpError(400, 'correctAnswer يجب أن يكون أحد: A, B, C, D');
      }

      const result = await pool.query(
        `INSERT INTO course_level_exam_questions (
          exam_id,
          type,
          question_text,
          question_image,
          option_a,
          option_b,
          option_c,
          option_d,
          correct_answer,
          created_by
        ) VALUES ($1, 'TEXT', $2, NULL, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [examId, questionText, optionA, optionB, optionC, optionD, correctAnswer, requester.id],
      );
      created.push(result.rows[0]);
    }
    return created;
  }

  /**
   * Create image-based questions (bulk upload)
   */
  static async createImageQuestions(requester: RequestUser, examId: number, images: string[]) {
    await this.verifyExamOwnership(examId, requester.id);

    // Validate max 10 images
    if (images.length > 10) {
      throw new HttpError(400, 'Maximum 10 images allowed per request');
    }

    if (images.length === 0) {
      throw new HttpError(400, 'At least one image is required');
    }

    const insertedQuestions = [];

    for (const imageUrl of images) {
      const result = await pool.query(
        `INSERT INTO course_level_exam_questions (
          exam_id,
          type,
          question_image,
          option_a,
          option_b,
          option_c,
          option_d,
          correct_answer,
          created_by
        ) VALUES ($1, 'IMAGE', $2, 'A', 'B', 'C', 'D', NULL, $3)
        RETURNING *`,
        [examId, imageUrl, requester.id],
      );

      insertedQuestions.push(result.rows[0]);
    }

    return insertedQuestions;
  }

  /**
   * Update a question
   */
  static async updateQuestion(
    requester: RequestUser,
    questionId: number,
    input: UpdateQuestionInput,
  ) {
    await this.verifyQuestionOwnership(questionId, requester.id);

    // Get current question
    const currentRes = await pool.query(`SELECT * FROM course_level_exam_questions WHERE id = $1`, [
      questionId,
    ]);

    if (!currentRes.rowCount) {
      throw new HttpError(404, 'Question not found');
    }

    const current = currentRes.rows[0];

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Handle question text and image
    if (input.questionText !== undefined) {
      updates.push(`question_text = $${paramIndex++}`);
      values.push(input.questionText);
    }

    if (input.questionImage !== undefined) {
      updates.push(`question_image = $${paramIndex++}`);
      values.push(input.questionImage);
    }

    // Handle options
    if (input.optionA !== undefined) {
      updates.push(`option_a = $${paramIndex++}`);
      values.push(input.optionA);
    }
    if (input.optionB !== undefined) {
      updates.push(`option_b = $${paramIndex++}`);
      values.push(input.optionB);
    }
    if (input.optionC !== undefined) {
      updates.push(`option_c = $${paramIndex++}`);
      values.push(input.optionC);
    }
    if (input.optionD !== undefined) {
      updates.push(`option_d = $${paramIndex++}`);
      values.push(input.optionD);
    }

    if (updates.length === 0) {
      // No updates provided, return current question
      return current;
    }

    // Validate that we don't remove both text and image
    const finalQuestionText =
      input.questionText !== undefined ? input.questionText : current.question_text;
    const finalQuestionImage =
      input.questionImage !== undefined ? input.questionImage : current.question_image;

    if (current.type === 'TEXT' && !finalQuestionText && !finalQuestionImage) {
      throw new HttpError(400, 'Cannot remove both question text and image');
    }

    if (current.type === 'IMAGE' && !finalQuestionImage) {
      throw new HttpError(400, 'Cannot remove question image for IMAGE type questions');
    }

    // Always update updated_at
    updates.push(`updated_at = NOW()`);
    values.push(questionId);

    const query = `UPDATE course_level_exam_questions 
                   SET ${updates.join(', ')} 
                   WHERE id = $${paramIndex} 
                   RETURNING *`;

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  /**
   * Delete a question
   */
  static async deleteQuestion(requester: RequestUser, questionId: number) {
    await this.verifyQuestionOwnership(questionId, requester.id);

    await pool.query('DELETE FROM course_level_exam_questions WHERE id = $1', [questionId]);

    return { message: 'Question deleted successfully' };
  }

  /**
   * Set/Update correct answer
   */
  static async setCorrectAnswer(
    requester: RequestUser,
    questionId: number,
    correctAnswer: 'A' | 'B' | 'C' | 'D',
  ) {
    await this.verifyQuestionOwnership(questionId, requester.id);

    // Validate correct answer
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
      throw new HttpError(400, 'correctAnswer must be one of A, B, C, or D');
    }

    const result = await pool.query(
      `UPDATE course_level_exam_questions 
       SET correct_answer = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [correctAnswer, questionId],
    );

    if (!result.rowCount) {
      throw new HttpError(404, 'Question not found');
    }

    return result.rows[0];
  }

  /**
   * Get all questions for an exam
   */
  static async getExamQuestions(examId: number, requester: RequestUser) {
    await this.verifyExamOwnership(examId, requester.id);

    const result = await pool.query(
      `SELECT * FROM course_level_exam_questions 
       WHERE exam_id = $1 
       ORDER BY created_at ASC`,
      [examId],
    );

    return result.rows;
  }

  /**
   * Get a single question by ID
   */
  static async getQuestionById(questionId: number, requester: RequestUser) {
    await this.verifyQuestionOwnership(questionId, requester.id);

    const result = await pool.query(`SELECT * FROM course_level_exam_questions WHERE id = $1`, [
      questionId,
    ]);

    if (!result.rowCount) {
      throw new HttpError(404, 'Question not found');
    }

    return result.rows[0];
  }
}
