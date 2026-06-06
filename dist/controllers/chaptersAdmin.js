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
const teacherAccess_1 = require("../services/teacherAccess");
const utils_1 = require("../utils");
const chapters_1 = require("../services/chapters");
const chapters_2 = require("../services/chapters");
const lessonsAdmin_1 = require("../services/lessonsAdmin");
const questionBankChangeRequests_1 = require("../services/questionBankChangeRequests");
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/chapters';
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = (0, multer_1.default)({ storage });
const router = (0, express_1.Router)();
exports.router = router;
// Keep admin guard for mutating routes; read route below will allow teacher too
// GET /api/chapters/:id/with-lessons (admin or assigned teacher)
router.get('/chapters/:id/with-lessons', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'employee']), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id))
            return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
        if (req.user?.role === 'teacher') {
            const subjectId = await (0, teacherAccess_1.getSubjectIdByChapterId)(id);
            if (!subjectId)
                return res.status(404).json({ success: false, message: 'الفصل غير موجود' });
            const allowed = await (0, teacherAccess_1.teacherHasSubjectAccess)(req.user.id, subjectId);
            if (!allowed)
                return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });
        }
        const chapter = await chapters_2.ChapterService.getById(id);
        if (!chapter)
            return res.status(404).json({ success: false, message: 'الفصل غير موجود' });
        const lessons = await lessonsAdmin_1.AdminLessonService.getByChapterId(id);
        return res.status(200).json({ success: true, data: { chapter, lessons } });
    }
    catch (error) {
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في جلب الفصل والدروس', error: error.message });
    }
});
// POST /api/subjects/:subjectId/chapters
router.post('/subjects/:subjectId/chapters', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const subjectId = Number(req.params.subjectId);
        if (Number.isNaN(subjectId))
            return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });
        if (!req.body.name)
            return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const adminId = req.user?.id;
        const chapter = await chapters_1.ChapterService.create(subjectId, { name: req.body.name, description: req.body.description, image_url }, adminId);
        return res
            .status(201)
            .json({ success: true, message: 'تم إنشاء الفصل بنجاح', data: chapter });
    }
    catch (error) {
        if (error.message === 'المادة غير موجودة')
            return res.status(404).json({ success: false, message: error.message });
        if (error.code === '23505' || error.message?.includes('باسم موجود'))
            return res
                .status(409)
                .json({ success: false, message: 'يوجد فصل بنفس الاسم داخل نفس المادة' });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في إنشاء الفصل', error: error.message });
    }
});
// PUT /api/chapters/:id
router.put('/chapters/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (Number.isNaN(id))
            return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const updatePayload = {
            name: req.body.name,
            description: req.body.description,
            image_url,
        };
        if (req.user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'chapter',
                entityId: id,
                action: 'update',
                payload: updatePayload,
                requestedBy: req.user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب تعديل الفصل للأدمن للموافقة',
                data: request,
            });
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const updated = await chapters_1.ChapterService.update(id, updatePayload);
        return res
            .status(200)
            .json({ success: true, message: 'تم تعديل الفصل بنجاح', data: updated });
    }
    catch (error) {
        if (error.message === 'الفصل غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        if (error.code === '23505' || error.message?.includes('باسم موجود'))
            return res
                .status(409)
                .json({ success: false, message: 'يوجد فصل بنفس الاسم داخل نفس المادة' });
        if (error.message === 'لا توجد بيانات للتحديث')
            return res.status(400).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في تعديل الفصل', error: error.message });
    }
});
// DELETE /api/chapters/:id
router.delete('/chapters/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), async (req, res) => {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        if (Number.isNaN(id))
            return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'chapter',
                entityId: id,
                action: 'delete',
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب حذف الفصل للأدمن للموافقة',
                data: request,
            });
        }
        await chapters_1.ChapterService.delete(id);
        return res.status(200).json({ success: true, message: 'تم حذف الفصل بنجاح' });
    }
    catch (error) {
        if (error.message === 'الفصل غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في حذف الفصل', error: error.message });
    }
});
