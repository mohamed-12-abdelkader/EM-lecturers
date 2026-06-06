"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const subjects_1 = require("../services/subjects");
const questionBank_1 = require("../db/types/questionBank");
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
// Create new subject
async function create(req, res) {
    try {
        const questionBankId = parseInt(req.params.bankId);
        if (isNaN(questionBankId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف بنك الأسئلة غير صحيح',
            });
        }
        const validatedData = questionBank_1.CreateSubjectSchema.parse(req.body);
        const subject = await subjects_1.SubjectService.create(questionBankId, validatedData);
        res.status(201).json({
            success: true,
            message: 'تم إنشاء المادة بنجاح',
            data: subject,
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
        if (error.message === 'بنك الأسئلة غير موجود') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'خطأ في إنشاء المادة',
            error: error.message,
        });
    }
}
// Get all subjects for a question bank
async function getByQuestionBank(req, res) {
    try {
        const questionBankId = parseInt(req.params.bankId);
        if (isNaN(questionBankId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف بنك الأسئلة غير صحيح',
            });
        }
        const is_active = req.query.is_active !== undefined ? req.query.is_active === 'true' : undefined;
        const result = await subjects_1.SubjectService.getByQuestionBank(questionBankId, is_active);
        res.status(200).json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب المواد',
            error: error.message,
        });
    }
}
// Get subject by ID
async function getById(req, res) {
    try {
        const id = parseInt(req.params.subjectId);
        if (isNaN(id)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المادة غير صحيح',
            });
        }
        const subject = await subjects_1.SubjectService.getById(id);
        if (!subject) {
            return res.status(404).json({
                success: false,
                message: 'المادة غير موجودة',
            });
        }
        res.status(200).json({
            success: true,
            data: subject,
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب المادة',
            error: error.message,
        });
    }
}
// Update subject
async function update(req, res) {
    try {
        const questionBankId = parseInt(req.params.bankId);
        const subjectId = parseInt(req.params.subjectId);
        if (isNaN(questionBankId) || isNaN(subjectId)) {
            return res.status(400).json({
                success: false,
                message: 'معرفات غير صحيحة',
            });
        }
        const validatedData = questionBank_1.UpdateSubjectSchema.parse(req.body);
        const subject = await subjects_1.SubjectService.update(questionBankId, subjectId, validatedData);
        res.status(200).json({
            success: true,
            message: 'تم تحديث المادة بنجاح',
            data: subject,
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
            message: 'خطأ في تحديث المادة',
            error: error.message,
        });
    }
}
// Delete subject
async function deleteSubject(req, res) {
    try {
        const questionBankId = parseInt(req.params.bankId);
        const subjectId = parseInt(req.params.subjectId);
        if (isNaN(questionBankId) || isNaN(subjectId)) {
            return res.status(400).json({
                success: false,
                message: 'معرفات غير صحيحة',
            });
        }
        await subjects_1.SubjectService.delete(questionBankId, subjectId);
        res.status(200).json({
            success: true,
            message: 'تم حذف المادة بنجاح',
        });
    }
    catch (error) {
        if (error.message === 'المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة') {
            return res.status(404).json({
                success: false,
                message: error.message,
            });
        }
        if (error.message.includes('لا يمكن حذف المادة')) {
            return res.status(400).json({
                success: false,
                message: error.message,
            });
        }
        res.status(500).json({
            success: false,
            message: 'خطأ في حذف المادة',
            error: error.message,
        });
    }
}
// Get subjects accessible to teacher
async function getTeacherSubjects(req, res) {
    try {
        const teacherId = parseInt(req.params.teacherId);
        if (isNaN(teacherId)) {
            return res.status(400).json({
                success: false,
                message: 'معرف المدرس غير صحيح',
            });
        }
        const subjects = await subjects_1.SubjectService.getTeacherSubjects(teacherId);
        res.status(200).json({
            success: true,
            data: {
                subjects,
                total: subjects.length,
            },
        });
    }
    catch (error) {
        res.status(500).json({
            success: false,
            message: 'خطأ في جلب مواد المدرس',
            error: error.message,
        });
    }
}
// Create router
const router = (0, express_1.Router)();
exports.router = router;
// Apply authentication middleware
router.use((0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee']));
// Subject routes
router.post('/:bankId/subjects', (0, permissions_1.checkPermission)('question_bank_management'), create);
router.get('/:bankId/subjects', getByQuestionBank);
router.get('/:bankId/subjects/:subjectId', getById);
router.put('/:bankId/subjects/:subjectId', (0, permissions_1.checkPermission)('question_bank_management'), update);
router.delete('/:bankId/subjects/:subjectId', (0, permissions_1.checkPermission)('question_bank_management'), deleteSubject);
// Teacher-specific routes
router.get('/teacher/:teacherId/subjects', getTeacherSubjects);
