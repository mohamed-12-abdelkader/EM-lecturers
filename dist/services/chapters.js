"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const crypto_1 = require("crypto");
const subjectBookStructure_1 = require("./subjectBookStructure");
class ChapterService {
    static async ensureBookExists(bookId) {
        const r = await pool_1.default.query(`SELECT id, subject_id FROM subject_books WHERE id = $1`, [bookId]);
        if (!r.rowCount)
            throw new Error('الكتاب غير موجود');
        return r.rows[0];
    }
    static async ensureSubjectExists(subjectId) {
        const q = `SELECT id FROM subjects WHERE id = $1`;
        const r = await pool_1.default.query(q, [subjectId]);
        if (r.rowCount === 0)
            throw new Error('المادة غير موجودة');
    }
    static async create(bookId, data, createdBy) {
        const book = await this.ensureBookExists(bookId);
        const dup = await pool_1.default.query(`SELECT 1 FROM chapters WHERE book_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`, [bookId, data.name]);
        if (dup.rowCount) {
            const e = new Error('فصل بنفس الاسم موجود بالفعل في هذا الكتاب');
            e.code = '23505';
            throw e;
        }
        const q = `
      INSERT INTO chapters (subject_id, book_id, name, description, image_url, created_by, mirror_key)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;
        const v = [
            book.subject_id,
            bookId,
            data.name,
            data.description ?? null,
            data.image_url ?? null,
            createdBy ?? null,
            (0, crypto_1.randomUUID)(),
        ];
        const r = await pool_1.default.query(q, v);
        const row = r.rows[0];
        await subjectBookStructure_1.SubjectBookStructureService.mirrorChapterToOtherBooks(row.id, createdBy);
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    /** @deprecated use create(bookId) — kept for legacy callers that pass subjectId only */
    static async createUnderSubject(subjectId, data, createdBy) {
        await this.ensureSubjectExists(subjectId);
        let bookId = data.book_id;
        if (!bookId) {
            const books = await pool_1.default.query(`SELECT id FROM subject_books WHERE subject_id = $1 ORDER BY order_num ASC, id ASC LIMIT 1`, [subjectId]);
            if (!books.rowCount) {
                throw new Error('يجب إنشاء كتاب للمادة أولاً قبل إضافة فصول');
            }
            bookId = books.rows[0].id;
        }
        return this.create(Number(bookId), data, createdBy);
    }
    static async getById(id) {
        const r = await pool_1.default.query(`SELECT c.*, sb.name AS book_name
       FROM chapters c
       LEFT JOIN subject_books sb ON sb.id = c.book_id
       WHERE c.id = $1`, [id]);
        if (r.rowCount === 0)
            return null;
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getByBookId(bookId) {
        await this.ensureBookExists(bookId);
        const r = await pool_1.default.query(`SELECT * FROM chapters WHERE book_id = $1 ORDER BY order_num ASC, name ASC, id ASC`, [bookId]);
        return r.rows.map((row) => ({
            ...row,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
        }));
    }
    static async getBySubjectId(subjectId) {
        await this.ensureSubjectExists(subjectId);
        const r = await pool_1.default.query(`SELECT c.*, sb.name AS book_name
       FROM chapters c
       LEFT JOIN subject_books sb ON sb.id = c.book_id
       WHERE c.subject_id = $1
       ORDER BY sb.order_num ASC, c.order_num ASC, c.name ASC, c.id ASC`, [subjectId]);
        return r.rows.map((row) => ({
            ...row,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
        }));
    }
    static async update(id, data) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الفصل غير موجود');
        if (data.name !== undefined && existing.book_id) {
            const dup = await pool_1.default.query(`SELECT 1 FROM chapters WHERE book_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`, [existing.book_id, data.name, id]);
            if (dup.rowCount) {
                const e = new Error('فصل بنفس الاسم موجود بالفعل في هذا الكتاب');
                e.code = '23505';
                throw e;
            }
        }
        const fields = [];
        const values = [];
        let idx = 1;
        if (data.name !== undefined) {
            fields.push(`name = $${idx++}`);
            values.push(data.name);
        }
        if (data.description !== undefined) {
            fields.push(`description = $${idx++}`);
            values.push(data.description);
        }
        if (data.image_url !== undefined) {
            fields.push(`image_url = $${idx++}`);
            values.push(data.image_url);
        }
        if (fields.length === 0)
            throw new Error('لا توجد بيانات للتحديث');
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const q = `UPDATE chapters SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const r = await pool_1.default.query(q, values);
        const row = r.rows[0];
        await subjectBookStructure_1.SubjectBookStructureService.syncChapterMirrors(id, data);
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async delete(id) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الفصل غير موجود');
        await subjectBookStructure_1.SubjectBookStructureService.deleteChapterMirrors(id);
    }
    static async getBySubjectAndBank(subjectId, questionBankId) {
        const query = `
      SELECT 
        c.*,
        s.name as subject_name,
        sb.name as book_name
      FROM chapters c
      LEFT JOIN subjects s ON c.subject_id = s.id
      LEFT JOIN subject_books sb ON sb.id = c.book_id
      WHERE c.subject_id = $1 AND c.question_bank_id = $2 AND c.is_active = true
      ORDER BY sb.order_num ASC, c."order" ASC, c.name ASC
    `;
        const result = await pool_1.default.query(query, [subjectId, questionBankId]);
        return result.rows.map((chapter) => ({
            ...chapter,
            created_at: new Date(chapter.created_at),
            updated_at: new Date(chapter.updated_at),
        }));
    }
}
exports.ChapterService = ChapterService;
