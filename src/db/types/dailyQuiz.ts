import { z } from 'zod';

export const DailyQuizStatusSchema = z.enum(['draft', 'published', 'archived']);
export const ShowAnswersModeSchema = z.enum(['never', 'after_submit', 'after_end']);
export const ScoringModeSchema = z.enum(['rank_bonus', 'time_ratio']);
export const AttemptStatusSchema = z.enum(['in_progress', 'submitted', 'expired', 'abandoned']);
export const CorrectAnswerSchema = z.enum(['A', 'B', 'C', 'D']);

const flexibleDateTime = z
  .union([z.string().min(8), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v));

const DailyQuizFieldsSchema = z.object({
  title: z.string().min(2).max(255),
  description: z.string().max(5000).optional().nullable(),
  grade_id: z.coerce.number().int().positive(),
  starts_at: flexibleDateTime,
  ends_at: flexibleDateTime,
  duration_seconds: z.coerce.number().int().min(30).max(7200),
  max_points: z.coerce.number().int().min(1).max(100000).default(100),
  allow_one_attempt: z.boolean().default(true),
  questions_target: z.coerce.number().int().min(0).max(200).optional(),
  shuffle_questions: z.boolean().default(true),
  shuffle_options: z.boolean().default(true),
  allow_navigation: z.boolean().default(true),
  show_answers_mode: ShowAnswersModeSchema.default('after_end'),
  scoring_mode: ScoringModeSchema.default('rank_bonus'),
  rank_bonus_start: z.coerce.number().int().min(0).max(1000).default(50),
  rank_bonus_step: z.coerce.number().int().min(0).max(100).default(5),
  rank_bonus_min: z.coerce.number().int().min(0).max(1000).default(0),
  time_ratio_max_bonus: z.coerce.number().int().min(0).max(1000).default(50),
  status: DailyQuizStatusSchema.default('draft'),
  is_visible: z.boolean().default(true),
});

export const CreateDailyQuizSchema = DailyQuizFieldsSchema.refine(
  (d) => new Date(d.ends_at).getTime() > new Date(d.starts_at).getTime(),
  {
    message: 'ends_at must be after starts_at',
    path: ['ends_at'],
  },
);

export const UpdateDailyQuizSchema = DailyQuizFieldsSchema.partial().superRefine((d, ctx) => {
  if (d.starts_at && d.ends_at && new Date(d.ends_at).getTime() <= new Date(d.starts_at).getTime()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'ends_at must be after starts_at',
      path: ['ends_at'],
    });
  }
});

const optionalUrl = z
  .union([z.string().url(), z.literal(''), z.null()])
  .optional()
  .nullable()
  .transform((v) => (v === '' || v == null ? null : v));

export const DailyQuizQuestionInputSchema = z.object({
  question_text: z.string().min(1),
  question_image_url: optionalUrl,
  option_a: z.string().min(1).max(1000),
  option_b: z.string().min(1).max(1000),
  option_c: z.string().min(1).max(1000),
  option_d: z.string().min(1).max(1000),
  option_a_image_url: optionalUrl,
  option_b_image_url: optionalUrl,
  option_c_image_url: optionalUrl,
  option_d_image_url: optionalUrl,
  correct_answer: CorrectAnswerSchema,
  points: z.coerce.number().int().min(0).max(10000).default(100),
  question_order: z.coerce.number().int().min(0).optional(),
});

export const BulkQuestionsSchema = z.object({
  questions: z.array(DailyQuizQuestionInputSchema).min(1).max(100),
});

export const AutosaveAnswersSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.coerce.number().int().positive(),
        selected_answer: CorrectAnswerSchema.nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});

export const SubmitAttemptSchema = z.object({
  answers: z
    .array(
      z.object({
        question_id: z.coerce.number().int().positive(),
        selected_answer: CorrectAnswerSchema.nullable().optional(),
      }),
    )
    .optional()
    .default([]),
  submit_token: z.string().min(8).max(64).optional(),
});

export type CreateDailyQuizInput = z.infer<typeof CreateDailyQuizSchema>;
export type UpdateDailyQuizInput = z.infer<typeof UpdateDailyQuizSchema>;
export type DailyQuizQuestionInput = z.infer<typeof DailyQuizQuestionInputSchema>;

export type DailyQuizRow = {
  id: number;
  tenant_id: number;
  teacher_id: number;
  grade_id: number;
  title: string;
  description: string | null;
  starts_at: Date;
  ends_at: Date;
  duration_seconds: number;
  max_points: number;
  allow_one_attempt: boolean;
  questions_target: number;
  questions_count: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  allow_navigation: boolean;
  show_answers_mode: 'never' | 'after_submit' | 'after_end';
  scoring_mode: 'rank_bonus' | 'time_ratio';
  rank_bonus_start: number;
  rank_bonus_step: number;
  rank_bonus_min: number;
  time_ratio_max_bonus: number;
  status: 'draft' | 'published' | 'archived';
  is_visible: boolean;
  created_at: Date;
  updated_at: Date;
  grade_name?: string;
  teacher_name?: string;
  teacher_avatar?: string | null;
};

export type DailyQuizQuestionRow = {
  id: number;
  quiz_id: number;
  question_text: string;
  question_image_url: string | null;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_a_image_url: string | null;
  option_b_image_url: string | null;
  option_c_image_url: string | null;
  option_d_image_url: string | null;
  correct_answer: 'A' | 'B' | 'C' | 'D';
  points: number;
  question_order: number;
};

export type PublicQuizOption = {
  key: 'A' | 'B' | 'C' | 'D';
  text: string;
  image_url: string | null;
};

export type PublicQuizQuestion = {
  id: number;
  question_text: string;
  question_image_url: string | null;
  points: number;
  options: PublicQuizOption[];
};
