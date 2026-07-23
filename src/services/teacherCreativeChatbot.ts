import fs from 'node:fs';
import path from 'node:path';
import { Blob } from 'node:buffer';
import pool from '../db/pool';
import { config, logger, uploadBufferToCloudinary, uploadToCloudinary } from '../utils';
import {
  TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE,
  buildTeacherCreativeChatSystemPrompt,
  buildTeacherCreativeChatUserPrompt,
  buildTeacherImagePrompt,
  buildTeacherPostSystemPrompt,
  buildTeacherPostUserPrompt,
  normalizeTeacherCreativeAspectRatio,
  normalizeTeacherCreativeLanguageMode,
  normalizeTeacherCreativePlatform,
  normalizeTeacherCreativeTone,
  type TeacherCreativeAspectRatio,
  type TeacherCreativeLanguageMode,
  type TeacherCreativePlatform,
  type TeacherCreativeTone,
} from './teacherCreative.prompts';

type GenerationRequestType = 'post' | 'image';

type TeacherCreativeGeneration = {
  id: number;
  teacher_id: number;
  request_type: GenerationRequestType;
  prompt: string;
  platform: string | null;
  tone: string | null;
  aspect_ratio: string | null;
  language_mode: TeacherCreativeLanguageMode | null;
  edited_generation_id: number | null;
  status: 'processing' | 'completed' | 'failed';
  generated_text: string | null;
  generated_image_url: string | null;
  provider: string | null;
  provider_model: string | null;
  provider_response: Record<string, unknown>;
  logo_path: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

type TeacherImageContext = {
  teacherName: string | null;
  profileSubject: string | null;
  avatarUrl: string | null;
  assignedSubjects: string[];
  subjectImageUrls: string[];
};

type LatestImageGeneration = {
  id: number;
  generated_image_url: string;
  aspect_ratio: string | null;
};

type CreativeSuggestedAction = 'none' | 'generate_post' | 'generate_image';

type CreativeChatPending = {
  ideas?: string[];
  draft_post?: string | null;
  image_concept?: string | null;
  suggested_action?: CreativeSuggestedAction;
  execution_prompt?: string | null;
  ready_to_execute?: boolean;
  platform?: string | null;
  tone?: string | null;
  aspect_ratio?: string | null;
  language_mode?: string | null;
  preferred_output?: 'post' | 'image' | 'auto' | null;
};

type CreativeChatSession = {
  id: number;
  teacher_id: number;
  status: 'active' | 'archived';
  preferred_output: 'post' | 'image' | 'auto' | null;
  platform: string | null;
  tone: string | null;
  aspect_ratio: string | null;
  language_mode: string | null;
  pending: CreativeChatPending;
  created_at: Date;
  updated_at: Date;
};

type CreativeChatMessage = {
  id: number;
  session_id: number;
  teacher_id: number;
  role: 'user' | 'assistant';
  message: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

type CreativeChatAiPayload = {
  reply: string;
  ideas: string[];
  draft_post: string | null;
  image_concept: string | null;
  suggested_action: CreativeSuggestedAction;
  execution_prompt: string | null;
  needs_more_info: boolean;
  ready_to_execute: boolean;
};

export type CreativeChatResult = {
  reply: string;
  session_id: number;
  ideas: string[];
  draft_post: string | null;
  image_concept: string | null;
  suggested_action: CreativeSuggestedAction;
  ready_to_execute: boolean;
  executed: boolean;
  generation: TeacherCreativeGeneration | null;
  actions: {
    can_execute: boolean;
    can_generate_post: boolean;
    can_generate_image: boolean;
  };
};

function normalizePrompt(prompt: string): string {
  const value = String(prompt || '').trim();
  if (!value) throw new Error('البرومبت مطلوب');
  if (value.length > 3000) throw new Error('البرومبت طويل جداً');
  return value;
}

function resolveLogoPath(): string {
  if (!config.TEACHER_CREATIVE_LOGO_PATH) {
    throw new Error('TEACHER_CREATIVE_LOGO_PATH is required for image generation');
  }
  const resolved = path.isAbsolute(config.TEACHER_CREATIVE_LOGO_PATH)
    ? config.TEACHER_CREATIVE_LOGO_PATH
    : path.resolve(process.cwd(), config.TEACHER_CREATIVE_LOGO_PATH);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Logo file not found: ${config.TEACHER_CREATIVE_LOGO_PATH}`);
  }
  return resolved;
}

function getImageMimeType(filePath: string, fallback = 'image/png'): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.png') return 'image/png';
  return fallback;
}

function getOpenAIImageSize(
  aspectRatio: TeacherCreativeAspectRatio,
): '1024x1024' | '1024x1536' | '1536x1024' {
  if (aspectRatio === '16:9') return '1536x1024';
  if (aspectRatio === '4:5' || aspectRatio === '9:16') return '1024x1536';
  return '1024x1024';
}

function sanitizeOpenAIImageResponse(payload: any): Record<string, unknown> {
  const data = Array.isArray(payload?.data)
    ? payload.data.map((item: any) => ({
        revised_prompt: item?.revised_prompt || null,
        has_b64_json: typeof item?.b64_json === 'string' && item.b64_json.length > 0,
        has_url: typeof item?.url === 'string' && item.url.length > 0,
      }))
    : [];

  return {
    created: payload?.created || null,
    usage: payload?.usage || null,
    data,
  };
}

async function appendImageFileToFormData(
  formData: FormData,
  fieldName: string,
  filePath: string,
  filename: string,
  mimeType?: string,
): Promise<void> {
  const buffer = await fs.promises.readFile(filePath);
  formData.append(
    fieldName,
    new Blob([buffer], { type: mimeType || getImageMimeType(filePath) }),
    filename,
  );
}

function filenameFromUrl(imageUrl: string, fallback: string): string {
  try {
    const parsed = new URL(imageUrl);
    const name = path.basename(parsed.pathname);
    return name && name.includes('.') ? name : fallback;
  } catch {
    return fallback;
  }
}

async function appendImageUrlToFormData(
  formData: FormData,
  fieldName: string,
  imageUrl: string,
  fallbackFilename: string,
): Promise<void> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image reference: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || 'image/png';
  if (!contentType.startsWith('image/')) {
    throw new Error(`Image reference is not an image: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  formData.append(
    fieldName,
    new Blob([buffer], { type: contentType }),
    filenameFromUrl(imageUrl, fallbackFilename),
  );
}

function isTruthyFormValue(value?: boolean | string): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function isLikelyEditRequest(prompt: string): boolean {
  const value = prompt.trim().toLowerCase();
  if (!value) return false;

  const englishPatterns = [
    /\b(last|previous|same)\s+(design|image|poster|creative)\b/i,
    /\b(edit|change|modify|update|adjust|replace|remove)\b.{0,40}\b(design|image|poster|creative|it|this|last|previous)\b/i,
    /\bmake\s+(it|this)\b/i,
  ];
  const arabicPatterns = [
    /(نفس|على نفس|زي|زى).{0,30}(التصميم|الصورة|البوست|البوستر)/,
    /(التصميم|الصورة|البوست|البوستر).{0,30}(السابق|الأخير|الاخير|اللي فات|القديمة|القديم)/,
    /(عدل|عدّل|تعديل|غيّر|غير|بدّل|بدل|استبدل|احذف|شيل).{0,40}(التصميم|الصورة|البوست|البوستر|ده|هذا|دي|دى|هذه|السابق|الأخير|الاخير)/,
  ];

  return [...englishPatterns, ...arabicPatterns].some((pattern) => pattern.test(value));
}

async function cleanupUploadedFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
}

function normalizePreferredOutput(value?: string | null): 'post' | 'image' | 'auto' {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'post' || normalized === 'image') return normalized;
  return 'auto';
}

