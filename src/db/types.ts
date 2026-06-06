import { z } from 'zod';

export const UserBase = z.object({
  email: z.string().email(),
  phone: z.string(),
  password: z.string().min(6),
  name: z.string().min(1),
});

export const UserCreate = UserBase;

export const UserUpdate = z.object({
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  name: z.string().optional(),
  role: z.enum(['student', 'admin', 'teacher', 'employee']).optional(),
});

export const User = UserBase.extend({
  id: z.number(),
  role: z.enum(['student', 'admin', 'teacher', 'employee']),
  jti: z.string(),
  created_at: z.string(),
});

export type User = z.infer<typeof User>;

export const CompetitionBase = z.object({
  title: z.string().min(1, 'عنوان المسابقة مطلوب'),
  description: z.string().optional(),
  image_url: z.string().optional(),
  duration: z.number().min(1, 'مدة المسابقة يجب أن تكون أكبر من صفر'),
  grade_id: z.number().min(1, 'الصف الدراسي مطلوب'),
  is_visible: z.boolean().default(true),
  is_active: z.boolean().default(true),
});

export const CompetitionCreate = CompetitionBase;

export const CompetitionUpdate = CompetitionBase.partial();

export const Competition = CompetitionBase.extend({
  id: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.number(),
});

export type Competition = z.infer<typeof Competition>;
export type CompetitionCreate = z.infer<typeof CompetitionCreate>;
export type CompetitionUpdate = z.infer<typeof CompetitionUpdate>;

// Types for Competition Questions
export const CompetitionQuestionBase = z.object({
  question_text: z.string().min(1, 'نص السؤال مطلوب'),
  option_a: z.string().min(1, 'الخيار أ مطلوب'),
  option_b: z.string().min(1, 'الخيار ب مطلوب'),
  option_c: z.string().min(1, 'الخيار ج مطلوب'),
  option_d: z.string().min(1, 'الخيار د مطلوب'),
  correct_answer: z
    .enum(['A', 'B', 'C', 'D'], {
      errorMap: () => ({ message: 'الإجابة الصحيحة يجب أن تكون A, B, C, أو D' }),
    })
    .nullable()
    .optional(),
  points: z.number().min(1, 'النقاط يجب أن تكون أكبر من صفر').default(1),
  question_order: z.number().min(0, 'ترتيب السؤال يجب أن يكون صفر أو أكبر').default(0),
  is_active: z.boolean().default(true),
});

export const CompetitionQuestionCreate = CompetitionQuestionBase.extend({
  competition_id: z.number().min(1, 'معرف المسابقة مطلوب'),
});

export const CompetitionQuestionUpdate = CompetitionQuestionBase.partial();

export const CompetitionQuestion = CompetitionQuestionBase.extend({
  id: z.number(),
  competition_id: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.number(),
});

export const BulkQuestionsCreate = z.object({
  competition_id: z.number().min(1, 'معرف المسابقة مطلوب'),
  questions: z.array(CompetitionQuestionBase).min(1, 'يجب إضافة سؤال واحد على الأقل'),
});

export type CompetitionQuestion = z.infer<typeof CompetitionQuestion>;
export type CompetitionQuestionCreate = z.infer<typeof CompetitionQuestionCreate>;
export type CompetitionQuestionUpdate = z.infer<typeof CompetitionQuestionUpdate>;
export type BulkQuestionsCreate = z.infer<typeof BulkQuestionsCreate>;

// Types for Competition Student Enrollment
export const CompetitionStudentBase = z.object({
  competition_id: z.number().min(1, 'معرف المسابقة مطلوب'),
  student_id: z.number().min(1, 'معرف الطالب مطلوب'),
  is_active: z.boolean().default(true),
});

export const CompetitionStudentCreate = CompetitionStudentBase;

export const CompetitionStudentUpdate = CompetitionStudentBase.partial();

export const CompetitionStudent = CompetitionStudentBase.extend({
  id: z.number(),
  joined_at: z.string(),
});

export type CompetitionStudent = z.infer<typeof CompetitionStudent>;
export type CompetitionStudentCreate = z.infer<typeof CompetitionStudentCreate>;
export type CompetitionStudentUpdate = z.infer<typeof CompetitionStudentUpdate>;

// أنواع نتائج المسابقات
export const CompetitionResultBase = z.object({
  competition_id: z.number(),
  student_id: z.number(),
  score: z.number(),
  total_questions: z.number(),
  correct_answers: z.number(),
  wrong_answers: z.number(),
  total_points: z.number(),
  earned_points: z.number(),
  percentage: z.number(),
  submitted_at: z.date().optional(),
});

export const CompetitionResultCreate = CompetitionResultBase;

export const CompetitionResultUpdate = CompetitionResultBase.partial();

export const CompetitionResult = CompetitionResultBase.extend({
  id: z.number(),
  created_at: z.date(),
  updated_at: z.date(),
});

// أنواع إجابات الطلاب
export const StudentAnswerBase = z.object({
  competition_result_id: z.number(),
  question_id: z.number(),
  student_answer: z.enum(['A', 'B', 'C', 'D']),
  is_correct: z.boolean(),
  points: z.number(),
  earned_points: z.number(),
});

export const StudentAnswerCreate = StudentAnswerBase;

export const StudentAnswerUpdate = StudentAnswerBase.partial();

export const StudentAnswer = StudentAnswerBase.extend({
  id: z.number(),
  created_at: z.date(),
});

// أنواع النتائج مع التفاصيل
export const CompetitionResultWithDetails = CompetitionResult.extend({
  competition: z.object({
    id: z.number(),
    title: z.string(),
    duration: z.number(),
  }),
  student: z.object({
    id: z.number(),
    name: z.string(),
  }),
});

