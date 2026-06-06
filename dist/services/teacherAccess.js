"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.teacherHasSubjectAccess = teacherHasSubjectAccess;
exports.getSubjectIdByChapterId = getSubjectIdByChapterId;
exports.getSubjectIdByLessonId = getSubjectIdByLessonId;
const pool_1 = __importDefault(require("../db/pool"));
async function teacherHasSubjectAccess(teacherId, subjectId) {
    const res = await pool_1.default.query('SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2 LIMIT 1', [teacherId, subjectId]);
    return !!res.rowCount && res.rowCount > 0;
}
async function getSubjectIdByChapterId(chapterId) {
    const res = await pool_1.default.query('SELECT subject_id FROM chapters WHERE id = $1', [chapterId]);
    if (!res.rowCount)
        return null;
    return res.rows[0].subject_id;
}
async function getSubjectIdByLessonId(lessonId) {
    const res = await pool_1.default.query(`SELECT c.subject_id
     FROM lessons l
     JOIN chapters c ON l.chapter_id = c.id
     WHERE l.id = $1`, [lessonId]);
    if (!res.rowCount)
        return null;
    return res.rows[0].subject_id;
}
