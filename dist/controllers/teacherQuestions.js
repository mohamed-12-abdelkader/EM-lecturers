"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const teacherActivityLog_1 = require("../services/teacherActivityLog");
exports.router = (0, express_1.Router)();
function parseNullableNumber(value, fieldName) {
    if (value === undefined || value === null || value === '')
        return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n <= 0) {
        throw new utils_1.HttpError(400, `${fieldName} غير صحيح`);
    }
    return n;
}
async function verifyLessonOwnership(lessonId, teacherId) {
    const result = await pool_1.default.query(`SELECT id FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2`, [lessonId, teacherId]);
    return Boolean(result.rowCount);
}
async function verifyPassageOwnership(passageId, teacherId) {
    const result = await pool_1.default.query(`SELECT p.id, p.lesson_id
     FROM teacher_question_passages p
     JOIN teacher_question_lessons l ON l.id = p.lesson_id
     WHERE p.id = $1 AND l.teacher_id = $2`, [passageId, teacherId]);
    return result.rows[0] ?? null;
}
// ========== الدروس (Lessons) — مباشرة داخل مكتبة المدرّس ==========
exports.router.post('/lesson', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    if (!title?.trim())
        throw new utils_1.HttpError(400, 'العنوان مطلوب');
    const result = await pool_1.default.query('INSERT INTO teacher_question_lessons (teacher_id, title) VALUES ($1, $2) RETURNING *', [teacher_id, title.trim()]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'add_lesson',
        entity_type: 'lesson',
        entity_id: result.rows[0].id,
        description: `أضاف درس: ${title}`,
    });
    res.status(201).json({ lesson: result.rows[0] });
}));
exports.router.put('/lesson/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    const lessonIdNum = Number(req.params.id);
    if (!title?.trim())
        throw new utils_1.HttpError(400, 'العنوان مطلوب');
    const result = await pool_1.default.query('UPDATE teacher_question_lessons SET title = $1 WHERE id = $2 AND teacher_id = $3 RETURNING *', [title.trim(), lessonIdNum, teacher_id]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_lesson',
        entity_type: 'lesson',
        entity_id: lessonIdNum,
        description: `تعديل درس: ${title}`,
    });
    res.json({ lesson: result.rows[0] });
}));
exports.router.delete('/lesson/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lessonIdNum = Number(req.params.id);
    const result = await pool_1.default.query('DELETE FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2 RETURNING id', [lessonIdNum, teacher_id]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_lesson',
        entity_type: 'lesson',
        entity_id: lessonIdNum,
        description: `حذف درس: ${lessonIdNum}`,
    });
    res.json({ success: true });
}));
exports.router.get('/lessons', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const result = await pool_1.default.query(`SELECT l.*,
              COUNT(q.id)::int AS questions_count
       FROM teacher_question_lessons l
       LEFT JOIN teacher_questions q ON q.lesson_id = l.id
       WHERE l.teacher_id = $1
       GROUP BY l.id
       ORDER BY l.id`, [teacher_id]);
    res.json({ lessons: result.rows });
}));
// ========== القطع (Passages) — مرتبطة بالدرس ==========
exports.router.post('/passage', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lessonIdNum = parseNullableNumber(req.body.lesson_id, 'lesson_id');
    const { title, content, questions = [] } = req.body;
    if (!content || !String(content).trim())
        throw new utils_1.HttpError(400, 'نص القطعة مطلوب');
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    }
    const client = await pool_1.default.connect();
    try {
        await client.query('BEGIN');
        const passageResult = await client.query(`INSERT INTO teacher_question_passages (lesson_id, title, content, order_index)
         VALUES ($1, $2, $3, 0)
         RETURNING *`, [lessonIdNum, title || null, content]);
        const passage = passageResult.rows[0];
        const createdQuestions = [];
        for (const q of Array.isArray(questions) ? questions : []) {
            const result = await client.query(`INSERT INTO teacher_questions (
             lesson_id, passage_id, question_text, question_type, choices, answer, image_url,
             correct_answer_index, explanation, difficulty_level, points
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`, [
                lessonIdNum,
                passage.id,
                q.question_text,
                q.question_type || (Array.isArray(q.choices) ? 'choice' : 'text'),
                q.choices ? JSON.stringify(q.choices) : null,
                q.answer || null,
                q.image_url || null,
                q.correct_answer_index ?? null,
                q.explanation || null,
                q.difficulty_level || 'medium',
                q.points || 1,
            ]);
            createdQuestions.push(result.rows[0]);
        }
        await client.query('COMMIT');
        res.status(201).json({ success: true, passage, questions: createdQuestions });
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}));
exports.router.get('/passages/:lesson_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lessonIdNum = Number(req.params.lesson_id);
    if (!Number.isInteger(lessonIdNum) || lessonIdNum <= 0) {
        throw new utils_1.HttpError(400, 'lesson_id غير صحيح');
    }
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    }
    const passages = (await pool_1.default.query('SELECT * FROM teacher_question_passages WHERE lesson_id = $1 ORDER BY order_index, id', [lessonIdNum])).rows;
    const passageIds = passages.map((p) => p.id);
    const questions = passageIds.length
        ? (await pool_1.default.query('SELECT * FROM teacher_questions WHERE passage_id = ANY($1::int[]) ORDER BY id', [passageIds])).rows
        : [];
    res.json({
        passages: passages.map((passage) => ({
            ...passage,
            questions: questions.filter((q) => q.passage_id === passage.id),
        })),
    });
}));
exports.router.get('/passage/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const passageId = Number(req.params.id);
    if (!Number.isInteger(passageId) || passageId <= 0)
        throw new utils_1.HttpError(400, 'id غير صحيح');
    const owned = await verifyPassageOwnership(passageId, teacher_id);
    if (!owned)
        throw new utils_1.HttpError(404, 'القطعة غير موجودة');
    const passage = (await pool_1.default.query('SELECT * FROM teacher_question_passages WHERE id = $1', [passageId])).rows[0];
    const questions = (await pool_1.default.query('SELECT * FROM teacher_questions WHERE passage_id = $1 ORDER BY id', [
        passageId,
    ])).rows;
    res.json({ passage: { ...passage, questions } });
}));
// ========== الأسئلة (Questions) — مباشرة داخل الدرس ==========
exports.router.post('/question', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { lesson_id, question_text, question_type, choices, answer, image_url, correct_answer_index, explanation, difficulty_level, points, } = req.body;
    const teacher_id = req.user.id;
    const lessonIdNum = Number(lesson_id);
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    }
    if (passageId != null) {
        const passage = await verifyPassageOwnership(passageId, teacher_id);
        if (!passage || passage.lesson_id !== lessonIdNum) {
            throw new utils_1.HttpError(404, 'القطعة غير موجودة داخل هذا الدرس');
        }
    }
    const result = await pool_1.default.query(`INSERT INTO teacher_questions (
         lesson_id, passage_id, question_text, question_type, choices, answer, image_url,
         correct_answer_index, explanation, difficulty_level, points
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`, [
        lessonIdNum,
        passageId,
        question_text,
        question_type,
        choices ? JSON.stringify(choices) : null,
        answer,
        image_url || null,
        correct_answer_index ?? null,
        explanation || null,
        difficulty_level || 'medium',
        points || 1,
    ]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'add_question',
        entity_type: 'question',
        entity_id: result.rows[0].id,
        description: `أضاف سؤال: ${question_text}`,
    });
    res.status(201).json({ question: result.rows[0] });
}));
exports.router.put('/question/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { question_text, question_type, choices, answer, image_url, correct_answer_index, explanation, difficulty_level, points, } = req.body;
    const teacher_id = req.user.id;
    const questionIdNum = Number(req.params.id);
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');
    const check = await pool_1.default.query(`SELECT q.id, q.lesson_id
       FROM teacher_questions q
       JOIN teacher_question_lessons l ON q.lesson_id = l.id
       WHERE q.id = $1 AND l.teacher_id = $2`, [questionIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'السؤال غير موجود');
    if (passageId != null) {
        const passage = await verifyPassageOwnership(passageId, teacher_id);
        if (!passage || passage.lesson_id !== Number(check.rows[0].lesson_id)) {
            throw new utils_1.HttpError(404, 'القطعة غير موجودة داخل هذا الدرس');
        }
    }
    const result = await pool_1.default.query(`UPDATE teacher_questions
       SET question_text = $1,
           question_type = $2,
           choices = $3,
           answer = $4,
           passage_id = $5,
           image_url = $6,
           correct_answer_index = $7,
           explanation = $8,
           difficulty_level = $9,
           points = $10
       WHERE id = $11
       RETURNING *`, [
        question_text,
        question_type,
        choices ? JSON.stringify(choices) : null,
        answer,
        passageId,
        image_url || null,
        correct_answer_index ?? null,
        explanation || null,
        difficulty_level || 'medium',
        points || 1,
        questionIdNum,
    ]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_question',
        entity_type: 'question',
        entity_id: questionIdNum,
        description: `تعديل سؤال: ${question_text}`,
    });
    res.json({ question: result.rows[0] });
}));
exports.router.delete('/question/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const questionIdNum = Number(req.params.id);
    const check = await pool_1.default.query(`SELECT q.id
       FROM teacher_questions q
       JOIN teacher_question_lessons l ON q.lesson_id = l.id
       WHERE q.id = $1 AND l.teacher_id = $2`, [questionIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'السؤال غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_question',
        entity_type: 'question',
        entity_id: questionIdNum,
        description: `حذف سؤال: ${questionIdNum}`,
    });
    await pool_1.default.query('DELETE FROM teacher_questions WHERE id = $1', [questionIdNum]);
    res.json({ success: true });
}));
exports.router.get('/questions/:lesson_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lessonIdNum = Number(req.params.lesson_id);
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    }
    const result = await pool_1.default.query('SELECT * FROM teacher_questions WHERE lesson_id = $1 ORDER BY id', [lessonIdNum]);
    res.json({ questions: result.rows });
}));
exports.router.post('/bulk', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { lesson_id, bulk_text } = req.body;
    const teacher_id = req.user.id;
    const lessonIdNum = Number(lesson_id);
    if (!lessonIdNum || !bulk_text)
        throw new utils_1.HttpError(400, 'lesson_id و bulk_text مطلوبان');
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    }
    const questionBlocks = bulk_text
        .split(/\n\s*\n/)
        .map((b) => b.trim())
        .filter(Boolean);
    const questions = [];
    const invalidBlocks = [];
    questionBlocks.forEach((block, idx) => {
        const lines = block
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        if (lines.length < 5) {
            invalidBlocks.push(idx + 1);
            return;
        }
        const question_text = lines[0];
        const choices = [];
        for (let i = 1; i < lines.length && choices.length < 4; i++) {
            const match = lines[i].match(/^[A-D][).:,-]?\s*(.+)$/i);
            if (match) {
                choices.push(match[1].trim());
            }
            else {
                choices.push(lines[i]);
            }
        }
        if (question_text && choices.length === 4) {
            questions.push({ question_text, choices });
        }
        else {
            invalidBlocks.push(idx + 1);
        }
    });
    if (invalidBlocks.length > 0) {
        return res.status(400).json({
            success: false,
            message: `هناك مشكلة في الأسئلة التالية: ${invalidBlocks.join(', ')}. تأكد أن كل سؤال يحتوي على نص وأربع اختيارات.`,
        });
    }
    let inserted = 0;
    for (const q of questions) {
        await pool_1.default.query('INSERT INTO teacher_questions (lesson_id, question_text, question_type, choices) VALUES ($1, $2, $3, $4)', [lessonIdNum, q.question_text, 'choice', JSON.stringify(q.choices)]);
        inserted++;
    }
    res.status(201).json({ success: true, inserted });
}));
exports.router.get('/public/questions/:lesson_id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonIdNum = Number(req.params.lesson_id);
    const result = await pool_1.default.query('SELECT * FROM teacher_questions WHERE lesson_id = $1 ORDER BY id', [lessonIdNum]);
    const questions = result.rows.map((q) => ({
        ...q,
        choices: typeof q.choices === 'string'
            ? (() => {
                try {
                    return JSON.parse(q.choices);
                }
                catch {
                    return q.choices;
                }
            })()
            : q.choices,
    }));
    res.json({ questions });
}));
exports.router.get('/tree', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const lessons = (await pool_1.default.query('SELECT * FROM teacher_question_lessons WHERE teacher_id = $1 ORDER BY id', [teacher_id])).rows;
    const lessonIds = lessons.map((l) => l.id);
    const questions = lessonIds.length
        ? (await pool_1.default.query('SELECT * FROM teacher_questions WHERE lesson_id = ANY($1::int[]) ORDER BY id', [lessonIds])).rows
        : [];
    const passages = lessonIds.length
        ? (await pool_1.default.query('SELECT * FROM teacher_question_passages WHERE lesson_id = ANY($1::int[]) ORDER BY order_index, id', [lessonIds])).rows
        : [];
    const lessonsMap = Object.fromEntries(lessons.map((l) => [l.id, { ...l, questions: [], passages: [] }]));
    for (const q of questions) {
        lessonsMap[q.lesson_id]?.questions.push(q);
    }
    for (const p of passages) {
        const lesson = lessonsMap[p.lesson_id];
        if (lesson) {
            lesson.passages.push({
                ...p,
                questions: questions.filter((q) => q.passage_id === p.id),
            });
        }
    }
    res.json({ lessons: Object.values(lessonsMap) });
}));
