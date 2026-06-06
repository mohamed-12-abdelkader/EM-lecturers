"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LessonController = void 0;
const lessons_1 = require("../services/lessons");
const questionBank_1 = require("../db/types/questionBank");
class LessonController {
    // Create new lesson
    static async create(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            const chapterId = parseInt(req.params.chapterId);
            if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const validatedData = questionBank_1.CreateLessonSchema.parse(req.body);
            const lesson = await lessons_1.LessonService.create(questionBankId, subjectId, chapterId, validatedData);
            res.status(201).json({
                success: true,
                message: 'تم إنشاء الدرس بنجاح',
                data: lesson,
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
            if (error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة أو بنك الأسئلة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في إنشاء الدرس',
                error: error.message,
            });
        }
    }
    // Get all lessons for a chapter
    static async getByChapter(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            const chapterId = parseInt(req.params.chapterId);
            if (isNaN(questionBankId) || isNaN(subjectId) || isNaN(chapterId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
            const order = req.query.order || 'asc';
            const result = await lessons_1.LessonService.getByChapter(questionBankId, subjectId, chapterId, is_active, order);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الدروس',
                error: error.message,
            });
        }
    }
    // Get lesson by ID
    static async getById(req, res) {
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
            const lesson = await lessons_1.LessonService.getById(questionBankId, subjectId, chapterId, lessonId);
            if (!lesson) {
                return res.status(404).json({
                    success: false,
                    message: 'الدرس غير موجود',
                });
            }
            res.status(200).json({
                success: true,
                data: lesson,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الدرس',
                error: error.message,
            });
        }
    }
    // Update lesson
    static async update(req, res) {
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
            const validatedData = questionBank_1.UpdateLessonSchema.parse(req.body);
            const lesson = await lessons_1.LessonService.update(questionBankId, subjectId, chapterId, lessonId, validatedData);
            res.status(200).json({
                success: true,
                message: 'تم تحديث الدرس بنجاح',
                data: lesson,
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
            res.status(500).json({
                success: false,
                message: 'خطأ في تحديث الدرس',
                error: error.message,
            });
        }
    }
    // Delete lesson
    static async delete(req, res) {
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
            await lessons_1.LessonService.delete(questionBankId, subjectId, chapterId, lessonId);
            res.status(200).json({
                success: true,
                message: 'تم حذف الدرس بنجاح',
            });
        }
        catch (error) {
            if (error.message === 'الدرس غير موجود أو لا ينتمي لهذا الفصل أو المادة أو بنك الأسئلة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            if (error.message.includes('لا يمكن حذف الدرس')) {
                return res.status(400).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في حذف الدرس',
                error: error.message,
            });
        }
    }
}
exports.LessonController = LessonController;
