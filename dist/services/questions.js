"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class QuestionService {
    // Create new question (Teacher)
    static async create(questionBankId, subjectId, chapterId, lessonId, teacherId, data) {
        const { question_text, question_type, difficulty_level, correct_answer, explanation, image_url, } = data;
        // Verify lesson exists and belongs to the chapter, subject, and question bank
        const verifyQuery = `
      SELECT id FROM lessons 
      WHERE id = $1 AND chapter_id = $2 AND subject_id = $3 AND question_bank_id = $4
    `;
        const verifyResult = await pool_1.default.query(verifyQuery, [
            lessonId,
            chapterId,
            subjectId,
            questionBankId,
        ]);
        if (verifyResult.rows.length === 0) {
            throw new Error('الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة');
        }
        // Check if teacher has permission for this subject
        const permissionQuery = `
      SELECT id FROM teacher_permissions 
      WHERE teacher_id = $1 AND subject_id = $2 AND question_bank_id = $3 AND is_active = true
    `;
        const permissionResult = await pool_1.default.query(permissionQuery, [
            teacherId,
            subjectId,
            questionBankId,
        ]);
        if (permissionResult.rows.length === 0) {
            throw new Error('ليس لديك صلاحية لإضافة أسئلة لهذه المادة');
        }
        const query = `
      INSERT INTO questions (
        question_text, question_type, difficulty_level, correct_answer, explanation, image_url,
        lesson_id, chapter_id, subject_id, question_bank_id, teacher_id, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
      RETURNING *
    `;
        const values = [
            question_text,
            question_type,
            difficulty_level,
            correct_answer,
            explanation,
            image_url,
            lessonId,
            chapterId,
            subjectId,
            questionBankId,
            teacherId,
        ];
        const result = await pool_1.default.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('فشل في إضافة السؤال');
        }
        const question = result.rows[0];
        return {
            ...question,
            lesson_id: lessonId,
            chapter_id: chapterId,
            subject_id: subjectId,
            question_bank_id: questionBankId,
            teacher_id: teacherId,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        };
    }
    // Get questions for a lesson
    static async getByLesson(questionBankId, subjectId, chapterId, lessonId, status, limit = 20, offset = 0) {
        // Verify lesson exists and belongs to the chapter, subject, and question bank
        const verifyQuery = `
      SELECT id FROM lessons 
      WHERE id = $1 AND chapter_id = $2 AND subject_id = $3 AND question_bank_id = $4
    `;
        const verifyResult = await pool_1.default.query(verifyQuery, [
            lessonId,
            chapterId,
            subjectId,
            questionBankId,
        ]);
        if (verifyResult.rows.length === 0) {
            throw new Error('الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة');
        }
        const whereConditions = [
            `lesson_id = $1`,
            `chapter_id = $2`,
            `subject_id = $3`,
            `question_bank_id = $4`,
        ];
        const values = [lessonId, chapterId, subjectId, questionBankId];
        let valueIndex = 5;
        if (status) {
            whereConditions.push(`status = $${valueIndex}`);
            values.push(status);
            valueIndex++;
        }
        const whereClause = whereConditions.join(' AND ');
        // Count total questions
        const countQuery = `SELECT COUNT(*) FROM questions WHERE ${whereClause}`;
        const countResult = await pool_1.default.query(countQuery, values);
        const total = parseInt(countResult.rows[0].count);
        // Get paginated questions
        values.push(limit, offset);
        const query = `
      SELECT 
        q.*,
        l.name as lesson_name,
        c.name as chapter_name,
        s.name as subject_name,
        u.name as teacher_name
      FROM questions q
      LEFT JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN chapters c ON q.chapter_id = c.id
      LEFT JOIN subjects s ON q.subject_id = s.id
      LEFT JOIN users u ON q.teacher_id = u.id
      WHERE ${whereClause}
      ORDER BY q.created_at DESC
      LIMIT $${valueIndex} OFFSET $${valueIndex + 1}
    `;
        const result = await pool_1.default.query(query, values);
        const questions = result.rows.map((question) => ({
            ...question,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        }));
        return { questions, total };
    }
    // Get question by ID
    static async getById(id) {
        const query = `
      SELECT 
        q.*,
        l.name as lesson_name,
        c.name as chapter_name,
        s.name as subject_name,
        qb.name as question_bank_name,
        u.name as teacher_name
      FROM questions q
      LEFT JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN chapters c ON q.chapter_id = c.id
      LEFT JOIN subjects s ON q.subject_id = s.id
      LEFT JOIN question_banks qb ON q.question_bank_id = qb.id
      LEFT JOIN users u ON q.teacher_id = u.id
      WHERE q.id = $1
    `;
        const result = await pool_1.default.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        const question = result.rows[0];
        return {
            ...question,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        };
    }
    // Get pending questions for admin review
    static async getPending(limit = 20, offset = 0, subject_id, teacher_id, difficulty_level) {
        const whereConditions = [`status = 'pending'`];
        const values = [];
        let valueIndex = 1;
        if (subject_id) {
            whereConditions.push(`subject_id = $${valueIndex}`);
            values.push(subject_id);
            valueIndex++;
        }
        if (teacher_id) {
            whereConditions.push(`teacher_id = $${valueIndex}`);
            values.push(teacher_id);
            valueIndex++;
        }
        if (difficulty_level) {
            whereConditions.push(`difficulty_level = $${valueIndex}`);
            values.push(difficulty_level);
            valueIndex++;
        }
        const whereClause = whereConditions.join(' AND ');
        // Count total pending questions
        const countQuery = `SELECT COUNT(*) FROM questions WHERE ${whereClause}`;
        const countResult = await pool_1.default.query(countQuery, values);
        const total = parseInt(countResult.rows[0].count);
        // Get paginated pending questions
        values.push(limit, offset);
        const query = `
      SELECT 
        q.*,
        l.name as lesson_name,
        c.name as chapter_name,
        s.name as subject_name,
        qb.name as question_bank_name,
        u.name as teacher_name
      FROM questions q
      LEFT JOIN lessons l ON q.lesson_id = l.id
      LEFT JOIN chapters c ON q.chapter_id = c.id
      LEFT JOIN subjects s ON q.subject_id = s.id
      LEFT JOIN question_banks qb ON q.question_bank_id = qb.id
      LEFT JOIN users u ON q.teacher_id = u.id
      WHERE ${whereClause}
      ORDER BY q.created_at ASC
      LIMIT $${valueIndex} OFFSET $${valueIndex + 1}
    `;
        const result = await pool_1.default.query(query, values);
        const questions = result.rows.map((question) => ({
            ...question,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        }));
        return { questions, total };
    }
    // Approve question (Admin)
    static async approve(questionId, adminId, data) {
        const { status } = data;
        if (status !== 'approved') {
            throw new Error('الحالة يجب أن تكون approved');
        }
        // Check if question exists and is pending
        const existingQuestion = await this.getById(questionId);
        if (!existingQuestion) {
            throw new Error('السؤال غير موجود');
        }
        if (existingQuestion.status !== 'pending') {
            throw new Error('السؤال تمت مراجعته بالفعل');
        }
        const query = `
      UPDATE questions 
      SET status = $1, admin_id = $2, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $3
      RETURNING *
    `;
        const result = await pool_1.default.query(query, [status, adminId, questionId]);
        if (result.rows.length === 0) {
            throw new Error('فشل في الموافقة على السؤال');
        }
        const question = result.rows[0];
        return {
            ...question,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        };
    }
    // Reject question (Admin)
    static async reject(questionId, adminId, data) {
        const { status, rejection_reason } = data;
        if (status !== 'rejected') {
            throw new Error('الحالة يجب أن تكون rejected');
        }
        if (!rejection_reason) {
            throw new Error('سبب الرفض مطلوب');
        }
        // Check if question exists and is pending
        const existingQuestion = await this.getById(questionId);
        if (!existingQuestion) {
            throw new Error('السؤال غير موجود');
        }
        if (existingQuestion.status !== 'pending') {
            throw new Error('السؤال تمت مراجعته بالفعل');
        }
        const query = `
      UPDATE questions 
      SET status = $1, rejection_reason = $2, admin_id = $3, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `;
        const result = await pool_1.default.query(query, [status, rejection_reason, adminId, questionId]);
        if (result.rows.length === 0) {
            throw new Error('فشل في رفض السؤال');
        }
        const question = result.rows[0];
        return {
            ...question,
            created_at: new Date(question.created_at),
            updated_at: new Date(question.updated_at),
        };
    }
    // Delete question
    static async delete(questionId) {
        // Check if question exists
        const existingQuestion = await this.getById(questionId);
        if (!existingQuestion) {
            throw new Error('السؤال غير موجود');
        }
        const query = `DELETE FROM questions WHERE id = $1`;
        const result = await pool_1.default.query(query, [questionId]);
        if (result.rowCount === 0) {
            throw new Error('فشل في حذف السؤال');
        }
    }
}
exports.QuestionService = QuestionService;
