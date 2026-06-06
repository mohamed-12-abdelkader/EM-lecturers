"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageSubjectGroupFilesService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageSubjectGroupFilesService {
    static async getFilesByGroup(groupId) {
        const res = await pool_1.default.query(`SELECT * FROM package_subject_item_group_files
       WHERE group_id = $1
       ORDER BY order_index ASC, created_at ASC`, [groupId]);
        return res.rows;
    }
    static async getFileById(fileId) {
        const res = await pool_1.default.query(`SELECT * FROM package_subject_item_group_files WHERE id = $1`, [fileId]);
        return res.rows[0] || null;
    }
    static async createFile(groupId, data) {
        const res = await pool_1.default.query(`INSERT INTO package_subject_item_group_files (group_id, title, file_url, order_index)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [groupId, data.title, data.file_url, data.order_index ?? 0]);
        return res.rows[0];
    }
    static async updateFile(fileId, data) {
        const updates = [];
        const values = [];
        let i = 1;
        if (data.title !== undefined) {
            updates.push(`title = $${i++}`);
            values.push(data.title);
        }
        if (data.file_url !== undefined) {
            updates.push(`file_url = $${i++}`);
            values.push(data.file_url);
        }
        if (data.order_index !== undefined) {
            updates.push(`order_index = $${i++}`);
            values.push(data.order_index ?? 0);
        }
        if (!updates.length)
            return await this.getFileById(fileId);
        updates.push(`updated_at = NOW()`);
        values.push(fileId);
        const res = await pool_1.default.query(`UPDATE package_subject_item_group_files
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`, values);
        return res.rows[0] || null;
    }
    static async deleteFile(fileId) {
        const res = await pool_1.default.query(`DELETE FROM package_subject_item_group_files WHERE id = $1 RETURNING *`, [fileId]);
        return res.rows[0] || null;
    }
}
exports.PackageSubjectGroupFilesService = PackageSubjectGroupFilesService;
