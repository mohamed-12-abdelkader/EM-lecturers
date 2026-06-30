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
const MAX_UPLOAD_FILES = 20;
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = node_path_1.default.extname(file.originalname || '');
            cb(null, `mistral-ocr-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    }),
    limits: {
        fileSize: 50 * 1024 * 1024,
        files: MAX_UPLOAD_FILES,
    },
    fileFilter: (_req, file, cb) => {
        try {
            mistralOcr_1.MistralOcrService.resolveSupportedMime(file);
            cb(null, true);
        }
        catch {
            cb(new Error('يسمح برفع PDF أو صورة فقط'));
        }
    },
});
const uploadExtract = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'files', maxCount: MAX_UPLOAD_FILES },
]);
const ImportQuestionBankV2Schema = zod_1.z
    .object({
    lesson_id: zod_1.z.coerce.number().int().positive(),
})
    .passthrough();
function parseBooleanField(value) {
    if (value === true || value === 1)
        return true;
    if (typeof value === 'string') {
        const v = value.trim().toLowerCase();
        return v === 'true' || v === '1' || v === 'yes';
    }
    return false;
}
function parseOptionalInt(value) {
    if (value == null || value === '')
        return undefined;
    const n = Number(value);
    if (!Number.isFinite(n))
        return undefined;
    return Math.trunc(n);
}
function collectUploadedFiles(req) {
    const collected = [];
    if (req.file) {
        collected.push(req.file);
    }
    const filesField = req.files;
    if (Array.isArray(filesField)) {
        collected.push(...filesField);
    }
    else if (filesField && typeof filesField === 'object') {
        for (const arr of Object.values(filesField)) {
            if (Array.isArray(arr))
                collected.push(...arr);
        }
    }
    const seen = new Set();
    return collected.filter((file) => {
        const key = file.path || `${file.originalname}-${file.size}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function cleanupFiles(files) {
    for (const file of files) {
        if (!file?.path)
            continue;
        node_fs_1.default.promises.unlink(file.path).catch(() => undefined);
    }
}
function handleOcrError(res, error) {
    if (error instanceof utils_1.HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
    }
    if (error instanceof zod_1.z.ZodError) {
        return res.status(400).json({
            success: false,
            message: 'OCR provider returned invalid question JSON',
            errors: error.errors,
        });
    }
    const msg = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
    if (msg === 'MISTRAL_API_KEY_MISSING') {
        return res.status(503).json({ success: false, message: 'MISTRAL_API_KEY غير مُعد في البيئة' });
    }
    throw error;
}
function parseExtractionOptions(req) {
    const inferCorrectAnswer = parseBooleanField(req.body.infer_correct_answer ?? req.query.infer_correct_answer);
    const includeQuestionImages = req.body.include_question_images === undefined &&
        req.query.include_question_images === undefined
        ? true
        : parseBooleanField(req.body.include_question_images ?? req.query.include_question_images);
    return {
        inferCorrectAnswer,
        includeQuestionImages,
        startPage: parseOptionalInt(req.body.start_page ?? req.query.start_page),
        endPage: parseOptionalInt(req.body.end_page ?? req.query.end_page),
    };
}
async function runOcrExtraction(files, options) {
    const pdfCount = files.filter((f) => mistralOcr_1.MistralOcrService.resolveSupportedMime(f).includes('pdf')).length;
    if (pdfCount > 0 && (options.startPage != null || options.endPage != null)) {
        (0, mistralOcr_1.parsePdfPageRange)(options.startPage, options.endPage);
    }
    if (files.length === 1) {
        return mistralOcr_1.MistralOcrService.extractTextFromFile(files[0], {
            pages: pdfCount > 0 ? (0, mistralOcr_1.parsePdfPageRange)(options.startPage, options.endPage) : undefined,
        });
    }
    if (pdfCount > 0) {
        throw new utils_1.HttpError(400, 'ارفع ملف PDF واحد فقط — للصور استخدم الحقل files');
    }
    return mistralOcr_1.MistralOcrService.extractTextFromFiles(files);
}
exports.router.post('/extract-text', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), uploadExtract, (0, utils_1.asyncWrapper)(async (req, res) => {
    const files = collectUploadedFiles(req);
    if (files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'يجب رفع ملف في file أو صور متعددة في files',
        });
    }
    const options = parseExtractionOptions(req);
    try {
        const data = await runOcrExtraction(files, options);
        return res.json({ success: true, data });
    }
    catch (error) {
        const handled = handleOcrError(res, error);
        if (handled)
            return handled;
        throw error;
    }
    finally {
        cleanupFiles(files);
    }
}));
exports.router.post('/extract-questions', (0, authentication_1.authMiddleware)(['teacher', 'admin', 'employee']), uploadExtract, (0, utils_1.asyncWrapper)(async (req, res) => {
    const files = collectUploadedFiles(req);
    if (files.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'يجب رفع ملف PDF في file أو صور متعددة في files',
        });
    }
    const options = parseExtractionOptions(req);
    try {
        const data = await mistralQuestionExtraction_1.MistralQuestionExtractionService.extractQuestionsFromFiles(files, {
            inferCorrectAnswer: options.inferCorrectAnswer,
            includeQuestionImages: options.includeQuestionImages,
            startPage: options.startPage,
            endPage: options.endPage,
        });
        return res.json({ success: true, data });
    }
    catch (error) {
        const handled = handleOcrError(res, error);
        if (handled)
            return handled;
        throw error;
    }
    finally {
        cleanupFiles(files);
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
    let payload;
    try {
        payload = (0, mistralQuestionExtraction_2.parseQuestionExtractionImportPayload)(req.body);
        mistralQuestionExtraction_2.MistralQuestionExtractionSchema.parse(payload.extraction);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: error.errors,
            });
        }
        return res.status(400).json({
            success: false,
            message: 'صيغة بيانات الاستخراج غير صحيحة',
        });
    }
    const result = await questionExtractionImport_1.QuestionExtractionImportService.importToQuestionBankV2({
        lessonId: parsed.data.lesson_id,
        teacherId: req.user.id,
        userRole: req.user.role,
        extraction: payload.extraction,
    });
    return res.status(201).json({
        success: true,
        message: `تم استيراد ${result.questions.length} سؤال`,
        data: (0, questionExtractionImport_1.buildImportExtractionResponse)(payload.meta, result),
    });
}));
