"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageSubjectItemFilesService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageSubjectItemFilesService {
    static async getFilesBySubject(subjectId) {
        const res = await pool_1.default.query(`SELECT * FROM package_subject_item_files
       WHERE subject_id = $1
       ORDER BY order_index ASC, created_at ASC`, [subjectId]);
        return res.rows;
    }
    static async getFileById(fileId) {
        const res = await pool_1.default.query(`SELECT * FROM package_subject_item_files WHERE id = $1`, [fileId]);
        return res.rows[0] || null;
    }
    static async createFile(subjectId, data) {
        const res = await pool_1.default.query(`INSERT INTO package_subject_item_files (subject_id, name, file_url, file_size, file_type, order_index)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`, [
            subjectId,
            data.name,
            data.file_url,
            data.file_size || null,
            data.file_type || null,
            data.order_index ?? 0
        ]);
        return res.rows[0];
    }
    static async updateFile(fileId, data) {
        const updates = [];
        const values = [];
        let i = 1;
        if (data.name !== undefined) {
            updates.push(`name = $${i++}`);
            values.push(data.name);
        }
        if (data.file_url !== undefined) {
            updates.push(`file_url = $${i++}`);
            values.push(data.file_url);
        }
        if (data.file_size !== undefined) {
            updates.push(`file_size = $${i++}`);
            values.push(data.file_size);
        }
        if (data.file_type !== undefined) {
            updates.push(`file_type = $${i++}`);
            values.push(data.file_type);
        }
        if (data.order_index !== undefined) {
            updates.push(`order_index = $${i++}`);
            values.push(data.order_index);
        }
        if (!updates.length)
            return await this.getFileById(fileId);
        updates.push(`updated_at = NOW()`);
        values.push(fileId);
        const res = await pool_1.default.query(`UPDATE package_subject_item_files
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`, values);
        return res.rows[0] || null;
    }
    static async deleteFile(fileId) {
        const res = await pool_1.default.query(`DELETE FROM package_subject_item_files WHERE id = $1 RETURNING *`, [fileId]);
        return res.rows[0] || null;
    }
}
exports.PackageSubjectItemFilesService = PackageSubjectItemFilesService;
