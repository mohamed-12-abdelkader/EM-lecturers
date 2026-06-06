"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.League = exports.LeagueUpdate = exports.LeagueCreate = exports.LeagueBase = exports.StudentCompetitionDetails = exports.SolveCompetitionResponse = exports.SolveCompetitionRequest = exports.GlobalLeaderboard = exports.GlobalLeaderboardEntry = exports.CompetitionLeaderboard = exports.LeaderboardEntry = exports.StudentAnswerWithQuestion = exports.CompetitionResultWithDetails = exports.StudentAnswer = exports.StudentAnswerUpdate = exports.StudentAnswerCreate = exports.StudentAnswerBase = exports.CompetitionResult = exports.CompetitionResultUpdate = exports.CompetitionResultCreate = exports.CompetitionResultBase = exports.CompetitionStudent = exports.CompetitionStudentUpdate = exports.CompetitionStudentCreate = exports.CompetitionStudentBase = exports.BulkQuestionsCreate = exports.CompetitionQuestion = exports.CompetitionQuestionUpdate = exports.CompetitionQuestionCreate = exports.CompetitionQuestionBase = exports.Competition = exports.CompetitionUpdate = exports.CompetitionCreate = exports.CompetitionBase = exports.User = exports.UserUpdate = exports.UserCreate = exports.UserBase = void 0;
const zod_1 = require("zod");
exports.UserBase = zod_1.z.object({
    email: zod_1.z.string().email(),
    phone: zod_1.z.string(),
    password: zod_1.z.string().min(6),
    name: zod_1.z.string().min(1),
});
exports.UserCreate = exports.UserBase;
exports.UserUpdate = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    password: zod_1.z.string().min(6).optional(),
    name: zod_1.z.string().optional(),
    role: zod_1.z.enum(['student', 'admin', 'teacher', 'employee']).optional(),
});
exports.User = exports.UserBase.extend({
    id: zod_1.z.number(),
    role: zod_1.z.enum(['student', 'admin', 'teacher', 'employee']),
    jti: zod_1.z.string(),
    created_at: zod_1.z.string(),
});
exports.CompetitionBase = zod_1.z.object({
    title: zod_1.z.string().min(1, 'عنوان المسابقة مطلوب'),
    description: zod_1.z.string().optional(),
    image_url: zod_1.z.string().optional(),
    duration: zod_1.z.number().min(1, 'مدة المسابقة يجب أن تكون أكبر من صفر'),
    grade_id: zod_1.z.number().min(1, 'الصف الدراسي مطلوب'),
    is_visible: zod_1.z.boolean().default(true),
    is_active: zod_1.z.boolean().default(true),
});
exports.CompetitionCreate = exports.CompetitionBase;
exports.CompetitionUpdate = exports.CompetitionBase.partial();
exports.Competition = exports.CompetitionBase.extend({
    id: zod_1.z.number(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
    created_by: zod_1.z.number(),
});
// Types for Competition Questions
exports.CompetitionQuestionBase = zod_1.z.object({
    question_text: zod_1.z.string().min(1, 'نص السؤال مطلوب'),
    option_a: zod_1.z.string().min(1, 'الخيار أ مطلوب'),
    option_b: zod_1.z.string().min(1, 'الخيار ب مطلوب'),
    option_c: zod_1.z.string().min(1, 'الخيار ج مطلوب'),
    option_d: zod_1.z.string().min(1, 'الخيار د مطلوب'),
    correct_answer: zod_1.z
        .enum(['A', 'B', 'C', 'D'], {
        errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون A, B, C, أو D' }),
    })
        .nullable()
        .optional(),
    points: zod_1.z.number().min(1, 'النقاط يجب أن تكون أكبر من صفر').default(1),
    question_order: zod_1.z.number().min(0, 'ترتيب السؤال يجب أن يكون صفر أو أكبر').default(0),
    is_active: zod_1.z.boolean().default(true),
});
exports.CompetitionQuestionCreate = exports.CompetitionQuestionBase.extend({
    competition_id: zod_1.z.number().min(1, 'معرف المسابقة مطلوب'),
});
exports.CompetitionQuestionUpdate = exports.CompetitionQuestionBase.partial();
exports.CompetitionQuestion = exports.CompetitionQuestionBase.extend({
    id: zod_1.z.number(),
    competition_id: zod_1.z.number(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
    created_by: zod_1.z.number(),
});
exports.BulkQuestionsCreate = zod_1.z.object({
    competition_id: zod_1.z.number().min(1, 'معرف المسابقة مطلوب'),
    questions: zod_1.z.array(exports.CompetitionQuestionBase).min(1, 'يجب إضافة سؤال واحد على الأقل'),
});
// Types for Competition Student Enrollment
exports.CompetitionStudentBase = zod_1.z.object({
    competition_id: zod_1.z.number().min(1, 'معرف المسابقة مطلوب'),
    student_id: zod_1.z.number().min(1, 'معرف الطالب مطلوب'),
    is_active: zod_1.z.boolean().default(true),
});
exports.CompetitionStudentCreate = exports.CompetitionStudentBase;
exports.CompetitionStudentUpdate = exports.CompetitionStudentBase.partial();
exports.CompetitionStudent = exports.CompetitionStudentBase.extend({
    id: zod_1.z.number(),
    joined_at: zod_1.z.string(),
});
// أنواع نتائج المسابقات
exports.CompetitionResultBase = zod_1.z.object({
    competition_id: zod_1.z.number(),
    student_id: zod_1.z.number(),
    score: zod_1.z.number(),
    total_questions: zod_1.z.number(),
    correct_answers: zod_1.z.number(),
    wrong_answers: zod_1.z.number(),
    total_points: zod_1.z.number(),
    earned_points: zod_1.z.number(),
    percentage: zod_1.z.number(),
    submitted_at: zod_1.z.date().optional(),
});
exports.CompetitionResultCreate = exports.CompetitionResultBase;
exports.CompetitionResultUpdate = exports.CompetitionResultBase.partial();
exports.CompetitionResult = exports.CompetitionResultBase.extend({
    id: zod_1.z.number(),
    created_at: zod_1.z.date(),
    updated_at: zod_1.z.date(),
});
// أنواع إجابات الطلاب
exports.StudentAnswerBase = zod_1.z.object({
    competition_result_id: zod_1.z.number(),
    question_id: zod_1.z.number(),
    student_answer: zod_1.z.enum(['A', 'B', 'C', 'D']),
    is_correct: zod_1.z.boolean(),
    points: zod_1.z.number(),
    earned_points: zod_1.z.number(),
});
exports.StudentAnswerCreate = exports.StudentAnswerBase;
exports.StudentAnswerUpdate = exports.StudentAnswerBase.partial();
exports.StudentAnswer = exports.StudentAnswerBase.extend({
    id: zod_1.z.number(),
    created_at: zod_1.z.date(),
});
// أنواع النتائج مع التفاصيل
exports.CompetitionResultWithDetails = exports.CompetitionResult.extend({
    competition: zod_1.z.object({
        id: zod_1.z.number(),
        title: zod_1.z.string(),
        duration: zod_1.z.number(),
    }),
    student: zod_1.z.object({
        id: zod_1.z.number(),
        name: zod_1.z.string(),
    }),
});
exports.StudentAnswerWithQuestion = exports.StudentAnswer.extend({
    question: zod_1.z.object({
        id: zod_1.z.number(),
        question_text: zod_1.z.string(),
        option_a: zod_1.z.string(),
        option_b: zod_1.z.string(),
        option_c: zod_1.z.string(),
        option_d: zod_1.z.string(),
        correct_answer: zod_1.z.enum(['A', 'B', 'C', 'D']).nullable(),
    }),
});
// أنواع الترتيب
exports.LeaderboardEntry = zod_1.z.object({
    rank: zod_1.z.number(),
    student_name: zod_1.z.string(),
    score: zod_1.z.number(),
    percentage: zod_1.z.number(),
    correct_answers: zod_1.z.number(),
    total_questions: zod_1.z.number(),
    submitted_at: zod_1.z.date(),
});
exports.CompetitionLeaderboard = zod_1.z.object({
    competition: zod_1.z.object({
        id: zod_1.z.number(),
        title: zod_1.z.string(),
        total_students: zod_1.z.number(),
    }),
    leaderboard: zod_1.z.array(exports.LeaderboardEntry),
    pagination: zod_1.z.object({
        total: zod_1.z.number(),
        limit: zod_1.z.number(),
        offset: zod_1.z.number(),
        has_more: zod_1.z.boolean(),
    }),
    filters: zod_1.z.object({
        grade_id: zod_1.z.number().nullable(),
        grade_name: zod_1.z.string(),
    }),
});
exports.GlobalLeaderboardEntry = exports.LeaderboardEntry.extend({
    student_id: zod_1.z.number(),
    grade_name: zod_1.z.string(),
    competition_title: zod_1.z.string(),
    competition_id: zod_1.z.number(),
});
exports.GlobalLeaderboard = zod_1.z.object({
    leaderboard: zod_1.z.array(exports.GlobalLeaderboardEntry),
    pagination: zod_1.z.object({
        total: zod_1.z.number(),
        limit: zod_1.z.number(),
        offset: zod_1.z.number(),
        has_more: zod_1.z.boolean(),
    }),
    filters: zod_1.z.object({
        grade_id: zod_1.z.number().nullable(),
        grade_name: zod_1.z.string(),
    }),
});
// أنواع حل المسابقة
exports.SolveCompetitionRequest = zod_1.z.object({
    answers: zod_1.z.array(zod_1.z.object({
        question_id: zod_1.z.number(),
        selected_answer: zod_1.z.enum(['A', 'B', 'C', 'D']),
    })),
});
exports.SolveCompetitionResponse = zod_1.z.object({
    score: zod_1.z.number(),
    total_questions: zod_1.z.number(),
    correct_answers: zod_1.z.number(),
    wrong_answers: zod_1.z.number(),
    total_points: zod_1.z.number(),
    earned_points: zod_1.z.number(),
    percentage: zod_1.z.number(),
    rank: zod_1.z.number(),
    total_students: zod_1.z.number(),
    submitted_at: zod_1.z.date(),
});
// أنواع تفاصيل المسابقة للطالب
exports.StudentCompetitionDetails = zod_1.z.object({
    competition: zod_1.z.object({
        id: zod_1.z.number(),
        title: zod_1.z.string(),
        duration: zod_1.z.number(),
        grade_id: zod_1.z.number(),
        is_visible: zod_1.z.boolean(),
        is_active: zod_1.z.boolean(),
    }),
    questions: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.number(),
        question_text: zod_1.z.string(),
        option_a: zod_1.z.string(),
        option_b: zod_1.z.string(),
        option_c: zod_1.z.string(),
        option_d: zod_1.z.string(),
        points: zod_1.z.number(),
        question_order: zod_1.z.number(),
    })),
    has_solved: zod_1.z.boolean(),
    result: zod_1.z
        .object({
        score: zod_1.z.number(),
        total_questions: zod_1.z.number(),
        correct_answers: zod_1.z.number(),
        wrong_answers: zod_1.z.number(),
        total_points: zod_1.z.number(),
        earned_points: zod_1.z.number(),
        percentage: zod_1.z.number(),
        rank: zod_1.z.number(),
        total_students: zod_1.z.number(),
        submitted_at: zod_1.z.date(),
    })
        .optional(),
    answers: zod_1.z
        .array(zod_1.z.object({
        question_id: zod_1.z.number(),
        question_text: zod_1.z.string(),
        student_answer: zod_1.z.string(),
        correct_answer: zod_1.z.string(),
        is_correct: zod_1.z.boolean(),
        points: zod_1.z.number(),
        earned_points: zod_1.z.number(),
        explanation: zod_1.z.string().optional(),
    }))
        .optional(),
});
// League types
exports.LeagueBase = zod_1.z.object({
    name: zod_1.z.string().min(1, 'اسم الدوري مطلوب'),
    grade_id: zod_1.z.number().min(1, 'الصف الدراسي مطلوب'),
    image_url: zod_1.z.string().optional(),
    matches_count: zod_1.z.number().min(1, 'عدد المباريات يجب أن يكون أكبر من صفر'),
    start_date: zod_1.z.string(),
    end_date: zod_1.z.string(),
    description: zod_1.z.string().optional(),
    price: zod_1.z.number().nullable().optional(),
});
exports.LeagueCreate = exports.LeagueBase;
exports.LeagueUpdate = exports.LeagueBase.partial();
exports.League = exports.LeagueBase.extend({
    id: zod_1.z.number(),
    created_at: zod_1.z.string(),
    updated_at: zod_1.z.string(),
    created_by: zod_1.z.number().nullable().optional(),
});