export const StudentAnswerWithQuestion = StudentAnswer.extend({
  question: z.object({
    id: z.number(),
    question_text: z.string(),
    option_a: z.string(),
    option_b: z.string(),
    option_c: z.string(),
    option_d: z.string(),
    correct_answer: z.enum(['A', 'B', 'C', 'D']).nullable(),
  }),
});

// أنواع الترتيب
export const LeaderboardEntry = z.object({
  rank: z.number(),
  student_name: z.string(),
  score: z.number(),
  percentage: z.number(),
  correct_answers: z.number(),
  total_questions: z.number(),
  submitted_at: z.date(),
});

export const CompetitionLeaderboard = z.object({
  competition: z.object({
    id: z.number(),
    title: z.string(),
    total_students: z.number(),
  }),
  leaderboard: z.array(LeaderboardEntry),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean(),
  }),
  filters: z.object({
    grade_id: z.number().nullable(),
    grade_name: z.string(),
  }),
});

export const GlobalLeaderboardEntry = LeaderboardEntry.extend({
  student_id: z.number(),
  grade_name: z.string(),
  competition_title: z.string(),
  competition_id: z.number(),
});

export const GlobalLeaderboard = z.object({
  leaderboard: z.array(GlobalLeaderboardEntry),
  pagination: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    has_more: z.boolean(),
  }),
  filters: z.object({
    grade_id: z.number().nullable(),
    grade_name: z.string(),
  }),
});

// أنواع حل المسابقة
export const SolveCompetitionRequest = z.object({
  answers: z.array(
    z.object({
      question_id: z.number(),
      selected_answer: z.enum(['A', 'B', 'C', 'D']),
    }),
  ),
});

export const SolveCompetitionResponse = z.object({
  score: z.number(),
  total_questions: z.number(),
  correct_answers: z.number(),
  wrong_answers: z.number(),
  total_points: z.number(),
  earned_points: z.number(),
  percentage: z.number(),
  rank: z.number(),
  total_students: z.number(),
  submitted_at: z.date(),
});

// أنواع تفاصيل المسابقة للطالب
export const StudentCompetitionDetails = z.object({
  competition: z.object({
    id: z.number(),
    title: z.string(),
    duration: z.number(),
    grade_id: z.number(),
    is_visible: z.boolean(),
    is_active: z.boolean(),
  }),
  questions: z.array(
    z.object({
      id: z.number(),
      question_text: z.string(),
      option_a: z.string(),
      option_b: z.string(),
      option_c: z.string(),
      option_d: z.string(),
      points: z.number(),
      question_order: z.number(),
    }),
  ),
  has_solved: z.boolean(),
  result: z
    .object({
      score: z.number(),
      total_questions: z.number(),
      correct_answers: z.number(),
      wrong_answers: z.number(),
      total_points: z.number(),
      earned_points: z.number(),
      percentage: z.number(),
      rank: z.number(),
      total_students: z.number(),
      submitted_at: z.date(),
    })
    .optional(),
  answers: z
    .array(
      z.object({
        question_id: z.number(),
        question_text: z.string(),
        student_answer: z.string(),
        correct_answer: z.string(),
        is_correct: z.boolean(),
        points: z.number(),
        earned_points: z.number(),
        explanation: z.string().optional(),
      }),
    )
    .optional(),
});

// Export types
export type CompetitionResult = z.infer<typeof CompetitionResult>;
export type CompetitionResultCreate = z.infer<typeof CompetitionResultCreate>;
export type CompetitionResultUpdate = z.infer<typeof CompetitionResultUpdate>;
export type CompetitionResultWithDetails = z.infer<typeof CompetitionResultWithDetails>;

export type StudentAnswer = z.infer<typeof StudentAnswer>;
export type StudentAnswerCreate = z.infer<typeof StudentAnswerCreate>;
export type StudentAnswerUpdate = z.infer<typeof StudentAnswerUpdate>;
export type StudentAnswerWithQuestion = z.infer<typeof StudentAnswerWithQuestion>;

export type LeaderboardEntry = z.infer<typeof LeaderboardEntry>;
export type CompetitionLeaderboard = z.infer<typeof CompetitionLeaderboard>;
export type GlobalLeaderboardEntry = z.infer<typeof GlobalLeaderboardEntry>;
export type GlobalLeaderboard = z.infer<typeof GlobalLeaderboard>;

export type SolveCompetitionRequest = z.infer<typeof SolveCompetitionRequest>;
export type SolveCompetitionResponse = z.infer<typeof SolveCompetitionResponse>;
export type StudentCompetitionDetails = z.infer<typeof StudentCompetitionDetails>;

// League types
export const LeagueBase = z.object({
  name: z.string().min(1, 'اسم الدوري مطلوب'),
  grade_id: z.number().min(1, 'الصف الدراسي مطلوب'),
  image_url: z.string().optional(),
  matches_count: z.number().min(1, 'عدد المباريات يجب أن يكون أكبر من صفر'),
  start_date: z.string(),
  end_date: z.string(),
  description: z.string().optional(),
  price: z.number().nullable().optional(),
});

export const LeagueCreate = LeagueBase;
export const LeagueUpdate = LeagueBase.partial();

export const League = LeagueBase.extend({
  id: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  created_by: z.number().nullable().optional(),
});

export type League = z.infer<typeof League>;
export type LeagueCreate = z.infer<typeof LeagueCreate>;
export type LeagueUpdate = z.infer<typeof LeagueUpdate>;
