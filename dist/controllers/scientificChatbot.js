"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const scientificChatbot_1 = require("../services/scientificChatbot");
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const requestParsers_1 = require("../utils/requestParsers");
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for course content files
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/course-content';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'scientific-content-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit for text files
    },
    fileFilter: (req, file, cb) => {
        // Accept text files
        const allowedMimes = [
            'text/plain',
            'text/markdown',
            'application/pdf', // Will need to extract text from PDF
        ];
        if (allowedMimes.includes(file.mimetype) ||
            file.originalname.endsWith('.txt') ||
            file.originalname.endsWith('.md')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only text files (.txt, .md) are allowed'));
        }
    },
});
// Configure multer for chat images
const chatStorage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads/chat-images';
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, 'chat-image-' + uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const uploadChat = (0, multer_1.default)({
    storage: chatStorage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit per image
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        }
        else {
            cb(new Error('Only images are allowed'));
        }
    },
});
/**
 * Upload course content file (Teacher only)
 * POST /scientific-chatbot/courses/:courseId/files
 */
router.post('/courses/:courseId/files', (0, authentication_1.authMiddleware)(['teacher', 'admin']), upload.single('file'), async (req, res) => {
    try {
        const courseId = (0, requestParsers_1.parseNumberInput)(req.params.courseId);
        const teacherId = req.user.id;
        const userRole = req.user.role;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        // Verify course exists
        const courseResult = await pool_1.default.query('SELECT * FROM courses WHERE id = $1', [courseId]);
        if (courseResult.rows.length === 0) {
            // Clean up uploaded file
            if (req.file?.path) {
                await fs_1.default.promises.unlink(req.file.path).catch(() => { });
            }
            return res.status(404).json({ error: 'Course not found' });
        }
        const course = courseResult.rows[0];
        // Verify course ownership
        if (userRole === 'teacher') {
            if (course.teacher_id !== teacherId) {
                // Clean up uploaded file
                await fs_1.default.promises.unlink(req.file.path).catch(() => { });
                return res
                    .status(403)
                    .json({ error: 'You do not have permission to upload files for this course' });
            }
        }
        // Read file content
        let contentText;
        try {
            if (req.file.mimetype === 'application/pdf') {
                // For PDF, you would need pdf-parse library
                // For now, we'll just read as text (won't work well for PDF)
                contentText = await fs_1.default.promises.readFile(req.file.path, 'utf-8');
            }
            else {
                contentText = await fs_1.default.promises.readFile(req.file.path, 'utf-8');
            }
        }
        catch (_readError) {
            await fs_1.default.promises.unlink(req.file.path).catch(() => { });
            return res.status(400).json({ error: 'Could not read file content' });
        }
        // Upload and process
        const result = await scientificChatbot_1.ScientificChatbotService.uploadCourseFile(courseId, teacherId, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, contentText);
        const { embeddingUnavailable, ...file } = result;
        res.status(201).json({
            message: embeddingUnavailable
                ? 'File saved. Embeddings could not be generated (embedding service unavailable). Use "Reset embeddings" for this course when the service is back.'
                : 'File uploaded and processed successfully',
            file,
            ...(embeddingUnavailable && { warning: 'Embedding service (Ollama) was unavailable. File is stored; run "Reset embeddings" when the service is available.' }),
        });
    }
    catch (error) {
        utils_1.logger.error('Error uploading course file:', error);
        // Clean up file if it exists
        if (req.file?.path) {
            await fs_1.default.promises.unlink(req.file.path).catch(() => { });
        }
        res.status(500).json({ error: error.message || 'Error uploading file' });
    }
});
/**
 * List course content files (Teacher only)
 * GET /scientific-chatbot/courses/:courseId/files
 */
