"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LessonService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class LessonService {
    // Create new lesson
    static async create(questionBankId, subjectId, chapterId, data) {
        const { name, description, order, is_active } = data;
        // Verify chapter exists and belongs to the subject and question bank
        const verifyQuery = `
      SELECT id FROM chapters 
      WHERE id = $1 AND subject_id = $2 AND question_bank_id = $3
    `;
        const verifyResult = await pool_1.default.query(verifyQuery, [chapterId, subjectId, questionBankId]);
        if (verifyResult.rows.length === 0) {
            throw new Error('الفصل غير موجود أو لا ينتمي لهذه المادة أو بنك الأسئلة');
        }
        const query = `
      INSERT INTO lessons (name, description, chapter_id, subject_id, question_bank_id, "order", is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
        const values = [name, description, chapterId, subjectId, questionBankId, order, is_active];
        const result = await pool_1.default.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('فشل في إنشاء الدرس');
        }
        const lesson = result.rows[0];
        return {
            ...lesson,
            chapter_id: chapterId,
            subject_id: subjectId,
            question_bank_id: questionBankId,
            created_at: new Date(lesson.created_at),
            updated_at: new Date(lesson.updated_at),
        };
    }
    // Get all lessons for a chapter
    static async getByChapter(questionBankId, subjectId, chapterId, is_active, order = 'asc') {
        // Verify chapter exists and belongs to the subject and question bank
        const verifyQuery = `
      SELECT id FROM chapters 
      WHERE id = $1 AND subject_id = $2 AND question_bank_id = $3
    `;
        const verifyResult = await pool_1.default.query(verifyQuery, [chapterId, subjectId, questionBankId]);
        if (verifyResult.rows.length === 0) {
            throw new Error('الفصل غير موجود أو لا ينتمي لهذه المادة أو بنك الأسئلة');
        }
        const whereConditions = [`chapter_id = $1`, `subject_id = $2`, `question_bank_id = $3`];
        const values = [chapterId, subjectId, questionBankId];
        let valueIndex = 4;
        if (is_active !== undefined) {
            whereConditions.push(`is_active = $${valueIndex}`);
            values.push(is_active);
            valueIndex++;
        }
        const whereClause = whereConditions.join(' AND ');
        const orderClause = order === 'desc' ? 'DESC' : 'ASC';
        const query = `
      SELECT * FROM lessons 
      WHERE ${whereClause}
      ORDER BY "order" ${orderClause}, name ASC
    `;
        const result = await pool_1.default.query(query, values);
        return result.rows.map((lesson) => ({
            ...lesson,
            created_at: new Date(lesson.created_at),
            updated_at: new Date(lesson.updated_at),
        }));
    }
    // Get lesson by ID
    static async getById(questionBankId, subjectId, chapterId, lessonId) {
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
        const query = `
      SELECT 
        l.*,
        c.name as chapter_name,
        s.name as subject_name,
        qb.name as question_bank_name
      FROM lessons l
      LEFT JOIN chapters c ON l.chapter_id = c.id
      LEFT JOIN subjects s ON l.subject_id = s.id
      LEFT JOIN question_banks qb ON l.question_bank_id = qb.id
      WHERE l.id = $1
    `;
        const result = await pool_1.default.query(query, [lessonId]);
        if (result.rows.length === 0) {
            return null;
        }
        const lesson = result.rows[0];
        return {
            ...lesson,
            created_at: new Date(lesson.created_at),
            updated_at: new Date(lesson.updated_at),
        };
    }
    // Update lesson
    static async update(questionBankId, subjectId, chapterId, lessonId, data) {
        const { name, description, order, is_active } = data;
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
        // Build update query dynamically
        const updateFields = [];
        const values = [];
        let valueIndex = 1;
        if (name !== undefined) {
            updateFields.push(`name = $${valueIndex}`);
            values.push(name);
            valueIndex++;
        }
        if (description !== undefined) {
            updateFields.push(`description = $${valueIndex}`);
            values.push(description);
            valueIndex++;
        }
        if (order !== undefined) {
            updateFields.push(`"order" = $${valueIndex}`);
            values.push(order);
            valueIndex++;
        }
        if (is_active !== undefined) {
            updateFields.push(`is_active = $${valueIndex}`);
            values.push(is_active);
            valueIndex++;
        }
        if (updateFields.length === 0) {
            throw new Error('لا توجد بيانات للتحديث');
        }
        updateFields.push(`updated_at = NOW()`);
        values.push(lessonId, chapterId, subjectId, questionBankId);
        const query = `
      UPDATE lessons 
      SET ${updateFields.join(', ')}
      WHERE id = $${valueIndex} AND chapter_id = $${valueIndex + 1} AND subject_id = $${valueIndex + 2} AND question_bank_id = $${valueIndex + 3}
      RETURNING *
    `;
        const result = await pool_1.default.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('فشل في تحديث الدرس');
        }
        const lesson = result.rows[0];
        return {
            ...lesson,
            created_at: new Date(lesson.created_at),
            updated_at: new Date(lesson.updated_at),
        };
    }
    // Delete lesson
    static async delete(questionBankId, subjectId, chapterId, lessonId) {
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
        // Check if there are any questions
        const checkQuery = `
      SELECT COUNT(*) as questions_count
      FROM questions 
      WHERE lesson_id = $1
    `;
        const checkResult = await pool_1.default.query(checkQuery, [lessonId]);
        const counts = checkResult.rows[0];
        if (counts.questions_count > 0) {
            throw new Error('لا يمكن حذف الدرس لوجود أسئلة مرتبطة به');
        }
        const query = `
      DELETE FROM lessons 
      WHERE id = $1 AND chapter_id = $2 AND subject_id = $3 AND question_bank_id = $4
    `;
        const result = await pool_1.default.query(query, [lessonId, chapterId, subjectId, questionBankId]);
        if (result.rowCount === 0) {
            throw new Error('فشل في حذف الدرس');
        }
    }
    // Get lessons accessible to teacher
    static async getTeacherLessons(teacherId, subjectId, questionBankId) {
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
            throw new Error('ليس لديك صلاحية للوصول لهذه المادة');
        }
        const query = `
      SELECT 
        l.*,
        c.name as chapter_name,
        s.name as subject_name
      FROM lessons l
      LEFT JOIN chapters c ON l.chapter_id = c.id
      LEFT JOIN subjects s ON l.subject_id = s.id
      WHERE l.subject_id = $1 AND l.question_bank_id = $2 AND l.is_active = true
      ORDER BY c."order" ASC, l."order" ASC, l.name ASC
    `;
        const result = await pool_1.default.query(query, [subjectId, questionBankId]);
        return result.rows.map((lesson) => ({
            ...lesson,
            created_at: new Date(lesson.created_at),
            updated_at: new Date(lesson.updated_at),
        }));
    }
}
exports.LessonService = LessonService;
