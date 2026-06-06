"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const assignmentQuestions_1 = require("../services/assignmentQuestions");
const packageSubjectLessons_1 = require("../services/packageSubjectLessons");
const packageSubjectPermissions_1 = require("../services/packageSubjectPermissions");
const packageActivationCodes_1 = require("../services/packageActivationCodes");
const utils_2 = require("../utils");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const zod_1 = require("zod");
const pool_1 = __importDefault(require("../db/pool"));
const router = (0, express_1.Router)();
exports.router = router;
// Configure multer for question images (up to 10 images)
const questionImageUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = 'uploads/assignment-questions';
            if (!fs_1.default.existsSync(uploadDir)) {
                fs_1.default.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
            cb(null, 'question-' + uniqueSuffix + path_1.default.extname(file.originalname));
        },
    }),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB per image
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path_1.default.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        else {
            cb(new Error('فقط ملفات الصور مسموح بها!'));
        }
    },
});
// Helper function للتحقق من صلاحية المدرس على الواجب
async function checkAssignmentPermission(assignmentId, userId, userRole) {
    if (userRole === 'admin') {
        return true;
    }
    if (userRole === 'teacher') {
        // جلب lesson_id من الواجب
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(assignmentId);
        if (!assignment) {
            return false;
        }
        // جلب subject_id من الدرس
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        const subjectId = await packageSubjectLessons_1.PackageSubjectLessonService.getSubjectIdByLessonId(assignment.lesson_id);
        if (!subjectId) {
            return false;
        }
        // التحقق من صلاحية المدرس على المادة
        return await packageSubjectPermissions_1.PackageSubjectPermissionsService.hasPermission(subjectId, userId);
    }
    return false;
}
// Schemas للتحقق من البيانات
const CreateTextQuestionSchema = zod_1.z
    .object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    // الصيغة الجديدة: options كمصفوفة
    options: zod_1.z
        .array(zod_1.z.object({
        option_text: zod_1.z.string().min(1, 'نص الخيار مطلوب'),
        option_letter: zod_1.z.enum(['a', 'b', 'c', 'd'], {
            errorMap: () => ({ message: 'option_letter يجب أن يكون a, b, c, أو d' }),
        }),
    }))
        .length(4, 'يجب إضافة 4 خيارات بالضبط')
        .optional(),
    // الصيغة القديمة: option_a, option_b, option_c, option_d
    option_a: zod_1.z.string().min(1, 'الخيار أ مطلوب').optional(),
    option_b: zod_1.z.string().min(1, 'الخيار ب مطلوب').optional(),
    option_c: zod_1.z.string().min(1, 'الخيار ج مطلوب').optional(),
    option_d: zod_1.z.string().min(1, 'الخيار د مطلوب').optional(),
    correct_answer: zod_1.z.enum(['a', 'b', 'c', 'd'], {
        errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون a, b, c, أو d' }),
    }),
    order_index: zod_1.z.number().int().min(0).optional(),
})
    .refine((data) => {
    // يجب أن يكون إما options أو option_a, option_b, option_c, option_d
    const hasOptions = data.options && data.options.length === 4;
    const hasOldFormat = data.option_a && data.option_b && data.option_c && data.option_d;
    return hasOptions || hasOldFormat;
}, {
    message: 'يجب إرسال إما options (مصفوفة) أو option_a, option_b, option_c, option_d',
});
// Schema لإضافة سؤال بصورة
const CreateImageQuestionSchema = zod_1.z
    .object({
    options: zod_1.z
        .array(zod_1.z.object({
        option_text: zod_1.z.string().min(1, 'نص الخيار مطلوب'),
        option_letter: zod_1.z.enum(['a', 'b', 'c', 'd'], {
            errorMap: () => ({ message: 'option_letter يجب أن يكون a, b, c, أو d' }),
        }),
    }))
        .length(4, 'يجب إضافة 4 خيارات بالضبط')
        .optional(), // اختياري - افتراضي: أ، ب، ج، د
    correct_answer: zod_1.z.enum(['a', 'b', 'c', 'd']).optional(), // اختياري - افتراضي: a
    order_index: zod_1.z
        .union([
        zod_1.z.number().int().min(0),
        zod_1.z.string().transform((val) => {
            const num = parseInt(val, 10);
            if (isNaN(num) || num < 0) {
                throw new Error('order_index يجب أن يكون رقماً صحيحاً موجباً');
            }
            return num;
        }),
    ])
        .optional(),
})
    .passthrough(); // يسمح بأي بيانات إضافية
