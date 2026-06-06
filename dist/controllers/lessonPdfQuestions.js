"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
/**
 * API مستقل لاستيراد أسئلة من PDF لدرس في بنك الأسئلة.
 * لا يعدل أي endpoint أو خدمة إضافة أسئلة حالية.
 */
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const lessonPdfQuestions_1 = require("../services/lessonPdfQuestions");
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const dir = path_1.default.join(__dirname, '../../uploads');
        fs_1.default.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const name = `${Date.now()}-${(file.originalname || 'document').replace(/[^a-zA-Z0-9.-]/g, '_')}`;
        cb(null, name);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 25 * 1024 * 1024 },
});
exports.router = (0, express_1.Router)();
/** POST /lessons/:lessonId/import-pdf - رفع PDF واستيراد كل صفحة كسؤال صورة */
exports.router.post('/lessons/:lessonId/import-pdf', (0, authentication_1.authMiddleware)(['teacher', 'admin']), upload.single('pdf'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    if (Number.isNaN(lessonId)) {
        return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const file = req.file;
    if (!file) {
        return res.status(400).json({ success: false, message: 'يجب رفع ملف PDF واحد' });
    }
    if (!(file.originalname || '').toLowerCase().endsWith('.pdf')) {
        if (fs_1.default.existsSync(file.path))
            fs_1.default.unlinkSync(file.path);
        return res.status(400).json({ success: false, message: 'يجب أن يكون الملف بصيغة PDF' });
    }
    const userId = req.user.id;
    const userRole = req.user.role;
    try {
        const result = await lessonPdfQuestions_1.LessonPdfQuestionsService.importPdfForLesson(lessonId, file.path, file.originalname || 'document.pdf', userId, userRole);
        if (fs_1.default.existsSync(file.path)) {
            try {
                fs_1.default.unlinkSync(file.path);
            }
            catch (_) {
                // .
            }
        }
        return res.status(201).json({
            success: true,
            message: `تم استيراد ${result.imported} سؤال من الملف`,
            data: result,
        });
    }
    catch (err) {
        if (file.path && fs_1.default.existsSync(file.path)) {
            try {
                fs_1.default.unlinkSync(file.path);
            }
            catch (_) {
                // .
            }
        }
        if (err.status === 404)
            return res.status(404).json({ success: false, message: err.message });
        if (err.status === 403)
            return res.status(403).json({ success: false, message: err.message });
        if (err.status === 400)
            return res.status(400).json({ success: false, message: err.message });
        throw err;
    }
}));
/** GET /lessons/:lessonId/pdf-questions - جلب أسئلة PDF للدرس (النظام المستقل فقط) */
exports.router.get('/lessons/:lessonId/pdf-questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    if (Number.isNaN(lessonId)) {
        return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const questions = await lessonPdfQuestions_1.LessonPdfQuestionsService.getByLesson(lessonId);
    return res.status(200).json({ success: true, data: questions });
}));
/** PATCH /pdf-questions/:questionId/correct-answer - تحديد الإجابة الصحيحة لسؤال PDF */
exports.router.patch('/pdf-questions/:questionId/correct-answer', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer: correctAnswer } = req.body;
    if (Number.isNaN(questionId)) {
        return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    }
    if (!correctAnswer || typeof correctAnswer !== 'string') {
        return res.status(400).json({ success: false, message: 'correct_answer مطلوب (أ، ب، ج، د)' });
    }
    const userId = req.user.id;
    const userRole = req.user.role;
    try {
        const question = await lessonPdfQuestions_1.LessonPdfQuestionsService.setCorrectAnswer(questionId, correctAnswer.trim(), userId, userRole);
        return res.status(200).json({ success: true, data: question });
    }
    catch (err) {
        if (err.status === 404)
            return res.status(404).json({ success: false, message: err.message });
        if (err.status === 403)
            return res.status(403).json({ success: false, message: err.message });
        if (err.status === 400)
            return res.status(400).json({ success: false, message: err.message });
        throw err;
    }
}));
