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
const questionBankV2_1 = require("../services/questionBankV2");
const questionBankV2_2 = require("../db/types/questionBankV2");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
exports.router = (0, express_1.Router)();
// إعداد multer لرفع الملفات
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            const dir = path_1.default.join(__dirname, '../../uploads');
            fs_1.default.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const uniqueName = `${Date.now()}-${file.originalname}`;
            cb(null, uniqueName);
        },
    }),
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});
// رفع حتى 20 صورة لأسئلة صورة فقط (Bulk)
const uploadImageOnlyBulk = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            const dir = path_1.default.join(__dirname, '../../uploads');
            fs_1.default.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}-${file.originalname || 'image'}`);
        },
    }),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file, 20 files
});
// ============================================
// 0. قطعة + أسئلة MCQ (Passage with MCQs)
// ============================================
exports.router.post('/passages', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const validatedData = questionBankV2_2.CreatePassageWithQuestionsSchema.parse(req.body);
    const result = await questionBankV2_1.QuestionBankV2Service.createPassageWithQuestions(userId, validatedData, userRole);
    res.status(201).json({
        success: true,
        message: `تمت إضافة القطعة مع ${result.questions.length} سؤال`,
        data: result
    });
}));
exports.router.get('/passages/:passageId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const passageId = parseInt(req.params.passageId);
    if (isNaN(passageId)) {
        return res.status(400).json({ success: false, message: 'معرف القطعة غير صحيح' });
    }
    const result = await questionBankV2_1.QuestionBankV2Service.getPassageWithQuestions(passageId);
    if (!result) {
        return res.status(404).json({ success: false, message: 'القطعة غير موجودة' });
    }
    res.status(200).json({ success: true, data: result });
}));
// ============================================
// 1. إضافة أسئلة نصية جماعية (Bulk Add)
// ============================================
exports.router.post('/bulk-text', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const validatedData = questionBankV2_2.BulkTextQuestionsSchema.parse(req.body);
    const questions = await questionBankV2_1.QuestionBankV2Service.createBulkTextQuestions(validatedData.lesson_id, userId, validatedData, userRole);
    res.status(201).json({
        success: true,
        message: `تم إضافة ${questions.length} سؤال بنجاح`,
        data: questions
    });
}));
// ============================================
// 2. إضافة سؤال باختيارات صور
// ============================================
exports.router.post('/image-choices', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.fields([
    { name: 'option_0', maxCount: 1 },
    { name: 'option_1', maxCount: 1 },
    { name: 'option_2', maxCount: 1 },
    { name: 'option_3', maxCount: 1 }
]), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const files = req.files;
    // ترتيب الملفات حسب الفهرس
    const optionFiles = [];
    for (let i = 0; i < 4; i++) {
        const file = files[`option_${i}`]?.[0];
        if (!file) {
            return res.status(400).json({
                success: false,
                message: `يجب رفع صورة للخيار ${i + 1}`
            });
        }
        optionFiles.push(file);
    }
    // التحقق من البيانات الأساسية (بدون options لأننا نرفع ملفات)
    const baseData = {
        question_text: req.body.question_text,
        lesson_id: parseInt(req.body.lesson_id),
        correct_answer_index: parseInt(req.body.correct_answer_index),
        explanation: req.body.explanation,
        difficulty_level: req.body.difficulty_level || 'medium',
        points: parseInt(req.body.points) || 1
    };
    // التحقق من البيانات الأساسية
    if (!baseData.question_text || baseData.question_text.trim().length === 0) {
        return res.status(400).json({
            success: false,
            message: 'نص السؤال مطلوب'
        });
    }
    if (isNaN(baseData.lesson_id) || baseData.lesson_id <= 0) {
        return res.status(400).json({
            success: false,
            message: 'معرف الدرس غير صحيح'
        });
    }
    if (isNaN(baseData.correct_answer_index) || baseData.correct_answer_index < 0 || baseData.correct_answer_index > 3) {
        return res.status(400).json({
            success: false,
            message: 'الإجابة الصحيحة يجب أن تكون بين 0 و 3'
        });
    }
    // إنشاء questionData للـ service (بدون التحقق من options لأننا نرفع ملفات)
    const questionData = {
        question_text: baseData.question_text,
        lesson_id: baseData.lesson_id,
        options: [
            { option_index: 0, option_type: 'image' },
            { option_index: 1, option_type: 'image' },
            { option_index: 2, option_type: 'image' },
            { option_index: 3, option_type: 'image' }
        ],
        correct_answer_index: baseData.correct_answer_index,
        explanation: baseData.explanation,
        difficulty_level: baseData.difficulty_level,
        points: baseData.points
    };
    const question = await questionBankV2_1.QuestionBankV2Service.createImageChoicesQuestion(userId, questionData, optionFiles, userRole);
    res.status(201).json({
        success: true,
        message: 'تم إضافة السؤال بنجاح',
        data: question
    });
}));
// ============================================
// 3. إضافة/تحديث صورة السؤال (Optional)
// ============================================
exports.router.post('/:questionId/media', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('media'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = parseInt(req.params.questionId);
    const userId = req.user.id;
    const userRole = req.user.role;
    const file = req.file;
    if (!file) {
        return res.status(400).json({
            success: false,
            message: 'يجب رفع ملف'
        });
    }
    if (isNaN(questionId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف السؤال غير صحيح'
        });
    }
    const mediaData = questionBankV2_2.QuestionMediaSchema.parse({
        media_type: req.body.media_type || 'image',
        media_name: req.body.media_name || file.originalname,
        media_size: file.size
    });
    const media = await questionBankV2_1.QuestionBankV2Service.updateQuestionMedia(questionId, userId, file, mediaData, userRole);
    res.status(200).json({
        success: true,
        message: 'تم إضافة/تحديث صورة السؤال بنجاح',
        data: media
    });
}));
// ============================================
// 4. جلب سؤال معين
// ============================================
exports.router.get('/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = parseInt(req.params.questionId);
    if (isNaN(questionId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف السؤال غير صحيح'
        });
    }
    const question = await questionBankV2_1.QuestionBankV2Service.getQuestionById(questionId);
    if (!question) {
        return res.status(404).json({
            success: false,
            message: 'السؤال غير موجود'
        });
    }
    res.status(200).json({
        success: true,
        data: question
    });
}));
// ============================================
// 4b. إضافة أسئلة صورة فقط (Bulk) - حتى 20 صورة، اختيارات ثابتة a,b,c,d
// ============================================
exports.router.post('/lesson/:lessonId/questions/image-only-bulk', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), uploadImageOnlyBulk.array('images', 20), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
        return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    }
    const files = req.files || [];
    if (files.length === 0) {
        return res.status(400).json({ success: false, message: 'يجب رفع صورة واحدة على الأقل (حتى 20)' });
    }
    if (files.length > 20) {
        return res.status(400).json({ success: false, message: 'الحد الأقصى 20 صورة في الطلب الواحد' });
    }
    const userId = req.user.id;
    const userRole = req.user.role;
    let teacherId = userId;
    if (userRole === 'admin' && req.body.teacher_id != null) {
        const tid = parseInt(req.body.teacher_id, 10);
        if (!Number.isNaN(tid))
            teacherId = tid;
    }
    let meta = [];
    if (req.body.meta && typeof req.body.meta === 'string') {
        try {
            meta = JSON.parse(req.body.meta);
            if (!Array.isArray(meta))
                meta = [];
        }
        catch (_) {
            meta = [];
        }
    }
    const result = await questionBankV2_1.QuestionBankV2Service.createBulkImageOnlyQuestions(lessonId, teacherId, files, meta, userRole);
    const status = result.failed === 0 ? 201 : result.added > 0 ? 207 : 400;
    res.status(status).json({
        success: result.added > 0,
        message: result.failed === 0
            ? `تمت إضافة ${result.added} سؤال بنجاح`
            : `تمت إضافة ${result.added} سؤال، وفشل ${result.failed}`,
        data: result,
    });
}));
// ============================================
// 5. جلب القطع وأسئلتها في الدرس (يجب أن يكون قبل /lesson/:lessonId)
// ============================================
exports.router.get('/lesson/:lessonId/passages', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    if (isNaN(lessonId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف الدرس غير صحيح'
        });
    }
    const passages = await questionBankV2_1.QuestionBankV2Service.getLessonPassages(lessonId);
    res.status(200).json({
        success: true,
        data: passages
    });
}));
// ============================================
// 6. جلب أسئلة الدرس
// ============================================
exports.router.get('/lesson/:lessonId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'student', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lessonId = parseInt(req.params.lessonId);
    const status = req.query.status;
    const limit = parseInt(req.query.limit) || 500;
    const offset = parseInt(req.query.offset) || 0;
    if (isNaN(lessonId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف الدرس غير صحيح'
        });
    }
    const result = await questionBankV2_1.QuestionBankV2Service.getLessonQuestions(lessonId, status, limit, offset);
    res.status(200).json({
        success: true,
        data: result
    });
}));
// ============================================
// 7. تحديث حالة السؤال (Admin)
// ============================================
exports.router.put('/:questionId/status', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = parseInt(req.params.questionId);
    const adminId = req.user.id;
    if (isNaN(questionId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف السؤال غير صحيح'
        });
    }
    const validatedData = questionBankV2_2.UpdateQuestionStatusSchema.parse(req.body);
    const question = await questionBankV2_1.QuestionBankV2Service.updateQuestionStatus(questionId, adminId, validatedData);
    res.status(200).json({
        success: true,
        message: validatedData.status === 'approved' ? 'تمت الموافقة على السؤال' : 'تم رفض السؤال',
        data: question
    });
}));
// ============================================
// 7b. تحديد الإجابة الصحيحة لسؤال (Admin)
// ============================================
exports.router.patch('/:questionId/correct-answer', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = parseInt(req.params.questionId);
    if (isNaN(questionId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف السؤال غير صحيح'
        });
    }
    const validatedData = questionBankV2_2.UpdateCorrectAnswerSchema.parse(req.body);
    const question = await questionBankV2_1.QuestionBankV2Service.updateQuestionCorrectAnswer(questionId, validatedData.correct_answer_index);
    res.status(200).json({
        success: true,
        message: 'تم تحديث الإجابة الصحيحة بنجاح',
        data: question
    });
}));
// ============================================
// 8. حذف سؤال
// ============================================
exports.router.delete('/:questionId', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = parseInt(req.params.questionId);
    const userId = req.user.id;
    const userRole = req.user.role;
    if (isNaN(questionId)) {
        return res.status(400).json({
            success: false,
            message: 'معرف السؤال غير صحيح'
        });
    }
    await questionBankV2_1.QuestionBankV2Service.deleteQuestion(questionId, userId, userRole);
    res.status(200).json({
        success: true,
        message: 'تم حذف السؤال بنجاح'
    });
}));
