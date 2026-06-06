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
const utils_1 = require("../utils");
const questionBank_1 = require("../db/types/questionBank");
const subjects_1 = require("../services/subjects");
// Multer setup for optional image upload
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
const permissions_1 = require("../middleware/permissions");
// Admin or employee with permission
router.use((0, authentication_1.authMiddleware)(['admin', 'employee']));
router.use((0, permissions_1.checkPermission)('question_bank_management'));
// POST /api/question-banks/:bankId/subjects (create)
router.post('/:bankId/subjects', upload.single('image'), async (req, res) => {
    try {
        const bankId = Number(req.params.bankId);
        if (Number.isNaN(bankId)) {
            return res.status(400).json({ success: false, message: 'معرف بنك الأسئلة غير صحيح' });
        }
        let image_url;
        const file = req.file;
        if (file)
            image_url = (await (0, utils_1.uploadToCloudinary)(file.path)).secure_url;
        const validated = questionBank_1.CreateSubjectSchema.parse({ ...req.body, image_url });
        const adminId = req.user?.id;
        const subject = await subjects_1.SubjectService.create(bankId, validated, adminId);
        return res.status(201).json({
            success: true,
            message: 'تم إنشاء المادة بنجاح',
            data: subject,
        });
    }
    catch (error) {
        if (error.name === 'ZodError') {
            return res
                .status(400)
                .json({ success: false, message: 'بيانات غير صحيحة', errors: error.errors });
        }
        if (error.message === 'بنك الأسئلة غير موجود') {
            return res.status(404).json({ success: false, message: error.message });
        }
        if (error.code === '23505' || error.message?.includes('موجودة بالفعل')) {
            return res
                .status(409)
                .json({ success: false, message: 'يوجد مادة بنفس الاسم داخل نفس بنك الأسئلة' });
        }
        return res
            .status(500)
            .json({ success: false, message: 'خطأ في إنشاء المادة', error: error.message });
    }
});
