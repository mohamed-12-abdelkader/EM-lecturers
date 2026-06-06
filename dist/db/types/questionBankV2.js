"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreatePassageWithQuestionsSchema = exports.PassageMcqQuestionSchema = exports.UpdateCorrectAnswerSchema = exports.UpdateQuestionStatusSchema = exports.QuestionMediaSchema = exports.ImageChoicesQuestionSchema = exports.BulkTextQuestionsSchema = exports.TextQuestionSchema = exports.QuestionOptionSchema = void 0;
const zod_1 = require("zod");
// ============================================
// Schemas for Validation
// ============================================
// Option Schema (للخيار الواحد)
exports.QuestionOptionSchema = zod_1.z.object({
    option_index: zod_1.z.number().int().min(0).max(3),
    option_type: zod_1.z.enum(['text', 'image']),
    text_content: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional() // جعلناها optional بدون url validation لأنها قد تكون 'temp' عند رفع الملفات
}).refine((data) => {
    if (data.option_type === 'text') {
        return !!data.text_content && data.text_content.trim().length > 0;
    }
    else {
        // للصور، image_url اختياري عند رفع الملفات (سيتم الحصول عليه بعد الرفع)
        // أو يمكن أن يكون موجوداً إذا كان URL مباشر
        return true; // نسمح بذلك لأننا نرفع ملفات
    }
}, {
    message: 'يجب توفير text_content للخيارات النصية'
});
// Schema لإضافة سؤال نصي واحد (Bulk Add)
exports.TextQuestionSchema = zod_1.z.object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    options: zod_1.z.array(exports.QuestionOptionSchema).length(4, 'يجب أن يكون هناك 4 خيارات'),
    correct_answer_index: zod_1.z.number().int().min(0).max(3, 'الإجابة الصحيحة يجب أن تكون بين 0 و 3'),
    explanation: zod_1.z.string().optional(),
    difficulty_level: zod_1.z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: zod_1.z.number().int().min(1).default(1)
}).refine((data) => {
    // التأكد من أن جميع الخيارات نصية
    return data.options.every(opt => opt.option_type === 'text');
}, {
    message: 'جميع الخيارات يجب أن تكون نصية في النوع الأول'
});
// Schema لإضافة أسئلة نصية جماعية (Bulk Add)
exports.BulkTextQuestionsSchema = zod_1.z.object({
    lesson_id: zod_1.z.number().int().positive(),
    questions: zod_1.z.array(exports.TextQuestionSchema).min(1, 'يجب إضافة سؤال واحد على الأقل')
});
// Schema لإضافة سؤال باختيارات صور
exports.ImageChoicesQuestionSchema = zod_1.z.object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    lesson_id: zod_1.z.number().int().positive(),
    options: zod_1.z.array(exports.QuestionOptionSchema).length(4, 'يجب أن يكون هناك 4 خيارات'),
    correct_answer_index: zod_1.z.number().int().min(0).max(3, 'الإجابة الصحيحة يجب أن تكون بين 0 و 3'),
    explanation: zod_1.z.string().optional(),
    difficulty_level: zod_1.z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: zod_1.z.number().int().min(1).default(1)
}).refine((data) => {
    // التأكد من أن جميع الخيارات صور
    return data.options.every(opt => opt.option_type === 'image');
}, {
    message: 'جميع الخيارات يجب أن تكون صور في النوع الثاني'
});
// Schema لإضافة/تحديث صورة السؤال
// ملاحظة: media_url اختياري لأنه يتم الحصول عليه بعد رفع الملف
exports.QuestionMediaSchema = zod_1.z.object({
    media_type: zod_1.z.enum(['image', 'diagram', 'chart']).default('image'),
    media_url: zod_1.z.string().url('يجب أن يكون رابط صحيح').optional(), // اختياري لأننا نرفع ملف
    media_name: zod_1.z.string().optional(),
    media_size: zod_1.z.number().int().positive().optional()
});
// Schema لتحديث حالة السؤال (Admin)
exports.UpdateQuestionStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['approved', 'rejected']),
    rejection_reason: zod_1.z.string().optional()
}).refine((data) => {
    if (data.status === 'rejected' && !data.rejection_reason) {
        return false;
    }
    return true;
}, {
    message: 'سبب الرفض مطلوب عند رفض السؤال'
});
/** تحديث الإجابة الصحيحة لسؤال (للأدمن) */
exports.UpdateCorrectAnswerSchema = zod_1.z.object({
    correct_answer_index: zod_1.z.number().int().min(0).max(3, 'الإجابة الصحيحة يجب أن تكون بين 0 و 3')
}); // Schema لإضافة قطعة مع أسئلة MCQ
exports.PassageMcqQuestionSchema = zod_1.z.object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    options: zod_1.z.array(exports.QuestionOptionSchema).length(4, 'يجب أن يكون هناك 4 خيارات'),
    correct_answer_index: zod_1.z.number().int().min(0).max(3, 'الإجابة الصحيحة بين 0 و 3'),
    explanation: zod_1.z.string().optional(),
    difficulty_level: zod_1.z.enum(['easy', 'medium', 'hard']).default('medium'),
    points: zod_1.z.number().int().min(1).default(1)
}).refine((data) => data.options.every(opt => opt.option_type === 'text'), { message: 'خيارات أسئلة القطعة يجب أن تكون نصية' });
exports.CreatePassageWithQuestionsSchema = zod_1.z.object({
    lesson_id: zod_1.z.number().int().positive(),
    title: zod_1.z.string().optional(),
    content: zod_1.z.string().min(1, 'نص القطعة مطلوب'),
    questions: zod_1.z.array(exports.PassageMcqQuestionSchema).min(1, 'يجب إضافة سؤال واحد على الأقل')
});
