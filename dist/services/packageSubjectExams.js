"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageSubjectExamService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageSubjectExamService {
    // Create Exam (is_visible = false by default)
    static async createExam(subjectId, name, duration, totalMarks, questionCount) {
        const result = await pool_1.default.query(`INSERT INTO package_subject_exams (subject_id, name, duration, total_marks, question_count, is_visible)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`, [subjectId, name, duration, totalMarks, questionCount]);
        return result.rows[0];
    }
    // Update Exam
    static async updateExam(examId, data) {
        const fields = [];
        const values = [];
        let paramCount = 1;
        if (data.name !== undefined) {
            fields.push(`name = $${paramCount++}`);
            values.push(data.name);
        }
        if (data.duration !== undefined) {
            fields.push(`duration = $${paramCount++}`);
            values.push(data.duration);
        }
        if (data.total_marks !== undefined) {
            fields.push(`total_marks = $${paramCount++}`);
            values.push(data.total_marks);
        }
        if (data.question_count !== undefined) {
            fields.push(`question_count = $${paramCount++}`);
            values.push(data.question_count);
        }
        if (fields.length === 0)
            return null;
        values.push(examId);
        const result = await pool_1.default.query(`UPDATE package_subject_exams SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`, values);
        return result.rows[0];
    }
    // Delete Exam
    static async deleteExam(examId) {
        const result = await pool_1.default.query('DELETE FROM package_subject_exams WHERE id = $1', [examId]);
        return (result.rowCount ?? 0) > 0;
    }
    // Toggle Visibility
    static async toggleVisibility(examId, isVisible) {
        const result = await pool_1.default.query('UPDATE package_subject_exams SET is_visible = $1 WHERE id = $2 RETURNING *', [isVisible, examId]);
        return result.rows[0];
    }
    // Get Exams for Subject
    static async getExamsBySubject(subjectId, studentId) {
        if (studentId) {
            // Student View: Include submission status AND enforce visibility
            const query = `
        SELECT e.*, 
               CASE WHEN s.id IS NOT NULL THEN TRUE ELSE FALSE END as is_submitted,
               s.score
        FROM package_subject_exams e
        LEFT JOIN package_subject_exam_submissions s ON e.id = s.exam_id AND s.student_id = $2
        WHERE e.subject_id = $1 AND e.is_visible = TRUE
        ORDER BY e.created_at DESC
      `;
            const result = await pool_1.default.query(query, [subjectId, studentId]);
            return result.rows;
        }
        // Admin/Teacher View: Return all exams (visible and hidden)
        const query = `
      SELECT e.*
      FROM package_subject_exams e
      WHERE e.subject_id = $1
      ORDER BY e.created_at DESC
    `;
        const result = await pool_1.default.query(query, [subjectId]);
        return result.rows;
    }
    // Get single exam (helper)
    static async getExam(examId) {
        const result = await pool_1.default.query('SELECT * FROM package_subject_exams WHERE id = $1', [examId]);
        return result.rows[0] || null;
    }
}
exports.PackageSubjectExamService = PackageSubjectExamService;
