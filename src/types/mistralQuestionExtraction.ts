import { z } from 'zod';

export const MistralExtractedOptionSchema = z.object({
  label: z.string().optional(),
  text: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? ''),
});

export const MistralQuestionImageSchema = z.object({
  image_id: z.string(),
  page_index: z.number().int().min(0).optional(),
  image_type: z.string().optional(),
  short_description: z.string().optional(),
  summary: z.string().optional(),
  extracted_text: z.string().nullable().optional(),
  image_url: z.string().optional(),
  image_base64: z.string().optional(),
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
    correct_answer_index: z.number().int().min(0).max(3).nullable().optional(),
    correct_answer_inferred: z.boolean().optional().default(false),
  })
  .superRefine((question, ctx) => {
    if (question.options.length !== 0 && question.options.length !== 4) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'options must be either empty or exactly 4 choices',
      });
    }
  });

export const MistralQuestionExtractionSchema = z.object({
  passages: z.array(MistralExtractedPassageSchema).optional().default([]),
  questions: z.array(MistralExtractedQuestionSchema),
  notes: z.string().optional(),
});

export type MistralExtractedOption = z.infer<typeof MistralExtractedOptionSchema>;
export type MistralQuestionImage = z.infer<typeof MistralQuestionImageSchema>;
export type MistralExtractedPassage = z.infer<typeof MistralExtractedPassageSchema>;
export type MistralExtractedQuestion = z.infer<typeof MistralExtractedQuestionSchema>;
export type MistralQuestionExtraction = z.infer<typeof MistralQuestionExtractionSchema>;

export type MistralOcrImage = {
  id: string;
  page_index: number;
  image_base64?: string;
  annotation?: {
    image_type?: string;
    short_description?: string;
    summary?: string;
    educational_relevance?: string;
    contains_text?: boolean;
    extracted_text?: string | null;
  };
};

export type MistralOcrPage = {
  index: number;
  markdown: string;
  images: MistralOcrImage[];
};

export type MistralOcrResult = {
  filename: string;
  mime_type: string;
  document_type: 'pdf' | 'image';
  model: string;
  page_count: number;
  text: string;
  pages: MistralOcrPage[];
  usage_info?: unknown;
};

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
};
