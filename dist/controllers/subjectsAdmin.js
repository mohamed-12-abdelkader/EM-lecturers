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
const questionBank_1 = require("../db/types/questionBank");
const subjects_1 = require("../services/subjects");
const chapters_1 = require("../services/chapters");
const questionBankHierarchy_1 = require("../services/questionBankHierarchy");
const pool_1 = __importDefault(require("../db/pool"));
const questionBankChangeRequests_1 = require("../services/questionBankChangeRequests");
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/subjects';
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = (0, multer_1.default)({ storage });
const router = (0, express_1.Router)();
exports.router = router;
// PUT /api/subjects/:id
router.put('/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const user = req.user;
        const subjectId = Number(req.params.id);
        if (Number.isNaN(subjectId))
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        const existing = await subjects_1.SubjectService.getById(subjectId);
        if (!existing)
            return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const validated = questionBank_1.UpdateSubjectSchema.parse({ ...req.body, image_url });
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'subject',
                entityId: subjectId,
                action: 'update',
                payload: validated,
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب تعديل المادة للأدمن للموافقة',
                data: request,
            });
        }
        const updated = await subjects_1.SubjectService.update(existing.question_bank_id, subjectId, validated);
        return res
            .status(200)
            .json({ success: true, message: 'تم تحديث المادة بنجاح', data: updated });
    }
    catch (error) {
        if (error.name === 'ZodError')
            return res
                .status(400)
                .json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
        if (error.message?.includes('مادة بنفس الاسم'))
            return res
                .status(409)
                .json({ success: false, message: 'يوجد مادة بنفس الاسم داخل نفس بنك الأسئلة' });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في تحديث المادة', error: error.message });
    }
});
// DELETE /api/subjects/:id
router.delete('/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), async (req, res) => {
    try {
        const user = req.user;
        const subjectId = Number(req.params.id);
        if (Number.isNaN(subjectId))
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        const existing = await subjects_1.SubjectService.getById(subjectId);
        if (!existing)
            return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'subject',
                entityId: subjectId,
                action: 'delete',
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب حذف المادة للأدمن للموافقة',
                data: request,
            });
        }
        await subjects_1.SubjectService.delete(existing.question_bank_id, subjectId);
        return res.status(200).json({ success: true, message: 'تم حذف المادة بنجاح' });
    }
    catch (error) {
        if (error.message?.includes('لا يمكن حذف المادة'))
            return res.status(409).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في حذف المادة', error: error.message });
    }
});
// Extra: GET /api/subjects/:id/with-books (admin or assigned teacher)
router.get('/:id/with-books', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee']), async (req, res) => {
    try {
        const subjectId = Number(req.params.id);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        }
        const subject = await subjects_1.SubjectService.getById(subjectId);
        if (!subject)
            return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
        const user = req.user;
        if (user.role === 'teacher') {
            const assigned = await pool_1.default.query('SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2', [user.id, subjectId]);
            if (!assigned.rowCount) {
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
            }
        }
        const books = await (0, questionBankHierarchy_1.getSubjectBooksWithChaptersAndLessons)(subjectId);
        return res.status(200).json({
            success: true,
            data: {
                subject,
                books,
                chapters: books.flatMap((b) => b.chapters),
            },
        });
    }
    catch (error) {
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في جلب المادة والكتب', error: error.message });
    }
});
// Extra: GET /api/subjects/:id/with-chapters (legacy flat view)
router.get('/:id/with-chapters', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee']), async (req, res) => {
    try {
        const subjectId = Number(req.params.id);
        if (Number.isNaN(subjectId)) {
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        }
        const subject = await subjects_1.SubjectService.getById(subjectId);
        if (!subject)
            return res.status(404).json({ success: false, message: 'المادة غير موجودة' });
        const user = req.user;
        if (user.role === 'teacher') {
            const assigned = await pool_1.default.query('SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2', [user.id, subjectId]);
            if (!assigned.rowCount) {
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
            }
        }
        const chapters = await chapters_1.ChapterService.getBySubjectId(subjectId);
        return res.status(200).json({ success: true, data: { subject, chapters } });
    }
    catch (error) {
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في جلب المادة والفصول', error: error.message });
    }
});
