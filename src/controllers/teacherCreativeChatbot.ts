import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { TeacherCreativeChatbotService } from '../services/teacherCreativeChatbot';
import {
  DEFAULT_TEACHER_CREATIVE_LANGUAGE,
  TEACHER_CREATIVE_ASPECT_RATIOS,
  TEACHER_CREATIVE_LANGUAGES,
  TEACHER_CREATIVE_PLATFORMS,
  TEACHER_CREATIVE_TONES,
} from '../services/teacherCreative.prompts';

export const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads/teacher-creative-references');
fs.mkdirSync(uploadDir, { recursive: true });

const referenceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '');
      cb(null, `teacher-creative-ref-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
    },
  }),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: TeacherCreativeChatbotService.MAX_REFERENCE_FILES,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('يسمح برفع صور فقط كمرجع للتصميم'));
  },
});

const PostSchema = z.object({
  prompt: z.string().min(1).max(3000),
  platform: z.string().optional(),
  tone: z.string().optional(),
});

const ImageSchema = z.object({
  prompt: z.string().min(1).max(3000),
  platform: z.string().optional(),
  aspect_ratio: z.string().optional(),
  language_mode: z.string().optional(),
  language: z.string().optional(),
  edit_last_design: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    }
    return value;
  }, z.boolean().optional()),
});

async function cleanupUploadedFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
}

router.get(
  '/options',
  authMiddleware(['teacher']),
  asyncWrapper(async (_req, res) => {
    res.json({
      request_types: [
        { value: 'post', label_ar: 'منشور نصي' },
        { value: 'image', label_ar: 'تصميم صورة' },
      ],
      platforms: TEACHER_CREATIVE_PLATFORMS,
      tones: TEACHER_CREATIVE_TONES,
      aspect_ratios: TEACHER_CREATIVE_ASPECT_RATIOS,
      languages: TEACHER_CREATIVE_LANGUAGES,
      default_language: DEFAULT_TEACHER_CREATIVE_LANGUAGE,
      uploads: {
        field_name: 'references',
        max_files: TeacherCreativeChatbotService.MAX_REFERENCE_FILES,
        max_file_size_mb: 8,
        allowed_types: ['image/*'],
      },
    });
  }),
);

router.post(
  '/posts',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const parsed = PostSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const generation = await TeacherCreativeChatbotService.generatePost(req.user!.id, parsed.data);
    res.status(201).json({
      message: 'تم توليد المنشور بنجاح',
      generation,
      post_text: generation.generated_text,
    });
  }),
);

router.post(
  '/images',
  authMiddleware(['teacher']),
  referenceUpload.array('references', TeacherCreativeChatbotService.MAX_REFERENCE_FILES),
  asyncWrapper(async (req, res) => {
    const files = ((req.files || []) as Express.Multer.File[]) || [];
    const parsed = ImageSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupUploadedFiles(files);
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const generation = await TeacherCreativeChatbotService.generateImage(
      req.user!.id,
      parsed.data,
      files,
    );

    res.status(201).json({
      message: 'تم توليد الصورة بنجاح',
      generation,
      image_url: generation.generated_image_url,
      references: generation.references,
    });
  }),
);

router.get(
  '/history',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 20;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    const result = await TeacherCreativeChatbotService.getHistory(req.user!.id, limit, offset);

    res.json({
      generations: result.generations,
      pagination: {
        limit: Math.min(Math.max(Number(limit) || 20, 1), 100),
        offset: Math.max(Number(offset) || 0, 0),
        total: result.total,
        has_more:
          result.total >
          Math.max(Number(offset) || 0, 0) + Math.min(Math.max(Number(limit) || 20, 1), 100),
      },
    });
  }),
);

router.get(
  '/generations/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const generation = await TeacherCreativeChatbotService.getGenerationById(
      req.user!.id,
      Number(req.params.id),
    );
    if (!generation) return res.status(404).json({ message: 'Generation not found' });
    res.json({ generation });
  }),
);
