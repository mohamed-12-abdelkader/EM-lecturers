"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminLessonService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const crypto_1 = require("crypto");
const subjectBookStructure_1 = require("./subjectBookStructure");
class AdminLessonService {
    static async ensureChapterExists(chapterId) {
        const r = await pool_1.default.query(`SELECT id FROM chapters WHERE id = $1`, [chapterId]);
        if (r.rowCount === 0)
            throw new Error('الفصل غير موجود');
    }
    static async create(chapterId, data, createdBy) {
        await this.ensureChapterExists(chapterId);
        const dup = await pool_1.default.query(`SELECT 1 FROM lessons WHERE chapter_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`, [chapterId, data.name]);
        if (dup.rowCount) {
            const e = new Error('درس بنفس الاسم موجود بالفعل في هذا الفصل');
            e.code = '23505';
            throw e;
        }
        const q = `
      INSERT INTO lessons (chapter_id, name, description, image_url, created_by, mirror_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
        const v = [
            chapterId,
            data.name,
            data.description ?? null,
            data.image_url ?? null,
            createdBy ?? null,
            (0, crypto_1.randomUUID)(),
        ];
        const r = await pool_1.default.query(q, v);
        const row = r.rows[0];
        await subjectBookStructure_1.SubjectBookStructureService.mirrorLessonToOtherBooks(row.id, createdBy);
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async getById(id) {
        const r = await pool_1.default.query(`SELECT * FROM lessons WHERE id = $1`, [id]);
        if (r.rowCount === 0)
            return null;
        const row = r.rows[0];
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async update(id, data) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الدرس غير موجود');
        if (data.name !== undefined) {
            const dup = await pool_1.default.query(`SELECT 1 FROM lessons WHERE chapter_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`, [existing.chapter_id, data.name, id]);
            if (dup.rowCount) {
                const e = new Error('درس بنفس الاسم موجود بالفعل في هذا الفصل');
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
        const q = `UPDATE lessons SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
        const r = await pool_1.default.query(q, values);
        const row = r.rows[0];
        await subjectBookStructure_1.SubjectBookStructureService.syncLessonMirrors(id, data);
        return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
    }
    static async delete(id) {
        const existing = await this.getById(id);
        if (!existing)
            throw new Error('الدرس غير موجود');
        await subjectBookStructure_1.SubjectBookStructureService.deleteLessonMirrors(id);
    }
    static async getByChapterId(chapterId) {
        await this.ensureChapterExists(chapterId);
        const r = await pool_1.default.query(`SELECT * FROM lessons WHERE chapter_id = $1 ORDER BY name ASC, id ASC`, [chapterId]);
        return r.rows.map((row) => ({
            ...row,
            created_at: new Date(row.created_at),
            updated_at: new Date(row.updated_at),
        }));
    }
}
exports.AdminLessonService = AdminLessonService;
