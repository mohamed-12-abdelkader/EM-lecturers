import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { requireTeacherPlanFeature } from '../middleware/teacherPlanGate';
import { asyncWrapper } from '../utils';
import { TeacherCreativeChatbotService } from '../services/teacherCreativeChatbot';
import {
  buildPlanFeatureAccess,
  getTeacherPackage,
} from '../services/teacherPlanPolicy';
import {
  DEFAULT_TEACHER_CREATIVE_LANGUAGE,
  TEACHER_CREATIVE_ASPECT_RATIOS,
  TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE,
  TEACHER_CREATIVE_LANGUAGES,
  TEACHER_CREATIVE_PLATFORMS,
  TEACHER_CREATIVE_TONES,
} from '../services/teacherCreative.prompts';

export const router = Router();

const planGateCreative = requireTeacherPlanFeature('creative_social');

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

const ChatSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.coerce.number().int().positive().optional(),
  preferred_output: z.enum(['post', 'image', 'auto']).optional(),
  platform: z.string().optional(),
  tone: z.string().optional(),
  aspect_ratio: z.string().optional(),
  language_mode: z.string().optional(),
  force_execute: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    }
    return value;
  }, z.boolean().optional()),
  edit_last_design: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
    }
    return value;
  }, z.boolean().optional()),
});

const ExecuteSchema = z.object({
  session_id: z.coerce.number().int().positive(),
  request_type: z.enum(['post', 'image']).optional(),
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
  asyncWrapper(async (req, res) => {
    const pkg = await getTeacherPackage(req.user!.id);
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
      chat_mode: {
        enabled: true,
        discuss_first: true,
        welcome_message: TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE,
        execute_keywords: ['نفّذ', 'نفذ', 'موافق', 'اعمل', 'ولّد'],
      },
      uploads: {
        field_name: 'references',
        max_files: TeacherCreativeChatbotService.MAX_REFERENCE_FILES,
        max_file_size_mb: 8,
        allowed_types: ['image/*'],
      },
      plan_access: buildPlanFeatureAccess(req.user!.id, pkg, 'creative_social'),
    });
  }),
);

router.post(
  '/chat',
  authMiddleware(['teacher']),
  planGateCreative,
  referenceUpload.array('references', TeacherCreativeChatbotService.MAX_REFERENCE_FILES),
  asyncWrapper(async (req, res) => {
    const files = ((req.files || []) as Express.Multer.File[]) || [];
    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupUploadedFiles(files);
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    try {
      const result = await TeacherCreativeChatbotService.chat(req.user!.id, {
        message: parsed.data.message,
        sessionId: parsed.data.session_id,
        preferredOutput: parsed.data.preferred_output,
        platform: parsed.data.platform,
        tone: parsed.data.tone,
        aspectRatio: parsed.data.aspect_ratio,
        languageMode: parsed.data.language_mode,
        forceExecute: parsed.data.force_execute,
        editLastDesign: parsed.data.edit_last_design,
        referenceFiles: files,
      });

      res.json({
        message: result.executed ? 'تم التنفيذ بنجاح' : 'تم الرد بنجاح',
        ...result,
        post_text: result.generation?.generated_text || result.draft_post || null,
        image_url: result.generation?.generated_image_url || null,
      });
    } catch (error) {
      await cleanupUploadedFiles(files);
      throw error;
    }
  }),
);

router.post(
  '/chat/execute',
  authMiddleware(['teacher']),
  planGateCreative,
  referenceUpload.array('references', TeacherCreativeChatbotService.MAX_REFERENCE_FILES),
  asyncWrapper(async (req, res) => {
    const files = ((req.files || []) as Express.Multer.File[]) || [];
    const parsed = ExecuteSchema.safeParse(req.body);
    if (!parsed.success) {
      await cleanupUploadedFiles(files);
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    try {
      const result = await TeacherCreativeChatbotService.executePendingChat(req.user!.id, {
        sessionId: parsed.data.session_id,
        requestType: parsed.data.request_type,
        editLastDesign: parsed.data.edit_last_design,
        referenceFiles: files,
      });

      res.status(201).json({
        message: 'تم التنفيذ بنجاح',
        ...result,
        post_text: result.generation?.generated_text || null,
        image_url: result.generation?.generated_image_url || null,
      });
    } catch (error) {
      await cleanupUploadedFiles(files);
      const message = error instanceof Error ? error.message : 'تعذر التنفيذ';
      return res.status(400).json({ success: false, message });
    }
  }),
);

router.post(
  '/chat/new',
  authMiddleware(['teacher']),
  planGateCreative,
  asyncWrapper(async (req, res) => {
    const active = await TeacherCreativeChatbotService.getActiveChatSession(req.user!.id);
    if (active) {
      await TeacherCreativeChatbotService.archiveChatSession(req.user!.id, active.id);
    }
    const session = await TeacherCreativeChatbotService.createChatSession(req.user!.id, {
      preferredOutput:
        typeof req.body?.preferred_output === 'string' ? req.body.preferred_output : undefined,
      platform: typeof req.body?.platform === 'string' ? req.body.platform : undefined,
      tone: typeof req.body?.tone === 'string' ? req.body.tone : undefined,
      aspectRatio: typeof req.body?.aspect_ratio === 'string' ? req.body.aspect_ratio : undefined,
      languageMode:
        typeof req.body?.language_mode === 'string' ? req.body.language_mode : undefined,
    });

    res.status(201).json({
      message: 'تم بدء محادثة جديدة',
      session_id: session.id,
      welcome_message: TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE,
      session,
    });
  }),
);

router.get(
  '/chat/messages',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const sessionId = Number(req.query.session_id);
    if (!Number.isInteger(sessionId) || sessionId <= 0) {
      return res.status(400).json({ message: 'session_id مطلوب' });
    }
    const session = await TeacherCreativeChatbotService.getChatSessionById(req.user!.id, sessionId);
    if (!session) return res.status(404).json({ message: 'الجلسة غير موجودة' });

    const messages = await TeacherCreativeChatbotService.getChatMessages(req.user!.id, sessionId);
    const pending = (session.pending || {}) as Record<string, unknown>;
    const ready = Boolean(pending.ready_to_execute);
    res.json({
      session_id: session.id,
      session,
      welcome_message: TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE,
      messages,
      pending,
      actions: {
        can_execute: ready,
        can_generate_post: ready && pending.suggested_action !== 'generate_image',
        can_generate_image: ready && pending.suggested_action !== 'generate_post',
      },
    });
  }),
);

router.post(
  '/posts',
  authMiddleware(['teacher']),
  planGateCreative,
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
  planGateCreative,
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
