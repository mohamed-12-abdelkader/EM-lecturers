"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectBookService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const subjectBookStructure_1 = require("./subjectBookStructure");
class SubjectBookService {
    static async ensureSubjectExists(subjectId) {
        const r = await pool_1.default.query(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
        if (!r.rowCount)
            throw new Error('المادة غير موجودة');
    }
    static async create(subjectId, data, createdBy) {
        await this.ensureSubjectExists(subjectId);
        const dup = await pool_1.default.query(`SELECT 1 FROM subject_books WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`, [subjectId, data.name]);
        if (dup.rowCount) {
            const e = new Error('كتاب بنفس الاسم موجود بالفعل في هذه المادة');
            e.code = '23505';
            throw e;
        }
        const r = await pool_1.default.query(`INSERT INTO subject_books (subject_id, name, description, image_url, order_num, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [
            subjectId,
            data.name,
            data.description ?? null,
            data.image_url ?? null,
            data.order_num ?? 1,
            createdBy ?? null,
        ]);
        const row = r.rows[0];
        await subjectBookStructure_1.SubjectBookStructureService.syncNewBookStructure(subjectId, row.id, createdBy);
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getById(id) {
        const r = await pool_1.default.query(`SELECT * FROM subject_books WHERE id = $1`, [id]);
        if (!r.rowCount)
            return null;
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getBySubjectId(subjectId, activeOnly = false) {
        await this.ensureSubjectExists(subjectId);
        const r = await pool_1.default.query(`SELECT * FROM subject_books
       WHERE subject_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''}
       ORDER BY order_num ASC, name ASC, id ASC`, [subjectId]);
        return r.rows.map((row) => ({
            ...row,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
        }));
    }
    static async update(id, data) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الكتاب غير موجود');
        if (data.name !== undefined) {
            const dup = await pool_1.default.query(`SELECT 1 FROM subject_books WHERE subject_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`, [existing.subject_id, data.name, id]);
            if (dup.rowCount) {
                const e = new Error('كتاب بنفس الاسم موجود بالفعل في هذه المادة');
                e.code = '23505';
                throw e;
            }
        }
        const fields = [];
        const values = [];
        let idx = 1;
        for (const [key, val] of Object.entries(data)) {
            if (val !== undefined) {
                fields.push(`${key} = $${idx++}`);
                values.push(val);
            }
        }
        if (fields.length === 0)
            throw new Error('لا توجد بيانات للتحديث');
        fields.push('updated_at = NOW()');
        values.push(id);
        const r = await pool_1.default.query(`UPDATE subject_books SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`, values);
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async delete(id) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الكتاب غير موجود');
        await pool_1.default.query(`DELETE FROM subject_books WHERE id = $1`, [id]);
    }
}
exports.SubjectBookService = SubjectBookService;
