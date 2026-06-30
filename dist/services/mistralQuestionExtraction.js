"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MistralQuestionExtractionService = void 0;
const mistral_1 = require("../config/mistral");
const mistralQuestionExtraction_prompt_1 = require("../prompts/mistralQuestionExtraction.prompt");
const mistralQuestionExtraction_1 = require("../types/mistralQuestionExtraction");
const utils_1 = require("../utils");
const expandMultiPartQuestions_1 = require("../utils/expandMultiPartQuestions");
const mistralOcr_1 = require("./mistralOcr");
const ARABIC_OPTION_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
const LABEL_TO_INDEX = {
    أ: 0,
    ا: 0,
    a: 0,
    A: 0,
    '1': 0,
    ب: 1,
    b: 1,
    B: 1,
    '2': 1,
    ج: 2,
    c: 2,
    C: 2,
    '3': 2,
    د: 3,
    d: 3,
    D: 3,
    '4': 3,
    هـ: 4,
    ه: 4,
    e: 4,
    E: 4,
    '5': 4,
    و: 5,
    f: 5,
    F: 5,
    '6': 5,
    ز: 6,
    g: 6,
    G: 6,
    '7': 6,
    ح: 7,
    h: 7,
    H: 7,
    '8': 7,
    ط: 8,
    i: 8,
    I: 8,
    '9': 8,
    ي: 9,
    j: 9,
    J: 9,
    '10': 9,
};
function resolveCorrectIndex(label, options) {
    if (!label?.trim())
        return null;
    const normalized = label.trim();
    const byLabel = options.findIndex((o) => o.label.trim() === normalized || o.label.trim().toLowerCase() === normalized.toLowerCase());
    if (byLabel >= 0)
        return byLabel;
    const mapped = LABEL_TO_INDEX[normalized];
    if (mapped != null && mapped < options.length)
        return mapped;
    return null;
}
function normalizeQuestion(q) {
    const options = (q.options ?? [])
        .map((opt, i) => ({
        label: opt.label?.trim() || ARABIC_OPTION_LABELS[i] || String(i + 1),
        text: (opt.text ?? '').trim(),
    }))
        .filter((opt) => opt.label || opt.text);
    const questionImages = (q.question_images ?? [])
        .map((image) => ({
        image_id: image.image_id?.trim(),
        page_index: image.page_index ?? null,
        image_url: image.image_url,
        image_type: image.image_type?.trim(),
        short_description: image.short_description?.trim(),
        summary: image.summary?.trim(),
        educational_relevance: image.educational_relevance?.trim(),
    }))
        .filter((image) => image.image_id);
    let correctAnswerIndex = q.correct_answer_index != null && q.correct_answer_index >= 0 ? q.correct_answer_index : null;
    if (correctAnswerIndex != null && correctAnswerIndex >= options.length) {
        correctAnswerIndex = null;
    }
    const correctAnswer = q.correct_answer?.trim() ||
        (correctAnswerIndex != null ? (options[correctAnswerIndex]?.label ?? null) : null);
    if (correctAnswerIndex == null && correctAnswer) {
        correctAnswerIndex = resolveCorrectIndex(correctAnswer, options);
    }
    if (correctAnswerIndex != null && !correctAnswer) {
        const label = options[correctAnswerIndex]?.label ?? null;
        return {
            number: q.number,
            source_number: q.source_number?.trim() || String(q.number),
            question_text: (q.question_text ?? '').trim(),
            passage_id: q.passage_id?.trim() || null,
            options,
            question_images: questionImages,
            correct_answer: label,
            correct_answer_index: correctAnswerIndex,
            correct_answer_inferred: q.correct_answer_inferred ?? false,
        };
    }
    return {
        number: q.number,
        source_number: q.source_number?.trim() || String(q.number),
        question_text: (q.question_text ?? '').trim(),
        passage_id: q.passage_id?.trim() || null,
        options,
        question_images: questionImages,
        correct_answer: correctAnswer ?? null,
        correct_answer_index: correctAnswerIndex,
        correct_answer_inferred: q.correct_answer_inferred ?? false,
    };
}
function normalizePassages(passages) {
    const byId = new Map();
    for (const passage of passages) {
        const passageId = passage.passage_id?.trim();
        const content = passage.content?.trim();
        if (!passageId || !content)
            continue;
        const existing = byId.get(passageId);
        if (!existing || content.length > existing.content.length) {
            byId.set(passageId, {
                passage_id: passageId,
                title: passage.title?.trim() || null,
                content,
            });
        }
    }
    return [...byId.values()];
}
function isSameExtractedQuestion(a, b) {
    const aText = a.question_text.trim();
    const bText = b.question_text.trim();
    if (!aText || !bText)
        return false;
    return aText === bText || aText.includes(bText) || bText.includes(aText);
}
function mergeExtractedQuestion(existing, normalized) {
    if (normalized.question_text.length > existing.question_text.length) {
        existing.question_text = normalized.question_text;
    }
    if (normalized.source_number && !existing.source_number) {
        existing.source_number = normalized.source_number;
    }
    if (normalized.passage_id && !existing.passage_id) {
        existing.passage_id = normalized.passage_id;
    }
    if (normalized.options.length > existing.options.length) {
        existing.options = normalized.options;
    }
    if (normalized.correct_answer && !existing.correct_answer) {
        existing.correct_answer = normalized.correct_answer;
        existing.correct_answer_index = normalized.correct_answer_index;
        existing.correct_answer_inferred = normalized.correct_answer_inferred;
    }
    const existingImageIds = new Set(existing.question_images.map((image) => image.image_id));
    for (const image of normalized.question_images) {
        if (!existingImageIds.has(image.image_id)) {
            existing.question_images.push(image);
        }
    }
}
function dedupeByNumber(questions) {
    const out = [];
    const bySourceNumber = new Map();
    for (const q of questions) {
        const normalized = normalizeQuestion(q);
        const key = normalized.source_number || String(normalized.number);
        const existingIndex = bySourceNumber.get(key);
        if (existingIndex == null) {
            bySourceNumber.set(key, out.length);
            out.push(normalized);
            continue;
        }
        const existing = out[existingIndex];
        if (isSameExtractedQuestion(existing, normalized)) {
            mergeExtractedQuestion(existing, normalized);
        }
        else {
            bySourceNumber.set(`${key}#${out.length}`, out.length);
            out.push(normalized);
        }
    }
    return out.map((question, index) => ({ ...question, number: index + 1 }));
}
function fillMissingPassageIds(questions, passages) {
    if (passages.length === 0)
        return questions;
    if (passages.length === 1) {
        const passageId = passages[0].passage_id;
        return questions.map((question) => ({
            ...question,
            passage_id: question.passage_id ?? passageId,
        }));
    }
    return questions.map((question, index) => {
        if (question.passage_id)
            return question;
        const previousPassageId = questions
            .slice(0, index)
            .reverse()
            .find((q) => q.passage_id)?.passage_id;
        const nextPassageId = questions.slice(index + 1).find((q) => q.passage_id)?.passage_id;
        if (previousPassageId && previousPassageId === nextPassageId) {
            return { ...question, passage_id: previousPassageId };
        }
        return { ...question, passage_id: previousPassageId ?? nextPassageId ?? null };
    });
}
function extractOcrImages(ocr) {
    return ocr.pages.flatMap((page) => page.images.map((image) => ({
        image_id: image.id,
        page_index: image.page_index,
        image_type: image.annotation?.image_type,
        short_description: image.annotation?.short_description,
        summary: image.annotation?.summary,
        educational_relevance: image.annotation?.educational_relevance,
        image_base64: image.image_base64,
    })));
}
function buildDocumentContext(ocr) {
    return ocr.pages
        .map((page) => {
        const imageContext = page.images
            .map((image) => {
            const annotation = image.annotation;
            return [
                `- image_id: ${image.id}`,
                `page_index: ${image.page_index}`,
                annotation?.image_type ? `type: ${annotation.image_type}` : null,
                annotation?.short_description ? `description: ${annotation.short_description}` : null,
                annotation?.summary ? `summary: ${annotation.summary}` : null,
                annotation?.educational_relevance
                    ? `educational_relevance: ${annotation.educational_relevance}`
                    : null,
                annotation?.extracted_text ? `image_text: ${annotation.extracted_text}` : null,
            ]
                .filter(Boolean)
                .join('; ');
        })
            .join('\n');
        return [
            `PAGE ${page.index}`,
            page.markdown,
            imageContext ? `IMAGE_CONTEXT:\n${imageContext}` : null,
        ]
            .filter(Boolean)
            .join('\n\n');
    })
        .join('\n\n---\n\n');
}
function attachOcrImages(questions, ocrImages) {
    const imagesById = new Map(ocrImages.map((image) => [image.image_id, image]));
    return questions.map((question) => ({
        ...question,
        question_images: question.question_images
            .map((ref) => {
            const image = imagesById.get(ref.image_id);
            if (!image)
                return ref;
            return {
                ...image,
                ...ref,
                image_base64: image.image_base64,
                image_url: ref.image_url || image.image_url,
                image_type: ref.image_type || image.image_type,
                short_description: ref.short_description || image.short_description,
                summary: ref.summary || image.summary,
                educational_relevance: ref.educational_relevance || image.educational_relevance,
            };
        })
            .filter((image) => image.image_id),
    }));
}
function parseDataUri(dataUri) {
    const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
    const mime = match?.[1] ?? 'image/jpeg';
    const base64 = match?.[2] ?? dataUri;
    const extFromMime = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    return {
        buffer: Buffer.from(base64, 'base64'),
        mime,
        ext: extFromMime,
    };
}
async function uploadQuestionImagesToCloudinary(questions) {
    const warnings = [];
    const uploadCache = new Map();
    const uploadImage = (image) => {
        if (image.image_url)
            return Promise.resolve(image.image_url);
        if (!image.image_base64)
            return Promise.resolve('');
        const cacheKey = image.image_id;
        const cached = uploadCache.get(cacheKey);
        if (cached)
            return cached;
        const uploadPromise = (async () => {
            const { buffer, ext } = parseDataUri(image.image_base64);
            const safeId = image.image_id.replace(/[^a-zA-Z0-9.-]/g, '_');
            const result = await (0, utils_1.uploadBufferToCloudinary)(buffer, `${Date.now()}-${safeId}.${ext}`, { resource_type: 'image' });
            return result.secure_url;
        })();
        uploadCache.set(cacheKey, uploadPromise);
        return uploadPromise;
    };
    const out = await Promise.all(questions.map(async (question) => {
        const uploadedImages = [];
        for (const image of question.question_images) {
            try {
                const imageUrl = await uploadImage(image);
                uploadedImages.push({
                    image_id: image.image_id,
                    page_index: image.page_index,
                    image_type: image.image_type,
                    short_description: image.short_description,
                    summary: image.summary,
                    educational_relevance: image.educational_relevance,
                    image_url: imageUrl || image.image_url,
                });
            }
            catch (error) {
                const message = error?.message || 'unknown upload error';
                warnings.push(`تعذر رفع الصورة ${image.image_id}: ${message}`);
                utils_1.logger.warn(`OCR question image upload failed (${image.image_id}):`, message);
                uploadedImages.push({
                    image_id: image.image_id,
                    page_index: image.page_index,
                    image_type: image.image_type,
                    short_description: image.short_description,
                    summary: image.summary,
                    educational_relevance: image.educational_relevance,
                    image_url: image.image_url,
                });
            }
        }
        return {
            ...question,
            question_images: uploadedImages,
        };
    }));
    return { questions: out, warnings };
}
function collectQuestionImages(questions) {
    const byId = new Map();
    for (const question of questions) {
        for (const image of question.question_images) {
            if (!byId.has(image.image_id)) {
                byId.set(image.image_id, image);
            }
        }
    }
    return [...byId.values()];
}
async function parseQuestionsWithChat(documentText, filename, inferCorrectAnswer, chatModelOverride) {
    const { apiKey, apiBaseUrl, chatModel: defaultChatModel } = (0, mistral_1.getMistralConfig)();
    const chatModel = chatModelOverride?.trim() || defaultChatModel;
    const response = await fetch(`${apiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            model: chatModel,
            temperature: inferCorrectAnswer ? 0.2 : 0.1,
            response_format: { type: 'json_object' },
            messages: [
                {
                    role: 'system',
                    content: 'أنت محلل امتحانات. أخرج JSON صالح فقط وفق المخطط المطلوب. لا تضف markdown أو شرح.',
                },
                {
                    role: 'user',
                    content: (0, mistralQuestionExtraction_prompt_1.buildQuestionExtractionPrompt)(documentText, filename, {
                        inferCorrectAnswer,
                    }),
                },
            ],
        }),
    });
    if (!response.ok) {
        const errBody = await response.text();
        if (response.status === 401) {
            throw new utils_1.HttpError(502, 'Mistral رفض مفتاح API (401). تحقق من MISTRAL_API_KEY في https://console.mistral.ai');
        }
        throw new utils_1.HttpError(response.status >= 500 ? 502 : 400, `Mistral Chat failed (${response.status}): ${errBody.slice(0, 500)}`);
    }
    const json = (await response.json());
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
        throw new utils_1.HttpError(502, 'Mistral Chat returned empty response');
    }
    let parsed;
    try {
        parsed = JSON.parse(content);
    }
    catch {
        throw new utils_1.HttpError(502, 'Mistral Chat returned invalid JSON');
    }
    const validatedResult = mistralQuestionExtraction_1.MistralQuestionExtractionSchema.safeParse(parsed);
    if (!validatedResult.success) {
        const issueSummary = validatedResult.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .slice(0, 5)
            .join('; ');
        throw new utils_1.HttpError(502, `Mistral Chat returned invalid question structure: ${issueSummary}`);
    }
    const validated = validatedResult.data;
    const expanded = (0, expandMultiPartQuestions_1.expandMultiPartQuestions)(normalizePassages(validated.passages), dedupeByNumber(validated.questions));
    return {
        passages: expanded.passages,
        questions: expanded.questions,
        notes: validated.notes,
        chatModel,
    };
}
class MistralQuestionExtractionService {
    /**
     * Pipeline: Mistral OCR (PDF/صورة → markdown) → Mistral Chat (markdown → أسئلة JSON)
     */
    static async extractQuestionsFromFile(file, options = {}) {
        return this.extractQuestionsFromFiles([file], options);
    }
    static async extractQuestionsFromFiles(files, options = {}) {
        (0, mistral_1.assertMistralConfigured)();
        if (files.length === 0) {
            throw new utils_1.HttpError(400, 'يجب رفع ملف واحد على الأقل');
        }
        const inferCorrectAnswer = options.inferCorrectAnswer ?? false;
        const includeQuestionImages = options.includeQuestionImages ?? true;
        const requestedChatModel = options.chatModel?.trim();
        const ocrModel = options.ocrModel?.trim();
        const pdfFiles = files.filter((f) => {
            const mime = mistralOcr_1.MistralOcrService.resolveSupportedMime(f);
            return mime.includes('pdf');
        });
        const imageFiles = files.filter((f) => {
            const mime = mistralOcr_1.MistralOcrService.resolveSupportedMime(f);
            return !mime.includes('pdf');
        });
        if (pdfFiles.length && imageFiles.length) {
            throw new utils_1.HttpError(400, 'لا يمكن رفع PDF وصور معاً في طلب واحد');
        }
        if (pdfFiles.length > 1) {
            throw new utils_1.HttpError(400, 'ارفع ملف PDF واحد فقط');
        }
        const pages = pdfFiles.length > 0
            ? (0, mistralOcr_1.parsePdfPageRange)(options.startPage, options.endPage)
            : undefined;
        if (pages && imageFiles.length > 0) {
            throw new utils_1.HttpError(400, 'نطاق الصفحات متاح لملفات PDF فقط');
        }
        const ocrOptions = {
            annotateImages: includeQuestionImages,
            includeImageBase64: includeQuestionImages,
            ocrModel,
            pages,
        };
        const ocr = files.length === 1
            ? await mistralOcr_1.MistralOcrService.extractTextFromFile(files[0], ocrOptions)
            : await mistralOcr_1.MistralOcrService.extractTextFromFiles(files, ocrOptions);
        return this.extractQuestionsFromOcr(ocr, {
            inferCorrectAnswer,
            includeQuestionImages,
            requestedChatModel,
            sourceFiles: files.map((f) => ({
                filename: f.originalname || f.filename,
                mime_type: mistralOcr_1.MistralOcrService.resolveSupportedMime(f),
            })),
            pageRange: pages && pages.length > 0
                ? {
                    start_page: pages[0] + 1,
                    end_page: pages[pages.length - 1] + 1,
                    pages_processed: pages.length,
                }
                : undefined,
        });
    }
    static async extractQuestionsFromOcr(ocr, opts) {
        const documentContext = buildDocumentContext(ocr);
        if (!documentContext.trim()) {
            throw new utils_1.HttpError(400, 'لم يُستخرج أي نص من الملف — تأكد أن الصورة/PDF واضحة');
        }
        const extractedImages = extractOcrImages(ocr);
        const { passages, questions, notes, chatModel } = await parseQuestionsWithChat(documentContext, ocr.filename, opts.inferCorrectAnswer, opts.requestedChatModel);
        const questionsWithPassages = fillMissingPassageIds(questions, passages);
        const attachedQuestions = opts.includeQuestionImages
            ? attachOcrImages(questionsWithPassages, extractedImages)
            : questionsWithPassages.map((q) => ({ ...q, question_images: [] }));
        let questionsWithImages = attachedQuestions;
        let imageUploadWarnings = [];
        if (opts.includeQuestionImages) {
            const uploadResult = await uploadQuestionImagesToCloudinary(attachedQuestions);
            questionsWithImages = uploadResult.questions;
            imageUploadWarnings = uploadResult.warnings;
        }
        return {
            filename: ocr.filename,
            mime_type: ocr.mime_type,
            document_type: ocr.document_type,
            page_count: ocr.page_count,
            question_count: questions.length,
            ocr_model: ocr.model,
            chat_model: chatModel,
            infer_correct_answer: opts.inferCorrectAnswer,
            passages,
            extracted_images: opts.includeQuestionImages ? collectQuestionImages(questionsWithImages) : [],
            questions: questionsWithImages,
            notes,
            ...(opts.sourceFiles && opts.sourceFiles.length > 1 && { source_files: opts.sourceFiles }),
            ...(opts.pageRange && { page_range: opts.pageRange }),
            ...(imageUploadWarnings.length > 0 && { image_upload_warnings: imageUploadWarnings }),
        };
    }
}
exports.MistralQuestionExtractionService = MistralQuestionExtractionService;