function isExplicitExecuteRequest(message: string): boolean {
  const value = message.trim().toLowerCase();
  if (!value) return false;
  const patterns = [
    /^(نفذ|نفّذ|تنفيذ|يلا نفذ|يلا نفّذ|موافق|موافق نفذ|موافق نفّذ|اعمل|اعمله|اعملي|ولد|ولّد|انشئ|أنشئ|generate|execute|do it|go ahead)\b/i,
    /(نفذ|نفّذ|تنفيذ|ولد|ولّد).{0,20}(البوست|المنشور|التصميم|الصورة|الفكرة|المسودة)/,
    /(اعمل|اعمله|اعملي).{0,20}(البوست|المنشور|التصميم|الصورة|النهائي)/,
    /\b(generate|create|make)\s+(it|the\s+)?(post|image|design|final)\b/i,
  ];
  return patterns.some((pattern) => pattern.test(value));
}

function parseCreativeChatAiPayload(raw: string): CreativeChatAiPayload {
  const fallback: CreativeChatAiPayload = {
    reply: raw.trim() || 'تمام، قولي أكتر عن هدفك عشان أقترح أفكار مناسبة.',
    ideas: [],
    draft_post: null,
    image_concept: null,
    suggested_action: 'none',
    execution_prompt: null,
    needs_more_info: false,
    ready_to_execute: false,
  };

  try {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Partial<CreativeChatAiPayload>;
    const suggested = String(parsed.suggested_action || 'none').trim().toLowerCase();
    const suggestedAction: CreativeSuggestedAction =
      suggested === 'generate_post' || suggested === 'generate_image' ? suggested : 'none';

    return {
      reply: String(parsed.reply || fallback.reply).trim() || fallback.reply,
      ideas: Array.isArray(parsed.ideas)
        ? parsed.ideas.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
        : [],
      draft_post: parsed.draft_post ? String(parsed.draft_post).trim() : null,
      image_concept: parsed.image_concept ? String(parsed.image_concept).trim() : null,
      suggested_action: suggestedAction,
      execution_prompt: parsed.execution_prompt ? String(parsed.execution_prompt).trim() : null,
      needs_more_info: Boolean(parsed.needs_more_info),
      ready_to_execute: Boolean(parsed.ready_to_execute),
    };
  } catch {
    return fallback;
  }
}

function summarizePending(pending: CreativeChatPending | null | undefined): string {
  if (!pending || typeof pending !== 'object') return '';
  const parts: string[] = [];
  if (pending.draft_post) parts.push(`مسودة منشور:\n${pending.draft_post}`);
  if (pending.image_concept) parts.push(`فكرة تصميم:\n${pending.image_concept}`);
  if (pending.execution_prompt) parts.push(`برومبت التنفيذ:\n${pending.execution_prompt}`);
  if (pending.ideas?.length) parts.push(`أفكار:\n- ${pending.ideas.join('\n- ')}`);
  if (pending.suggested_action && pending.suggested_action !== 'none') {
    parts.push(`الإجراء المقترح: ${pending.suggested_action}`);
  }
  return parts.join('\n\n');
}

