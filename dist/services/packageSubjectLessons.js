"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PackageSubjectLessonService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
class PackageSubjectLessonService {
    // Create Lesson
    static async createLesson(subjectId, name) {
        const result = await pool_1.default.query(`INSERT INTO package_subject_lessons (subject_id, name)
       VALUES ($1, $2)
       RETURNING *`, [subjectId, name]);
        return result.rows[0];
    }
    // Get Lessons with Content
    static async getLessonsBySubject(subjectId) {
        // 1. Get Lessons
        const lessonsResult = await pool_1.default.query('SELECT * FROM package_subject_lessons WHERE subject_id = $1 ORDER BY created_at DESC', [subjectId]);
        const lessons = lessonsResult.rows;
        if (lessons.length === 0)
            return [];
        const lessonIds = lessons.map(l => l.id);
        if (lessonIds.length === 0) {
            return lessons.map(lesson => ({
                ...lesson,
                videos: [],
                assignments: []
            }));
        }
        // 2. Get Videos
        const videosResult = await pool_1.default.query('SELECT * FROM package_subject_videos WHERE lesson_id = ANY($1)', [lessonIds]);
        // 3. Get Assignments
        const assignmentsResult = await pool_1.default.query('SELECT * FROM package_subject_assignments WHERE lesson_id = ANY($1)', [lessonIds]);
        // 4. Assemble
        return lessons.map(lesson => ({
            ...lesson,
            videos: videosResult.rows.filter(v => v.lesson_id === lesson.id),
            assignments: assignmentsResult.rows.filter(a => a.lesson_id === lesson.id)
        }));
    }
    // Get Lessons with Content (Filtered for Students: Visible Only)
    static async getVisibleLessonsBySubject(subjectId) {
        // 1. Get Visible Lessons
        const lessonsResult = await pool_1.default.query('SELECT * FROM package_subject_lessons WHERE subject_id = $1 AND is_visible = TRUE ORDER BY created_at DESC', [subjectId]);
        const lessons = lessonsResult.rows;
        if (lessons.length === 0)
            return [];
        const lessonIds = lessons.map(l => l.id);
        if (lessonIds.length === 0) {
            return lessons.map(lesson => ({
                ...lesson,
                videos: [],
                assignments: []
            }));
        }
        // 2. Get Videos (No separate visibility for videos yet, assuming if lesson is visible, its videos are too? 
        // Wait, requirement didn't specify video visibility, only lesson and assignment. 
        // IF assignment has visibility, filter it.)
        const videosResult = await pool_1.default.query('SELECT * FROM package_subject_videos WHERE lesson_id = ANY($1)', [lessonIds]);
        // 3. Get Visible Assignments
        const assignmentsResult = await pool_1.default.query('SELECT * FROM package_subject_assignments WHERE lesson_id = ANY($1) AND is_visible = TRUE', [lessonIds]);
        // 4. Assemble
        return lessons.map(lesson => ({
            ...lesson,
            videos: videosResult.rows.filter(v => v.lesson_id === lesson.id),
            assignments: assignmentsResult.rows.filter(a => a.lesson_id === lesson.id)
        }));
    }
    // Check if lesson exists
    static async getLesson(lessonId) {
        const result = await pool_1.default.query('SELECT * FROM package_subject_lessons WHERE id = $1', [lessonId]);
        return result.rows[0] || null;
    }
    // Update Lesson
    static async updateLesson(lessonId, name) {
        const result = await pool_1.default.query('UPDATE package_subject_lessons SET name = $1 WHERE id = $2 RETURNING *', [name, lessonId]);
        return result.rows[0];
    }
    // Delete Lesson
    static async deleteLesson(lessonId) {
        const result = await pool_1.default.query('DELETE FROM package_subject_lessons WHERE id = $1', [lessonId]);
        return (result.rowCount ?? 0) > 0;
    }
    // --- Videos ---
    static async addVideo(lessonId, name, link) {
        const result = await pool_1.default.query(`INSERT INTO package_subject_videos (lesson_id, name, link)
       VALUES ($1, $2, $3)
       RETURNING *`, [lessonId, name, link]);
        return result.rows[0];
    }
    static async deleteVideo(videoId) {
        const result = await pool_1.default.query('DELETE FROM package_subject_videos WHERE id = $1', [videoId]);
        return (result.rowCount ?? 0) > 0;
    }
    // --- Assignments ---
    static async addAssignment(lessonId, name, questionCount, totalMarks) {
        const result = await pool_1.default.query(`INSERT INTO package_subject_assignments (lesson_id, name, question_count, total_marks)
       VALUES ($1, $2, $3, $4)
       RETURNING *`, [lessonId, name, questionCount, totalMarks]);
        return result.rows[0];
    }
    static async deleteAssignment(assignmentId) {
        const result = await pool_1.default.query('DELETE FROM package_subject_assignments WHERE id = $1', [assignmentId]);
        return (result.rowCount ?? 0) > 0;
    }
    // --- Visibility Toggles ---
    static async toggleLessonVisibility(lessonId, isVisible) {
        const result = await pool_1.default.query('UPDATE package_subject_lessons SET is_visible = $1 WHERE id = $2 RETURNING *', [isVisible, lessonId]);
        return result.rows[0];
    }
    static async toggleAssignmentVisibility(assignmentId, isVisible) {
        const result = await pool_1.default.query('UPDATE package_subject_assignments SET is_visible = $1 WHERE id = $2 RETURNING *', [isVisible, assignmentId]);
        return result.rows[0];
    }
}
exports.PackageSubjectLessonService = PackageSubjectLessonService;
