"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const fs = __importStar(require("node:fs"));
const authentication_1 = require("../middleware/authentication");
const permissions_1 = require("../middleware/permissions");
const utils_1 = require("../utils");
const subjectBooks_1 = require("../services/subjectBooks");
const questionBankHierarchy_1 = require("../services/questionBankHierarchy");
const teacherAccess_1 = require("../services/teacherAccess");
const questionBankChangeRequests_1 = require("../services/questionBankChangeRequests");
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => {
        const dir = 'uploads/books';
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = (0, multer_1.default)({ storage });
const router = (0, express_1.Router)();
exports.router = router;
async function assertTeacherBookAccess(userId, bookId) {
    const book = await subjectBooks_1.SubjectBookService.getById(bookId);
    if (!book)
        return false;
    return (0, teacherAccess_1.teacherHasSubjectAccess)(userId, book.subject_id);
}
// GET /api/books/:id/with-chapters
router.get('/books/:id/with-chapters', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee']), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
        }
        if (req.user?.role === 'teacher') {
            const allowed = await assertTeacherBookAccess(req.user.id, id);
            if (!allowed) {
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذا الكتاب' });
            }
        }
        const data = await (0, questionBankHierarchy_1.getBookWithChaptersAndLessons)(id);
        if (!data) {
            return res.status(404).json({ success: false, message: 'الكتاب غير موجود' });
        }
        return res.status(200).json({ success: true, data });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        return res.status(500).json({ success: false, message: 'خطأ في جلب الكتاب', error: message });
    }
});
// GET /api/subjects/:subjectId/books
router.get('/subjects/:subjectId/books', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee', 'student']), async (req, res) => {
    try {
        const subjectId = Number(req.params.subjectId);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        }
        if (req.user?.role === 'teacher') {
            const allowed = await (0, teacherAccess_1.teacherHasSubjectAccess)(req.user.id, subjectId);
            if (!allowed) {
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
            }
        }
        const books = await subjectBooks_1.SubjectBookService.getBySubjectId(subjectId, req.user?.role === 'student');
        return res.status(200).json({ success: true, data: books });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message === 'المادة غير موجودة') {
            return res.status(404).json({ success: false, message });
        }
        return res.status(500).json({ success: false, message: 'خطأ في جلب الكتب', error: message });
    }
});
// POST /api/subjects/:subjectId/books
router.post('/subjects/:subjectId/books', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const subjectId = Number(req.params.subjectId);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        }
        if (!req.body.name) {
            return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });
        }
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const existingBooks = await subjectBooks_1.SubjectBookService.getBySubjectId(subjectId);
        const book = await subjectBooks_1.SubjectBookService.create(subjectId, {
            name: req.body.name,
            description: req.body.description,
            image_url,
            order_num: req.body.order_num ? Number(req.body.order_num) : undefined,
        }, req.user?.id);
        const message = existingBooks.length > 0
            ? 'تم إنشاء الكتاب بنجاح — تم نسخ الفصول والدروس من الكتاب الأول تلقائياً (الأسئلة منفصلة لكل كتاب)'
            : 'تم إنشاء الكتاب بنجاح';
        return res.status(201).json({ success: true, message, data: book });
    }
    catch (error) {
        const err = error;
        if (err.message === 'المادة غير موجودة') {
            return res.status(404).json({ success: false, message: err.message });
        }
        if (err.code === '23505' || err.message?.includes('بنفس الاسم')) {
            return res.status(409).json({ success: false, message: 'يوجد كتاب بنفس الاسم داخل نفس المادة' });
        }
        return res.status(500).json({ success: false, message: 'خطأ في إنشاء الكتاب', error: err.message });
    }
});
// PUT /api/books/:id
router.put('/books/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
        }
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const updatePayload = {
            name: req.body.name,
            description: req.body.description,
            image_url,
            order_num: req.body.order_num !== undefined ? Number(req.body.order_num) : undefined,
            is_active: req.body.is_active !== undefined
                ? req.body.is_active === 'true' || req.body.is_active === true
                : undefined,
        };
        if (req.user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'book',
                entityId: id,
                action: 'update',
                payload: updatePayload,
                requestedBy: req.user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب تعديل الكتاب للأدمن للموافقة',
                data: request,
            });
        }
        const updated = await subjectBooks_1.SubjectBookService.update(id, updatePayload);
        return res.status(200).json({ success: true, message: 'تم تعديل الكتاب بنجاح', data: updated });
    }
    catch (error) {
        const err = error;
        if (err.message === 'الكتاب غير موجود') {
            return res.status(404).json({ success: false, message: err.message });
        }
        if (err.code === '23505') {
            return res.status(409).json({ success: false, message: 'يوجد كتاب بنفس الاسم داخل نفس المادة' });
        }
        return res.status(500).json({ success: false, message: 'خطأ في تعديل الكتاب', error: err.message });
    }
});
// DELETE /api/books/:id
router.delete('/books/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id)) {
            return res.status(400).json({ success: false, message: 'معرف الكتاب غير صحيح' });
        }
        if (req.user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'book',
                entityId: id,
                action: 'delete',
                requestedBy: req.user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب حذف الكتاب للأدمن للموافقة',
                data: request,
            });
        }
        await subjectBooks_1.SubjectBookService.delete(id);
        return res.status(200).json({ success: true, message: 'تم حذف الكتاب بنجاح' });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message === 'الكتاب غير موجود') {
            return res.status(404).json({ success: false, message });
        }
        return res.status(500).json({ success: false, message: 'خطأ في حذف الكتاب', error: message });
    }
});
