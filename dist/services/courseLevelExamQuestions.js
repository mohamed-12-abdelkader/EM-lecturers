"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CourseLevelExamQuestionsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
class CourseLevelExamQuestionsService {
    /**
     * Verify that the exam belongs to the teacher
     */
    static async verifyExamOwnership(examId, teacherId) {
        const examRes = await pool_1.default.query(`SELECT e.*, c.teacher_id 
       FROM course_level_exams e
       JOIN courses c ON e.course_id = c.id
       WHERE e.id = $1`, [examId]);
        if (!examRes.rowCount) {
            throw new utils_1.HttpError(404, 'Exam not found');
        }
        const exam = examRes.rows[0];
        if (exam.teacher_id !== teacherId) {
            throw new utils_1.HttpError(403, 'You are not allowed to manage questions for this exam');
        }
    }
    /**
     * Verify that the question belongs to an exam owned by the teacher
     */
    static async verifyQuestionOwnership(questionId, teacherId) {
        const questionRes = await pool_1.default.query(`SELECT q.exam_id, c.teacher_id
       FROM course_level_exam_questions q
       JOIN course_level_exams e ON q.exam_id = e.id
       JOIN courses c ON e.course_id = c.id
       WHERE q.id = $1`, [questionId]);
        if (!questionRes.rowCount) {
            throw new utils_1.HttpError(404, 'Question not found');
        }
        const question = questionRes.rows[0];
        if (question.teacher_id !== teacherId) {
            throw new utils_1.HttpError(403, 'You are not allowed to manage this question');
        }
        return question.exam_id;
    }
    /**
     * Create a text-based question
     */
    static async createTextQuestion(requester, input) {
        await this.verifyExamOwnership(input.examId, requester.id);
        // Validate all options are provided
        if (!input.optionA || !input.optionB || !input.optionC || !input.optionD) {
            throw new utils_1.HttpError(400, 'All options (A, B, C, D) are required for TEXT questions');
        }
        // Validate correct answer
        if (!['A', 'B', 'C', 'D'].includes(input.correctAnswer)) {
            throw new utils_1.HttpError(400, 'correctAnswer must be one of A, B, C, or D');
        }
        const result = await pool_1.default.query(`INSERT INTO course_level_exam_questions (
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
      RETURNING *`, [
            input.examId,
            input.questionText,
            input.questionImage || null,
            input.optionA,
            input.optionB,
            input.optionC,
            input.optionD,
            input.correctAnswer,
            input.createdBy,
        ]);
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
    static parseBulkQuestionText(text, correctAnswers) {
        const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
        const questions = [];
        let questionLines = [];
        const optionMap = {};
        const pushIfComplete = (index) => {
            const A = optionMap['A'], B = optionMap['B'], C = optionMap['C'], D = optionMap['D'];
            const questionText = questionLines.join(' ').trim();
            if (questionText && A && B && C && D) {
                const correctAnswer = (correctAnswers && correctAnswers[index] != null
                    ? correctAnswers[index]
                    : 'A');
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
            }
            else {
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
    static async createTextQuestionsBulk(requester, examId, questions) {
        if (!questions.length) {
            throw new utils_1.HttpError(400, 'يجب إرسال مصفوفة أسئلة غير فارغة');
        }
        await this.verifyExamOwnership(examId, requester.id);
        const created = [];
        for (const q of questions) {
            const questionText = (q.questionText || '').trim();
            const optionA = (q.optionA || '').trim();
            const optionB = (q.optionB || '').trim();
            const optionC = (q.optionC || '').trim();
            const optionD = (q.optionD || '').trim();
            const correctAnswer = (q.correctAnswer || '').toUpperCase();
            if (!questionText || !optionA || !optionB || !optionC || !optionD) {
                throw new utils_1.HttpError(400, 'كل سؤال يحتاج: questionText, optionA, optionB, optionC, optionD');
            }
            if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
                throw new utils_1.HttpError(400, 'correctAnswer يجب أن يكون أحد: A, B, C, D');
            }
            const result = await pool_1.default.query(`INSERT INTO course_level_exam_questions (
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
        RETURNING *`, [examId, questionText, optionA, optionB, optionC, optionD, correctAnswer, requester.id]);
            created.push(result.rows[0]);
        }
        return created;
    }
    /**
     * Create image-based questions (bulk upload)
     */
    static async createImageQuestions(requester, examId, images) {
        await this.verifyExamOwnership(examId, requester.id);
        // Validate max 10 images
        if (images.length > 10) {
            throw new utils_1.HttpError(400, 'Maximum 10 images allowed per request');
        }
        if (images.length === 0) {
            throw new utils_1.HttpError(400, 'At least one image is required');
        }
        const insertedQuestions = [];
        for (const imageUrl of images) {
            const result = await pool_1.default.query(`INSERT INTO course_level_exam_questions (
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
        RETURNING *`, [examId, imageUrl, requester.id]);
            insertedQuestions.push(result.rows[0]);
        }
        return insertedQuestions;
    }
    /**
     * Update a question
     */
    static async updateQuestion(requester, questionId, input) {
        await this.verifyQuestionOwnership(questionId, requester.id);
        // Get current question
        const currentRes = await pool_1.default.query(`SELECT * FROM course_level_exam_questions WHERE id = $1`, [
            questionId,
        ]);
        if (!currentRes.rowCount) {
            throw new utils_1.HttpError(404, 'Question not found');
        }
        const current = currentRes.rows[0];
        // Build update query
        const updates = [];
        const values = [];
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
        const finalQuestionText = input.questionText !== undefined ? input.questionText : current.question_text;
        const finalQuestionImage = input.questionImage !== undefined ? input.questionImage : current.question_image;
        if (current.type === 'TEXT' && !finalQuestionText && !finalQuestionImage) {
            throw new utils_1.HttpError(400, 'Cannot remove both question text and image');
        }
        if (current.type === 'IMAGE' && !finalQuestionImage) {
            throw new utils_1.HttpError(400, 'Cannot remove question image for IMAGE type questions');
        }
        // Always update updated_at
        updates.push(`updated_at = NOW()`);
        values.push(questionId);
        const query = `UPDATE course_level_exam_questions 
                   SET ${updates.join(', ')} 
                   WHERE id = $${paramIndex} 
                   RETURNING *`;
        const result = await pool_1.default.query(query, values);
        return result.rows[0];
    }
    /**
     * Delete a question
     */
    static async deleteQuestion(requester, questionId) {
        await this.verifyQuestionOwnership(questionId, requester.id);
        await pool_1.default.query('DELETE FROM course_level_exam_questions WHERE id = $1', [questionId]);
        return { message: 'Question deleted successfully' };
    }
    /**
     * Set/Update correct answer
     */
    static async setCorrectAnswer(requester, questionId, correctAnswer) {
        await this.verifyQuestionOwnership(questionId, requester.id);
        // Validate correct answer
        if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
            throw new utils_1.HttpError(400, 'correctAnswer must be one of A, B, C, or D');
        }
        const result = await pool_1.default.query(`UPDATE course_level_exam_questions 
       SET correct_answer = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`, [correctAnswer, questionId]);
        if (!result.rowCount) {
            throw new utils_1.HttpError(404, 'Question not found');
        }
        return result.rows[0];
    }
    /**
     * Get all questions for an exam
     */
    static async getExamQuestions(examId, requester) {
        await this.verifyExamOwnership(examId, requester.id);
        const result = await pool_1.default.query(`SELECT * FROM course_level_exam_questions 
       WHERE exam_id = $1 
       ORDER BY created_at ASC`, [examId]);
        return result.rows;
    }
    /**
     * Get a single question by ID
     */
    static async getQuestionById(questionId, requester) {
        await this.verifyQuestionOwnership(questionId, requester.id);
        const result = await pool_1.default.query(`SELECT * FROM course_level_exam_questions WHERE id = $1`, [
            questionId,
        ]);
        if (!result.rowCount) {
            throw new utils_1.HttpError(404, 'Question not found');
        }
        return result.rows[0];
    }
}
exports.CourseLevelExamQuestionsService = CourseLevelExamQuestionsService;
