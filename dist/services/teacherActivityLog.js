"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherActivityLogService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class TeacherActivityLogService {
    static async log({ teacher_id, action, entity_type, entity_id, description, }) {
        await pool_1.default.query(`INSERT INTO teacher_activity_log (teacher_id, action, entity_type, entity_id, description)
       VALUES ($1, $2, $3, $4, $5)`, [teacher_id, action, entity_type, entity_id ?? null, description ?? null]);
    }
    static async getTeacherLog(teacher_id, limit = 20, offset = 0) {
        const result = await pool_1.default.query(`SELECT * FROM teacher_activity_log WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [teacher_id, limit, offset]);
        return result.rows;
    }
}
exports.TeacherActivityLogService = TeacherActivityLogService;
