"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherGradesService = exports.findUserByEmail = exports.createUser = exports.getUserById = exports.getAllUsers = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const getAllUsers = async () => {
    const res = await pool_1.default.query('SELECT id, name, email FROM users');
    return res.rows;
};
exports.getAllUsers = getAllUsers;
const getUserById = async (id) => {
    const res = await pool_1.default.query('SELECT id, name, email FROM users WHERE id = $1', [id]);
    return res.rows[0];
};
exports.getUserById = getUserById;
const createUser = async (name, email, passwordHash) => {
    const res = await pool_1.default.query('INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, passwordHash]);
    return res.rows[0];
};
exports.createUser = createUser;
const findUserByEmail = async (email) => {
    const res = await pool_1.default.query('SELECT id, name, email, password FROM users WHERE email = $1', [
        email,
    ]);
    return res.rows[0];
};
exports.findUserByEmail = findUserByEmail;
class TeacherGradesService {
    static async setTeacherGrades(teacherId, gradeIds) {
        // احذف القديم
        await pool_1.default.query('DELETE FROM teacher_grades WHERE teacher_id = $1', [teacherId]);
        // تحقق من وجود الصفوف الدراسية قبل إدراجها
        for (const gradeId of gradeIds) {
            const gradeExists = await pool_1.default.query('SELECT id FROM grades WHERE id = $1', [gradeId]);
            if (gradeExists.rows.length === 0) {
                throw new Error(`الصف الدراسي برقم ${gradeId} غير موجود`);
            }
            await pool_1.default.query('INSERT INTO teacher_grades (teacher_id, grade_id) VALUES ($1, $2)', [
                teacherId,
                gradeId,
            ]);
        }
    }
    static async getTeacherGrades(teacherId) {
        const res = await pool_1.default.query(`SELECT DISTINCT g.id, g.name, g.slug, g.stage, g.status
       FROM grades g
       WHERE g.id IN (
         SELECT tg.grade_id
         FROM teacher_grades tg
         WHERE tg.teacher_id = $1
         UNION
         SELECT ug.grade_id
         FROM user_grades ug
         WHERE ug.user_id = $1
       )
       ORDER BY g.id`, [teacherId]);
        return res.rows;
    }
}
exports.TeacherGradesService = TeacherGradesService;