function buildActionsFromPending(pending: CreativeChatPending | null | undefined) {
  const suggested = pending?.suggested_action || 'none';
  const ready = Boolean(pending?.ready_to_execute);
  const hasPrompt = Boolean(
    pending?.execution_prompt || pending?.draft_post || pending?.image_concept,
  );

  const can_generate_post = ready && hasPrompt && suggested !== 'generate_image';
  const can_generate_image = ready && hasPrompt && suggested !== 'generate_post';

  return {
    can_execute: can_generate_post || can_generate_image,
    can_generate_post,
    can_generate_image,
  };
}

export class TeacherCreativeChatbotService {
  static readonly MAX_REFERENCE_FILES = 4;

  static async createGeneration(input: {
    teacherId: number;
    requestType: GenerationRequestType;
    prompt: string;
    platform?: string;
    tone?: string;
    aspectRatio?: string;
    languageMode?: TeacherCreativeLanguageMode;
    editedGenerationId?: number | null;
    provider?: string;
    providerModel?: string;
    logoPath?: string;
  }): Promise<TeacherCreativeGeneration> {
    const result = await pool.query<TeacherCreativeGeneration>(
      `INSERT INTO teacher_creative_generations
       (teacher_id, request_type, prompt, platform, tone, aspect_ratio, language_mode, edited_generation_id, provider, provider_model, logo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        input.teacherId,
        input.requestType,
        input.prompt,
        input.platform || null,
        input.tone || null,
        input.aspectRatio || null,
        input.languageMode || null,
        input.editedGenerationId || null,
        input.provider || null,
        input.providerModel || null,
        input.logoPath || null,
      ],
    );
    return result.rows[0];
  }

  static async completeGeneration(
    generationId: number,
    patch: {
      generatedText?: string;
      generatedImageUrl?: string;
      providerResponse?: unknown;
    },
  ): Promise<TeacherCreativeGeneration> {
    const result = await pool.query<TeacherCreativeGeneration>(
      `UPDATE teacher_creative_generations
       SET status = 'completed',
           generated_text = COALESCE($2, generated_text),
           generated_image_url = COALESCE($3, generated_image_url),
           provider_response = $4::jsonb,
           updated_at = NOW(),
           completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        generationId,
        patch.generatedText || null,
        patch.generatedImageUrl || null,
        JSON.stringify(patch.providerResponse || {}),
      ],
    );
    return result.rows[0];
  }

  static async failGeneration(generationId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await pool.query(
      `UPDATE teacher_creative_generations
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW(),
           completed_at = NOW()
       WHERE id = $1`,
      [generationId, message],
    );
  }

  static async callDeepSeekForPost(input: {
    prompt: string;
    platform: TeacherCreativePlatform;
    tone: TeacherCreativeTone;
  }): Promise<{ text: string; response: Record<string, unknown> }> {
    if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required');

    const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: buildTeacherPostSystemPrompt() },
          { role: 'user', content: buildTeacherPostUserPrompt(input) },
        ],
        temperature: 0.75,
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `DeepSeek post generation failed: ${response.status} ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as any;
    const text = payload.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error('DeepSeek returned empty post text');

    return {
      text,
      response: {
        id: payload.id,
        model: payload.model,
        usage: payload.usage,
      },
    };
  }

  static async generatePost(
    teacherId: number,
    input: { prompt: string; platform?: string; tone?: string },
  ): Promise<TeacherCreativeGeneration> {
    const prompt = normalizePrompt(input.prompt);
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const tone = normalizeTeacherCreativeTone(input.tone);

    const generation = await this.createGeneration({
      teacherId,
      requestType: 'post',
      prompt,
      platform,
      tone,
      provider: 'deepseek',
      providerModel: 'deepseek-chat',
    });

    try {
      const result = await this.callDeepSeekForPost({ prompt, platform, tone });
      return await this.completeGeneration(generation.id, {
        generatedText: result.text,
        providerResponse: result.response,
      });
    } catch (error) {
      await this.failGeneration(generation.id, error);
      throw error;
    }
  }

  /**
   * Uses DeepSeek to enhance the user's prompt with visual details for image generation.
   * Keeps the original idea intact but adds descriptive visual elements (colors, mood, composition, lighting).
   */
  static async callDeepSeekForPromptEnhancement(input: {
    prompt: string;
    aspectRatio: TeacherCreativeAspectRatio;
  }): Promise<string> {
    if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required');

    const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: `You are an assistant that enhances user prompts for AI image generation.

