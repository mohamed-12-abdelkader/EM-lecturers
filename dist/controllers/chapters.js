"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChapterController = void 0;
const chapters_1 = require("../services/chapters");
const questionBank_1 = require("../db/types/questionBank");
class ChapterController {
    // Create new chapter
    static async create(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            if (isNaN(questionBankId) || isNaN(subjectId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const validatedData = questionBank_1.CreateChapterSchema.parse(req.body);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const chapter = await chapters_1.ChapterService.create(questionBankId, subjectId, validatedData);
            res.status(201).json({
                success: true,
                message: 'تم إنشاء الفصل بنجاح',
                data: chapter,
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
            if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في إنشاء الفصل',
                error: error.message,
            });
        }
    }
    // Get all chapters for a subject
    static async getBySubject(req, res) {
        try {
            const questionBankId = parseInt(req.params.bankId);
            const subjectId = parseInt(req.params.subjectId);
            if (isNaN(questionBankId) || isNaN(subjectId)) {
                return res.status(400).json({
                    success: false,
                    message: 'معرفات غير صحيحة',
                });
            }
            const is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
            const order = req.query.order || 'asc';
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const result = await chapters_1.ChapterService.getBySubject(questionBankId, subjectId, is_active, order);
            res.status(200).json({
                success: true,
                data: result,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الفصول',
                error: error.message,
            });
        }
    }
    // Get chapter by ID
    static async getById(req, res) {
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
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const chapter = await chapters_1.ChapterService.getById(questionBankId, subjectId, chapterId);
            if (!chapter) {
                return res.status(404).json({
                    success: false,
                    message: 'الفصل غير موجود',
                });
            }
            res.status(200).json({
                success: true,
                data: chapter,
            });
        }
        catch (error) {
            res.status(500).json({
                success: false,
                message: 'خطأ في جلب الفصل',
                error: error.message,
            });
        }
    }
    // Update chapter
    static async update(req, res) {
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
            const validatedData = questionBank_1.UpdateChapterSchema.parse(req.body);
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            const chapter = await chapters_1.ChapterService.update(chapterId, validatedData);
            res.status(200).json({
                success: true,
                message: 'تم تحديث الفصل بنجاح',
                data: chapter,
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
            if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة' ||
                error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في تحديث الفصل',
                error: error.message,
            });
        }
    }
    // Delete chapter
    static async delete(req, res) {
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
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            await chapters_1.ChapterService.delete(questionBankId, subjectId, chapterId);
            res.status(200).json({
                success: true,
                message: 'تم حذف الفصل بنجاح',
            });
        }
        catch (error) {
            if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة' ||
                error.message === 'الفصل غير موجود أو لا ينتمي لهذه المادة') {
                return res.status(404).json({
                    success: false,
                    message: error.message,
                });
            }
            if (error.message.includes('لا يمكن حذف الفصل')) {
                return res.status(400).json({
                    success: false,
                    message: error.message,
                });
            }
            res.status(500).json({
                success: false,
                message: 'خطأ في حذف الفصل',
                error: error.message,
            });
        }
    }
}
exports.ChapterController = ChapterController;
