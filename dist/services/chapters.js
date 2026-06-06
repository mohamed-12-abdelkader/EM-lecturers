"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class ChapterService {
    static async ensureSubjectExists(subjectId) {
        const q = `SELECT id FROM subjects WHERE id = $1`;
        const r = await pool_1.default.query(q, [subjectId]);
        if (r.rowCount === 0)
            throw new Error('المادة غير موجودة');
    }
    static async create(subjectId, data, createdBy) {
        await this.ensureSubjectExists(subjectId);
        const dup = await pool_1.default.query(`SELECT 1 FROM chapters WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`, [subjectId, data.name]);
        if (dup.rowCount) {
            const e = new Error('فصل بنفس الاسم موجود بالفعل في هذه المادة');
            e.code = '23505';
            throw e;
        }
        const q = `
      INSERT INTO chapters (subject_id, name, description, image_url, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
        const v = [
            subjectId,
            data.name,
            data.description ?? null,
            data.image_url ?? null,
            createdBy ?? null,
        ];
        const r = await pool_1.default.query(q, v);
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getById(id) {
        const r = await pool_1.default.query(`SELECT * FROM chapters WHERE id = $1`, [id]);
        if (r.rowCount === 0)
            return null;
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getBySubjectId(subjectId) {
        await this.ensureSubjectExists(subjectId);
        const r = await pool_1.default.query(`SELECT * FROM chapters WHERE subject_id = $1 ORDER BY name ASC, id ASC`, [subjectId]);
        return r.rows.map((row) => ({
            ...row,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
        }));
    }
    static async update(id, subjectId, chapterId, data) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الفصل غير موجود');
        if (data.name !== undefined) {
            const dup = await pool_1.default.query(`SELECT 1 FROM chapters WHERE subject_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`, [existing.subject_id, data.name, id]);
            if (dup.rowCount) {
                const e = new Error('فصل بنفس الاسم موجود بالفعل في هذه المادة');
                e.code = '23505';
                throw e;
            }
        }
        const fields = [];
        const values = [];
        let idx = 1;
        if (data.name !== undefined) {
            fields.push(`name = $${idx}`);
            values.push(data.name);
            idx++;
        }
        if (data.description !== undefined) {
            fields.push(`description = $${idx}`);
            values.push(data.description);
            idx++;
        }
        if (data.image_url !== undefined) {
            fields.push(`image_url = $${idx}`);
            values.push(data.image_url);
            idx++;
        }
        if (fields.length === 0)
            throw new Error('لا توجد بيانات للتحديث');
        fields.push(`updated_at = NOW()`);
        values.push(id);
        const q = `UPDATE chapters SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const r = await pool_1.default.query(q, values);
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async delete(id) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الفصل غير موجود');
        const r = await pool_1.default.query(`DELETE FROM chapters WHERE id = $1`, [id]);
        if (r.rowCount === 0)
            throw new Error('فشل في حذف الفصل');
    }
    // ✅ الجزء اللي كان عامل المشكلة
    static async getBySubjectAndBank(subjectId, questionBankId) {
        const query = `
      SELECT 
        c.*,
        s.name as subject_name
      FROM chapters c
      LEFT JOIN subjects s ON c.subject_id = s.id
      WHERE c.subject_id = $1 AND c.question_bank_id = $2 AND c.is_active = true
      ORDER BY c."order" ASC, c.name ASC
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