Rules:
- Keep the original idea intact — do NOT change the core message or topic.
- Add visual details: colors, lighting, composition, mood, atmosphere.
- Make the prompt vivid and descriptive, suitable for an image generation model.
- Write the enhanced prompt in English.
- Output ONLY the enhanced prompt text — no explanations, no introductions, no markdown.
- Keep it concise but rich (2-4 sentences).`,
          },
          {
            role: 'user',
            content: `Enhance this prompt for image generation:\n\n${input.prompt}`,
          },
        ],
        temperature: 0.6,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[TeacherCreativeChatbot] DeepSeek enhancement failed:', errBody);
      return input.prompt;
    }

    const payload = (await response.json()) as any;
    const enhanced = payload.choices?.[0]?.message?.content?.trim();
    if (!enhanced) {
      console.error('[TeacherCreativeChatbot] DeepSeek returned empty enhancement');
      return input.prompt;
    }

    return enhanced;
  }

  static async callOpenAIImageGeneration(input: {
    prompt: string;
    logoPath: string;
    referenceFiles: Express.Multer.File[];
    avatarUrl?: string | null;
    baseImageUrl?: string | null;
    aspectRatio: TeacherCreativeAspectRatio;
  }): Promise<{ buffer: Buffer; model: string; response: Record<string, unknown> }> {
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');

    const model = config.OPENAI_IMAGE_MODEL || 'gpt-image-2';
    const formData = new FormData();
    formData.append('model', model);
    formData.append('prompt', input.prompt);
    formData.append('n', '1');
    formData.append('size', getOpenAIImageSize(input.aspectRatio));
    formData.append('quality', 'high');

    if (input.baseImageUrl) {
      await appendImageUrlToFormData(
        formData,
        'image[]',
        input.baseImageUrl,
        'previous-design.png',
      );
    }

    await appendImageFileToFormData(
      formData,
      'image[]',
      input.logoPath,
      path.basename(input.logoPath),
    );

    for (const file of input.referenceFiles) {
      await appendImageFileToFormData(
        formData,
        'image[]',
        file.path,
        file.originalname || path.basename(file.path),
        file.mimetype,
      );
    }

    if (!input.referenceFiles.length && input.avatarUrl) {
      try {
        await appendImageUrlToFormData(formData, 'image[]', input.avatarUrl, 'teacher-avatar.png');
      } catch (error) {
        logger.warn(
          { error, avatar_url: input.avatarUrl },
          '[TeacherCreativeChatbot] Failed to attach teacher avatar reference',
        );
      }
    }

    const response = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(
        `OpenAI image generation failed: ${response.status} ${await response.text()}`,
      );
    }

    const payload = (await response.json()) as any;
    const firstImage = Array.isArray(payload.data) ? payload.data[0] : null;
    const b64Json = firstImage?.b64_json;
    const imageUrl = firstImage?.url;
    let buffer: Buffer | null = null;

    if (typeof b64Json === 'string' && b64Json.trim()) {
      buffer = Buffer.from(b64Json, 'base64');
    } else if (typeof imageUrl === 'string' && imageUrl.trim()) {
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to download OpenAI image: ${imageResponse.status}`);
      }
      buffer = Buffer.from(await imageResponse.arrayBuffer());
    }

    if (!buffer) throw new Error('OpenAI returned no image');

    return {
      buffer,
      model,
      response: sanitizeOpenAIImageResponse(payload),
    };
  }

  static async uploadReferenceFiles(
    generationId: number,
    teacherId: number,
    files: Express.Multer.File[],
  ) {
    const references = [];
    for (const file of files) {
      const uploaded = await uploadToCloudinary(file.path, { resource_type: 'image' });
      const result = await pool.query(
        `INSERT INTO teacher_creative_reference_files
         (generation_id, teacher_id, file_url, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          generationId,
          teacherId,
          uploaded.secure_url,
          file.originalname || null,
          file.mimetype || null,
          file.size || null,
        ],
      );
      references.push(result.rows[0]);
    }
    return references;
  }

  static async getTeacherImageContext(teacherId: number): Promise<TeacherImageContext> {
    const [teacherRes, subjectsRes] = await Promise.all([
      pool.query<{
        name: string | null;
        subject: string | null;
        avatar: string | null;
      }>(
        `SELECT name, subject, avatar
         FROM users
         WHERE id = $1 AND role = 'teacher'
         LIMIT 1`,
        [teacherId],
      ),
      pool.query<{
        subject_name: string | null;
        subject_image_url: string | null;
      }>(
        `SELECT s.name AS subject_name, s.image_url AS subject_image_url
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id
         WHERE ts.teacher_id = $1
         ORDER BY ts.assigned_at DESC, s.id ASC`,
        [teacherId],
      ),
    ]);

    const teacher = teacherRes.rows[0];
    return {
      teacherName: teacher?.name || null,
      profileSubject: teacher?.subject || null,
      avatarUrl: teacher?.avatar || null,
      assignedSubjects: subjectsRes.rows
        .map((row) => row.subject_name)
        .filter((subject): subject is string => Boolean(subject?.trim())),
      subjectImageUrls: subjectsRes.rows
        .map((row) => row.subject_image_url)
        .filter((imageUrl): imageUrl is string => Boolean(imageUrl?.trim())),
    };
  }

  static async getLatestCompletedImageGeneration(
    teacherId: number,
  ): Promise<LatestImageGeneration | null> {
    const result = await pool.query<LatestImageGeneration>(
      `SELECT id, generated_image_url, aspect_ratio
       FROM teacher_creative_generations
       WHERE teacher_id = $1
         AND request_type = 'image'
         AND status = 'completed'
         AND generated_image_url IS NOT NULL
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 1`,
      [teacherId],
    );

    return result.rows[0] || null;
  }

  static async generateImage(
    teacherId: number,
    input: {
      prompt: string;
      platform?: string;
      aspect_ratio?: string;
      language_mode?: string;
      language?: string;
      edit_last_design?: boolean | string;
    },
    referenceFiles: Express.Multer.File[] = [],
  ) {
    const prompt = normalizePrompt(input.prompt);
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const languageMode = normalizeTeacherCreativeLanguageMode(input.language_mode || input.language);
    const logoPath = resolveLogoPath();
    const [teacherContext, latestCompletedDesign] = await Promise.all([
      this.getTeacherImageContext(teacherId),
      isTruthyFormValue(input.edit_last_design) || isLikelyEditRequest(prompt)
        ? this.getLatestCompletedImageGeneration(teacherId)
        : Promise.resolve(null),
    ]);
    const editRequested = isTruthyFormValue(input.edit_last_design) || isLikelyEditRequest(prompt);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(
      input.aspect_ratio || latestCompletedDesign?.aspect_ratio || undefined,
    );

    const generation = await this.createGeneration({
      teacherId,
      requestType: 'image',
      prompt,
      platform,
      aspectRatio,
      languageMode,
      editedGenerationId: latestCompletedDesign?.id || null,
      provider: 'openai',
      providerModel: config.OPENAI_IMAGE_MODEL,
      logoPath,
    });

    try {
      const enhancedPrompt = await this.callDeepSeekForPromptEnhancement({
        prompt,
        aspectRatio,
      });
      const avatarFallbackAttached = !referenceFiles.length && Boolean(teacherContext.avatarUrl);
      const finalPrompt = buildTeacherImagePrompt({
        prompt: enhancedPrompt,
        platform,
        aspectRatio,
        referenceCount: referenceFiles.length,
        logoAttached: true,
        languageMode,
        teacherContext: {
          teacherName: teacherContext.teacherName,
          profileSubject: teacherContext.profileSubject,
          assignedSubjects: teacherContext.assignedSubjects,
          avatarAttached: avatarFallbackAttached,
          subjectImageUrls: teacherContext.subjectImageUrls,
        },
        editBaseAttached: Boolean(latestCompletedDesign?.generated_image_url),
      });

      if (config.NODE_ENV !== 'production') {
        logger.info(
          {
            generation_id: generation.id,
            teacher_id: teacherId,
            original_prompt: prompt,
            enhanced_prompt: enhancedPrompt,
            final_prompt: finalPrompt,
            logo_path: logoPath,
            language_mode: languageMode,
            edited_generation_id: latestCompletedDesign?.id || null,
          },
          '[TeacherCreativeChatbot] Enhanced prompt for image generation',
        );
      }

      const openAIImage = await this.callOpenAIImageGeneration({
        prompt: finalPrompt,
        logoPath,
        referenceFiles,
        avatarUrl: avatarFallbackAttached ? teacherContext.avatarUrl : null,
        baseImageUrl: latestCompletedDesign?.generated_image_url || null,
        aspectRatio,
      });

      const uploaded = await uploadBufferToCloudinary(
        openAIImage.buffer,
        `teacher-creative-${teacherId}-${generation.id}-${Date.now()}.png`,
        { resource_type: 'image' },
      );
      const references = await this.uploadReferenceFiles(generation.id, teacherId, referenceFiles);

      const completed = await this.completeGeneration(generation.id, {
        generatedText: prompt,
        generatedImageUrl: uploaded.secure_url,
        providerResponse: {
          model: openAIImage.model,
          response: openAIImage.response,
          enhanced_prompt: enhancedPrompt,
          final_prompt: finalPrompt,
          logo_attached: true,
          language_mode: languageMode,
          teacher_context: {
            teacher_name: teacherContext.teacherName,
            profile_subject: teacherContext.profileSubject,
            assigned_subjects: teacherContext.assignedSubjects,
            avatar_url: teacherContext.avatarUrl,
            subject_image_urls: teacherContext.subjectImageUrls,
          },
          edit_requested: editRequested,
          edited_generation_id: latestCompletedDesign?.id || null,
          edit_base_attached: Boolean(latestCompletedDesign?.generated_image_url),
          avatar_fallback_attached: avatarFallbackAttached,
          references_count: references.length,
        },
      });

      return { ...completed, references };
    } catch (error) {
      await cleanupUploadedFiles(referenceFiles);
      await this.failGeneration(generation.id, error);
      throw error;
    }
  }

  static async getHistory(teacherId: number, limit = 20, offset = 0) {
    const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const safeOffset = Math.max(Number(offset) || 0, 0);

    const [items, count] = await Promise.all([
      pool.query(
        `SELECT id,
                teacher_id,
                request_type,
                prompt,
                platform,
                tone,
                aspect_ratio,
                status,
                generated_text,
                generated_image_url,
                provider,
                provider_model,
                error_message,
                created_at,
                updated_at,
                completed_at
         FROM teacher_creative_generations
         WHERE teacher_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, safeLimit, safeOffset],
      ),
      pool.query(
        `SELECT COUNT(*)::text AS count
         FROM teacher_creative_generations
         WHERE teacher_id = $1`,
        [teacherId],
      ),
    ]);

    return {
      generations: items.rows,
      total: Number(count.rows[0]?.count || 0),
    };
  }

  static async getGenerationById(teacherId: number, generationId: number) {
    if (!Number.isInteger(generationId) || generationId <= 0) return null;

    const generationRes = await pool.query(
      `SELECT id,
              teacher_id,
              request_type,
              prompt,
              platform,
              tone,
              aspect_ratio,
              status,
              generated_text,
              generated_image_url,
              provider,
              provider_model,
              error_message,
              created_at,
              updated_at,
              completed_at
       FROM teacher_creative_generations
       WHERE teacher_id = $1 AND id = $2`,
      [teacherId, generationId],
    );
    const generation = generationRes.rows[0];
    if (!generation) return null;

    const refs = await pool.query(
      `SELECT * FROM teacher_creative_reference_files
       WHERE teacher_id = $1 AND generation_id = $2
       ORDER BY id ASC`,
      [teacherId, generationId],
    );

    return { ...generation, references: refs.rows };
  }

  static getWelcomeMessage(): string {
    return TEACHER_CREATIVE_CHAT_WELCOME_MESSAGE;
  }

  static async createChatSession(
    teacherId: number,
    input?: {
      preferredOutput?: string;
      platform?: string;
      tone?: string;
      aspectRatio?: string;
      languageMode?: string;
    },
  ): Promise<CreativeChatSession> {
    const preferredOutput = normalizePreferredOutput(input?.preferredOutput);
    const platform = normalizeTeacherCreativePlatform(input?.platform);
    const tone = normalizeTeacherCreativeTone(input?.tone);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(input?.aspectRatio);
    const languageMode = normalizeTeacherCreativeLanguageMode(input?.languageMode);

    const result = await pool.query<CreativeChatSession>(
      `INSERT INTO teacher_creative_chat_sessions
       (teacher_id, preferred_output, platform, tone, aspect_ratio, language_mode, pending)
       VALUES ($1, $2, $3, $4, $5, $6, '{}'::jsonb)
       RETURNING *`,
      [teacherId, preferredOutput, platform, tone, aspectRatio, languageMode],
    );
    return result.rows[0];
  }

  static async getActiveChatSession(teacherId: number): Promise<CreativeChatSession | null> {
    const result = await pool.query<CreativeChatSession>(
      `SELECT * FROM teacher_creative_chat_sessions
       WHERE teacher_id = $1 AND status = 'active'
       ORDER BY updated_at DESC
       LIMIT 1`,
      [teacherId],
    );
    return result.rows[0] || null;
  }

  static async getChatSessionById(
    teacherId: number,
    sessionId: number,
  ): Promise<CreativeChatSession | null> {
    if (!Number.isInteger(sessionId) || sessionId <= 0) return null;
    const result = await pool.query<CreativeChatSession>(
      `SELECT * FROM teacher_creative_chat_sessions
       WHERE teacher_id = $1 AND id = $2
       LIMIT 1`,
      [teacherId, sessionId],
    );
    return result.rows[0] || null;
  }

  static async archiveChatSession(teacherId: number, sessionId: number): Promise<void> {
    await pool.query(
      `UPDATE teacher_creative_chat_sessions
       SET status = 'archived', updated_at = NOW()
       WHERE teacher_id = $1 AND id = $2`,
      [teacherId, sessionId],
    );
  }

  static async getChatMessages(
    teacherId: number,
    sessionId: number,
    limit = 100,
  ): Promise<CreativeChatMessage[]> {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 200);
    const result = await pool.query<CreativeChatMessage>(
      `SELECT * FROM teacher_creative_chat_messages
       WHERE teacher_id = $1 AND session_id = $2
       ORDER BY created_at ASC
       LIMIT $3`,
      [teacherId, sessionId, safeLimit],
    );
    return result.rows;
  }

  private static async saveChatMessage(input: {
    sessionId: number;
    teacherId: number;
    role: 'user' | 'assistant';
    message: string;
    payload?: Record<string, unknown>;
  }): Promise<CreativeChatMessage> {
    const result = await pool.query<CreativeChatMessage>(
      `INSERT INTO teacher_creative_chat_messages
       (session_id, teacher_id, role, message, payload)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [
        input.sessionId,
        input.teacherId,
        input.role,
        input.message,
        JSON.stringify(input.payload || {}),
      ],
    );
    return result.rows[0];
  }

  private static async updateChatSession(
    sessionId: number,
    teacherId: number,
    patch: {
      preferredOutput?: string;
      platform?: string;
      tone?: string;
      aspectRatio?: string;
      languageMode?: string;
      pending?: CreativeChatPending;
    },
  ): Promise<CreativeChatSession> {
    const result = await pool.query<CreativeChatSession>(
      `UPDATE teacher_creative_chat_sessions
       SET preferred_output = COALESCE($3, preferred_output),
           platform = COALESCE($4, platform),
           tone = COALESCE($5, tone),
           aspect_ratio = COALESCE($6, aspect_ratio),
           language_mode = COALESCE($7, language_mode),
           pending = COALESCE($8::jsonb, pending),
           updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`,
      [
        sessionId,
        teacherId,
        patch.preferredOutput || null,
        patch.platform || null,
        patch.tone || null,
        patch.aspectRatio || null,
        patch.languageMode || null,
        patch.pending ? JSON.stringify(patch.pending) : null,
      ],
    );
    return result.rows[0];
  }

  private static async callDeepSeekForChat(input: {
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    platform?: string;
    tone?: string;
    preferredOutput?: string;
    aspectRatio?: string;
    languageMode?: string;
    pendingSummary?: string;
  }): Promise<{ payload: CreativeChatAiPayload; response: Record<string, unknown> }> {
    if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required');

    const messages = [
      { role: 'system' as const, content: buildTeacherCreativeChatSystemPrompt() },
      ...input.history.slice(-12).map((item) => ({
        role: item.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: item.content,
      })),
      {
        role: 'user' as const,
        content: buildTeacherCreativeChatUserPrompt({
          message: input.message,
          platform: input.platform,
          tone: input.tone,
          preferredOutput: input.preferredOutput,
          aspectRatio: input.aspectRatio,
          languageMode: input.languageMode,
          pendingSummary: input.pendingSummary,
        }),
      },
    ];

    const response = await fetch(`${config.DEEPSEEK_API_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages,
        temperature: 0.7,
        max_tokens: 1200,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      throw new Error(
        `DeepSeek creative chat failed: ${response.status} ${await response.text()}`,
      );
    }

    const body = (await response.json()) as any;
    const content = String(body.choices?.[0]?.message?.content || '').trim();
    return {
      payload: parseCreativeChatAiPayload(content),
      response: {
        id: body.id,
        model: body.model,
        usage: body.usage,
      },
    };
  }

  private static resolveExecutionPrompt(
    pending: CreativeChatPending,
    preferredOutput: 'post' | 'image' | 'auto',
  ): { action: 'generate_post' | 'generate_image'; prompt: string } | null {
    const suggested = pending.suggested_action || 'none';
    const prompt =
      pending.execution_prompt ||
      pending.draft_post ||
      pending.image_concept ||
      null;
    if (!prompt || !pending.ready_to_execute) return null;

    if (suggested === 'generate_post') return { action: 'generate_post', prompt };
    if (suggested === 'generate_image') return { action: 'generate_image', prompt };

    if (preferredOutput === 'image') return { action: 'generate_image', prompt };
    if (preferredOutput === 'post') return { action: 'generate_post', prompt };

    // auto: draft_post prefers text, otherwise image
    if (pending.draft_post && !pending.image_concept) {
      return { action: 'generate_post', prompt: pending.draft_post };
    }
    if (pending.image_concept) {
      return { action: 'generate_image', prompt: pending.image_concept };
    }
    return { action: 'generate_post', prompt };
  }

  static async executePendingChat(
    teacherId: number,
    input: {
      sessionId: number;
      requestType?: 'post' | 'image';
      referenceFiles?: Express.Multer.File[];
      editLastDesign?: boolean | string;
    },
  ): Promise<CreativeChatResult> {
    const session = await this.getChatSessionById(teacherId, input.sessionId);
    if (!session || session.status !== 'active') {
      throw new Error('جلسة المحادثة غير موجودة أو غير نشطة');
    }

    const pending = (session.pending || {}) as CreativeChatPending;
    const preferredOutput = normalizePreferredOutput(
      input.requestType || session.preferred_output || pending.preferred_output,
    );
    const resolved = this.resolveExecutionPrompt(
      {
        ...pending,
        ready_to_execute: true,
        suggested_action:
          input.requestType === 'post'
            ? 'generate_post'
            : input.requestType === 'image'
              ? 'generate_image'
              : pending.suggested_action,
      },
      preferredOutput,
    );

    if (!resolved) {
      throw new Error('لا توجد مسودة جاهزة للتنفيذ. ناقش الفكرة أولاً ثم أكد التنفيذ.');
    }

    const platform = normalizeTeacherCreativePlatform(pending.platform || session.platform || undefined);
    const tone = normalizeTeacherCreativeTone(pending.tone || session.tone || undefined);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(
      pending.aspect_ratio || session.aspect_ratio || undefined,
    );
    const languageMode = normalizeTeacherCreativeLanguageMode(
      pending.language_mode || session.language_mode || undefined,
    );

    let generation: TeacherCreativeGeneration;
    if (resolved.action === 'generate_image') {
      generation = await this.generateImage(
        teacherId,
        {
          prompt: resolved.prompt,
          platform,
          aspect_ratio: aspectRatio,
          language_mode: languageMode,
          edit_last_design: input.editLastDesign,
        },
        input.referenceFiles || [],
      );
    } else {
      generation = await this.generatePost(teacherId, {
        prompt: resolved.prompt,
        platform,
        tone,
      });
    }

    const reply =
      resolved.action === 'generate_image'
        ? 'تم تنفيذ التصميم حسب المسودة المتفق عليها. تقدر تعدّل الفكرة أو تطلب نسخة تانية.'
        : 'تم تنفيذ المنشور حسب المسودة المتفق عليها. تقدر تنسخه أو نعدّله سوا.';

    const clearedPending: CreativeChatPending = {
      ...pending,
      ready_to_execute: false,
      suggested_action: 'none',
    };

    await this.updateChatSession(session.id, teacherId, { pending: clearedPending });
    await this.saveChatMessage({
      sessionId: session.id,
      teacherId,
      role: 'assistant',
      message: reply,
      payload: {
        executed: true,
        generation_id: generation.id,
        suggested_action: resolved.action,
      },
    });

    return {
      reply,
      session_id: session.id,
      ideas: pending.ideas || [],
      draft_post: pending.draft_post || null,
      image_concept: pending.image_concept || null,
      suggested_action: 'none',
      ready_to_execute: false,
      executed: true,
      generation,
      actions: {
        can_execute: false,
        can_generate_post: false,
        can_generate_image: false,
      },
    };
  }

  static async chat(
    teacherId: number,
    input: {
      message: string;
      sessionId?: number;
      preferredOutput?: string;
      platform?: string;
      tone?: string;
      aspectRatio?: string;
      languageMode?: string;
      forceExecute?: boolean;
      referenceFiles?: Express.Multer.File[];
      editLastDesign?: boolean | string;
    },
  ): Promise<CreativeChatResult> {
    const message = String(input.message || '').trim();
    if (!message) throw new Error('الرسالة مطلوبة');
    if (message.length > 4000) throw new Error('الرسالة طويلة جداً');

    let session =
      (input.sessionId
        ? await this.getChatSessionById(teacherId, input.sessionId)
        : null) ||
      (await this.getActiveChatSession(teacherId)) ||
      (await this.createChatSession(teacherId, input));

    session = await this.updateChatSession(session.id, teacherId, {
      preferredOutput: input.preferredOutput
        ? normalizePreferredOutput(input.preferredOutput)
        : undefined,
      platform: input.platform
        ? normalizeTeacherCreativePlatform(input.platform)
        : undefined,
      tone: input.tone ? normalizeTeacherCreativeTone(input.tone) : undefined,
      aspectRatio: input.aspectRatio
        ? normalizeTeacherCreativeAspectRatio(input.aspectRatio)
        : undefined,
      languageMode: input.languageMode
        ? normalizeTeacherCreativeLanguageMode(input.languageMode)
        : undefined,
    });

    await this.saveChatMessage({
      sessionId: session.id,
      teacherId,
      role: 'user',
      message,
      payload: {
        preferred_output: session.preferred_output,
        platform: session.platform,
        tone: session.tone,
      },
    });

    const pending = (session.pending || {}) as CreativeChatPending;
    const shouldExecute =
      input.forceExecute === true ||
      (isExplicitExecuteRequest(message) && Boolean(pending.ready_to_execute));

    if (shouldExecute) {
      try {
        return await this.executePendingChat(teacherId, {
          sessionId: session.id,
          requestType:
            pending.suggested_action === 'generate_image'
              ? 'image'
              : pending.suggested_action === 'generate_post'
                ? 'post'
                : normalizePreferredOutput(session.preferred_output) === 'image'
                  ? 'image'
                  : normalizePreferredOutput(session.preferred_output) === 'post'
                    ? 'post'
                    : undefined,
          referenceFiles: input.referenceFiles,
          editLastDesign: input.editLastDesign,
        });
      } catch (error) {
        const reply =
          error instanceof Error
            ? error.message
            : 'تعذر التنفيذ الآن. خلينا نضبط المسودة أولاً.';
        await this.saveChatMessage({
          sessionId: session.id,
          teacherId,
          role: 'assistant',
          message: reply,
          payload: { executed: false, error: true },
        });
        const actions = buildActionsFromPending(pending);
        return {
          reply,
          session_id: session.id,
          ideas: pending.ideas || [],
          draft_post: pending.draft_post || null,
          image_concept: pending.image_concept || null,
          suggested_action: pending.suggested_action || 'none',
          ready_to_execute: Boolean(pending.ready_to_execute),
          executed: false,
          generation: null,
          actions,
        };
      }
    }

    const historyRows = await this.getChatMessages(teacherId, session.id, 20);
    const history = historyRows
      .filter((row) => row.message && row.role)
      .slice(0, -1) // exclude the just-saved user message; we pass it separately
      .map((row) => ({
        role: row.role,
        content: row.message,
      }));

    const ai = await this.callDeepSeekForChat({
      message,
      history,
      platform: session.platform || undefined,
      tone: session.tone || undefined,
      preferredOutput: session.preferred_output || undefined,
      aspectRatio: session.aspect_ratio || undefined,
      languageMode: session.language_mode || undefined,
      pendingSummary: summarizePending(pending),
    });

    const nextPending: CreativeChatPending = {
      ideas: ai.payload.ideas,
      draft_post: ai.payload.draft_post,
      image_concept: ai.payload.image_concept,
      suggested_action: ai.payload.suggested_action,
      execution_prompt: ai.payload.execution_prompt,
      ready_to_execute: ai.payload.ready_to_execute,
      platform: session.platform,
      tone: session.tone,
      aspect_ratio: session.aspect_ratio,
      language_mode: session.language_mode,
      preferred_output: session.preferred_output,
    };

    await this.updateChatSession(session.id, teacherId, { pending: nextPending });
    await this.saveChatMessage({
      sessionId: session.id,
      teacherId,
      role: 'assistant',
      message: ai.payload.reply,
      payload: {
        ...ai.payload,
        provider_response: ai.response,
      },
    });

    const actions = buildActionsFromPending(nextPending);
    return {
      reply: ai.payload.reply,
      session_id: session.id,
      ideas: nextPending.ideas || [],
      draft_post: nextPending.draft_post || null,
      image_concept: nextPending.image_concept || null,
      suggested_action: nextPending.suggested_action || 'none',
      ready_to_execute: Boolean(nextPending.ready_to_execute),
      executed: false,
      generation: null,
      actions,
    };
  }
}
