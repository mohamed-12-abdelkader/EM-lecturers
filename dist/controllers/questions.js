"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionController = void 0;
const questions_1 = require("../services/questions");
const questionBank_1 = require("../db/types/questionBank");
class QuestionController {
    // Create new question (Teacher)
    static async create(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            const chapterId = parseInt(req.params.chapterId);
            const lessonId = parseInt(req.params.lessonId);
            if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId) || isNaN(lessonId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            // Get teacher ID from authenticated user
            const teacherId = req.user.id;
            const validatedData = questionBank_1.CreateQuestionSchema.parse(req.body);
            const question = await questions_1.QuestionService.create(questionBankId, subjectId, chapterId, lessonId, teacherId, validatedData);
            res.status(201).json({
                success: true,
                message: 'تم إضافة السؤال بنجاح وتم إرساله للمراجعة',
                data: question,
            });
        }
        catch (error) {
            if (error.name === 'ZodError') {
                return res.status(400).json({
                    success: false,
                    message: 'بيانات غير صحيحة',
                    errors: error.errors,
                });
            }
            if (error.message === 'الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            if (error.message === 'ليس لديك صلاحية لإضافة أسئلة لهذه المادة') {
                return res.status(403).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في إضافة السؤال',
                error: error.message,
            });
        }
    }
    // Get questions for a lesson
    static async getByLesson(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            const chapterId = parseInt(req.params.chapterId);
            const lessonId = parseInt(req.params.lessonId);
            if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId) || isNaN(lessonId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const status = req.query.status;
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;
            const result = await questions_1.QuestionService.getByLesson(questionBankId, subjectId, chapterId, lessonId, status, limit, offset);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الأسئلة',
                error: error.message,
            });
        }
    }
    // Get question by ID
    static async getById(req, res) {
        try {
            const id = parseInt(req.params.questionId);
            if (isNaN(id)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف السؤال غير صحيح',
                });
            }
            const question = await questions_1.QuestionService.getById(id);
            if (!question) {
                return res.status(404).json({
                    success: false,
                    message: 'السؤال غير موجود',
                });
            }
            res.status(200).json({
                success: true,
                data: question,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب السؤال',
                error: error.message,
            });
        }
    }
    // Get pending questions for admin review
    static async getPending(req, res) {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const offset = parseInt(req.query.offset) || 0;
            const subject_id = req.query.subject_id
                ? parseInt(req.query.subject_id)
                : undefined;
            const teacher_id = req.query.teacher_id
                ? parseInt(req.query.teacher_id)
                : undefined;
            const difficulty_level = req.query.difficulty_level;
            const result = await questions_1.QuestionService.getPending(limit, offset, subject_id, teacher_id, difficulty_level);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الأسئلة المعلقة',
                error: error.message,
            });
        }
    }
    // Approve question (Admin)
    static async approve(req, res) {
        try {
            const questionId = parseInt(req.params.questionId);
            if (isNaN(questionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف السؤال غير صحيح',
                });
            }
            const adminId = req.user.id;
            const validatedData = questionBank_1.UpdateQuestionStatusSchema.parse(req.body);
            const question = await questions_1.QuestionService.approve(questionId, adminId, validatedData);
            res.status(200).json({
                success: true,
                message: 'تمت الموافقة على السؤال بنجاح',
                data: question,
            });
        }
        catch (error) {
            if (error.name === 'ZodError') {
                return res.status(400).json({
                    success: false,
                    message: 'بيانات غير صحيحة',
                    errors: error.errors,
                });
            }
            if (error.message === 'السؤال غير موجود أو تمت مراجعته بالفعل') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في الموافقة على السؤال',
                error: error.message,
            });
        }
    }
    // Reject question (Admin)
    static async reject(req, res) {
        try {
            const questionId = parseInt(req.params.questionId);
            if (isNaN(questionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف السؤال غير صحيح',
                });
            }
            const adminId = req.user.id;
            const validatedData = questionBank_1.UpdateQuestionStatusSchema.parse(req.body);
            const question = await questions_1.QuestionService.reject(questionId, adminId, validatedData);
            res.status(200).json({
                success: true,
                message: 'تم رفض السؤال بنجاح',
                data: question,
            });
        }
        catch (error) {
            if (error.name === 'ZodError') {
                return res.status(400).json({
                    success: false,
                    message: 'بيانات غير صحيحة',
                    errors: error.errors,
                });
            }
            if (error.message === 'سبب الرفض مطلوب') {
                return res.status(400).json({
                    success: false,
                    message: error.message,
                });
            }
            if (error.message === 'السؤال غير موجود أو تمت مراجعته بالفعل') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في رفض السؤال',
                error: error.message,
            });
        }
    }
    // Delete question
    static async delete(req, res) {
        try {
            const questionId = parseInt(req.params.questionId);
            if (isNaN(questionId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرف السؤال غير صحيح',
                });
            }
            await questions_1.QuestionService.delete(questionId);
            res.status(200).json({
                success: true,
                message: 'تم حذف السؤال بنجاح',
            });
        }
        catch (error) {
            if (error.message === 'السؤال غير موجود') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في حذف السؤال',
                error: error.message,
            });
        }
    }
}
exports.QuestionController = QuestionController;
