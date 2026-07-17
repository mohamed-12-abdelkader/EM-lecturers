import { z } from 'zod';

/** MCQ with choices: 2–5 options (e.g. 3 or 5 in English exams). Empty = no choices. */
export const MIN_MCQ_OPTIONS = 2;
export const MAX_MCQ_OPTIONS = 5;

export function isValidMistralOptionCount(count: number): boolean {
  return count === 0 || (count >= MIN_MCQ_OPTIONS && count <= MAX_MCQ_OPTIONS);
}

export const MistralExtractedOptionSchema = z.object({
  label: z.string(),
  text: z.string().default(''),
});

export const MistralQuestionImageSchema = z.object({
  image_id: z.string(),
  page_index: z.number().int().nonnegative().nullable().optional(),
  image_url: z.string().url().optional(),
  image_type: z.string().optional(),
  short_description: z.string().optional(),
  summary: z.string().optional(),
  educational_relevance: z.string().optional(),
});

export const MistralExtractedPassageSchema = z.object({
  passage_id: z.string(),
  title: z.string().nullable().optional(),
  content: z.string().min(1),
});

export const MistralExtractedQuestionSchema = z
  .object({
    number: z.number().int().positive(),
    source_number: z.string().optional(),
    question_text: z.string().default(''),
    passage_id: z.string().nullable().optional(),
    options: z.array(MistralExtractedOptionSchema).default([]),
    question_images: z.array(MistralQuestionImageSchema).optional().default([]),
    correct_answer: z.string().nullable().optional(),
    correct_answer_index: z.number().int().min(0).nullable().optional(),
    correct_answer_inferred: z.boolean().optional().default(false),
  })
  .superRefine((question, ctx) => {
    if (!isValidMistralOptionCount(question.options.length)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: `options must be empty or contain ${MIN_MCQ_OPTIONS}–${MAX_MCQ_OPTIONS} choices`,
      });
    }

    if (
      question.correct_answer_index != null &&
      question.correct_answer_index >= question.options.length
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correct_answer_index'],
        message: 'correct_answer_index is outside options range',
      });
    }
  });

export const MistralQuestionExtractionSchema = z.object({
  passages: z.array(MistralExtractedPassageSchema).optional().default([]),
  questions: z.array(MistralExtractedQuestionSchema),
  notes: z.string().optional(),
});

/** Full payload returned by POST /api/ocr/extract-questions (data object). */
export const MistralQuestionExtractionResultSchema = MistralQuestionExtractionSchema.extend({
  filename: z.string().optional(),
  mime_type: z.string().optional(),
  document_type: z.enum(['pdf', 'image']).optional(),
  page_count: z.number().int().nonnegative().optional(),
  question_count: z.number().int().nonnegative().optional(),
  ocr_model: z.string().optional(),
  chat_model: z.string().optional(),
  infer_correct_answer: z.boolean().optional(),
  extracted_images: z.array(MistralQuestionImageSchema).optional().default([]),
  image_upload_warnings: z.array(z.string()).optional(),
});

const ImportExtractionInnerSchema = z.union([
  MistralQuestionExtractionSchema,
  MistralQuestionExtractionResultSchema,
]);

/**
 * Accepts:
 * - full extract-questions response: { success: true, data: { passages, questions, ... } }
 * - extract data object directly: { passages, questions, filename?, ... }
 * - legacy import body: { extraction: { passages, questions } }
 */
function parseImportInner(body: unknown): z.infer<typeof ImportExtractionInnerSchema> {
  if (!body || typeof body !== 'object') {
    throw new Error('INVALID_EXTRACTION_PAYLOAD');
  }

  const record = body as Record<string, unknown>;

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

export function parseQuestionExtractionImportBody(body: unknown): z.infer<typeof MistralQuestionExtractionSchema> {
  const inner = parseImportInner(body);
  return {
    passages: inner.passages,
    questions: inner.questions,
    notes: inner.notes,
  };
}

export function parseQuestionExtractionImportPayload(body: unknown): {
  meta: Partial<MistralQuestionExtractionResult>;
  extraction: z.infer<typeof MistralQuestionExtractionSchema>;
} {
  const inner = parseImportInner(body);
  const { passages, questions, notes, ...meta } = inner;
  return {
    meta: { ...meta, notes, question_count: questions.length },
    extraction: { passages, questions, notes },
  };
}

export type MistralExtractedOption = z.infer<typeof MistralExtractedOptionSchema>;
export type MistralQuestionImage = z.infer<typeof MistralQuestionImageSchema>;
export type MistralExtractedPassage = z.infer<typeof MistralExtractedPassageSchema>;
export type MistralExtractedQuestion = z.infer<typeof MistralExtractedQuestionSchema>;
export type MistralQuestionExtractionPayload = z.infer<typeof MistralQuestionExtractionSchema>;

export type MistralQuestionExtractionResult = {
  filename: string;
  mime_type: string;
  document_type: 'pdf' | 'image';
  page_count: number;
  question_count: number;
  ocr_model: string;
  chat_model: string;
  infer_correct_answer: boolean;
  passages: MistralExtractedPassage[];
  extracted_images: MistralQuestionImage[];
  questions: MistralExtractedQuestion[];
  notes?: string;
  image_upload_warnings?: string[];
  source_files?: Array<{ filename: string; mime_type: string }>;
  page_range?: {
    start_page: number;
    end_page: number;
    pages_processed: number;
  };
};

export type MistralQuestionExtractionOptions = {
  inferCorrectAnswer?: boolean;
  includeQuestionImages?: boolean;
  chatModel?: string;
  ocrModel?: string;
  /** 1-based inclusive PDF page range (converted to Mistral 0-based indices). */
  startPage?: number;
  endPage?: number;
};
