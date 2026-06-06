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
const lessonsAdmin_1 = require("../services/lessonsAdmin");
const questionBankChangeRequests_1 = require("../services/questionBankChangeRequests");
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads/lessons';
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = (0, multer_1.default)({ storage });
const router = (0, express_1.Router)();
exports.router = router;
// router.use(authMiddleware(['admin'])); // Disabled for more granular access below
// GET /api/chapters/:chapterId/lessons (list)
router.get('/chapters/:chapterId/lessons', (0, authentication_1.authMiddleware)(['admin', 'employee']), async (req, res) => {
    try {
        const chapterId = Number(req.params.chapterId);
        if (Number.isNaN(chapterId))
            return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
        const lessons = await lessonsAdmin_1.AdminLessonService.getByChapterId(chapterId);
        return res.status(200).json({ success: true, data: lessons });
    }
    catch (error) {
        if (error.message === 'الفصل غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في جلب الدروس', error: error.message });
    }
});
// POST /api/chapters/:chapterId/lessons
router.post('/chapters/:chapterId/lessons', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const chapterId = Number(req.params.chapterId);
        if (Number.isNaN(chapterId))
            return res.status(400).json({ success: false, message: 'معرف الفصل غير صحيح' });
        if (!req.body.name)
            return res.status(400).json({ success: false, message: 'حقل الاسم مطلوب' });
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const adminId = req.user?.id;
        const lesson = await lessonsAdmin_1.AdminLessonService.create(chapterId, { name: req.body.name, description: req.body.description, image_url }, adminId);
        return res.status(201).json({ success: true, message: 'تم إنشاء الدرس بنجاح', data: lesson });
    }
    catch (error) {
        if (error.message === 'الفصل غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        if (error.code === '23505' || error.message?.includes('بنفس الاسم'))
            return res
                .status(409)
                .json({ success: false, message: 'يوجد درس بنفس الاسم داخل نفس الفصل' });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في إنشاء الدرس', error: error.message });
    }
});
// PUT /api/lessons/:id
router.put('/lessons/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), upload.single('image'), async (req, res) => {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        if (Number.isNaN(id))
            return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const updatePayload = {
            name: req.body.name,
            description: req.body.description,
            image_url,
        };
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'lesson',
                entityId: id,
                action: 'update',
                payload: updatePayload,
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب تعديل الدرس للأدمن للموافقة',
                data: request,
            });
        }
        const updated = await lessonsAdmin_1.AdminLessonService.update(id, updatePayload);
        return res.status(200).json({ success: true, message: 'تم تعديل الدرس بنجاح', data: updated });
    }
    catch (error) {
        if (error.message === 'الدرس غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        if (error.code === '23505' || error.message?.includes('بنفس الاسم'))
            return res
                .status(409)
                .json({ success: false, message: 'يوجد درس بنفس الاسم داخل نفس الفصل' });
        if (error.message === 'لا توجد بيانات للتحديث')
            return res.status(400).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في تعديل الدرس', error: error.message });
    }
});
// DELETE /api/lessons/:id
router.delete('/lessons/:id', (0, authentication_1.authMiddleware)(['admin', 'employee']), (0, permissions_1.checkPermission)('question_bank_management'), async (req, res) => {
    try {
        const user = req.user;
        const id = Number(req.params.id);
        if (Number.isNaN(id))
            return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
        if (user.role === 'employee') {
            const request = await (0, questionBankChangeRequests_1.createQuestionBankChangeRequest)({
                entityType: 'lesson',
                entityId: id,
                action: 'delete',
                requestedBy: user.id,
            });
            return res.status(202).json({
                success: true,
                message: 'تم إرسال طلب حذف الدرس للأدمن للموافقة',
                data: request,
            });
        }
        await lessonsAdmin_1.AdminLessonService.delete(id);
        return res.status(200).json({ success: true, message: 'تم حذف الدرس بنجاح' });
    }
    catch (error) {
        if (error.message === 'الدرس غير موجود')
            return res.status(404).json({ success: false, message: error.message });
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في حذف الدرس', error: error.message });
    }
});
