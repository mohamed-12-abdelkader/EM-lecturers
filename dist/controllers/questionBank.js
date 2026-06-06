"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
exports.router = (0, express_1.Router)();
// API للـ Admin للحصول على قائمة بنوك الأسئلة
exports.router.get('/', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const result = await pool_1.default.query(`SELECT 
           qb.id,
           qb.name,
           qb.description,
           qb.grade_id,
           g.name as grade_name,
           COUNT(DISTINCT s.id) as subjects_count,
           COUNT(DISTINCT c.id) as chapters_count,
           COUNT(DISTINCT l.id) as lessons_count,
           COUNT(DISTINCT q.id) as questions_count
         FROM question_banks qb
         JOIN grades g ON g.id = qb.grade_id
         LEFT JOIN subjects s ON s.question_bank_id = qb.id
         LEFT JOIN chapters c ON c.subject_id = s.id
         LEFT JOIN lessons l ON l.chapter_id = c.id
         LEFT JOIN questions q ON q.lesson_id = l.id
         GROUP BY qb.id, qb.name, qb.description, qb.grade_id, g.name
         ORDER BY qb.name`, []);
        res.json({
            success: true,
            data: result.rows.map((bank) => ({
                id: bank.id,
                name: bank.name,
                description: bank.description,
                grade_id: bank.grade_id,
                grade_name: bank.grade_name,
                subjects_count: parseInt(bank.subjects_count),
                chapters_count: parseInt(bank.chapters_count),
                lessons_count: parseInt(bank.lessons_count),
                questions_count: parseInt(bank.questions_count),
            })),
        });
    }
    catch (error) {
        console.error('Error in question banks API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}));
// API للتحقق من حالة الطالب وصفه (للـ debugging)
exports.router.get('/student/debug', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        // جلب معلومات الطالب
        const studentResult = await pool_1.default.query(`SELECT id, name, email, role FROM users WHERE id = $1`, [studentId]);
        if (!studentResult.rowCount) {
            return res.status(404).json({ message: 'Student not found' });
        }
        // جلب صف الطالب
        const gradeResult = await pool_1.default.query(`SELECT ug.grade_id, g.name as grade_name 
         FROM user_grades ug 
         JOIN grades g ON g.id = ug.grade_id 
         WHERE ug.user_id = $1`, [studentId]);
        // جلب بنك الأسئلة الخاص بالصف
        let questionBank = null;
        if (gradeResult.rowCount && gradeResult.rowCount > 0) {
            const qbResult = await pool_1.default.query(`SELECT id, name FROM question_banks WHERE grade_id = $1`, [gradeResult.rows[0].grade_id]);
            questionBank = qbResult.rows[0] || null;
        }
        // جلب المواد في بنك الأسئلة
        let subjects = [];
        if (questionBank) {
            const subjectsResult = await pool_1.default.query(`SELECT id, name FROM subjects WHERE question_bank_id = $1 AND is_active = true`, [questionBank.id]);
            subjects = subjectsResult.rows;
        }
        res.json({
            success: true,
            data: {
                student: studentResult.rows[0],
                grade: gradeResult.rows[0] || null,
                question_bank: questionBank,
                subjects_count: subjects.length,
                subjects: subjects,
            },
        });
    }
    catch (error) {
        console.error('Error in debug API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}));
// API للطالب ليعرض المواد الموجودة في بنك الأسئلة الخاص بصفه
exports.router.get('/student/subjects', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        console.log(`Debug - Getting subjects for student ${studentId}`);
        // جلب صف الطالب من جدول user_grades
        const studentGradeResult = await pool_1.default.query(`SELECT ug.grade_id FROM user_grades ug WHERE ug.user_id = $1 LIMIT 1`, [studentId]);
        if (!studentGradeResult.rowCount) {
            console.log(`Debug - Student ${studentId} has no grade assigned`);
            return res.status(400).json({ message: 'Student grade not assigned' });
        }
        const gradeId = studentGradeResult.rows[0].grade_id;
        console.log(`Debug - Student grade ID: ${gradeId}`);
        // جلب المواد الموجودة في بنك الأسئلة الخاص بصف الطالب
        const subjectsResult = await pool_1.default.query(`SELECT 
          s.id,
          s.name,
          s.description,
          s.image_url,
          s.color,
          COUNT(DISTINCT c.id) as chapters_count,
          COUNT(DISTINCT l.id) as lessons_count,
          COUNT(DISTINCT q.id) as questions_count
         FROM subjects s
         LEFT JOIN chapters c ON c.subject_id = s.id
         LEFT JOIN lessons l ON l.chapter_id = c.id
         LEFT JOIN questions q ON q.lesson_id = l.id
         WHERE s.question_bank_id = (
           SELECT qb.id FROM question_banks qb WHERE qb.grade_id = $1
         )
         AND s.is_active = true
         GROUP BY s.id, s.name, s.description, s.image_url, s.color
         ORDER BY s.name`, [gradeId]);
        console.log(`Debug - Subjects found: ${subjectsResult.rows.length}`);
        res.json({
            success: true,
            data: subjectsResult.rows.map((subject) => ({
                id: subject.id,
                name: subject.name,
                description: subject.description,
                image_url: subject.image_url,
                color: subject.color,
                chapters_count: parseInt(subject.chapters_count),
                lessons_count: parseInt(subject.lessons_count),
                questions_count: parseInt(subject.questions_count),
            })),
        });
    }
    catch (error) {
        console.error('Error in subjects API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}));
// API للطالب ليعرض الفصول الموجودة في مادة معينة
exports.router.get('/student/subjects/:subjectId/chapters', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const studentId = req.user.id;
    const subjectId = Number(req.params.subjectId);
    if (isNaN(subjectId)) {
        return res.status(400).json({ message: 'Invalid subject ID' });
    }
    // التحقق من أن المادة موجودة في بنك الأسئلة الخاص بصف الطالب
    const subjectCheckResult = await pool_1.default.query(`SELECT s.id 
       FROM subjects s
       JOIN question_banks qb ON qb.id = s.question_bank_id
       JOIN user_grades ug ON ug.grade_id = qb.grade_id
       WHERE s.id = $1 AND ug.user_id = $2 AND s.is_active = true`, [subjectId, studentId]);
    if (!subjectCheckResult.rowCount) {
        return res.status(404).json({ message: 'Subject not found or not accessible' });
    }
    // جلب الفصول الموجودة في المادة
    const chaptersResult = await pool_1.default.query(`SELECT 
        c.id,
        c.name,
        c.description,
        c.image_url,
        COUNT(DISTINCT l.id) as lessons_count,
        COUNT(DISTINCT q.id) as questions_count
       FROM chapters c
       LEFT JOIN lessons l ON l.chapter_id = c.id
       LEFT JOIN questions q ON q.lesson_id = l.id
       WHERE c.subject_id = $1
       GROUP BY c.id, c.name, c.description, c.image_url
       ORDER BY c.name`, [subjectId]);
    res.json({
        success: true,
        data: chaptersResult.rows.map((chapter) => ({
            id: chapter.id,
            name: chapter.name,
            description: chapter.description,
            image_url: chapter.image_url,
            lessons_count: parseInt(chapter.lessons_count),
            questions_count: parseInt(chapter.questions_count),
        })),
    });
}));
// API للطالب ليعرض الدروس الموجودة في فصل معين
exports.router.get('/student/chapters/:chapterId/lessons', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        const chapterId = Number(req.params.chapterId);
        console.log(`Debug - Getting lessons for chapter ${chapterId}, student ${studentId}`);
        if (isNaN(chapterId)) {
            return res.status(400).json({ message: 'Invalid chapter ID' });
        }
        // التحقق من أن الطالب له صف محدد
        const studentGradeResult = await pool_1.default.query(`SELECT ug.grade_id FROM user_grades ug WHERE ug.user_id = $1 LIMIT 1`, [studentId]);
        if (!studentGradeResult.rowCount) {
            console.log(`Debug - Student ${studentId} has no grade assigned`);
            return res.status(400).json({ message: 'Student grade not assigned' });
        }
        const gradeId = studentGradeResult.rows[0].grade_id;
        console.log(`Debug - Student grade ID: ${gradeId}`);
        // التحقق من أن الفصل موجود في بنك الأسئلة الخاص بصف الطالب
        const chapterCheckResult = await pool_1.default.query(`SELECT c.id, c.name, s.name as subject_name
         FROM chapters c
         JOIN subjects s ON s.id = c.subject_id
         JOIN question_banks qb ON qb.id = s.question_bank_id
         JOIN user_grades ug ON ug.grade_id = qb.grade_id
         WHERE c.id = $1 AND ug.user_id = $2`, [chapterId, studentId]);
        console.log(`Debug - Chapter check result:`, chapterCheckResult.rows);
        if (!chapterCheckResult.rowCount) {
            console.log(`Debug - Chapter ${chapterId} not found or not accessible for student ${studentId}`);
            return res.status(404).json({ message: 'Chapter not found or not accessible' });
        }
        // فحص أعمدة جدول lessons
        const columnsResult = await pool_1.default.query(`SELECT column_name FROM information_schema.columns 
         WHERE table_name = 'lessons' AND table_schema = 'public'`, []);
        console.log(`Debug - Lessons table columns:`, columnsResult.rows.map((r) => r.column_name));
        // جلب الدروس الموجودة في الفصل
        let lessonsResult;
        try {
            // محاولة استخدام order_num و is_active إذا كانا موجودين
            lessonsResult = await pool_1.default.query(`SELECT 
            l.id,
            l.name,
            l.description,
            l.image_url,
            l.order_num,
            COUNT(DISTINCT q.id) as questions_count
           FROM lessons l
           LEFT JOIN questions q ON q.lesson_id = l.id
           WHERE l.chapter_id = $1 AND l.is_active = true
           GROUP BY l.id, l.name, l.description, l.image_url, l.order_num
           ORDER BY l.order_num, l.name`, [chapterId]);
        }
        catch (error) {
            console.log(`Debug - Advanced columns not found, using basic query`);
            console.log(`Debug - Error:`, error instanceof Error ? error.message : 'Unknown error');
            // استخدام query أساسي بدون order_num و is_active
            lessonsResult = await pool_1.default.query(`SELECT 
            l.id,
            l.name,
            l.description,
            l.image_url,
            l.id as order_num,
            COUNT(DISTINCT q.id) as questions_count
           FROM lessons l
           LEFT JOIN questions q ON q.lesson_id = l.id
           WHERE l.chapter_id = $1
           GROUP BY l.id, l.name, l.description, l.image_url
           ORDER BY l.id, l.name`, [chapterId]);
        }
        console.log(`Debug - Lessons found: ${lessonsResult.rows.length}`);
        res.json({
            success: true,
            data: lessonsResult.rows.map((lesson) => ({
                id: lesson.id,
                name: lesson.name,
                description: lesson.description,
                image_url: lesson.image_url,
                order_num: lesson.order_num,
                questions_count: parseInt(lesson.questions_count),
            })),
        });
    }
    catch (error) {
        console.error('Error in chapters lessons API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}));
// API للطالب لجلب الأسئلة من درس معين (للاستخدام في الألعاب)
exports.router.get('/student/lessons/:lessonId/questions', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const studentId = req.user.id;
        const lessonId = Number(req.params.lessonId);
        const { count = 10 } = req.query;
        console.log(`Debug - Getting questions for lesson ${lessonId}, student ${studentId}`);
        if (isNaN(lessonId)) {
            return res.status(400).json({ message: 'Invalid lesson ID' });
        }
        const questionsCount = Math.min(Math.max(Number(count), 1), 50); // بين 1 و 50 سؤال
        // التحقق من أن الدرس موجود في بنك الأسئلة الخاص بصف الطالب
        let lessonCheckResult;
        try {
            lessonCheckResult = await pool_1.default.query(`SELECT l.id 
         FROM lessons l
         JOIN chapters c ON c.id = l.chapter_id
         JOIN subjects s ON s.id = c.subject_id
         JOIN question_banks qb ON qb.id = s.question_bank_id
         JOIN user_grades ug ON ug.grade_id = qb.grade_id
         WHERE l.id = $1 AND ug.user_id = $2 AND l.is_active = true`, [lessonId, studentId]);
        }
        catch {
            console.log(`Debug - is_active column not found in lesson check, using basic query`);
            // استخدام query بديل بدون is_active
            lessonCheckResult = await pool_1.default.query(`SELECT l.id 
         FROM lessons l
         JOIN chapters c ON c.id = l.chapter_id
         JOIN subjects s ON s.id = c.subject_id
         JOIN question_banks qb ON qb.id = s.question_bank_id
         JOIN user_grades ug ON ug.grade_id = qb.grade_id
         WHERE l.id = $1 AND ug.user_id = $2`, [lessonId, studentId]);
        }
        if (!lessonCheckResult.rowCount) {
            return res.status(404).json({ message: 'Lesson not found or not accessible' });
        }
        // جلب الأسئلة العشوائية من الدرس
        const questionsResult = await pool_1.default.query(`SELECT 
        q.id,
        q.text,
        q.options,
        q.image,
        q.correct_answer,
        q.difficulty_level,
        q.points
       FROM questions q
       WHERE q.lesson_id = $1
       ORDER BY RANDOM()
       LIMIT $2`, [lessonId, questionsCount]);
        res.json({
            success: true,
            data: questionsResult.rows.map((question) => ({
                id: question.id,
                text: question.text,
                options: question.options,
                image: question.image,
                correct_answer: question.correct_answer,
                difficulty_level: question.difficulty_level,
                points: question.points,
            })),
        });
    }
    catch (error) {
        console.error('Error in lesson questions API:', error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
}));
