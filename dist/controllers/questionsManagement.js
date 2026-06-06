"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const permissions_1 = require("../middleware/permissions");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const questionsManagement_1 = require("../services/questionsManagement");
const pool_1 = __importDefault(require("../db/pool"));
exports.router = (0, express_1.Router)();
// إضافة أسئلة دفعة واحدة
exports.router.post('/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { bulk_text } = req.body;
    if (!bulk_text || typeof bulk_text !== 'string') {
        return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.createBulkQuestions(bulk_text);
        res.status(201).json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// إضافة أسئلة دفعة واحدة لامتحان محاضرة معينة
exports.router.post('/lecture-exam/:examId/bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const { bulk_text } = req.body;
    if (isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam ID' });
    }
    if (!bulk_text || typeof bulk_text !== 'string') {
        return res.status(400).json({ message: 'bulk_text is required and must be a string' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.createBulkQuestionsForLectureExam(examId, bulk_text);
        res.status(201).json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// جلب أسئلة امتحان محاضرة معين
exports.router.get('/lecture-exam/:examId/questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam ID' });
    }
    try {
        // جلب بيانات الامتحان أولاً
        let duration = null;
        try {
            const examRes = await pool_1.default.query("SELECT duration FROM exams WHERE id = $1 AND type = 'exam'", [examId]);
            if (!examRes.rowCount) {
                console.error('امتحان المحاضرة غير موجود أو النوع غير صحيح examId=', examId);
                return res.status(404).json({ message: 'امتحان المحاضرة غير موجود' });
            }
            duration = examRes.rows[0].duration ?? null;
        }
        catch (err) {
            console.error('خطأ أثناء جلب مدة الامتحان:', err);
            duration = null;
        }
        const questions = await questionsManagement_1.QuestionsManagementService.getLectureExamQuestions(examId);
        res.json({ questions, duration });
    }
    catch (error) {
        res.status(500).json({ message: error.message });
    }
}));
// جلب جميع الأسئلة
exports.router.get('/', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questions = await questionsManagement_1.QuestionsManagementService.getAllQuestions();
    res.json(questions);
}));
// جلب سؤال واحد
exports.router.get('/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.id);
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    try {
        const question = await questionsManagement_1.QuestionsManagementService.getQuestionById(questionId);
        res.json(question);
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
}));
// تحديث الإجابة الصحيحة لسؤال
exports.router.patch('/:id/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.id);
    const { correctOption } = req.body;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    if (!correctOption || typeof correctOption !== 'string') {
        return res.status(400).json({ message: 'correctOption is required and must be a string' });
    }
    try {
        const question = await questionsManagement_1.QuestionsManagementService.updateCorrectAnswer(questionId, correctOption);
        res.json(question);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// حذف سؤال
exports.router.delete('/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.id);
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.deleteQuestion(questionId);
        res.json(result);
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
}));
// تحديث سؤال كامل
exports.router.put('/:id', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.id);
    const { questionText, options } = req.body;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    if (!questionText || typeof questionText !== 'string') {
        return res.status(400).json({ message: 'questionText is required and must be a string' });
    }
    if (!options || typeof options !== 'object') {
        return res.status(400).json({ message: 'options is required and must be an object' });
    }
    try {
        const question = await questionsManagement_1.QuestionsManagementService.updateQuestion(questionId, questionText, options);
        res.json(question);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// تعديل نص السؤال أو درجته أو صورته
exports.router.patch('/lecture-exam-question/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { question_text, grade } = req.body;
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    let imageUrl = undefined;
    // إذا تم رفع صورة، ارفعها على Cloudinary
    if (req.file) {
        try {
            const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
            imageUrl = uploaded.secure_url;
        }
        catch (uploadError) {
            console.error('Error uploading image to Cloudinary:', uploadError);
            return res.status(500).json({ message: 'فشل في رفع الصورة' });
        }
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.updateLectureExamQuestion(questionId, question_text, grade, imageUrl);
        res.json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// تحديد الإجابة الصحيحة
exports.router.patch('/lecture-exam-question/:questionId/answer', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const { correct_answer } = req.body;
    if (isNaN(questionId) || isNaN(correct_answer)) {
        return res.status(400).json({ message: 'Invalid question ID or choice ID' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.setLectureExamQuestionCorrectAnswer(questionId, correct_answer);
        res.json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// حذف سؤال
exports.router.delete('/lecture-exam-question/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question ID' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.deleteLectureExamQuestion(questionId);
        res.json(result);
    }
    catch (error) {
        res.status(404).json({ message: error.message });
    }
}));
// حل امتحان المحاضرة
exports.router.post('/lecture-exam/:examId/submit', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const { answers } = req.body; // answers: [{ questionId, choiceId }]
    const user = req.user;
    if (isNaN(examId) || !Array.isArray(answers)) {
        return res.status(400).json({ message: 'بيانات غير صحيحة' });
    }
    try {
        const result = await questionsManagement_1.QuestionsManagementService.submitLectureExam(examId, user.id, answers);
        res.json(result);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// إضافة سؤال جديد في امتحان المحاضرة مع إمكانية إضافة صورة
exports.router.post('/lecture-exam/:examId/question', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.single('image'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    const { question_text, grade } = req.body;
    if (isNaN(examId)) {
        return res.status(400).json({ message: 'معرف الامتحان غير صحيح' });
    }
    // يجب إرسال نص السؤال أو صورة على الأقل
    if (!question_text && !req.file) {
        return res.status(400).json({ message: 'يجب إرسال نص السؤال أو صورة على الأقل' });
    }
    try {
        const question = await questionsManagement_1.QuestionsManagementService.addQuestionToLectureExam(examId, question_text || null, req.file || null, grade ? Number(grade) : 1);
        res.status(201).json({
            success: true,
            message: 'تم إضافة السؤال بنجاح',
            question,
        });
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// إضافة أسئلة بالصور لامتحان المحاضرة
exports.router.post('/lecture-exam-question/', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), utils_1.uploadExamImage.array('images', 10), // يسمح برفع حتى 10 صور
(0, utils_1.asyncWrapper)(async (req, res) => {
    const files = req.files;
    const { exam_id } = req.body;
    if (!files || files.length === 0) {
        return res.status(400).json({ message: 'يجب رفع صورة واحدة على الأقل' });
    }
    if (files.length > 10) {
        return res.status(400).json({ message: 'يمكن رفع 10 صور كحد أقصى' });
    }
    if (exam_id && isNaN(Number(exam_id))) {
        return res.status(400).json({ message: 'exam_id يجب أن يكون رقم صحيح' });
    }
    try {
        const questions = await questionsManagement_1.QuestionsManagementService.createImageQuestions(files, exam_id ? Number(exam_id) : undefined);
        res.status(201).json(questions);
    }
    catch (error) {
        res.status(400).json({ message: error.message });
    }
}));
// جلب تفاصيل امتحان محاضرة (بيانات الامتحان + الأسئلة)
exports.router.get('/lecture-exam/:examId/details', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const examId = Number(req.params.examId);
    if (isNaN(examId)) {
        return res.status(400).json({ message: 'Invalid exam ID' });
    }
    // جلب بيانات الامتحان
    const examRes = await pool_1.default.query("SELECT * FROM exams WHERE id = $1 AND type = 'exam'", [
        examId,
    ]);
    if (!examRes.rowCount) {
        return res.status(404).json({ message: 'امتحان المحاضرة غير موجود' });
    }
    const exam = examRes.rows[0];
    // جلب الأسئلة
    let questions = [];
    try {
        questions = await questionsManagement_1.QuestionsManagementService.getLectureExamQuestions(examId);
    }
    catch (_err) {
        questions = [];
    }
    res.json({
        exam: {
            id: exam.id,
            title: exam.title,
            duration: exam.duration ?? null,
            total_grade: exam.total_grade ?? null,
            created_at: exam.created_at,
            lecture_id: exam.lecture_id,
            // أضف أي حقول أخرى تحتاجها
        },
        questions,
    });
}));
