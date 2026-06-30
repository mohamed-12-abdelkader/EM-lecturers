"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileCategoriesRepository = void 0;
const pool_1 = __importDefault(require("../../../db/pool"));
class FileCategoriesRepository {
    static async create(teacherId, name) {
        const result = await pool_1.default.query(`INSERT INTO file_categories (teacher_id, name)
       VALUES ($1, $2)
       RETURNING *`, [teacherId, name]);
        return result.rows[0];
    }
    static async findById(id, teacherId) {
        const result = await pool_1.default.query(`SELECT * FROM file_categories WHERE id = $1 AND teacher_id = $2`, [id, teacherId]);
        return result.rows[0] ?? null;
    }
    static async listByTeacher(teacherId) {
        const result = await pool_1.default.query(`SELECT * FROM file_categories WHERE teacher_id = $1 ORDER BY name ASC`, [teacherId]);
        return result.rows;
    }
    static async update(id, teacherId, name) {
        const result = await pool_1.default.query(`UPDATE file_categories
       SET name = $3, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`, [id, teacherId, name]);
        return result.rows[0] ?? null;
    }
    static async delete(id, teacherId) {
        const result = await pool_1.default.query(`DELETE FROM file_categories WHERE id = $1 AND teacher_id = $2`, [id, teacherId]);
        return (result.rowCount ?? 0) > 0;
    }
    static async countFilesInCategory(categoryId, teacherId) {
        const result = await pool_1.default.query(`SELECT COUNT(*)::text AS count
       FROM teacher_files
       WHERE category_id = $1 AND teacher_id = $2 AND deleted_at IS NULL`, [categoryId, teacherId]);
        return parseInt(result.rows[0]?.count ?? '0', 10);
    }
}
exports.FileCategoriesRepository = FileCategoriesRepository;
