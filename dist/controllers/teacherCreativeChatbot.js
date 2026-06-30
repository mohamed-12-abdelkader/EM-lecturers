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
const teacherPlanGate_1 = require("../middleware/teacherPlanGate");
const utils_1 = require("../utils");
const teacherCreativeChatbot_1 = require("../services/teacherCreativeChatbot");
const teacherPlanPolicy_1 = require("../services/teacherPlanPolicy");
const teacherCreative_prompts_1 = require("../services/teacherCreative.prompts");
exports.router = (0, express_1.Router)();
const planGateCreative = (0, teacherPlanGate_1.requireTeacherPlanFeature)('creative_social');
const uploadDir = node_path_1.default.join(process.cwd(), 'uploads/teacher-creative-references');
node_fs_1.default.mkdirSync(uploadDir, { recursive: true });
const referenceUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => cb(null, uploadDir),
        filename: (_req, file, cb) => {
            const ext = node_path_1.default.extname(file.originalname || '');
            cb(null, `teacher-creative-ref-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
        },
    }),
    limits: {
        fileSize: 8 * 1024 * 1024,
        files: teacherCreativeChatbot_1.TeacherCreativeChatbotService.MAX_REFERENCE_FILES,
    },
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/'))
            cb(null, true);
        else
            cb(new Error('يسمح برفع صور فقط كمرجع للتصميم'));
    },
});
const PostSchema = zod_1.z.object({
    prompt: zod_1.z.string().min(1).max(3000),
    platform: zod_1.z.string().optional(),
    tone: zod_1.z.string().optional(),
});
const ImageSchema = zod_1.z.object({
    prompt: zod_1.z.string().min(1).max(3000),
    platform: zod_1.z.string().optional(),
    aspect_ratio: zod_1.z.string().optional(),
    language_mode: zod_1.z.string().optional(),
    language: zod_1.z.string().optional(),
    edit_last_design: zod_1.z.preprocess((value) => {
        if (value === undefined || value === null || value === '')
            return undefined;
        if (typeof value === 'boolean')
            return value;
        if (typeof value === 'string') {
            return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
        }
        return value;
    }, zod_1.z.boolean().optional()),
});
async function cleanupUploadedFiles(files) {
    await Promise.all(files.map((file) => node_fs_1.default.promises.unlink(file.path).catch(() => undefined)));
}
exports.router.get('/options', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const pkg = await (0, teacherPlanPolicy_1.getTeacherPackage)(req.user.id);
    res.json({
        request_types: [
            { value: 'post', label_ar: 'منشور نصي' },
            { value: 'image', label_ar: 'تصميم صورة' },
        ],
        platforms: teacherCreative_prompts_1.TEACHER_CREATIVE_PLATFORMS,
        tones: teacherCreative_prompts_1.TEACHER_CREATIVE_TONES,
        aspect_ratios: teacherCreative_prompts_1.TEACHER_CREATIVE_ASPECT_RATIOS,
        languages: teacherCreative_prompts_1.TEACHER_CREATIVE_LANGUAGES,
        default_language: teacherCreative_prompts_1.DEFAULT_TEACHER_CREATIVE_LANGUAGE,
        uploads: {
            field_name: 'references',
            max_files: teacherCreativeChatbot_1.TeacherCreativeChatbotService.MAX_REFERENCE_FILES,
            max_file_size_mb: 8,
            allowed_types: ['image/*'],
        },
        plan_access: (0, teacherPlanPolicy_1.buildPlanFeatureAccess)(req.user.id, pkg, 'creative_social'),
    });
}));
exports.router.post('/posts', (0, authentication_1.authMiddleware)(['teacher']), planGateCreative, (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = PostSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const generation = await teacherCreativeChatbot_1.TeacherCreativeChatbotService.generatePost(req.user.id, parsed.data);
    res.status(201).json({
        message: 'تم توليد المنشور بنجاح',
        generation,
        post_text: generation.generated_text,
    });
}));
exports.router.post('/images', (0, authentication_1.authMiddleware)(['teacher']), planGateCreative, referenceUpload.array('references', teacherCreativeChatbot_1.TeacherCreativeChatbotService.MAX_REFERENCE_FILES), (0, utils_1.asyncWrapper)(async (req, res) => {
    const files = (req.files || []) || [];
    const parsed = ImageSchema.safeParse(req.body);
    if (!parsed.success) {
        await cleanupUploadedFiles(files);
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const generation = await teacherCreativeChatbot_1.TeacherCreativeChatbotService.generateImage(req.user.id, parsed.data, files);
    res.status(201).json({
        message: 'تم توليد الصورة بنجاح',
        generation,
        image_url: generation.generated_image_url,
        references: generation.references,
    });
}));
exports.router.get('/history', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    const result = await teacherCreativeChatbot_1.TeacherCreativeChatbotService.getHistory(req.user.id, limit, offset);
    res.json({
        generations: result.generations,
        pagination: {
            limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
            offset: Math.max(Number(offset) || 0, 0),
            total: result.total,
            has_more: result.total >
                Math.max(Number(offset) || 0, 0) + Math.min(Math.max(Number(limit) || 20, 1), 100),
        },
    });
}));
exports.router.get('/generations/:id', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const generation = await teacherCreativeChatbot_1.TeacherCreativeChatbotService.getGenerationById(req.user.id, Number(req.params.id));
    if (!generation)
        return res.status(404).json({ message: 'Generation not found' });
    res.json({ generation });
}));
