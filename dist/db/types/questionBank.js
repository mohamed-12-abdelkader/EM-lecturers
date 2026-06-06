"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuestionBankListResponse = exports.CreateTeacherPermissionSchema = exports.TeacherPermissionSchema = exports.UpdateQuestionStatusSchema = exports.CreateQuestionSchema = exports.QuestionSchema = exports.UpdateLessonSchema = exports.CreateLessonSchema = exports.LessonSchema = exports.UpdateChapterSchema = exports.CreateChapterSchema = exports.ChapterSchema = exports.UpdateSubjectSchema = exports.CreateSubjectSchema = exports.SubjectSchema = exports.UpdateQuestionBankSchema = exports.CreateQuestionBankSchema = exports.QuestionBankSchema = void 0;
const zod_1 = require("zod");
// Helpers to coerce common multipart/form-data values
const CoercedBoolean = zod_1.z.preprocess((val) => {
    if (typeof val === 'string') {
        const lowered = val.toLowerCase().trim();
        if (['true', '1', 'yes', 'on'].includes(lowered))
            return true;
        if (['false', '0', 'no', 'off'].includes(lowered))
            return false;
    }
    if (typeof val === 'number') {
        if (val === 1)
            return true;
        if (val === 0)
            return false;
    }
    return val;
}, zod_1.z.boolean());
// Question Bank Schema
exports.QuestionBankSchema = zod_1.z.object({
    id: zod_1.z.number(),
    name: zod_1.z.string().min(1, 'اسم بنك الأسئلة مطلوب'),
    description: zod_1.z.string().optional(),
    price: zod_1.z.number().nonnegative().default(0).optional(),
    grade_id: zod_1.z.number(),
    is_active: zod_1.z.boolean().default(true),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Question Bank Schema
exports.CreateQuestionBankSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم بنك الأسئلة مطلوب'),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    price: zod_1.z.coerce.number().nonnegative().default(0).optional(),
    grade_id: zod_1.z.coerce.number().min(1, 'معرف الصف مطلوب'),
    is_active: CoercedBoolean.default(true),
});
// Update Question Bank Schema
exports.UpdateQuestionBankSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم بنك الأسئلة مطلوب').optional(),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    price: zod_1.z.coerce.number().nonnegative().optional(),
    grade_id: zod_1.z.coerce.number().min(1, 'معرف الصف مطلوب').optional(),
    is_active: CoercedBoolean.optional(),
});
// Subject Schema
exports.SubjectSchema = zod_1.z.object({
    id: zod_1.z.number(),
    name: zod_1.z.string().min(1, 'اسم المادة مطلوب'),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    color: zod_1.z
        .string()
        .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
        .optional(),
    question_bank_id: zod_1.z.number(),
    is_active: zod_1.z.boolean().default(true),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Subject Schema
exports.CreateSubjectSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم المادة مطلوب'),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    color: zod_1.z
        .string()
        .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
        .optional(),
    is_active: zod_1.z.boolean().default(true),
});
// Update Subject Schema
exports.UpdateSubjectSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم المادة مطلوب').optional(),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    color: zod_1.z
        .string()
        .regex(/^#[0-9A-F]{6}$/i, 'لون غير صحيح')
        .optional(),
    is_active: zod_1.z.boolean().optional(),
});
// Chapter Schema
exports.ChapterSchema = zod_1.z.object({
    id: zod_1.z.number(),
    name: zod_1.z.string().min(1, 'اسم الفصل مطلوب'),
    description: zod_1.z.string().optional(),
    subject_id: zod_1.z.number(),
    question_bank_id: zod_1.z.number(),
    order: zod_1.z.number().min(1, 'ترتيب الفصل مطلوب'),
    is_active: zod_1.z.boolean().default(true),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Chapter Schema
exports.CreateChapterSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الفصل مطلوب'),
    description: zod_1.z.string().optional(),
    order: zod_1.z.number().min(1, 'ترتيب الفصل مطلوب'),
    is_active: zod_1.z.boolean().default(true),
});
// Update Chapter Schema
exports.UpdateChapterSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الفصل مطلوب').optional(),
    description: zod_1.z.string().optional(),
    order: zod_1.z.number().min(1, 'ترتيب الفصل مطلوب').optional(),
    is_active: zod_1.z.boolean().optional(),
});
// Lesson Schema
exports.LessonSchema = zod_1.z.object({
    id: zod_1.z.number(),
    name: zod_1.z.string().min(1, 'اسم الدرس مطلوب'),
    description: zod_1.z.string().optional(),
    chapter_id: zod_1.z.number(),
    subject_id: zod_1.z.number(),
    question_bank_id: zod_1.z.number(),
    order: zod_1.z.number().min(1, 'ترتيب الدرس مطلوب'),
    is_active: zod_1.z.boolean().default(true),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Lesson Schema
exports.CreateLessonSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الدرس مطلوب'),
    description: zod_1.z.string().optional(),
    order: zod_1.z.number().min(1, 'ترتيب الدرس مطلوب'),
    is_active: zod_1.z.boolean().default(true),
});
// Update Lesson Schema
exports.UpdateLessonSchema = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الدرس مطلوب').optional(),
    description: zod_1.z.string().optional(),
    order: zod_1.z.number().min(1, 'ترتيب الدرس مطلوب').optional(),
    is_active: zod_1.z.boolean().optional(),
});
// Question Schema
exports.QuestionSchema = zod_1.z.object({
    id: zod_1.z.number(),
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    question_type: zod_1.z.enum(['multiple_choice', 'true_false', 'essay']),
    difficulty_level: zod_1.z.enum(['easy', 'medium', 'hard']),
    correct_answer: zod_1.z.string().optional(),
    explanation: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    lesson_id: zod_1.z.number(),
    chapter_id: zod_1.z.number(),
    subject_id: zod_1.z.number(),
    question_bank_id: zod_1.z.number(),
    teacher_id: zod_1.z.number(),
    status: zod_1.z.enum(['pending', 'approved', 'rejected']).default('pending'),
    rejection_reason: zod_1.z.string().optional(),
    admin_id: zod_1.z.number().optional(),
    reviewed_at: zod_1.z.date().optional(),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Question Schema
exports.CreateQuestionSchema = zod_1.z.object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    question_type: zod_1.z.enum(['multiple_choice', 'true_false', 'essay']),
    difficulty_level: zod_1.z.enum(['easy', 'medium', 'hard']),
    correct_answer: zod_1.z.string().optional(),
    explanation: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
});
// Update Question Status Schema
exports.UpdateQuestionStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['approved', 'rejected']),
    rejection_reason: zod_1.z.string().optional(),
});
// Teacher Permission Schema
exports.TeacherPermissionSchema = zod_1.z.object({
    id: zod_1.z.number(),
    teacher_id: zod_1.z.number(),
    subject_id: zod_1.z.number(),
    question_bank_id: zod_1.z.number(),
    granted_by: zod_1.z.number(),
    granted_at: zod_1.z.date(),
    is_active: zod_1.z.boolean().default(true),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// Create Teacher Permission Schema
exports.CreateTeacherPermissionSchema = zod_1.z.object({
    teacher_id: zod_1.z.number().min(1, 'معرف المدرس مطلوب'),
});
// Question Bank List Response Schema
exports.QuestionBankListResponse = zod_1.z.object({
    question_banks: zod_1.z.array(exports.QuestionBankSchema),
    total: zod_1.z.number(),
    page: zod_1.z.number(),
    limit: zod_1.z.number(),
    totalPages: zod_1.z.number(),
});
