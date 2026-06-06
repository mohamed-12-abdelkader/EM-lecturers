"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const lessonMcqQuestions_1 = require("../services/lessonMcqQuestions");
const teacherAccess_1 = require("../services/teacherAccess");
exports.router = (0, express_1.Router)();
// Preferred non-conflicting: POST /lessons/:lessonId/questions/bulk
exports.router.post('/lessons/:lessonId/questions/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const body = req.body;
    try {
        let inserted;
        if (typeof body.questions === 'string') {
            inserted = await lessonMcqQuestions_1.LessonMcqQuestionsService.bulkCreateFromText(lessonId, body.questions);
        }
        else if (Array.isArray(body.questions)) {
            inserted = await lessonMcqQuestions_1.LessonMcqQuestionsService.bulkCreate(lessonId, body.questions);
        }
        else {
            throw new Error('questions must be an array or a formatted string');
        }
        res.status(201).json({ success: true, message: 'Questions created', data: inserted });
    }
    catch (error) {
        const status = error.message === 'lesson not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Also support the requested path: POST /questions/bulk (may conflict in this codebase)
// POST /questions/bulk
exports.router.post('/questions/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { lessonId } = req.body;
    const body = req.body;
    try {
        let inserted;
        if (typeof body.questions === 'string') {
            inserted = await lessonMcqQuestions_1.LessonMcqQuestionsService.bulkCreateFromText(Number(lessonId), body.questions);
        }
        else if (Array.isArray(body.questions)) {
            inserted = await lessonMcqQuestions_1.LessonMcqQuestionsService.bulkCreate(Number(lessonId), body.questions);
        }
        else {
            throw new Error('questions must be an array or a formatted string');
        }
        res.status(201).json({ success: true, message: 'Questions created', data: inserted });
    }
    catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}));
// Preferred non-conflicting: PUT /lesson-questions/:id/answer
exports.router.put('/lesson-questions/:id/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    const { correctAnswer } = req.body;
    try {
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.setCorrectAnswer(id, correctAnswer);
        res.json({ success: true, message: 'Correct answer updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Also support requested path: PUT /questions/:id/answer
// PUT /questions/:id/answer
exports.router.put('/questions/:id/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    const { correctAnswer } = req.body;
    try {
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.setCorrectAnswer(id, correctAnswer);
        res.json({ success: true, message: 'Correct answer updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Preferred non-conflicting: PUT /lesson-questions/:id/image (multipart upload)
exports.router.put('/lesson-questions/:id/image', (0, authentication_1.authMiddleware)(['teacher', 'admin']), utils_1.uploadExamImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    try {
        const file = req.file;
        if (!file)
            return res.status(400).json({ success: false, message: 'image file is required' });
        const uploaded = await (0, utils_1.uploadToCloudinary)(file.path);
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.setImage(id, uploaded.secure_url);
        res.json({ success: true, message: 'Image updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Also support requested path: PUT /questions/:id/image (multipart as well)
exports.router.put('/questions/:id/image', (0, authentication_1.authMiddleware)(['teacher', 'admin']), utils_1.uploadExamImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    try {
        const file = req.file;
        if (!file)
            return res.status(400).json({ success: false, message: 'image file is required' });
        const uploaded = await (0, utils_1.uploadToCloudinary)(file.path);
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.setImage(id, uploaded.secure_url);
        res.json({ success: true, message: 'Image updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// GET /lessons/:lessonId/questions
exports.router.get('/lessons/:lessonId/questions', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    try {
        if (req.user?.role === 'teacher') {
            const subjectId = await (0, teacherAccess_1.getSubjectIdByLessonId)(lessonId);
            if (!subjectId)
                return res.status(404).json({ success: false, message: 'الدرس غير موجود' });
            const allowed = await (0, teacherAccess_1.teacherHasSubjectAccess)(req.user.id, subjectId);
            if (!allowed)
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
        }
        const rows = await lessonMcqQuestions_1.LessonMcqQuestionsService.getByLesson(lessonId);
        res.json({ success: true, data: rows });
    }
    catch (error) {
        const status = error.message.includes('lessonId') ? 400 : 500;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Preferred non-conflicting: PUT /lesson-questions/:id
exports.router.put('/lesson-questions/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    const { text, options } = req.body;
    try {
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.updateQuestion(id, { text, options });
        res.json({ success: true, message: 'Question updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Also support requested path: PUT /questions/:id
// PUT /questions/:id
exports.router.put('/questions/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    const { text, options } = req.body;
    try {
        const updated = await lessonMcqQuestions_1.LessonMcqQuestionsService.updateQuestion(id, { text, options });
        res.json({ success: true, message: 'Question updated', data: updated });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Preferred non-conflicting: DELETE /lesson-questions/:id
exports.router.delete('/lesson-questions/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    try {
        await lessonMcqQuestions_1.LessonMcqQuestionsService.delete(id);
        res.json({ success: true, message: 'Question deleted' });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
// Also support requested path: DELETE /questions/:id
// DELETE /questions/:id
exports.router.delete('/questions/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = Number(req.params.id);
    try {
        await lessonMcqQuestions_1.LessonMcqQuestionsService.delete(id);
        res.json({ success: true, message: 'Question deleted' });
    }
    catch (error) {
        const status = error.message === 'question not found' ? 404 : 400;
        res.status(status).json({ success: false, message: error.message });
    }
}));
exports.default = exports.router;
