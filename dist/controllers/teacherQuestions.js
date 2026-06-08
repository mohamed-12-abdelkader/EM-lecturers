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
async function verifyPartOwnership(partId, teacherId) {
    const result = await pool_1.default.query(`SELECT p.id
     FROM teacher_question_parts p
     JOIN teacher_question_lessons l ON p.lesson_id = l.id
     JOIN teacher_question_chapters c ON l.chapter_id = c.id
     WHERE p.id = $1 AND c.teacher_id = $2`, [partId, teacherId]);
    return Boolean(result.rowCount);
}
async function verifyPassageOwnership(passageId, teacherId) {
    const result = await pool_1.default.query(`SELECT p.id, p.part_id
     FROM teacher_question_passages p
     JOIN teacher_question_parts part ON part.id = p.part_id
     JOIN teacher_question_lessons l ON part.lesson_id = l.id
     JOIN teacher_question_chapters c ON l.chapter_id = c.id
     WHERE p.id = $1 AND c.teacher_id = $2`, [passageId, teacherId]);
    return result.rows[0] ?? null;
}
// ========== الفصول (Chapters) ==========
// إضافة فصل جديد
exports.router.post('/chapter', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    if (!title)
        throw new utils_1.HttpError(400, 'العنوان مطلوب');
    const result = await pool_1.default.query('INSERT INTO teacher_question_chapters (teacher_id, title) VALUES ($1, $2) RETURNING *', [teacher_id, title]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'add_chapter',
        entity_type: 'chapter',
        entity_id: result.rows[0].id,
        description: `أضاف فصل: ${title}`,
    });
    res.status(201).json({ chapter: result.rows[0] });
}));
// تعديل فصل
exports.router.put('/chapter/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    const { id } = req.params;
    const chapterIdNum = Number(id);
    const result = await pool_1.default.query('UPDATE teacher_question_chapters SET title = $1 WHERE id = $2 AND teacher_id = $3 RETURNING *', [title, chapterIdNum, teacher_id]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'الفصل غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_chapter',
        entity_type: 'chapter',
        entity_id: chapterIdNum,
        description: `تعديل فصل: ${title}`,
    });
    res.json({ chapter: result.rows[0] });
}));
// حذف فصل
exports.router.delete('/chapter/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { id } = req.params;
    const chapterIdNum = Number(id);
    const result = await pool_1.default.query('DELETE FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2 RETURNING id', [chapterIdNum, teacher_id]);
    if (!result.rowCount)
        throw new utils_1.HttpError(404, 'الفصل غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_chapter',
        entity_type: 'chapter',
        entity_id: chapterIdNum,
        description: `حذف فصل: ${id}`,
    });
    res.json({ success: true });
}));
// جلب كل الفصول للمدرس
exports.router.get('/chapters', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const result = await pool_1.default.query('SELECT * FROM teacher_question_chapters WHERE teacher_id = $1 ORDER BY id', [teacher_id]);
    res.json({ chapters: result.rows });
}));
// ========== الدروس (Lessons) ==========
// إضافة درس
exports.router.post('/lesson', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { chapter_id, title } = req.body;
    const teacher_id = req.user.id;
    const chapterIdNum = Number(chapter_id);
    // تحقق أن الفصل يخص المدرس
    const check = await pool_1.default.query('SELECT id FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2', [chapterIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الفصل غير موجود');
    const result = await pool_1.default.query('INSERT INTO teacher_question_lessons (chapter_id, title) VALUES ($1, $2) RETURNING *', [chapterIdNum, title]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'add_lesson',
        entity_type: 'lesson',
        entity_id: result.rows[0].id,
        description: `أضاف درس: ${title}`,
    });
    res.status(201).json({ lesson: result.rows[0] });
}));
// تعديل درس
exports.router.put('/lesson/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    const { id } = req.params;
    // تحقق أن الدرس يخص المدرس
    const check = await pool_1.default.query('SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2', [id, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    const result = await pool_1.default.query('UPDATE teacher_question_lessons SET title = $1 WHERE id = $2 RETURNING *', [title, id]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_lesson',
        entity_type: 'lesson',
        entity_id: id,
        description: `تعديل درس: ${title}`,
    });
    res.json({ lesson: result.rows[0] });
}));
// حذف درس
exports.router.delete('/lesson/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { id } = req.params;
    const lessonIdNum = Number(id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool_1.default.query('SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2', [lessonIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_lesson',
        entity_type: 'lesson',
        entity_id: lessonIdNum,
        description: `حذف درس: ${id}`,
    });
    await pool_1.default.query('DELETE FROM teacher_question_lessons WHERE id = $1', [lessonIdNum]);
    res.json({ success: true });
}));
// جلب الدروس لفصل معين
exports.router.get('/lessons/:chapter_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { chapter_id } = req.params;
    const chapterIdNum = Number(chapter_id);
    // تحقق أن الفصل يخص المدرس
    const check = await pool_1.default.query('SELECT id FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2', [chapterIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الفصل غير موجود');
    const result = await pool_1.default.query('SELECT * FROM teacher_question_lessons WHERE chapter_id = $1 ORDER BY id', [chapterIdNum]);
    res.json({ lessons: result.rows });
}));
// ========== الأجزاء (Parts) ==========
// إضافة جزء
exports.router.post('/part', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { lesson_id, title } = req.body;
    const teacher_id = req.user.id;
    const lessonIdNum = Number(lesson_id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool_1.default.query('SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2', [lessonIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    const result = await pool_1.default.query('INSERT INTO teacher_question_parts (lesson_id, title) VALUES ($1, $2) RETURNING *', [lessonIdNum, title]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'add_part',
        entity_type: 'part',
        entity_id: result.rows[0].id,
        description: `أضاف جزء: ${title}`,
    });
    res.status(201).json({ part: result.rows[0] });
}));
// تعديل جزء
exports.router.put('/part/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user.id;
    const { id } = req.params;
    const partIdNum = Number(id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool_1.default.query('SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2', [partIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    const result = await pool_1.default.query('UPDATE teacher_question_parts SET title = $1 WHERE id = $2 RETURNING *', [title, partIdNum]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_part',
        entity_type: 'part',
        entity_id: partIdNum,
        description: `تعديل جزء: ${title}`,
    });
    res.json({ part: result.rows[0] });
}));
// حذف جزء
exports.router.delete('/part/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { id } = req.params;
    const partIdNum = Number(id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool_1.default.query('SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2', [partIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_part',
        entity_type: 'part',
        entity_id: partIdNum,
        description: `حذف جزء: ${id}`,
    });
    await pool_1.default.query('DELETE FROM teacher_question_parts WHERE id = $1', [partIdNum]);
    res.json({ success: true });
}));
// جلب الأجزاء لدرس معين
exports.router.get('/parts/:lesson_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { lesson_id } = req.params;
    const lessonIdNum = Number(lesson_id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool_1.default.query('SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2', [lessonIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الدرس غير موجود');
    const result = await pool_1.default.query('SELECT * FROM teacher_question_parts WHERE lesson_id = $1 ORDER BY id', [lessonIdNum]);
    res.json({ parts: result.rows });
}));
// ========== القطع (Passages) ==========
exports.router.post('/passage', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const partIdNum = parseNullableNumber(req.body.part_id, 'part_id');
    const { title, content, questions = [] } = req.body;
    if (!content || !String(content).trim())
        throw new utils_1.HttpError(400, 'نص القطعة مطلوب');
    if (!(await verifyPartOwnership(partIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    }
    const client = await pool_1.default.connect();
    try {
        await client.query('BEGIN');
        const passageResult = await client.query(`INSERT INTO teacher_question_passages (part_id, title, content, order_index)
         VALUES ($1, $2, $3, 0)
         RETURNING *`, [partIdNum, title || null, content]);
        const passage = passageResult.rows[0];
        const createdQuestions = [];
        for (const q of Array.isArray(questions) ? questions : []) {
            const result = await client.query(`INSERT INTO teacher_questions (
             part_id, passage_id, question_text, question_type, choices, answer, image_url,
             correct_answer_index, explanation, difficulty_level, points
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`, [
                partIdNum,
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
exports.router.get('/passages/:part_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const partIdNum = Number(req.params.part_id);
    if (!Number.isInteger(partIdNum) || partIdNum <= 0) {
        throw new utils_1.HttpError(400, 'part_id غير صحيح');
    }
    if (!(await verifyPartOwnership(partIdNum, teacher_id))) {
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    }
    const passages = (await pool_1.default.query('SELECT * FROM teacher_question_passages WHERE part_id = $1 ORDER BY order_index, id', [partIdNum])).rows;
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
// ========== الأسئلة (Questions) ==========
// إضافة سؤال
exports.router.post('/question', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { part_id, question_text, question_type, choices, answer, image_url, correct_answer_index, explanation, difficulty_level, points, } = req.body;
    const teacher_id = req.user.id;
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');
    // تحقق أن الجزء يخص المدرس
    const check = await pool_1.default.query('SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2', [part_id, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    if (passageId != null) {
        const passage = await verifyPassageOwnership(passageId, teacher_id);
        if (!passage || passage.part_id !== Number(part_id)) {
            throw new utils_1.HttpError(404, 'القطعة غير موجودة داخل هذا الجزء');
        }
    }
    const result = await pool_1.default.query(`INSERT INTO teacher_questions (
         part_id, passage_id, question_text, question_type, choices, answer, image_url,
         correct_answer_index, explanation, difficulty_level, points
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`, [
        part_id,
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
// تعديل سؤال
exports.router.put('/question/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { question_text, question_type, choices, answer, image_url, correct_answer_index, explanation, difficulty_level, points, } = req.body;
    const teacher_id = req.user.id;
    const { id } = req.params;
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');
    // تحقق أن السؤال يخص المدرس
    const check = await pool_1.default.query('SELECT q.id, q.part_id FROM teacher_questions q JOIN teacher_question_parts p ON q.part_id = p.id JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE q.id = $1 AND c.teacher_id = $2', [id, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'السؤال غير موجود');
    if (passageId != null) {
        const passage = await verifyPassageOwnership(passageId, teacher_id);
        if (!passage || passage.part_id !== Number(check.rows[0].part_id)) {
            throw new utils_1.HttpError(404, 'القطعة غير موجودة داخل هذا الجزء');
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
        id,
    ]);
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_question',
        entity_type: 'question',
        entity_id: id,
        description: `تعديل سؤال: ${question_text}`,
    });
    res.json({ question: result.rows[0] });
}));
// حذف سؤال
exports.router.delete('/question/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { id } = req.params;
    const questionIdNum = Number(id);
    // تحقق أن السؤال يخص المدرس
    const check = await pool_1.default.query('SELECT q.id FROM teacher_questions q JOIN teacher_question_parts p ON q.part_id = p.id JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE q.id = $1 AND c.teacher_id = $2', [questionIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'السؤال غير موجود');
    await teacherActivityLog_1.TeacherActivityLogService.log({
        teacher_id,
        action: 'delete_question',
        entity_type: 'question',
        entity_id: questionIdNum,
        description: `حذف سؤال: ${id}`,
    });
    await pool_1.default.query('DELETE FROM teacher_questions WHERE id = $1', [questionIdNum]);
    res.json({ success: true });
}));
// جلب الأسئلة لجزء معين
exports.router.get('/questions/:part_id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    const { part_id } = req.params;
    const partIdNum = Number(part_id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool_1.default.query('SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2', [partIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    const result = await pool_1.default.query('SELECT * FROM teacher_questions WHERE part_id = $1 ORDER BY id', [partIdNum]);
    res.json({ questions: result.rows });
}));
// ========== إضافة أسئلة دفعة واحدة (Bulk Insert) ==========
exports.router.post('/bulk', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { part_id, bulk_text } = req.body;
    const teacher_id = req.user.id;
    const partIdNum = Number(part_id);
    if (!partIdNum || !bulk_text)
        throw new utils_1.HttpError(400, 'part_id و bulk_text مطلوبان');
    // تحقق أن الجزء يخص المدرس
    const check = await pool_1.default.query('SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2', [partIdNum, teacher_id]);
    if (!check.rowCount)
        throw new utils_1.HttpError(404, 'الجزء غير موجود');
    // منطق تقسيم مرن لقبول جميع الصيغ
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
            // يقبل أي بادئة A/B/C/D مع أي فاصل أو حتى بدون فاصل
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
    // إدخال الأسئلة في قاعدة البيانات
    let inserted = 0;
    for (const q of questions) {
        await pool_1.default.query('INSERT INTO teacher_questions (part_id, question_text, question_type, choices) VALUES ($1, $2, $3, $4)', [partIdNum, q.question_text, 'choice', JSON.stringify(q.choices)]);
        inserted++;
    }
    res.status(201).json({ success: true, inserted });
}));
// ========== عرض الأسئلة لأي مستخدم (بدون تحقق ملكية المدرس) ==========
exports.router.get('/public/questions/:part_id', (0, utils_1.asyncWrapper)(async (req, res) => {
    const { part_id } = req.params;
    // جلب الأسئلة لهذا الجزء
    const result = await pool_1.default.query('SELECT * FROM teacher_questions WHERE part_id = $1 ORDER BY id', [part_id]);
    // إذا كانت choices نصية (string) وليست Array، حاول تحويلها
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
// ========== جلب الشجرة الكاملة للمدرس ==========
exports.router.get('/tree', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacher_id = req.user.id;
    // جلب الفصول
    const chapters = (await pool_1.default.query('SELECT * FROM teacher_question_chapters WHERE teacher_id = $1 ORDER BY id', [teacher_id])).rows;
    // جلب الدروس
    const lessons = (await pool_1.default.query('SELECT * FROM teacher_question_lessons WHERE chapter_id = ANY($1::int[]) ORDER BY id', [chapters.map((c) => c.id)])).rows;
    // جلب الأجزاء
    const parts = (await pool_1.default.query('SELECT * FROM teacher_question_parts WHERE lesson_id = ANY($1::int[]) ORDER BY id', [lessons.map((l) => l.id)])).rows;
    // جلب الأسئلة
    const questions = (await pool_1.default.query('SELECT * FROM teacher_questions WHERE part_id = ANY($1::int[]) ORDER BY id', [parts.map((p) => p.id)])).rows;
    // بناء الشجرة
    const partsMap = Object.fromEntries(parts.map((p) => [p.id, { ...p, questions: [] }]));
    for (const q of questions)
        partsMap[q.part_id]?.questions.push(q);
    const lessonsMap = Object.fromEntries(lessons.map((l) => [l.id, { ...l, parts: [] }]));
    for (const p of parts)
        lessonsMap[p.lesson_id]?.parts.push(partsMap[p.id]);
    const chaptersMap = Object.fromEntries(chapters.map((c) => [c.id, { ...c, lessons: [] }]));
    for (const l of lessons)
        chaptersMap[l.chapter_id]?.lessons.push(lessonsMap[l.id]);
    res.json({ chapters: Object.values(chaptersMap) });
}));
