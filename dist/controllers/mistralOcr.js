"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const mistralOcr_1 = require("../services/mistralOcr");
const mistralQuestionExtraction_1 = require("../services/mistralQuestionExtraction");
const questionExtractionImport_1 = require("../services/questionExtractionImport");
const mistralQuestionExtraction_2 = require("../types/mistralQuestionExtraction");
exports.router = (0, express_1.Router)();
const uploadDir = node_path_1.default.join(process.cwd(), 'uploads/mistral-ocr');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = node_path_1.default.extname(file.originalname || '');
            cb(null, `mistral-ocr-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    }),
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 1,
    },
    fileFilter: (_req, file, cb) => {
        if (mistralOcr_1.MistralOcrService.isSupportedMime(file.mimetype))
            cb(null, true);
        else
            cb(new Error('يسمح برفع PDF أو صورة فقط'));
    },
});
const ImportQuestionBankV2Schema = zod_1.z.object({
    lesson_id: zod_1.z.coerce.number().int().positive(),
    extraction: mistralQuestionExtraction_2.MistralQuestionExtractionSchema,
});
function parseBooleanField(value) {
    if (value === true || value === 'true' || value === '1' || value === 1)
        return true;
    return false;
}
function cleanupFile(file) {
    if (!file?.path)
        return;
    node_fs_1.default.promises.unlink(file.path).catch(() => undefined);
}
exports.router.post('/extract-text', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({
            success: false,
            message: 'يجب رفع ملف واحد في الحقل file (PDF أو صورة)',
        });
    }
    try {
        const data = await mistralOcr_1.MistralOcrService.extractTextFromFile(file);
        return res.json({ success: true, data });
    }
    finally {
        cleanupFile(file);
    }
}));
exports.router.post('/extract-questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const file = req.file;
    if (!file) {
        return res.status(400).json({
            success: false,
            message: 'يجب رفع ملف واحد في الحقل file (PDF أو صورة)',
        });
    }
    const inferCorrectAnswer = parseBooleanField(req.body.infer_correct_answer ?? req.query.infer_correct_answer);
    const includeQuestionImages = req.body.include_question_images === undefined &&
        req.query.include_question_images === undefined
        ? true
        : parseBooleanField(req.body.include_question_images ?? req.query.include_question_images);
    try {
        const data = await mistralQuestionExtraction_1.MistralQuestionExtractionService.extractQuestionsFromFile(file, {
            inferCorrectAnswer,
            includeQuestionImages,
        });
        return res.json({ success: true, data });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                message: 'OCR provider returned invalid question JSON',
                errors: error.errors,
            });
        }
        throw error;
    }
    finally {
        cleanupFile(file);
    }
}));
exports.router.post('/import-question-bank-v2', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = ImportQuestionBankV2Schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: parsed.error.errors,
        });
    }
    const result = await questionExtractionImport_1.QuestionExtractionImportService.importToQuestionBankV2({
        lessonId: parsed.data.lesson_id,
        teacherId: req.user.id,
        userRole: req.user.role,
        extraction: parsed.data.extraction,
    });
    return res.status(201).json({
        success: true,
        message: `تم استيراد ${result.questions.length} سؤال`,
        data: result,
    });
}));
