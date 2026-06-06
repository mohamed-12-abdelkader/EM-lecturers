"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionBankService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class QuestionBankService {
    // Create new question bank
    static async create(data, createdBy) {
        const { name, description, grade_id, is_active, image_url, price } = data;
        const query = `
      INSERT INTO question_banks (name, description, image_url, grade_id, is_active, created_by, price)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
        const values = [
            name,
            description ?? null,
            image_url ?? null,
            grade_id,
            is_active,
            createdBy,
            price ?? 0,
        ];
        const result = await pool_1.default.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('فشل في إنشاء بنك الأسئلة');
        }
        const questionBank = result.rows[0];
        return {
            ...questionBank,
            created_at: new Date(questionBank.created_at),
            updated_at: new Date(questionBank.updated_at),
        };
    }
    // List question banks (wrapper for getAll with object parameter)
    static async list(params) {
        return this.getAll(params.page ?? 1, params.limit ?? 20, params.grade_id, params.is_active, params.search);
    }
    // Get all question banks with pagination and filters
    static async getAll(page = 1, limit = 20, grade_id, is_active, search) {
        const whereConditions = [];
        const values = [];
        let valueIndex = 1;
        if (grade_id !== undefined) {
            whereConditions.push(`grade_id = $${valueIndex}`);
            values.push(grade_id);
            valueIndex++;
        }
        if (is_active !== undefined) {
            whereConditions.push(`is_active = $${valueIndex}`);
            values.push(is_active);
            valueIndex++;
        }
        if (search) {
            whereConditions.push(`(name ILIKE $${valueIndex} OR description ILIKE $${valueIndex})`);
            values.push(`%${search}%`);
            valueIndex++;
        }
        const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';
        // Count total records
        const countQuery = `SELECT COUNT(*) FROM question_banks ${whereClause}`;
        const countResult = await pool_1.default.query(countQuery, values);
        const total = parseInt(countResult.rows[0].count);
        // Calculate pagination
        const offset = (page - 1) * limit;
        const totalPages = Math.ceil(total / limit);
        // Get paginated results
        const query = `
      SELECT 
        qb.*,
        g.name as grade_name,
        g.level as grade_level
      FROM question_banks qb
      LEFT JOIN grades g ON qb.grade_id = g.id
      ${whereClause}
      ORDER BY qb.created_at DESC
      LIMIT $${valueIndex} OFFSET $${valueIndex + 1}
    `;
        values.push(limit, offset);
        const result = await pool_1.default.query(query, values);
        const questionBanks = result.rows.map((bank) => ({
            ...bank,
            created_at: new Date(bank.created_at),
            updated_at: new Date(bank.updated_at),
        }));
        return {
            question_banks: questionBanks,
            total,
            page,
            limit,
            totalPages,
        };
    }
    // Get question bank by ID
    static async getById(id) {
        const query = `
      SELECT 
        qb.*,
        g.name as grade_name,
        g.level as grade_level
      FROM question_banks qb
      LEFT JOIN grades g ON qb.grade_id = g.id
      WHERE qb.id = $1
    `;
        const result = await pool_1.default.query(query, [id]);
        if (result.rows.length === 0) {
            return null;
        }
        const questionBank = result.rows[0];
        return {
            ...questionBank,
            created_at: new Date(questionBank.created_at),
            updated_at: new Date(questionBank.updated_at),
        };
    }
    // Update question bank
    static async update(id, data) {
        const { name, description, grade_id, is_active, image_url, price } = data;
        // Check if question bank exists
        const existingBank = await this.getById(id);
        if (!existingBank) {
            throw new Error('بنك الأسئلة غير موجود');
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
        if (image_url !== undefined) {
            updateFields.push(`image_url = $${valueIndex}`);
            values.push(image_url);
            valueIndex++;
        }
        if (price !== undefined) {
            updateFields.push(`price = $${valueIndex}`);
            values.push(price);
            valueIndex++;
        }
        if (grade_id !== undefined) {
            updateFields.push(`grade_id = $${valueIndex}`);
            values.push(grade_id);
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
        values.push(id);
        const query = `
      UPDATE question_banks 
      SET ${updateFields.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING *
    `;
        const result = await pool_1.default.query(query, values);
        if (result.rows.length === 0) {
            throw new Error('فشل في تحديث بنك الأسئلة');
        }
        const questionBank = result.rows[0];
        // Get grade info
        const gradeQuery = `SELECT name, level FROM grades WHERE id = $1`;
        const gradeResult = await pool_1.default.query(gradeQuery, [questionBank.grade_id]);
        return {
            ...questionBank,
            created_at: new Date(questionBank.created_at),
            updated_at: new Date(questionBank.updated_at),
        };
    }
    // Delete question bank
    static async delete(id, force = false) {
        // Check if question bank exists
        const existingBank = await this.getById(id);
        if (!existingBank) {
            throw new Error('بنك الأسئلة غير موجود');
        }
        // If not forced, block deletion when there are related rows
        if (!force) {
            const checkQuery = `
        SELECT 
          (SELECT COUNT(*) FROM subjects s WHERE s.question_bank_id = $1) as subjects_count,
          (SELECT COUNT(*) 
             FROM chapters c 
             JOIN subjects s ON c.subject_id = s.id 
            WHERE s.question_bank_id = $1) as chapters_count,
          (SELECT COUNT(*) 
             FROM lessons l 
             JOIN chapters c ON l.chapter_id = c.id 
             JOIN subjects s ON c.subject_id = s.id 
            WHERE s.question_bank_id = $1) as lessons_count,
          (SELECT COUNT(*) 
             FROM questions q 
             JOIN lessons l ON q.lesson_id = l.id 
             JOIN chapters c ON l.chapter_id = c.id 
             JOIN subjects s ON c.subject_id = s.id 
            WHERE s.question_bank_id = $1) as questions_count
      `;
            const checkResult = await pool_1.default.query(checkQuery, [id]);
            const counts = checkResult.rows[0];
            if (counts.subjects_count > 0 ||
                counts.chapters_count > 0 ||
                counts.lessons_count > 0 ||
                counts.questions_count > 0) {
                throw new Error('لا يمكن حذف بنك الأسئلة لوجود مواد أو فصول أو دروس أو أسئلة مرتبطة به');
            }
        }
        if (force) {
            // Perform cascading manual deletes to remove dependent data
            await pool_1.default.query('BEGIN');
            try {
                // Delete questions under this bank
                await pool_1.default.query(`DELETE FROM questions q
           USING lessons l, chapters c, subjects s
           WHERE q.lesson_id = l.id AND l.chapter_id = c.id AND c.subject_id = s.id AND s.question_bank_id = $1`, [id]);
                // Delete lessons
                await pool_1.default.query(`DELETE FROM lessons l
           USING chapters c, subjects s
           WHERE l.chapter_id = c.id AND c.subject_id = s.id AND s.question_bank_id = $1`, [id]);
                // Delete chapters
                await pool_1.default.query(`DELETE FROM chapters c
           USING subjects s
           WHERE c.subject_id = s.id AND s.question_bank_id = $1`, [id]);
                // Delete teacher_subjects assignments
                await pool_1.default.query(`DELETE FROM teacher_subjects ts
           USING subjects s
           WHERE ts.subject_id = s.id AND s.question_bank_id = $1`, [id]);
                // Delete subjects
                await pool_1.default.query(`DELETE FROM subjects WHERE question_bank_id = $1`, [id]);
                // Finally delete the bank
                const result = await pool_1.default.query(`DELETE FROM question_banks WHERE id = $1`, [id]);
                if (result.rowCount === 0)
                    throw new Error('فشل في حذف بنك الأسئلة');
                await pool_1.default.query('COMMIT');
            }
            catch (e) {
                await pool_1.default.query('ROLLBACK');
                throw e;
            }
            return;
        }
        const result = await pool_1.default.query(`DELETE FROM question_banks WHERE id = $1`, [id]);
        if (result.rowCount === 0) {
            throw new Error('فشل في حذف بنك الأسئلة');
        }
    }
    // Get question bank statistics
    static async getStats(id) {
        // Check if question bank exists
        const existingBank = await this.getById(id);
        if (!existingBank) {
            throw new Error('بنك الأسئلة غير موجود');
        }
        const statsQuery = `
      SELECT 
        (SELECT COUNT(*) FROM subjects s WHERE s.question_bank_id = $1) as subjects_count,
        (SELECT COUNT(*) 
           FROM chapters c 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1) as chapters_count,
        (SELECT COUNT(*) 
           FROM lessons l 
           JOIN chapters c ON l.chapter_id = c.id 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1) as lessons_count,
        (SELECT COUNT(*) 
           FROM questions q 
           JOIN lessons l ON q.lesson_id = l.id 
           JOIN chapters c ON l.chapter_id = c.id 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1) as questions_count,
        (SELECT COUNT(*) 
           FROM questions q 
           JOIN lessons l ON q.lesson_id = l.id 
           JOIN chapters c ON l.chapter_id = c.id 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1 AND q.status = 'approved') as approved_questions_count,
        (SELECT COUNT(*) 
           FROM questions q 
           JOIN lessons l ON q.lesson_id = l.id 
           JOIN chapters c ON l.chapter_id = c.id 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1 AND q.status = 'pending') as pending_questions_count,
        (SELECT COUNT(*) 
           FROM questions q 
           JOIN lessons l ON q.lesson_id = l.id 
           JOIN chapters c ON l.chapter_id = c.id 
           JOIN subjects s ON c.subject_id = s.id 
          WHERE s.question_bank_id = $1 AND q.status = 'rejected') as rejected_questions_count
    `;
        const statsResult = await pool_1.default.query(statsQuery, [id]);
        const stats = statsResult.rows[0];
        // Get grade info
        const gradeQuery = `SELECT name, level FROM grades WHERE id = $1`;
        const gradeResult = await pool_1.default.query(gradeQuery, [existingBank.grade_id]);
        return {
            question_bank: existingBank,
            grade: gradeResult.rows[0],
            statistics: {
                subjects: parseInt(stats.subjects_count),
                chapters: parseInt(stats.chapters_count),
                lessons: parseInt(stats.lessons_count),
                questions: parseInt(stats.questions_count),
                approved_questions: parseInt(stats.approved_questions_count),
                pending_questions: parseInt(stats.pending_questions_count),
                rejected_questions: parseInt(stats.rejected_questions_count),
            },
        };
    }
    // Search question banks
    static async search(query, page = 1, limit = 20) {
        const searchQuery = `
      SELECT 
        qb.*,
        g.name as grade_name,
        g.level as grade_level
      FROM question_banks qb
      LEFT JOIN grades g ON qb.grade_id = g.id
      WHERE 
        qb.name ILIKE $1 OR 
        qb.description ILIKE $1 OR
        g.name ILIKE $1
      ORDER BY 
        CASE 
          WHEN qb.name ILIKE $1 THEN 1
          WHEN qb.description ILIKE $1 THEN 2
          ELSE 3
        END,
        qb.created_at DESC
      LIMIT $2 OFFSET $3
    `;
        const offset = (page - 1) * limit;
        const values = [`%${query}%`, limit, offset];
        const result = await pool_1.default.query(searchQuery, values);
        // Count total results
        const countQuery = `
      SELECT COUNT(*)
      FROM question_banks qb
      LEFT JOIN grades g ON qb.grade_id = g.id
      WHERE 
        qb.name ILIKE $1 OR 
        qb.description ILIKE $1 OR
        g.name ILIKE $1
    `;
        const countResult = await pool_1.default.query(countQuery, [`%${query}%`]);
        const total = parseInt(countResult.rows[0].count);
        const totalPages = Math.ceil(total / limit);
        const questionBanks = result.rows.map((bank) => ({
            ...bank,
            created_at: new Date(bank.created_at),
            updated_at: new Date(bank.updated_at),
        }));
        return {
            question_banks: questionBanks,
            total,
            page,
            limit,
            totalPages,
        };
    }
}
exports.QuestionBankService = QuestionBankService;
