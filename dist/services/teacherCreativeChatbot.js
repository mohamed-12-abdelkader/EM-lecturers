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
function sanitizeOpenAIImageResponse(payload) {
    const data = Array.isArray(payload?.data)
        ? payload.data.map((item) => ({
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
async function appendImageFileToFormData(formData, fieldName, filePath, filename, mimeType) {
    const buffer = await node_fs_1.default.promises.readFile(filePath);
    formData.append(fieldName, new node_buffer_1.Blob([buffer], { type: mimeType || getImageMimeType(filePath) }), filename);
}
function filenameFromUrl(imageUrl, fallback) {
    try {
        const parsed = new URL(imageUrl);
        const name = node_path_1.default.basename(parsed.pathname);
        return name && name.includes('.') ? name : fallback;
    }
    catch {
        return fallback;
    }
}
async function appendImageUrlToFormData(formData, fieldName, imageUrl, fallbackFilename) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
        throw new Error(`Failed to download image reference: ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
        throw new Error(`Image reference is not an image: ${contentType}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    formData.append(fieldName, new node_buffer_1.Blob([buffer], { type: contentType }), filenameFromUrl(imageUrl, fallbackFilename));
}
function isTruthyFormValue(value) {
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}
function isLikelyEditRequest(prompt) {
    const value = prompt.trim().toLowerCase();
    if (!value)
        return false;
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
async function cleanupUploadedFiles(files) {
    await Promise.all(files.map((file) => node_fs_1.default.promises.unlink(file.path).catch(() => undefined)));
}
class TeacherCreativeChatbotService {
    static MAX_REFERENCE_FILES = 4;
    static async createGeneration(input) {
        const result = await pool_1.default.query(`INSERT INTO teacher_creative_generations
       (teacher_id, request_type, prompt, platform, tone, aspect_ratio, language_mode, edited_generation_id, provider, provider_model, logo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`, [
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
    /**
     * Uses DeepSeek to enhance the user's prompt with visual details for image generation.
     * Keeps the original idea intact but adds descriptive visual elements (colors, mood, composition, lighting).
     */
    static async callDeepSeekForPromptEnhancement(input) {
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
        const payload = (await response.json());
        const enhanced = payload.choices?.[0]?.message?.content?.trim();
        if (!enhanced) {
            console.error('[TeacherCreativeChatbot] DeepSeek returned empty enhancement');
            return input.prompt;
        }
        return enhanced;
    }
    static async callOpenAIImageGeneration(input) {
        if (!utils_1.config.OPENAI_API_KEY)
            throw new Error('OPENAI_API_KEY is required');
        const model = utils_1.config.OPENAI_IMAGE_MODEL || 'gpt-image-2';
        const formData = new FormData();
        formData.append('model', model);
        formData.append('prompt', input.prompt);
        formData.append('n', '1');
        formData.append('size', getOpenAIImageSize(input.aspectRatio));
        formData.append('quality', 'high');
        if (input.baseImageUrl) {
            await appendImageUrlToFormData(formData, 'image[]', input.baseImageUrl, 'previous-design.png');
        }
        await appendImageFileToFormData(formData, 'image[]', input.logoPath, node_path_1.default.basename(input.logoPath));
        for (const file of input.referenceFiles) {
            await appendImageFileToFormData(formData, 'image[]', file.path, file.originalname || node_path_1.default.basename(file.path), file.mimetype);
        }
        if (!input.referenceFiles.length && input.avatarUrl) {
            try {
                await appendImageUrlToFormData(formData, 'image[]', input.avatarUrl, 'teacher-avatar.png');
            }
            catch (error) {
                utils_1.logger.warn({ error, avatar_url: input.avatarUrl }, '[TeacherCreativeChatbot] Failed to attach teacher avatar reference');
            }
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
            response: sanitizeOpenAIImageResponse(payload),
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
    static async getTeacherImageContext(teacherId) {
        const [teacherRes, subjectsRes] = await Promise.all([
            pool_1.default.query(`SELECT name, subject, avatar
         FROM users
         WHERE id = $1 AND role = 'teacher'
         LIMIT 1`, [teacherId]),
            pool_1.default.query(`SELECT s.name AS subject_name, s.image_url AS subject_image_url
         FROM teacher_subjects ts
         JOIN subjects s ON s.id = ts.subject_id
         WHERE ts.teacher_id = $1
         ORDER BY ts.assigned_at DESC, s.id ASC`, [teacherId]),
        ]);
        const teacher = teacherRes.rows[0];
        return {
            teacherName: teacher?.name || null,
            profileSubject: teacher?.subject || null,
            avatarUrl: teacher?.avatar || null,
            assignedSubjects: subjectsRes.rows
                .map((row) => row.subject_name)
                .filter((subject) => Boolean(subject?.trim())),
            subjectImageUrls: subjectsRes.rows
                .map((row) => row.subject_image_url)
                .filter((imageUrl) => Boolean(imageUrl?.trim())),
        };
    }
    static async getLatestCompletedImageGeneration(teacherId) {
        const result = await pool_1.default.query(`SELECT id, generated_image_url, aspect_ratio
       FROM teacher_creative_generations
       WHERE teacher_id = $1
         AND request_type = 'image'
         AND status = 'completed'
         AND generated_image_url IS NOT NULL
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 1`, [teacherId]);
        return result.rows[0] || null;
    }
    static async generateImage(teacherId, input, referenceFiles = []) {
        const prompt = normalizePrompt(input.prompt);
        const platform = (0, teacherCreative_prompts_1.normalizeTeacherCreativePlatform)(input.platform);
        const languageMode = (0, teacherCreative_prompts_1.normalizeTeacherCreativeLanguageMode)(input.language_mode || input.language);
        const logoPath = resolveLogoPath();
        const [teacherContext, latestCompletedDesign] = await Promise.all([
            this.getTeacherImageContext(teacherId),
            isTruthyFormValue(input.edit_last_design) || isLikelyEditRequest(prompt)
                ? this.getLatestCompletedImageGeneration(teacherId)
                : Promise.resolve(null),
        ]);
        const editRequested = isTruthyFormValue(input.edit_last_design) || isLikelyEditRequest(prompt);
        const aspectRatio = (0, teacherCreative_prompts_1.normalizeTeacherCreativeAspectRatio)(input.aspect_ratio || latestCompletedDesign?.aspect_ratio || undefined);
        const generation = await this.createGeneration({
            teacherId,
            requestType: 'image',
            prompt,
            platform,
            aspectRatio,
            languageMode,
            editedGenerationId: latestCompletedDesign?.id || null,
            provider: 'openai',
            providerModel: utils_1.config.OPENAI_IMAGE_MODEL,
            logoPath,
        });
        try {
            const enhancedPrompt = await this.callDeepSeekForPromptEnhancement({
                prompt,
                aspectRatio,
            });
            const avatarFallbackAttached = !referenceFiles.length && Boolean(teacherContext.avatarUrl);
            const finalPrompt = (0, teacherCreative_prompts_1.buildTeacherImagePrompt)({
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
            if (utils_1.config.NODE_ENV !== 'production') {
                utils_1.logger.info({
                    generation_id: generation.id,
                    teacher_id: teacherId,
                    original_prompt: prompt,
                    enhanced_prompt: enhancedPrompt,
                    final_prompt: finalPrompt,
                    logo_path: logoPath,
                    language_mode: languageMode,
                    edited_generation_id: latestCompletedDesign?.id || null,
                }, '[TeacherCreativeChatbot] Enhanced prompt for image generation');
            }
            const openAIImage = await this.callOpenAIImageGeneration({
                prompt: finalPrompt,
                logoPath,
                referenceFiles,
                avatarUrl: avatarFallbackAttached ? teacherContext.avatarUrl : null,
                baseImageUrl: latestCompletedDesign?.generated_image_url || null,
                aspectRatio,
            });
            const uploaded = await (0, utils_1.uploadBufferToCloudinary)(openAIImage.buffer, `teacher-creative-${teacherId}-${generation.id}-${Date.now()}.png`, { resource_type: 'image' });
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
            pool_1.default.query(`SELECT id,
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
        const generationRes = await pool_1.default.query(`SELECT id,
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
