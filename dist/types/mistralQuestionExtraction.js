"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MistralQuestionExtractionResultSchema = exports.MistralQuestionExtractionSchema = exports.MistralExtractedQuestionSchema = exports.MistralExtractedPassageSchema = exports.MistralQuestionImageSchema = exports.MistralExtractedOptionSchema = void 0;
exports.parseQuestionExtractionImportBody = parseQuestionExtractionImportBody;
exports.parseQuestionExtractionImportPayload = parseQuestionExtractionImportPayload;
const zod_1 = require("zod");
exports.MistralExtractedOptionSchema = zod_1.z.object({
    label: zod_1.z.string(),
    text: zod_1.z.string().default(''),
});
exports.MistralQuestionImageSchema = zod_1.z.object({
    image_id: zod_1.z.string(),
    page_index: zod_1.z.number().int().nonnegative().nullable().optional(),
    image_url: zod_1.z.string().url().optional(),
    image_type: zod_1.z.string().optional(),
    short_description: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    educational_relevance: zod_1.z.string().optional(),
});
exports.MistralExtractedPassageSchema = zod_1.z.object({
    passage_id: zod_1.z.string(),
    title: zod_1.z.string().nullable().optional(),
    content: zod_1.z.string().min(1),
});
exports.MistralExtractedQuestionSchema = zod_1.z
    .object({
    number: zod_1.z.number().int().positive(),
    source_number: zod_1.z.string().optional(),
    question_text: zod_1.z.string().default(''),
    passage_id: zod_1.z.string().nullable().optional(),
    options: zod_1.z.array(exports.MistralExtractedOptionSchema).default([]),
    question_images: zod_1.z.array(exports.MistralQuestionImageSchema).optional().default([]),
    correct_answer: zod_1.z.string().nullable().optional(),
    correct_answer_index: zod_1.z.number().int().min(0).nullable().optional(),
    correct_answer_inferred: zod_1.z.boolean().optional().default(false),
})
    .superRefine((question, ctx) => {
    if (question.options.length !== 0 && question.options.length !== 4) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['options'],
            message: 'options must be either empty or exactly 4 choices',
        });
    }
    if (question.correct_answer_index != null &&
        question.correct_answer_index >= question.options.length) {
        ctx.addIssue({
            code: zod_1.z.ZodIssueCode.custom,
            path: ['correct_answer_index'],
            message: 'correct_answer_index is outside options range',
        });
    }
});
exports.MistralQuestionExtractionSchema = zod_1.z.object({
    passages: zod_1.z.array(exports.MistralExtractedPassageSchema).optional().default([]),
    questions: zod_1.z.array(exports.MistralExtractedQuestionSchema),
    notes: zod_1.z.string().optional(),
});
/** Full payload returned by POST /api/ocr/extract-questions (data object). */
exports.MistralQuestionExtractionResultSchema = exports.MistralQuestionExtractionSchema.extend({
    filename: zod_1.z.string().optional(),
    mime_type: zod_1.z.string().optional(),
    document_type: zod_1.z.enum(['pdf', 'image']).optional(),
    page_count: zod_1.z.number().int().nonnegative().optional(),
    question_count: zod_1.z.number().int().nonnegative().optional(),
    ocr_model: zod_1.z.string().optional(),
    chat_model: zod_1.z.string().optional(),
    infer_correct_answer: zod_1.z.boolean().optional(),
    extracted_images: zod_1.z.array(exports.MistralQuestionImageSchema).optional().default([]),
    image_upload_warnings: zod_1.z.array(zod_1.z.string()).optional(),
});
const ImportExtractionInnerSchema = zod_1.z.union([
    exports.MistralQuestionExtractionSchema,
    exports.MistralQuestionExtractionResultSchema,
]);
/**
 * Accepts:
 * - full extract-questions response: { success: true, data: { passages, questions, ... } }
 * - extract data object directly: { passages, questions, filename?, ... }
 * - legacy import body: { extraction: { passages, questions } }
 */
function parseImportInner(body) {
    if (!body || typeof body !== 'object') {
        throw new Error('INVALID_EXTRACTION_PAYLOAD');
    }
    const record = body;
    if (record.data && typeof record.data === 'object') {
        return ImportExtractionInnerSchema.parse(record.data);
    }
    if (record.extraction && typeof record.extraction === 'object') {
        return ImportExtractionInnerSchema.parse(record.extraction);
    }
    if (Array.isArray(record.questions)) {
        return ImportExtractionInnerSchema.parse(record);
    }
    throw new Error('INVALID_EXTRACTION_PAYLOAD');
}
function parseQuestionExtractionImportBody(body) {
    const inner = parseImportInner(body);
    return {
        passages: inner.passages,
        questions: inner.questions,
        notes: inner.notes,
    };
}
function parseQuestionExtractionImportPayload(body) {
    const inner = parseImportInner(body);
    const { passages, questions, notes, ...meta } = inner;
    return {
        meta: { ...meta, notes, question_count: questions.length },
        extraction: { passages, questions, notes },
    };
}