router.get('/courses/:courseId/files', (0, authentication_1.authMiddleware)(['teacher', 'admin']), async (req, res) => {
    try {
        const courseId = (0, requestParsers_1.parseNumberInput)(req.params.courseId);
        const teacherId = req.user.id;
        const userRole = req.user.role;
        // Verify course exists
        const courseResult = await pool_1.default.query('SELECT * FROM courses WHERE id = $1', [courseId]);
        if (courseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        const course = courseResult.rows[0];
        // Verify course ownership
        if (userRole === 'teacher') {
            if (course.teacher_id !== teacherId) {
                return res
                    .status(403)
                    .json({ error: 'You do not have permission to view files for this course' });
            }
        }
        const files = await scientificChatbot_1.ScientificChatbotService.listCourseFiles(courseId, userRole === 'admin' ? undefined : teacherId);
        res.json({ files });
    }
    catch (error) {
        utils_1.logger.error('Error listing course files:', error);
        res.status(500).json({ error: error.message || 'Error listing files' });
    }
});
/**
 * Reset course embeddings (delete and regenerate)
 * POST /scientific-chatbot/courses/:courseId/reset-embeddings
 */
router.post('/courses/:courseId/reset-embeddings', (0, authentication_1.authMiddleware)(['teacher', 'admin']), async (req, res) => {
    try {
        const courseId = (0, requestParsers_1.parseNumberInput)(req.params.courseId);
        const teacherId = req.user.id;
        const userRole = req.user.role;
        // Verify course exists
        const courseResult = await pool_1.default.query('SELECT * FROM courses WHERE id = $1', [courseId]);
        if (courseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Course not found' });
        }
        const course = courseResult.rows[0];
        // Verify course ownership
        if (userRole === 'teacher') {
            if (course.teacher_id !== teacherId) {
                return res
                    .status(403)
                    .json({ error: 'You do not have permission to reset embeddings for this course' });
            }
        }
        await scientificChatbot_1.ScientificChatbotService.resetCourseEmbeddings(courseId, teacherId);
        res.json({
            message: 'Embeddings reset successfully',
        });
    }
    catch (error) {
        utils_1.logger.error('Error resetting embeddings:', error);
        res.status(500).json({ error: error.message || 'Error resetting embeddings' });
    }
});
/**
 * Delete course content file
 * DELETE /scientific-chatbot/files/:fileId
 */
router.delete('/files/:fileId', (0, authentication_1.authMiddleware)(['teacher', 'admin']), async (req, res) => {
    try {
        const fileId = (0, requestParsers_1.parseNumberInput)(req.params.fileId);
        const teacherId = req.user.id;
        const result = await scientificChatbot_1.ScientificChatbotService.deleteCourseFile(fileId, teacherId);
        res.json({
            message: 'File deleted successfully',
            ...(result.milvusUnavailable && {
                warning: 'Vector index (Milvus) was unavailable. File removed from the course. When Milvus is running, use "Reset embeddings" for this course to sync the index.',
            }),
        });
    }
    catch (error) {
        utils_1.logger.error('Error deleting file:', error);
        res.status(500).json({ error: error.message || 'Error deleting file' });
    }
});
/**
 * Ask a question (Student only)
 * POST /scientific-chatbot/courses/:courseId/ask
 */
router.post('/courses/:courseId/ask', (0, authentication_1.authMiddleware)(['student']), uploadChat.array('images', 5), async (req, res) => {
    try {
        const courseId = (0, requestParsers_1.parseNumberInput)(req.params.courseId);
        const studentId = req.user.id;
        // const studentId = 1
        const { question } = req.body;
        if (!question || typeof question !== 'string' || question.trim().length === 0) {
            return res.status(400).json({ error: 'Question is required' });
        }
        // Check if course has content
        const hasContent = await scientificChatbot_1.ScientificChatbotService.courseHasContent(courseId);
        if (!hasContent) {
            if (req.files && Array.isArray(req.files)) {
                for (const file of req.files) {
                    await fs_1.default.promises.unlink(file.path).catch(() => { });
                }
            }
            return res.status(404).json({
                error: 'This course does not have uploaded content yet. Please ask your teacher to upload course materials.',
            });
        }
        const images = [];
        if (req.files && Array.isArray(req.files)) {
            req.files.forEach((file) => {
                images.push(file.path.replace(/\\/g, '/'));
            });
        }
        // Get answer
        const result = await scientificChatbot_1.ScientificChatbotService.answerQuestion(studentId, courseId, question.trim(), images);
        res.json({
            answer: result.answer,
            retrieved_chunks: result.retrievedChunks,
        });
    }
    catch (error) {
        utils_1.logger.error('Error answering question:', error);
        if (req.files && Array.isArray(req.files)) {
            for (const file of req.files) {
                await fs_1.default.promises.unlink(file.path).catch(() => { });
            }
        }
        const msg = error?.message ?? '';
        const isServiceUnavailable = msg.includes('Ollama API error') ||
            msg.includes('502') ||
            msg.includes('503') ||
            msg.includes('Bad Gateway') ||
            msg.includes('UNAVAILABLE');
        if (isServiceUnavailable) {
            return res.status(503).json({
                error: 'Answer service is temporarily unavailable. Please try again later.',
            });
        }
        res.status(500).json({ error: error.message || 'Error answering question' });
    }
});
/**
 * Get chat history (Student only)
 * GET /scientific-chatbot/courses/:courseId/history
 */
router.get('/courses/:courseId/history', (0, authentication_1.authMiddleware)(['student']), async (req, res) => {
    try {
        const courseId = (0, requestParsers_1.parseNumberInput)(req.params.courseId);
        const studentId = req.user.id;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;
        const beforeId = req.query.beforeId ? parseInt(req.query.beforeId) : undefined;
        const history = await scientificChatbot_1.ScientificChatbotService.getChatHistory(studentId, courseId, limit, beforeId);
        res.json({ history });
    }
    catch (error) {
        utils_1.logger.error('Error getting chat history:', error);
        res.status(500).json({ error: error.message || 'Error getting chat history' });
    }
});
