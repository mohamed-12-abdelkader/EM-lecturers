import { z } from 'zod';

// Helpers to coerce common multipart/form-data values
const CoercedBoolean = z.preprocess((val) => {
  if (typeof val === 'string') {
    const lowered = val.toLowerCase().trim();
    if (['true', '1', 'yes', 'on'].includes(lowered)) return true;
    if (['false', '0', 'no', 'off'].includes(lowered)) return false;
  }
  if (typeof val === 'number') {
    if (val === 1) return true;
    if (val === 0) return false;
  }
  return val;
}, z.boolean());

// Question Bank Schema
export const QuestionBankSchema = z.object({
  id: z.number(),
  name: z.string().min(1, 'اسم بنك الأسئلة مطلوب'),
  description: z.string().optional(),
  price: z.number().nonnegative().default(0).optional(),
  grade_id: z.number(),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Question Bank Schema
export const CreateQuestionBankSchema = z.object({
  name: z.string().min(1, 'اسم بنك الأسئلة مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  price: z.coerce.number().nonnegative().default(0).optional(),
  grade_id: z.coerce.number().min(1, 'معرف الصف مطلوب'),
  is_active: CoercedBoolean.default(true),
});

// Update Question Bank Schema
export const UpdateQuestionBankSchema = z.object({
  name: z.string().min(1, 'اسم بنك الأسئلة مطلوب').optional(),
  description: z.string().optional(),
  image_url: z.string().optional(),
  price: z.coerce.number().nonnegative().optional(),
  grade_id: z.coerce.number().min(1, 'معرف الصف مطلوب').optional(),
  is_active: CoercedBoolean.optional(),
});

// Subject Schema
export const SubjectSchema = z.object({
  id: z.number(),
  name: z.string().min(1, 'اسم المادة مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
    .optional(),
  question_bank_id: z.number(),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Subject Schema
export const CreateSubjectSchema = z.object({
  name: z.string().min(1, 'اسم المادة مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
    .optional(),
  is_active: z.boolean().default(true),
});

// Update Subject Schema
export const UpdateSubjectSchema = z.object({
  name: z.string().min(1, 'اسم المادة مطلوب').optional(),
  description: z.string().optional(),
  image_url: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
    .optional(),
  is_active: z.boolean().optional(),
});

// Subject Book Schema
export const SubjectBookSchema = z.object({
  id: z.number(),
  subject_id: z.number(),
  name: z.string().min(1, 'اسم الكتاب مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  order_num: z.number().min(1).default(1),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

export const CreateSubjectBookSchema = z.object({
  name: z.string().min(1, 'اسم الكتاب مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  order_num: z.coerce.number().min(1).optional(),
  is_active: z.boolean().default(true),
});

export const UpdateSubjectBookSchema = z.object({
  name: z.string().min(1, 'اسم الكتاب مطلوب').optional(),
  description: z.string().optional(),
  image_url: z.string().optional(),
  order_num: z.coerce.number().min(1).optional(),
  is_active: z.boolean().optional(),
});

// Chapter Schema
export const ChapterSchema = z.object({
  id: z.number(),
  name: z.string().min(1, 'اسم الفصل مطلوب'),
  description: z.string().optional(),
  subject_id: z.number(),
  book_id: z.number().optional(),
  question_bank_id: z.number(),
  order: z.number().min(1, 'ترتيب الفصل مطلوب'),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Chapter Schema
export const CreateChapterSchema = z.object({
  name: z.string().min(1, 'اسم الفصل مطلوب'),
  description: z.string().optional(),
  order: z.number().min(1, 'ترتيب الفصل مطلوب'),
  is_active: z.boolean().default(true),
});

// Update Chapter Schema
export const UpdateChapterSchema = z.object({
  name: z.string().min(1, 'اسم الفصل مطلوب').optional(),
  description: z.string().optional(),
  order: z.number().min(1, 'ترتيب الفصل مطلوب').optional(),
  is_active: z.boolean().optional(),
});

// Lesson Schema
export const LessonSchema = z.object({
  id: z.number(),
  name: z.string().min(1, 'اسم الدرس مطلوب'),
  description: z.string().optional(),
  chapter_id: z.number(),
  subject_id: z.number(),
  question_bank_id: z.number(),
  order: z.number().min(1, 'ترتيب الدرس مطلوب'),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Lesson Schema
export const CreateLessonSchema = z.object({
  name: z.string().min(1, 'اسم الدرس مطلوب'),
  description: z.string().optional(),
  order: z.number().min(1, 'ترتيب الدرس مطلوب'),
  is_active: z.boolean().default(true),
});

// Update Lesson Schema
export const UpdateLessonSchema = z.object({
  name: z.string().min(1, 'اسم الدرس مطلوب').optional(),
  description: z.string().optional(),
  order: z.number().min(1, 'ترتيب الدرس مطلوب').optional(),
  is_active: z.boolean().optional(),
});

// Question Schema
export const QuestionSchema = z.object({
  id: z.number(),
  question_text: z.string().min(1, 'نص السؤال مطلوب'),
  question_type: z.enum(['multiple_choice', 'true_false', 'essay']),
  difficulty_level: z.enum(['easy', 'medium', 'hard']),
  correct_answer: z.string().optional(),
  explanation: z.string().optional(),
  image_url: z.string().optional(),
  lesson_id: z.number(),
  chapter_id: z.number(),
  subject_id: z.number(),
  question_bank_id: z.number(),
  teacher_id: z.number(),
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  rejection_reason: z.string().optional(),
  admin_id: z.number().optional(),
  reviewed_at: z.date().optional(),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Question Schema
export const CreateQuestionSchema = z.object({
  question_text: z.string().min(1, 'نص السؤال مطلوب'),
  question_type: z.enum(['multiple_choice', 'true_false', 'essay']),
  difficulty_level: z.enum(['easy', 'medium', 'hard']),
  correct_answer: z.string().optional(),
  explanation: z.string().optional(),
  image_url: z.string().optional(),
});

// Update Question Status Schema
export const UpdateQuestionStatusSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  rejection_reason: z.string().optional(),
});

// Teacher Permission Schema
export const TeacherPermissionSchema = z.object({
  id: z.number(),
  teacher_id: z.number(),
  subject_id: z.number(),
  question_bank_id: z.number(),
  granted_by: z.number(),
  granted_at: z.date(),
  is_active: z.boolean().default(true),
  created_at: z.date(),
  updated_at: z.date(),
});

// Create Teacher Permission Schema
export const CreateTeacherPermissionSchema = z.object({
  teacher_id: z.number().min(1, 'معرف المدرس مطلوب'),
});

// Question Bank List Response Schema
export const QuestionBankListResponse = z.object({
  question_banks: z.array(QuestionBankSchema),
  total: z.number(),
  page: z.number(),
  limit: z.number(),
  totalPages: z.number(),
});

// Export types
export type QuestionBank = z.infer<typeof QuestionBankSchema>;
export type CreateQuestionBank = z.infer<typeof CreateQuestionBankSchema>;
export type UpdateQuestionBank = z.infer<typeof UpdateQuestionBankSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type CreateSubject = z.infer<typeof CreateSubjectSchema>;
export type UpdateSubject = z.infer<typeof UpdateSubjectSchema>;
export type SubjectBook = z.infer<typeof SubjectBookSchema>;
export type CreateSubjectBook = z.infer<typeof CreateSubjectBookSchema>;
export type UpdateSubjectBook = z.infer<typeof UpdateSubjectBookSchema>;
export type Chapter = z.infer<typeof ChapterSchema>;
export type CreateChapter = z.infer<typeof CreateChapterSchema>;
export type UpdateChapter = z.infer<typeof UpdateChapterSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type CreateLesson = z.infer<typeof CreateLessonSchema>;
export type UpdateLesson = z.infer<typeof UpdateLessonSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type CreateQuestion = z.infer<typeof CreateQuestionSchema>;
export type UpdateQuestionStatus = z.infer<typeof UpdateQuestionStatusSchema>;
export type TeacherPermission = z.infer<typeof TeacherPermissionSchema>;
export type CreateTeacherPermission = z.infer<typeof CreateTeacherPermissionSchema>;