const UpdateQuestionSchema = zod_1.z.object({
    question_text: zod_1.z.string().min(1).optional(),
    option_a: zod_1.z.string().min(1).optional(),
    option_b: zod_1.z.string().min(1).optional(),
    option_c: zod_1.z.string().min(1).optional(),
    option_d: zod_1.z.string().min(1).optional(),
    correct_answer: zod_1.z.enum(['a', 'b', 'c', 'd']).optional(),
    order_index: zod_1.z.number().int().min(0).optional(),
    image_urls: zod_1.z.array(zod_1.z.string().url()).max(10).optional(),
});
const UpdateCorrectAnswerSchema = zod_1.z.object({
    correct_answer: zod_1.z.enum(['a', 'b', 'c', 'd'], {
        errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون a, b, c, أو d' }),
    }),
});
// 1. إضافة سؤال نصي
router.post('/assignments/:assignmentId/questions/text', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الواجب',
            });
        }
        // التحقق من صحة البيانات
        const parse = CreateTextQuestionSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        // تحويل البيانات إلى الصيغة المطلوبة
        let options;
        if (parse.data.options && parse.data.options.length === 4) {
            // الصيغة الجديدة: options كمصفوفة
            options = parse.data.options;
        }
        else if (parse.data.option_a &&
            parse.data.option_b &&
            parse.data.option_c &&
            parse.data.option_d) {
            // الصيغة القديمة: تحويل option_a, option_b, etc إلى options
            options = [
                { option_text: parse.data.option_a, option_letter: 'a' },
                { option_text: parse.data.option_b, option_letter: 'b' },
                { option_text: parse.data.option_c, option_letter: 'c' },
                { option_text: parse.data.option_d, option_letter: 'd' },
            ];
        }
        else {
            return res.status(400).json({
                error: 'Validation failed',
                message: 'يجب إرسال إما options (مصفوفة) أو option_a, option_b, option_c, option_d',
            });
        }
        const questionData = {
            question_text: parse.data.question_text,
            options: options,
            correct_answer: parse.data.correct_answer,
            order_index: parse.data.order_index,
        };
        const question = await assignmentQuestions_1.AssignmentQuestionsService.createTextQuestion(assignmentId, questionData);
        res.status(201).json({
            success: true,
            message: 'تم إضافة السؤال النصي بنجاح',
            question,
        });
    }
    catch (error) {
        console.error('Error creating text question:', error);
        res.status(500).json({
            error: 'خطأ في إضافة السؤال',
            message: error.message,
        });
    }
}));
// 2. إضافة سؤال بصورة
router.post('/assignments/:assignmentId/questions/image', (0, authentication_1.authMiddleware)(['admin', 'teacher']), questionImageUpload.array('images', 10), // حتى 10 صور
(0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لإضافة أسئلة لهذا الواجب',
            });
        }
        // جلب الملفات المرفوعة
        const files = req.files || [];
        if (files.length === 0) {
            return res.status(400).json({ error: 'يجب رفع صورة واحدة على الأقل' });
        }
        if (files.length > 10) {
            return res.status(400).json({ error: 'الحد الأقصى للصور هو 10 صور' });
        }
        // رفع الصور إلى Cloudinary
        const imageUrls = [];
        const uploadErrors = [];
        for (const file of files) {
            try {
                // التحقق من وجود الملف
                if (!fs_1.default.existsSync(file.path)) {
                    throw new Error(`الملف غير موجود: ${file.path}`);
                }
                const uploaded = await (0, utils_2.uploadToCloudinary)(file.path);
                imageUrls.push(uploaded.secure_url);
                // لا نحذف الملف هنا لأن uploadToCloudinary يحذفه تلقائياً
            }
            catch (error) {
                console.error('Error uploading image:', {
                    filename: file.originalname,
                    path: file.path,
                    size: file.size,
                    mimetype: file.mimetype,
                    error: error.message,
                    stack: error.stack,
                });
                uploadErrors.push({
                    filename: file.originalname,
                    error: error.message || error.toString() || 'فشل في رفع الصورة',
                    path: file.path,
                    details: error.response?.data || error.http_code || null,
                });
                // حذف الملف المحلي حتى لو فشل الرفع
                try {
                    if (fs_1.default.existsSync(file.path)) {
                        fs_1.default.unlinkSync(file.path);
                    }
                }
                catch (unlinkError) {
                    console.error('Error deleting file:', unlinkError);
                }
            }
        }
        if (uploadErrors.length > 0) {
            return res.status(500).json({
                error: 'فشل في رفع بعض الصور',
                errors: uploadErrors,
                uploaded_count: imageUrls.length,
                failed_count: uploadErrors.length,
            });
        }
        // التحقق من صحة البيانات (اختياري - للخيارات المخصصة)
        const parse = CreateImageQuestionSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        // تحضير البيانات
        const questionData = {
            image_urls: imageUrls,
            order_index: parse.data.order_index,
        };
        // إذا تم إرسال خيارات مخصصة، استخدمها
        if (parse.data.options && parse.data.options.length === 4) {
            questionData.options = parse.data.options;
            questionData.correct_answer = parse.data.correct_answer || 'a';
        }
        const question = await assignmentQuestions_1.AssignmentQuestionsService.createImageQuestion(assignmentId, questionData);
        res.status(201).json({
            success: true,
            message: 'تم إضافة السؤال بالصورة بنجاح',
            question,
        });
    }
    catch (error) {
        console.error('Error creating image question:', error);
        res.status(500).json({
            error: 'خطأ في إضافة السؤال',
            message: error.message,
        });
    }
}));
// 3. تحديث الإجابة الصحيحة
router.patch('/assignment-questions/:questionId/correct-answer', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const questionId = parseInt(req.params.questionId);
        if (isNaN(questionId)) {
            return res.status(400).json({ error: 'Invalid question ID' });
        }
        // التحقق من وجود السؤال
        const existingQuestion = await assignmentQuestions_1.AssignmentQuestionsService.getQuestionById(questionId);
        if (!existingQuestion) {
            return res.status(404).json({ error: 'السؤال غير موجود' });
        }
        // جلب assignment_id من السؤال
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(existingQuestion.assignment_id);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لتعديل هذا السؤال',
            });
        }
        // التحقق من صحة البيانات
        const parse = UpdateCorrectAnswerSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const updatedQuestion = await assignmentQuestions_1.AssignmentQuestionsService.updateCorrectAnswer(questionId, parse.data.correct_answer);
        res.json({
            success: true,
            message: 'تم تحديث الإجابة الصحيحة بنجاح',
            question: updatedQuestion,
        });
    }
    catch (error) {
        console.error('Error updating correct answer:', error);
        res.status(500).json({
            error: 'خطأ في تحديث الإجابة الصحيحة',
            message: error.message,
        });
    }
}));
// 4. تحديث سؤال
router.put('/assignment-questions/:questionId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const questionId = parseInt(req.params.questionId);
        if (isNaN(questionId)) {
            return res.status(400).json({ error: 'Invalid question ID' });
        }
        // التحقق من وجود السؤال
        const existingQuestion = await assignmentQuestions_1.AssignmentQuestionsService.getQuestionById(questionId);
        if (!existingQuestion) {
            return res.status(404).json({ error: 'السؤال غير موجود' });
        }
        // جلب assignment_id من السؤال
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(existingQuestion.assignment_id);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لتعديل هذا السؤال',
            });
        }
        // التحقق من صحة البيانات
        const parse = UpdateQuestionSchema.safeParse(req.body);
        if (!parse.success) {
            return res.status(400).json({
                error: 'Validation failed',
                errors: parse.error.errors,
            });
        }
        const updatedQuestion = await assignmentQuestions_1.AssignmentQuestionsService.updateQuestion(questionId, parse.data);
        res.json({
            success: true,
            message: 'تم تحديث السؤال بنجاح',
            question: updatedQuestion,
        });
    }
    catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({
            error: 'خطأ في تحديث السؤال',
            message: error.message,
        });
    }
}));
// 5. حذف سؤال
router.delete('/assignment-questions/:questionId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const questionId = parseInt(req.params.questionId);
        if (isNaN(questionId)) {
            return res.status(400).json({ error: 'Invalid question ID' });
        }
        // التحقق من وجود السؤال
        const existingQuestion = await assignmentQuestions_1.AssignmentQuestionsService.getQuestionById(questionId);
        if (!existingQuestion) {
            return res.status(404).json({ error: 'السؤال غير موجود' });
        }
        // جلب assignment_id من السؤال
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(existingQuestion.assignment_id);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        const user = req.user;
        // التحقق من الصلاحيات
        const hasPermission = await checkAssignmentPermission(assignment.id, user.id, user.role);
        if (!hasPermission) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'ليس لديك صلاحية لحذف هذا السؤال',
            });
        }
        await assignmentQuestions_1.AssignmentQuestionsService.deleteQuestion(questionId);
        res.json({
            success: true,
            message: 'تم حذف السؤال بنجاح',
        });
    }
    catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({
            error: 'خطأ في حذف السؤال',
            message: error.message,
        });
    }
}));
// 6. عرض أسئلة واجب معين
router.get('/assignments/:assignmentId/questions', (0, authentication_1.authMiddleware)(['admin', 'teacher', 'student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const user = req.user;
        console.log('[Admin/Teacher Questions Endpoint] Request received', {
            assignmentId: req.params.assignmentId,
            userId: user.id,
            userRole: user.role,
            url: req.url,
            method: req.method,
        });
        // للطلاب: يجب توجيههم إلى endpoint المخصص لهم في assignmentSubmissions
        if (user.role === 'student') {
            console.warn('[Admin/Teacher Questions Endpoint] Student trying to access admin endpoint, should use assignmentSubmissions');
            // لا نمنعهم هنا، لكن نتحقق من الصلاحيات
        }
        const assignmentId = parseInt(req.params.assignmentId);
        if (isNaN(assignmentId)) {
            return res.status(400).json({ error: 'Invalid assignment ID' });
        }
        // التحقق من وجود الواجب
        const assignment = await assignmentQuestions_1.AssignmentQuestionsService.getAssignmentById(assignmentId);
        if (!assignment) {
            return res.status(404).json({ error: 'الواجب غير موجود' });
        }
        // للطلاب: التحقق من الاشتراك في الباقة
        if (user.role === 'student') {
            // جلب lesson_id من الواجب
            if (!assignment.lesson_id) {
                console.error('[Student Access] Assignment has no lesson_id:', assignmentId);
                return res.status(404).json({ error: 'الواجب غير مرتبط بدرس' });
            }
            // جلب lesson
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const lesson = await packageSubjectLessons_1.PackageSubjectLessonService.getLessonById(assignment.lesson_id);
            if (!lesson) {
                console.error('[Student Access] Lesson not found:', assignment.lesson_id);
                return res.status(404).json({ error: 'الدرس غير موجود' });
            }
            // جلب subject_id من الدرس (package_subject_item_id)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error
            const subjectId = await packageSubjectLessons_1.PackageSubjectLessonService.getSubjectIdByLessonId(lesson.id);
            if (!subjectId) {
                console.error('[Student Access] Subject not found for lesson:', lesson.id);
                return res.status(404).json({ error: 'المادة غير موجودة' });
            }
            // جلب package_id من المادة
            const subjectResult = await pool_1.default.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
            if (!subjectResult.rowCount) {
                console.error('[Student Access] Package not found for subject:', subjectId);
                return res.status(404).json({ error: 'المادة غير موجودة' });
            }
            const packageId = subjectResult.rows[0].package_id;
            console.log('[Student Access Check]', {
                assignmentId,
                lessonId: assignment.lesson_id,
                subjectId,
                packageId,
                studentId: user.id,
            });
            // التحقق من تفعيل الباقة
            const isActivated = await packageActivationCodes_1.PackageActivationCodeService.isActivated(packageId, user.id);
            console.log('[Student Access Result]', {
                assignmentId,
                packageId,
                studentId: user.id,
                isActivated,
            });
            if (!isActivated) {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب',
                    details: {
                        assignment_id: assignmentId,
                        lesson_id: assignment.lesson_id,
                        subject_id: subjectId,
                        package_id: packageId,
                        student_id: user.id,
                    },
                });
            }
        }
        // للأدمن والمدرسين: التحقق من الصلاحيات
        if (user.role === 'admin' || user.role === 'teacher') {
            const hasPermission = await checkAssignmentPermission(assignmentId, user.id, user.role);
            if (!hasPermission && user.role === 'teacher') {
                return res.status(403).json({
                    error: 'Forbidden',
                    message: 'ليس لديك صلاحية لعرض أسئلة هذا الواجب',
                });
            }
        }
        const questions = await assignmentQuestions_1.AssignmentQuestionsService.getQuestionsByAssignment(assignmentId);
        res.json({
            success: true,
            assignment_id: assignmentId,
            questions,
            total: questions.length,
        });
    }
    catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({
            error: 'خطأ في جلب الأسئلة',
            message: error.message,
        });
    }
}));
