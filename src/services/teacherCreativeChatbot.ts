import fs from 'node:fs';
import path from 'node:path';
import { Blob } from 'node:buffer';
import pool from '../db/pool';
import { config, logger, uploadBufferToCloudinary, uploadToCloudinary } from '../utils';
import {
  buildTeacherImageCopySystemPrompt,
  buildTeacherImageCopyUserPrompt,
  buildTeacherImagePrompt,
  buildTeacherPostSystemPrompt,
  buildTeacherPostUserPrompt,
  normalizeTeacherCreativeAspectRatio,
  normalizeTeacherCreativePlatform,
  normalizeTeacherCreativeTone,
  type TeacherCreativeAspectRatio,
  type TeacherCreativeImageCopy,
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

function normalizePrompt(prompt: string): string {
  const value = String(prompt || '').trim();
  if (!value) throw new Error('البرومبت مطلوب');
  if (value.length > 3000) throw new Error('البرومبت طويل جداً');
  return value;
}

function compactText(value?: string, maxLength = 80): string {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeImageCopy(copy: TeacherCreativeImageCopy): TeacherCreativeImageCopy {
  return {
    headline: compactText(copy.headline, 42),
    subheadline: compactText(copy.subheadline, 70),
    cta: compactText(copy.cta, 28),
  };
}

function buildFallbackImageCopy(prompt: string): TeacherCreativeImageCopy {
  return {
    headline: compactText(prompt, 42) || 'ابدأ رحلتك التعليمية',
    subheadline: 'تعلم بخطوات واضحة ومتابعة مستمرة',
    cta: 'ابدأ الآن',
  };
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

async function cleanupUploadedFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((file) => fs.promises.unlink(file.path).catch(() => undefined)));
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
    provider?: string;
    providerModel?: string;
    logoPath?: string;
  }): Promise<TeacherCreativeGeneration> {
    const result = await pool.query<TeacherCreativeGeneration>(
      `INSERT INTO teacher_creative_generations
       (teacher_id, request_type, prompt, platform, tone, aspect_ratio, provider, provider_model, logo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.teacherId,
        input.requestType,
        input.prompt,
        input.platform || null,
        input.tone || null,
        input.aspectRatio || null,
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

  static async callDeepSeekForImageCopy(input: {
    prompt: string;
    platform: TeacherCreativePlatform;
    aspectRatio: TeacherCreativeAspectRatio;
  }): Promise<{ copy: TeacherCreativeImageCopy; response: Record<string, unknown> }> {
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
          { role: 'system', content: buildTeacherImageCopySystemPrompt() },
          { role: 'user', content: buildTeacherImageCopyUserPrompt(input) },
        ],
        temperature: 0.45,
        max_tokens: 250,
      }),
    });

    if (!response.ok) {
      throw new Error(`DeepSeek image copy failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as any;
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('DeepSeek returned empty image copy');

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(
      jsonMatch ? jsonMatch[0] : content,
    ) as Partial<TeacherCreativeImageCopy>;

    return {
      copy: normalizeImageCopy({
        headline: parsed.headline || buildFallbackImageCopy(input.prompt).headline,
        subheadline: parsed.subheadline || '',
        cta: parsed.cta || '',
      }),
      response: {
        id: payload.id,
        model: payload.model,
        usage: payload.usage,
        raw_content: content,
      },
    };
  }

  static async callOpenAIImageGeneration(input: {
    prompt: string;
    logoPath: string;
    referenceFiles: Express.Multer.File[];
    aspectRatio: TeacherCreativeAspectRatio;
  }): Promise<{ buffer: Buffer; model: string; response: Record<string, unknown> }> {
    if (!config.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required');

    const model = config.OPENAI_IMAGE_MODEL || 'gpt-image-1';
    const formData = new FormData();
    formData.append('model', model);
    formData.append('prompt', input.prompt);
    formData.append('n', '1');
    formData.append('size', getOpenAIImageSize(input.aspectRatio));
    formData.append('quality', 'high');

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
      response: payload,
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

  static async generateImage(
    teacherId: number,
    input: { prompt: string; platform?: string; aspect_ratio?: string },
    referenceFiles: Express.Multer.File[] = [],
  ) {
    const prompt = normalizePrompt(input.prompt);
    const platform = normalizeTeacherCreativePlatform(input.platform);
    const aspectRatio = normalizeTeacherCreativeAspectRatio(input.aspect_ratio);
    const logoPath = resolveLogoPath();

    const generation = await this.createGeneration({
      teacherId,
      requestType: 'image',
      prompt,
      platform,
      aspectRatio,
      provider: 'openai',
      providerModel: config.OPENAI_IMAGE_MODEL,
      logoPath,
    });

    try {
      const imageCopyResult = await this.callDeepSeekForImageCopy({
        prompt,
        platform,
        aspectRatio,
      }).catch((error) => ({
        copy: buildFallbackImageCopy(prompt),
        response: {
          fallback: true,
          error: error instanceof Error ? error.message : String(error),
        },
      }));

      const imagePrompt = buildTeacherImagePrompt({
        prompt,
        platform,
        aspectRatio,
        referenceCount: referenceFiles.length,
        logoAttached: true,
        imageCopy: imageCopyResult.copy,
      });

      if (config.NODE_ENV !== 'production') {
        logger.info(
          {
            generation_id: generation.id,
            teacher_id: teacherId,
            prompt: imagePrompt,
            ai_rendered_copy: imageCopyResult.copy,
            logo_path: logoPath,
          },
          '[TeacherCreativeChatbot] Final image generation prompt',
        );
      }

      const openAIImage = await this.callOpenAIImageGeneration({
        prompt: imagePrompt,
        logoPath,
        referenceFiles,
        aspectRatio,
      });

      const uploaded = await uploadBufferToCloudinary(
        openAIImage.buffer,
        `teacher-creative-${teacherId}-${generation.id}-${Date.now()}.png`,
        { resource_type: 'image' },
      );
      const references = await this.uploadReferenceFiles(generation.id, teacherId, referenceFiles);

      const completed = await this.completeGeneration(generation.id, {
        generatedText: [
          imageCopyResult.copy.headline,
          imageCopyResult.copy.subheadline,
          imageCopyResult.copy.cta,
        ]
          .filter(Boolean)
          .join('\n'),
        generatedImageUrl: uploaded.secure_url,
        providerResponse: {
          model: openAIImage.model,
          response: openAIImage.response,
          image_copy: imageCopyResult.copy,
          image_copy_response: imageCopyResult.response,
          logo_attached: true,
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
        `SELECT * FROM teacher_creative_generations
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
      `SELECT * FROM teacher_creative_generations
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
}
