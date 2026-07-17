import { z } from 'zod';

// ============================================
// Types
// ============================================

export type QuestionType = 'text_only' | 'text_with_image' | 'image_choices';
export type OptionType = 'text' | 'image';
export type DifficultyLevel = 'easy' | 'medium' | 'hard';
export type QuestionStatus = 'pending' | 'approved' | 'rejected';

/** MCQ text options: 2–5 (e.g. 3 or 5 choices in English exams). */
export const MIN_QUESTION_OPTIONS = 2;
export const MAX_QUESTION_OPTIONS = 5;
export const MAX_OPTION_INDEX = MAX_QUESTION_OPTIONS - 1; // 0..4

export interface QuestionPassage {
  id: number;
  lesson_id: number;
  title?: string;
  content: string;
  order_index: number;
  created_at: Date;
  updated_at: Date;
}

export interface QuestionV2 {
  id: number;
  question_text: string;
  question_type: QuestionType;
  lesson_id: number;
  teacher_id: number;
  correct_answer_index: number; // 0–4 depending on option count
  explanation?: string;
  difficulty_level: DifficultyLevel;
  points: number;
  status: QuestionStatus;
  approved_by?: number;
  approved_at?: Date;
  rejection_reason?: string;
  created_at: Date;
  updated_at: Date;
  passage_id?: number | null;
  // Relations
  options?: QuestionOption[];
  media?: QuestionMedia;
  passage?: QuestionPassage;
}

export interface QuestionOption {
  id: number;
  question_id: number;
  option_index: number; // 0–4
  option_type: OptionType;
  text_content?: string;
  image_url?: string;
  created_at: Date;
}

export interface QuestionMedia {
  id: number;
  question_id: number;
  media_type: 'image' | 'diagram' | 'chart';
  media_url: string;
  media_name?: string;
  media_size?: number;
  uploaded_by: number;
  created_at: Date;
}

// ============================================
// Schemas for Validation
// ============================================

// Option Schema (للخيار الواحد)
export const QuestionOptionSchema = z.object({
  option_index: z.number().int().min(0).max(MAX_OPTION_INDEX),
  option_type: z.enum(['text', 'image']),
  text_content: z.string().optional(),
  image_url: z.string().optional(), // optional عند رفع الملفات
}).refine(
  (data) => {
    if (data.option_type === 'text') {
      return !!data.text_content && data.text_content.trim().length > 0;
    }
    return true;
  },
  {
    message: 'يجب توفير text_content للخيارات النصية',
  },
);

const correctAnswerWithinOptions = <
  T extends { options: Array<{ option_index: number }>; correct_answer_index: number },
>(
  data: T,
) =>
  data.correct_answer_index >= 0 && data.correct_answer_index < data.options.length;

// Schema لإضافة سؤال نصي واحد (Bulk Add)
export const TextQuestionSchema = z
  .object({
    question_text: z.string().min(1, 'نص السؤال مطلوب'),
    options: z
      .array(QuestionOptionSchema)
      .min(MIN_QUESTION_OPTIONS, `يجب إضافة ${MIN_QUESTION_OPTIONS} خيارات على الأقل`)
      .max(MAX_QUESTION_OPTIONS, `الحد الأقصى ${MAX_QUESTION_OPTIONS} خيارات`),
    correct_answer_index: z
      .number()
      .int()
      .min(0)
      .max(MAX_OPTION_INDEX, `الإجابة الصحيحة يجب أن تكون بين 0 و ${MAX_OPTION_INDEX}`),
    explanation: z.string().optional(),
    difficulty_level: z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: z.number().int().min(1).default(1),
  })
  .refine((data) => data.options.every((opt) => opt.option_type === 'text'), {
    message: 'جميع الخيارات يجب أن تكون نصية في النوع الأول',
  })
  .refine(correctAnswerWithinOptions, {
    message: 'correct_answer_index خارج نطاق options',
    path: ['correct_answer_index'],
  });

// Schema لإضافة أسئلة نصية جماعية (Bulk Add)
export const BulkTextQuestionsSchema = z.object({
  lesson_id: z.number().int().positive(),
  questions: z.array(TextQuestionSchema).min(1, 'يجب إضافة سؤال واحد على الأقل'),
});

// Schema لإضافة سؤال باختيارات صور (ما زال 4 صور حسب مسار الرفع الحالي)
export const ImageChoicesQuestionSchema = z
  .object({
    question_text: z.string().min(1, 'نص السؤال مطلوب'),
    lesson_id: z.number().int().positive(),
    options: z.array(QuestionOptionSchema).length(4, 'يجب أن يكون هناك 4 خيارات صور'),
    correct_answer_index: z
      .number()
      .int()
      .min(0)
      .max(3, 'الإجابة الصحيحة يجب أن تكون بين 0 و 3'),
    explanation: z.string().optional(),
    difficulty_level: z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: z.number().int().min(1).default(1),
  })
  .refine((data) => data.options.every((opt) => opt.option_type === 'image'), {
    message: 'جميع الخيارات يجب أن تكون صور في النوع الثاني',
  });

// Schema لإضافة/تحديث صورة السؤال
export const QuestionMediaSchema = z.object({
  media_type: z.enum(['image', 'diagram', 'chart']).default('image'),
  media_url: z.string().url('يجب أن يكون رابط صحيح').optional(),
  media_name: z.string().optional(),
  media_size: z.number().int().positive().optional(),
});

// Schema لتحديث حالة السؤال (Admin)
export const UpdateQuestionStatusSchema = z
  .object({
    status: z.enum(['approved', 'rejected']),
    rejection_reason: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.status === 'rejected' && !data.rejection_reason) {
        return false;
      }
      return true;
    },
    {
      message: 'سبب الرفض مطلوب عند رفض السؤال',
    },
  );

/** تحديث الإجابة الصحيحة لسؤال (للأدمن) */
export const UpdateCorrectAnswerSchema = z.object({
  correct_answer_index: z
    .number()
    .int()
    .min(0)
    .max(MAX_OPTION_INDEX, `الإجابة الصحيحة يجب أن تكون بين 0 و ${MAX_OPTION_INDEX}`),
});

export const PassageMcqQuestionSchema = z
  .object({
    question_text: z.string().min(1, 'نص السؤال مطلوب'),
    options: z
      .array(QuestionOptionSchema)
      .min(MIN_QUESTION_OPTIONS, `يجب إضافة ${MIN_QUESTION_OPTIONS} خيارات على الأقل`)
      .max(MAX_QUESTION_OPTIONS, `الحد الأقصى ${MAX_QUESTION_OPTIONS} خيارات`),
    correct_answer_index: z
      .number()
      .int()
      .min(0)
      .max(MAX_OPTION_INDEX, `الإجابة الصحيحة بين 0 و ${MAX_OPTION_INDEX}`),
    explanation: z.string().optional(),
    difficulty_level: z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: z.number().int().min(1).default(1),
  })
  .refine((data) => data.options.every((opt) => opt.option_type === 'text'), {
    message: 'خيارات أسئلة القطعة يجب أن تكون نصية',
  })
  .refine(correctAnswerWithinOptions, {
    message: 'correct_answer_index خارج نطاق options',
    path: ['correct_answer_index'],
  });

export const CreatePassageWithQuestionsSchema = z.object({
  lesson_id: z.number().int().positive(),
  title: z.string().optional(),
  content: z.string().min(1, 'نص القطعة مطلوب'),
  questions: z.array(PassageMcqQuestionSchema).min(1, 'يجب إضافة سؤال واحد على الأقل'),
});
