import pool from '../db/pool';

export interface Exam {
    id: number;
    subject_id: number;
    name: string;
    duration: number;
    total_marks: number;
    question_count: number;
    is_visible: boolean;
    created_at: string;
    is_submitted?: boolean; // For student view
    score?: number; // For student view
}

export class PackageSubjectExamService {
    // Create Exam (is_visible = false by default)
    static async createExam(
        subjectId: number,
        name: string,
        duration: number,
        totalMarks: number,
        questionCount: number
    ): Promise<Exam> {
        const result = await pool.query(
            `INSERT INTO package_subject_exams (subject_id, name, duration, total_marks, question_count, is_visible)
       VALUES ($1, $2, $3, $4, $5, FALSE)
       RETURNING *`,
            [subjectId, name, duration, totalMarks, questionCount]
        );
        return result.rows[0];
    }

    // Update Exam
    static async updateExam(
        examId: number,
        data: { name?: string; duration?: number; total_marks?: number; question_count?: number }
    ): Promise<Exam | null> {
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

        if (fields.length === 0) return null;

        values.push(examId);
        const result = await pool.query(
            `UPDATE package_subject_exams SET ${fields.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );
        return result.rows[0];
    }

    // Delete Exam
    static async deleteExam(examId: number): Promise<boolean> {
        const result = await pool.query('DELETE FROM package_subject_exams WHERE id = $1', [examId]);
        return (result.rowCount ?? 0) > 0;
    }

    // Toggle Visibility
    static async toggleVisibility(examId: number, isVisible: boolean): Promise<Exam | null> {
        const result = await pool.query(
            'UPDATE package_subject_exams SET is_visible = $1 WHERE id = $2 RETURNING *',
            [isVisible, examId]
        );
        return result.rows[0];
    }

    // Get Exams for Subject
    static async getExamsBySubject(subjectId: number, studentId?: number): Promise<Exam[]> {
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
            const result = await pool.query(query, [subjectId, studentId]);
            return result.rows;
        }

        // Admin/Teacher View: Return all exams (visible and hidden)
        const query = `
      SELECT e.*
      FROM package_subject_exams e
      WHERE e.subject_id = $1
      ORDER BY e.created_at DESC
    `;
        const result = await pool.query(query, [subjectId]);
        return result.rows;
    }

    // Get single exam (helper)
    static async getExam(examId: number): Promise<Exam | null> {
        const result = await pool.query('SELECT * FROM package_subject_exams WHERE id = $1', [examId]);
        return result.rows[0] || null;
    }
}
