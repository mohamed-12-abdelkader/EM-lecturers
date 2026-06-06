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
const courseLevelExamQuestions_1 = require("../services/courseLevelExamQuestions");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
exports.router = (0, express_1.Router)();
// Configure multer for image uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'exam-question-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('Only image files are allowed'));
        }
    },
});
// Note: Routes for creating questions (POST /api/exams/:examId/questions) are in exams.ts
// This router only handles question management (update, delete, set correct answer, get single question)
/**
 * PUT /api/questions/:questionId
 * Update a question
 */
exports.router.put('/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('questionImage'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question id' });
    }
    const { questionText, optionA, optionB, optionC, optionD } = req.body;
    const updateData = {};
    if (questionText !== undefined) {
        updateData.questionText = questionText.trim();
    }
    if (optionA !== undefined) {
        updateData.optionA = optionA.trim();
    }
    if (optionB !== undefined) {
        updateData.optionB = optionB.trim();
    }
    if (optionC !== undefined) {
        updateData.optionC = optionC.trim();
    }
    if (optionD !== undefined) {
        updateData.optionD = optionD.trim();
    }
    // Handle image upload if provided
    if (req.file) {
        try {
            const uploaded = await (0, utils_1.uploadToCloudinary)(req.file.path);
            updateData.questionImage = uploaded.secure_url;
        }
        catch (error) {
            console.error('Error uploading image:', error);
            return res.status(500).json({ message: 'Failed to upload image' });
        }
    }
    else if (req.body.questionImage === null || req.body.questionImage === 'null') {
        // Allow explicitly setting image to null
        updateData.questionImage = null;
    }
    try {
        const question = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.updateQuestion(req.user, questionId, updateData);
        res.json({ question });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error updating question:', error);
        res.status(500).json({ message: 'Failed to update question' });
    }
}));
/**
 * DELETE /api/questions/:questionId
 * Delete a question
 */
exports.router.delete('/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question id' });
    }
    try {
        const result = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.deleteQuestion(req.user, questionId);
        res.json(result);
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error deleting question:', error);
        res.status(500).json({ message: 'Failed to delete question' });
    }
}));
/**
 * PATCH /api/questions/:questionId/correct-answer
 * Set/Update correct answer
 */
exports.router.patch('/:questionId/correct-answer', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question id' });
    }
    const { correctAnswer } = req.body;
    if (!correctAnswer) {
        return res.status(400).json({ message: 'correctAnswer is required' });
    }
    if (!['A', 'B', 'C', 'D'].includes(correctAnswer)) {
        return res.status(400).json({ message: 'correctAnswer must be one of A, B, C, or D' });
    }
    try {
        const question = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.setCorrectAnswer(req.user, questionId, correctAnswer);
        res.json({ question });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error setting correct answer:', error);
        res.status(500).json({ message: 'Failed to set correct answer' });
    }
}));
/**
 * GET /api/questions/:questionId
 * Get a single question by ID
 */
exports.router.get('/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    if (Number.isNaN(questionId)) {
        return res.status(400).json({ message: 'Invalid question id' });
    }
    try {
        const question = await courseLevelExamQuestions_1.CourseLevelExamQuestionsService.getQuestionById(questionId, req.user);
        res.json({ question });
    }
    catch (error) {
        if (error.status) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('Error fetching question:', error);
        res.status(500).json({ message: 'Failed to fetch question' });
    }
}));
