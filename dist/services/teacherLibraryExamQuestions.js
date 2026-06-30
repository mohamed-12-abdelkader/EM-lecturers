"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherLibraryExamQuestionsService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const examFlow_1 = require("./examFlow");
const courseLevelExams_1 = require("./courseLevelExams");
function parseChoices(raw) {
    if (raw == null)
        return [];
    if (Array.isArray(raw))
        return raw.map((v) => String(v ?? '').trim()).filter(Boolean);
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.map((v) => String(v ?? '').trim()).filter(Boolean) : [];
        }
        catch {
            return [];
        }
    }
    return [];
}
function indexToLetter(index) {
    const i = index ?? 0;
    if (i < 0 || i > 3)
        return 'A';
    return String.fromCharCode(65 + i);
}
function padOptions(choices) {
    const padded = [...choices];
    while (padded.length < 4)
        padded.push(String.fromCharCode(65 + padded.length));
    return [
        padded[0].substring(0, 500),
        padded[1].substring(0, 500),
        padded[2].substring(0, 500),
        padded[3].substring(0, 500),
    ];
}
class TeacherLibraryExamQuestionsService {
    static async fetchOwnedQuestions(teacherId, questionIds) {
        if (!questionIds.length)
            return [];
        const res = await pool_1.default.query(`SELECT tq.id, tq.lesson_id, tq.passage_id, tq.question_text, tq.question_type,
              tq.choices, tq.answer, tq.image_url, tq.correct_answer_index, tq.explanation,
              COALESCE(tq.points, 1) AS points
       FROM teacher_questions tq
       JOIN teacher_question_lessons l ON l.id = tq.lesson_id
       WHERE l.teacher_id = $1 AND tq.id = ANY($2::int[])
       ORDER BY tq.id`, [teacherId, questionIds]);
        return res.rows;
    }
    static async validateQuestionIds(teacherId, questionIds) {
        const unique = [...new Set(questionIds)];
        if (!unique.length)
            return { missing: [] };
        const rows = await this.fetchOwnedQuestions(teacherId, unique);
        const found = new Set(rows.map((r) => r.id));
        return { missing: unique.filter((id) => !found.has(id)) };
    }
    static async fetchLessonQuestionIds(teacherId, lessonId) {
        const res = await pool_1.default.query(`SELECT tq.id
       FROM teacher_questions tq
       JOIN teacher_question_lessons l ON l.id = tq.lesson_id
       WHERE l.teacher_id = $1 AND l.id = $2
       ORDER BY tq.id`, [teacherId, lessonId]);
        return res.rows.map((r) => r.id);
    }
    static async fetchPassageQuestionIds(teacherId, passageId) {
        const res = await pool_1.default.query(`SELECT tq.id
       FROM teacher_questions tq
       JOIN teacher_question_passages p ON p.id = tq.passage_id
       JOIN teacher_question_lessons l ON l.id = p.lesson_id
       WHERE l.teacher_id = $1 AND p.id = $2
       ORDER BY tq.id`, [teacherId, passageId]);
        return res.rows.map((r) => r.id);
    }
    static async addToLectureExam(teacherId, examId, questionIds, txClient) {
        const exam = await examFlow_1.ExamFlowService.getExamWithCourse(examId);
        if (!exam)
            throw new utils_1.HttpError(404, 'Exam not found');
        if (exam.teacher_id !== teacherId)
            throw new utils_1.HttpError(403, 'You do not own this exam');
        const uniqueIds = [...new Set(questionIds)];
        if (!uniqueIds.length) {
            return {
                addedCount: 0,
                examQuestionIds: [],
                addedTeacherQuestionIds: [],
                skippedTeacherQuestionIds: [],
            };
        }
        const db = txClient ?? pool_1.default;
        const questions = await this.fetchOwnedQuestions(teacherId, uniqueIds);
        const foundIds = new Set(questions.map((q) => q.id));
        const missing = uniqueIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
            throw new utils_1.HttpError(400, 'Some question IDs were not found in your question library', {
                missingQuestionIds: missing,
            });
        }
        const existingRes = await db.query(`SELECT teacher_question_id FROM exam_questions
       WHERE exam_id = $1 AND teacher_question_id = ANY($2::int[])`, [examId, uniqueIds]);
        const existing = new Set(existingRes.rows
            .map((r) => r.teacher_question_id)
            .filter((id) => id != null));
        const toAdd = questions.filter((q) => !existing.has(q.id));
        const skippedTeacherQuestionIds = questions
            .filter((q) => existing.has(q.id))
            .map((q) => q.id);
        const examQuestionIds = [];
        const addedTeacherQuestionIds = [];
        for (const q of toAdd) {
            const choices = parseChoices(q.choices);
            const insertRes = await db.query(`INSERT INTO exam_questions (
           exam_id, teacher_question_id, question_text, grade, image, correct_answer_index_override
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`, [
                examId,
                q.id,
                q.question_text,
                q.points ?? 1,
                q.image_url,
                q.question_type === 'choice' ? q.correct_answer_index : null,
            ]);
            const examQuestionId = insertRes.rows[0].id;
            examQuestionIds.push(examQuestionId);
            addedTeacherQuestionIds.push(q.id);
            if (q.question_type === 'choice' && choices.length > 0) {
                const limit = Math.min(choices.length, 4);
                for (let i = 0; i < limit; i++) {
                    try {
                        await db.query(`INSERT INTO exam_question_options (exam_question_id, option_index, text_content)
               VALUES ($1, $2, $3)`, [examQuestionId, i, choices[i]]);
                    }
                    catch {
                        // exam_question_options table may be missing on old DBs
                    }
                }
            }
        }
        return {
            addedCount: examQuestionIds.length,
            examQuestionIds,
            addedTeacherQuestionIds,
            skippedTeacherQuestionIds,
        };
    }
    static async addToCourseExam(teacherId, examId, questionIds, txClient) {
        await courseLevelExams_1.CourseLevelExamsService.getExamById(examId, { id: teacherId, role: 'teacher' });
        const uniqueIds = [...new Set(questionIds)];
        if (!uniqueIds.length) {
            return {
                addedCount: 0,
                addedQuestions: [],
                addedTeacherQuestionIds: [],
                skippedTeacherQuestionIds: [],
            };
        }
        const db = txClient ?? pool_1.default;
        const questions = await this.fetchOwnedQuestions(teacherId, uniqueIds);
        const foundIds = new Set(questions.map((q) => q.id));
        const missing = uniqueIds.filter((id) => !foundIds.has(id));
        if (missing.length) {
            throw new utils_1.HttpError(400, 'Some question IDs were not found in your question library', {
                missingQuestionIds: missing,
            });
        }
        const existingRes = await db.query(`SELECT teacher_question_id FROM course_level_exam_questions
       WHERE exam_id = $1 AND teacher_question_id = ANY($2::int[])`, [examId, uniqueIds]);
        const existing = new Set(existingRes.rows
            .map((r) => r.teacher_question_id)
            .filter((id) => id != null));
        const toAdd = questions.filter((q) => !existing.has(q.id));
        const skippedTeacherQuestionIds = questions
            .filter((q) => existing.has(q.id))
            .map((q) => q.id);
        const addedQuestions = [];
        const addedTeacherQuestionIds = [];
        for (const q of toAdd) {
            if (q.question_type !== 'choice') {
                throw new utils_1.HttpError(400, `Question ${q.id} is not multiple-choice; only choice questions can be added to course-level exams`);
            }
            const choices = parseChoices(q.choices);
            if (choices.length < 2) {
                throw new utils_1.HttpError(400, `Question ${q.id} must have at least 2 choices`);
            }
            const [optionA, optionB, optionC, optionD] = padOptions(choices);
            const hasImage = Boolean(q.image_url?.trim());
            const type = hasImage ? 'IMAGE' : 'TEXT';
            const correctAnswer = indexToLetter(q.correct_answer_index);
            const insertRes = await db.query(`INSERT INTO course_level_exam_questions (
           exam_id, type, question_text, question_image,
           option_a, option_b, option_c, option_d,
           correct_answer, created_by, teacher_question_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`, [
                examId,
                type,
                hasImage ? null : q.question_text,
                hasImage ? q.image_url : null,
                optionA,
                optionB,
                optionC,
                optionD,
                correctAnswer,
                teacherId,
                q.id,
            ]);
            addedQuestions.push(insertRes.rows[0]);
            addedTeacherQuestionIds.push(q.id);
        }
        return {
            addedCount: addedQuestions.length,
            addedQuestions,
            addedTeacherQuestionIds,
            skippedTeacherQuestionIds,
        };
    }
}
exports.TeacherLibraryExamQuestionsService = TeacherLibraryExamQuestionsService;
