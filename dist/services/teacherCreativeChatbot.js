"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeacherCreativeChatbotService = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_buffer_1 = require("node:buffer");
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const teacherCreative_prompts_1 = require("./teacherCreative.prompts");
function normalizePrompt(prompt) {
    const value = String(prompt || '').trim();
    if (!value)
        throw new Error('البرومبت مطلوب');
    if (value.length > 3000)
        throw new Error('البرومبت طويل جداً');
    return value;
}
function compactText(value, maxLength = 80) {
    const text = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (text.length <= maxLength)
        return text;
    return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}
function normalizeImageCopy(copy) {
    return {
        headline: compactText(copy.headline, 42),
        subheadline: compactText(copy.subheadline, 70),
        cta: compactText(copy.cta, 28),
    };
}
function buildFallbackImageCopy(prompt) {
    return {
        headline: compactText(prompt, 42) || 'ابدأ رحلتك التعليمية',
        subheadline: 'تعلم بخطوات واضحة ومتابعة مستمرة',
        cta: 'ابدأ الآن',
    };
}
function resolveLogoPath() {
    if (!utils_1.config.TEACHER_CREATIVE_LOGO_PATH) {
        throw new Error('TEACHER_CREATIVE_LOGO_PATH is required for image generation');
    }
    const resolved = node_path_1.default.isAbsolute(utils_1.config.TEACHER_CREATIVE_LOGO_PATH)
        ? utils_1.config.TEACHER_CREATIVE_LOGO_PATH
        : node_path_1.default.resolve(process.cwd(), utils_1.config.TEACHER_CREATIVE_LOGO_PATH);
    if (!node_fs_1.default.existsSync(resolved)) {
        throw new Error(`Logo file not found: ${utils_1.config.TEACHER_CREATIVE_LOGO_PATH}`);
    }
    return resolved;
}
function getImageMimeType(filePath, fallback = 'image/png') {
    const ext = node_path_1.default.extname(filePath).toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg')
        return 'image/jpeg';
    if (ext === '.webp')
        return 'image/webp';
    if (ext === '.gif')
        return 'image/gif';
    if (ext === '.png')
        return 'image/png';
    return fallback;
}
function getOpenAIImageSize(aspectRatio) {
    if (aspectRatio === '16:9')
        return '1536x1024';
    if (aspectRatio === '4:5' || aspectRatio === '9:16')
        return '1024x1536';
    return '1024x1024';
}
async function appendImageFileToFormData(formData, fieldName, filePath, filename, mimeType) {
    const buffer = await node_fs_1.default.promises.readFile(filePath);
    formData.append(fieldName, new node_buffer_1.Blob([buffer], { type: mimeType || getImageMimeType(filePath) }), filename);
}
async function cleanupUploadedFiles(files) {
    await Promise.all(files.map((file) => node_fs_1.default.promises.unlink(file.path).catch(() => undefined)));
}
class TeacherCreativeChatbotService {
    static MAX_REFERENCE_FILES = 4;
    static async createGeneration(input) {
        const result = await pool_1.default.query(`INSERT INTO teacher_creative_generations
       (teacher_id, request_type, prompt, platform, tone, aspect_ratio, provider, provider_model, logo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`, [
            input.teacherId,
            input.requestType,
            input.prompt,
            input.platform || null,
            input.tone || null,
            input.aspectRatio || null,
            input.provider || null,
            input.providerModel || null,
            input.logoPath || null,
        ]);
        return result.rows[0];
    }
    static async completeGeneration(generationId, patch) {
        const result = await pool_1.default.query(`UPDATE teacher_creative_generations
       SET status = 'completed',
           generated_text = COALESCE($2, generated_text),
           generated_image_url = COALESCE($3, generated_image_url),
           provider_response = $4::jsonb,
           updated_at = NOW(),
           completed_at = NOW()
       WHERE id = $1
       RETURNING *`, [
            generationId,
            patch.generatedText || null,
            patch.generatedImageUrl || null,
            JSON.stringify(patch.providerResponse || {}),
        ]);
        return result.rows[0];
    }
    static async failGeneration(generationId, error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await pool_1.default.query(`UPDATE teacher_creative_generations
       SET status = 'failed',
           error_message = $2,
           updated_at = NOW(),
           completed_at = NOW()
       WHERE id = $1`, [generationId, message]);
    }
    static async callDeepSeekForPost(input) {
        if (!utils_1.config.DEEPSEEK_API_KEY)
            throw new Error('DEEPSEEK_API_KEY is required');
        const response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: (0, teacherCreative_prompts_1.buildTeacherPostSystemPrompt)() },
                    { role: 'user', content: (0, teacherCreative_prompts_1.buildTeacherPostUserPrompt)(input) },
                ],
                temperature: 0.75,
                max_tokens: 700,
            }),
        });
        if (!response.ok) {
            throw new Error(`DeepSeek post generation failed: ${response.status} ${await response.text()}`);
        }
        const payload = (await response.json());
        const text = payload.choices?.[0]?.message?.content?.trim();
        if (!text)
            throw new Error('DeepSeek returned empty post text');
        return {
            text,
            response: {
                id: payload.id,
                model: payload.model,
                usage: payload.usage,
            },
        };
    }
    static async generatePost(teacherId, input) {
        const prompt = normalizePrompt(input.prompt);
        const platform = (0, teacherCreative_prompts_1.normalizeTeacherCreativePlatform)(input.platform);
        const tone = (0, teacherCreative_prompts_1.normalizeTeacherCreativeTone)(input.tone);
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
        }
        catch (error) {
            await this.failGeneration(generation.id, error);
            throw error;
        }
    }
    static async callDeepSeekForImageCopy(input) {
        if (!utils_1.config.DEEPSEEK_API_KEY)
            throw new Error('DEEPSEEK_API_KEY is required');
        const response = await fetch(`${utils_1.config.DEEPSEEK_API_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${utils_1.config.DEEPSEEK_API_KEY}`,
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: (0, teacherCreative_prompts_1.buildTeacherImageCopySystemPrompt)() },
                    { role: 'user', content: (0, teacherCreative_prompts_1.buildTeacherImageCopyUserPrompt)(input) },
                ],
                temperature: 0.45,
                max_tokens: 250,
            }),
        });
        if (!response.ok) {
            throw new Error(`DeepSeek image copy failed: ${response.status} ${await response.text()}`);
        }
        const payload = (await response.json());
        const content = payload.choices?.[0]?.message?.content?.trim();
        if (!content)
            throw new Error('DeepSeek returned empty image copy');
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
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
    static async callOpenAIImageGeneration(input) {
        if (!utils_1.config.OPENAI_API_KEY)
            throw new Error('OPENAI_API_KEY is required');
        const model = utils_1.config.OPENAI_IMAGE_MODEL || 'gpt-image-1';
        const formData = new FormData();
        formData.append('model', model);
        formData.append('prompt', input.prompt);
        formData.append('n', '1');
        formData.append('size', getOpenAIImageSize(input.aspectRatio));
        formData.append('quality', 'high');
        await appendImageFileToFormData(formData, 'image[]', input.logoPath, node_path_1.default.basename(input.logoPath));
        for (const file of input.referenceFiles) {
            await appendImageFileToFormData(formData, 'image[]', file.path, file.originalname || node_path_1.default.basename(file.path), file.mimetype);
        }
        const response = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${utils_1.config.OPENAI_API_KEY}`,
            },
            body: formData,
        });
        if (!response.ok) {
            throw new Error(`OpenAI image generation failed: ${response.status} ${await response.text()}`);
        }
        const payload = (await response.json());
        const firstImage = Array.isArray(payload.data) ? payload.data[0] : null;
        const b64Json = firstImage?.b64_json;
        const imageUrl = firstImage?.url;
        let buffer = null;
        if (typeof b64Json === 'string' && b64Json.trim()) {
            buffer = Buffer.from(b64Json, 'base64');
        }
        else if (typeof imageUrl === 'string' && imageUrl.trim()) {
            const imageResponse = await fetch(imageUrl);
            if (!imageResponse.ok) {
                throw new Error(`Failed to download OpenAI image: ${imageResponse.status}`);
            }
            buffer = Buffer.from(await imageResponse.arrayBuffer());
        }
        if (!buffer)
            throw new Error('OpenAI returned no image');
        return {
            buffer,
            model,
            response: payload,
        };
    }
    static async uploadReferenceFiles(generationId, teacherId, files) {
        const references = [];
        for (const file of files) {
            const uploaded = await (0, utils_1.uploadToCloudinary)(file.path, { resource_type: 'image' });
            const result = await pool_1.default.query(`INSERT INTO teacher_creative_reference_files
         (generation_id, teacher_id, file_url, original_name, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [
                generationId,
                teacherId,
                uploaded.secure_url,
                file.originalname || null,
                file.mimetype || null,
                file.size || null,
            ]);
            references.push(result.rows[0]);
        }
        return references;
    }
    static async generateImage(teacherId, input, referenceFiles = []) {
        const prompt = normalizePrompt(input.prompt);
        const platform = (0, teacherCreative_prompts_1.normalizeTeacherCreativePlatform)(input.platform);
        const aspectRatio = (0, teacherCreative_prompts_1.normalizeTeacherCreativeAspectRatio)(input.aspect_ratio);
        const logoPath = resolveLogoPath();
        const generation = await this.createGeneration({
            teacherId,
            requestType: 'image',
            prompt,
            platform,
            aspectRatio,
            provider: 'openai',
            providerModel: utils_1.config.OPENAI_IMAGE_MODEL,
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
            const imagePrompt = (0, teacherCreative_prompts_1.buildTeacherImagePrompt)({
                prompt,
                platform,
                aspectRatio,
                referenceCount: referenceFiles.length,
                logoAttached: true,
                imageCopy: imageCopyResult.copy,
            });
            if (utils_1.config.NODE_ENV !== 'production') {
                utils_1.logger.info({
                    generation_id: generation.id,
                    teacher_id: teacherId,
                    prompt: imagePrompt,
                    ai_rendered_copy: imageCopyResult.copy,
                    logo_path: logoPath,
                }, '[TeacherCreativeChatbot] Final image generation prompt');
            }
            const openAIImage = await this.callOpenAIImageGeneration({
                prompt: imagePrompt,
                logoPath,
                referenceFiles,
                aspectRatio,
            });
            const uploaded = await (0, utils_1.uploadBufferToCloudinary)(openAIImage.buffer, `teacher-creative-${teacherId}-${generation.id}-${Date.now()}.png`, { resource_type: 'image' });
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
        }
        catch (error) {
            await cleanupUploadedFiles(referenceFiles);
            await this.failGeneration(generation.id, error);
            throw error;
        }
    }
    static async getHistory(teacherId, limit = 20, offset = 0) {
        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        const [items, count] = await Promise.all([
            pool_1.default.query(`SELECT * FROM teacher_creative_generations
         WHERE teacher_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`, [teacherId, safeLimit, safeOffset]),
            pool_1.default.query(`SELECT COUNT(*)::text AS count
         FROM teacher_creative_generations
         WHERE teacher_id = $1`, [teacherId]),
        ]);
        return {
            generations: items.rows,
            total: Number(count.rows[0]?.count || 0),
        };
    }
    static async getGenerationById(teacherId, generationId) {
        if (!Number.isInteger(generationId) || generationId <= 0)
            return null;
        const generationRes = await pool_1.default.query(`SELECT * FROM teacher_creative_generations
       WHERE teacher_id = $1 AND id = $2`, [teacherId, generationId]);
        const generation = generationRes.rows[0];
        if (!generation)
            return null;
        const refs = await pool_1.default.query(`SELECT * FROM teacher_creative_reference_files
       WHERE teacher_id = $1 AND generation_id = $2
       ORDER BY id ASC`, [teacherId, generationId]);
        return { ...generation, references: refs.rows };
    }
}
exports.TeacherCreativeChatbotService = TeacherCreativeChatbotService;
