"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MistralQuestionExtractionSchema = exports.MistralExtractedQuestionSchema = exports.MistralExtractedPassageSchema = exports.MistralQuestionImageSchema = exports.MistralExtractedOptionSchema = void 0;
const zod_1 = require("zod");
exports.MistralExtractedOptionSchema = zod_1.z.object({
    label: zod_1.z.string().optional(),
    text: zod_1.z
        .string()
        .nullable()
        .optional()
        .transform((value) => value ?? ''),
});
exports.MistralQuestionImageSchema = zod_1.z.object({
    image_id: zod_1.z.string(),
    page_index: zod_1.z.number().int().min(0).optional(),
    image_type: zod_1.z.string().optional(),
    short_description: zod_1.z.string().optional(),
    summary: zod_1.z.string().optional(),
    extracted_text: zod_1.z.string().nullable().optional(),
    image_url: zod_1.z.string().optional(),
    image_base64: zod_1.z.string().optional(),
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
    correct_answer_index: zod_1.z.number().int().min(0).max(3).nullable().optional(),
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
});
exports.MistralQuestionExtractionSchema = zod_1.z.object({
    passages: zod_1.z.array(exports.MistralExtractedPassageSchema).optional().default([]),
    questions: zod_1.z.array(exports.MistralExtractedQuestionSchema),
    notes: zod_1.z.string().optional(),
});
