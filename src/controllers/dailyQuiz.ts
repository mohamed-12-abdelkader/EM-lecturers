import { Router, Request, Response, NextFunction } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { HttpError } from '../utils';
import {
  AutosaveAnswersSchema,
  BulkQuestionsSchema,
  CreateDailyQuizSchema,
  DailyQuizQuestionInputSchema,
  SubmitAttemptSchema,
  UpdateDailyQuizSchema,
} from '../db/types/dailyQuiz';
import {
  DailyQuizAttemptsService,
  DailyQuizGamification,
  DailyQuizLeaderboard,
  DailyQuizService,
  DailyQuizStatsService,
} from '../services/dailyQuiz';

export const router = Router();

function tenantIdOf(req: Request): number {
  const id = req.tenant?.id;
  if (!id) throw new HttpError(400, 'تعذر تحديد المنصة (tenant)');
  return id;
}

function handleError(err: unknown, res: Response) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, message: err.message, details: err.details });
  }
  if (err && typeof err === 'object' && 'name' in err && (err as { name: string }).name === 'ZodError') {
    return res.status(400).json({
      success: false,
      message: 'بيانات غير صالحة',
      errors: (err as { issues?: unknown }).issues,
    });
  }
  console.error('[daily-quiz]', err);
  return res.status(500).json({ success: false, message: 'خطأ داخلي في المسابقة اليومية' });
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, _next: NextFunction) => {
    try {
      await fn(req, res);
    } catch (err) {
      handleError(err, res);
    }
  };
}

// ─── Teacher ───────────────────────────────────────────────

router.post(
  '/',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const input = CreateDailyQuizSchema.parse(req.body);
    const quiz = await DailyQuizService.create(input, req.user!.id, tenantIdOf(req));
    res.status(201).json({ success: true, data: quiz });
  }),
);

router.get(
  '/teacher',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const data = await DailyQuizService.listForTeacher(req.user!.id, tenantIdOf(req), {
      grade_id: req.query.grade_id ? Number(req.query.grade_id) : undefined,
      status: req.query.status as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 20,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/teacher/:id/stats',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const data = await DailyQuizStatsService.getQuizStats(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/teacher/:id/export.csv',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const csv = await DailyQuizStatsService.exportCsv(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="daily-quiz-${req.params.id}.csv"`);
    res.send('\uFEFF' + csv);
  }),
);

router.get(
  '/teacher/:id/export.pdf-data',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const data = await DailyQuizStatsService.exportPdfPayload(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/teacher/:id',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const quizId = Number(req.params.id);
    const quiz = await DailyQuizService.assertTeacherOwns(quizId, req.user!.id, tenantIdOf(req));
    const questions = await DailyQuizService.listQuestions(quizId, true);
    res.json({ success: true, data: { ...quiz, questions } });
  }),
);

router.patch(
  '/teacher/:id',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const input = UpdateDailyQuizSchema.parse(req.body);
    const quiz = await DailyQuizService.update(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
      input,
    );
    res.json({ success: true, data: quiz });
  }),
);

router.post(
  '/teacher/:id/publish',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const quiz = await DailyQuizService.publish(Number(req.params.id), req.user!.id, tenantIdOf(req));
    res.json({ success: true, data: quiz, message: 'تم نشر المسابقة' });
  }),
);

router.delete(
  '/teacher/:id',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    await DailyQuizService.delete(Number(req.params.id), req.user!.id, tenantIdOf(req));
    res.json({ success: true, message: 'تم حذف المسابقة' });
  }),
);

router.post(
  '/teacher/:id/questions/bulk',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const input = BulkQuestionsSchema.parse(req.body);
    const questions = await DailyQuizService.addQuestionsBulk(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
      input.questions,
    );
    res.status(201).json({ success: true, data: questions });
  }),
);

router.post(
  '/teacher/:id/questions',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const input = DailyQuizQuestionInputSchema.parse(req.body);
    const question = await DailyQuizService.addQuestion(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
      input,
    );
    res.status(201).json({ success: true, data: question });
  }),
);

router.patch(
  '/teacher/:id/questions/:questionId',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    const input = DailyQuizQuestionInputSchema.partial().parse(req.body);
    const question = await DailyQuizService.updateQuestion(
      Number(req.params.id),
      Number(req.params.questionId),
      req.user!.id,
      tenantIdOf(req),
      input,
    );
    res.json({ success: true, data: question });
  }),
);

router.delete(
  '/teacher/:id/questions/:questionId',
  authMiddleware(['teacher', 'admin']),
  wrap(async (req, res) => {
    await DailyQuizService.deleteQuestion(
      Number(req.params.id),
      Number(req.params.questionId),
      req.user!.id,
      tenantIdOf(req),
    );
    res.json({ success: true, message: 'تم حذف السؤال' });
  }),
);

// ─── Student fixed paths (before /:id) ─────────────────────

router.get(
  '/student/home',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const cards = await DailyQuizService.getActiveCardForStudent(req.user!.id, tenantIdOf(req));
    res.json({ success: true, data: { section_title: '🔥 المسابقة اليومية', quizzes: cards } });
  }),
);

router.get(
  '/student/achievements',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const data = await DailyQuizGamification.getAchievements(req.user!.id, tenantIdOf(req));
    res.json({ success: true, data });
  }),
);

router.get(
  '/leaderboard/monthly',
  authMiddleware(['student', 'teacher', 'admin']),
  wrap(async (req, res) => {
    const gradeId = Number(req.query.grade_id);
    if (!gradeId) throw new HttpError(400, 'grade_id مطلوب');
    const data = await DailyQuizLeaderboard.getMonthly({
      tenantId: tenantIdOf(req),
      gradeId,
      yearMonth: req.query.year_month as string | undefined,
      studentId: req.user!.role === 'student' ? req.user!.id : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/leaderboard/monthly/archive',
  authMiddleware(['student', 'teacher', 'admin']),
  wrap(async (req, res) => {
    const gradeId = Number(req.query.grade_id);
    const yearMonth = String(req.query.year_month || '');
    if (!gradeId || !yearMonth) throw new HttpError(400, 'grade_id و year_month مطلوبان');
    const data = await DailyQuizLeaderboard.getArchive(tenantIdOf(req), gradeId, yearMonth);
    res.json({ success: true, data });
  }),
);

router.get(
  '/attempts/:attemptId',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const data = await DailyQuizAttemptsService.getAttemptPayload(
      Number(req.params.attemptId),
      req.user!.id,
      tenantIdOf(req),
      false,
    );
    res.json({ success: true, data });
  }),
);

router.patch(
  '/attempts/:attemptId/answers',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const input = AutosaveAnswersSchema.parse(req.body);
    const data = await DailyQuizAttemptsService.autosave(
      Number(req.params.attemptId),
      req.user!.id,
      tenantIdOf(req),
      input.answers,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  '/attempts/:attemptId/submit',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const input = SubmitAttemptSchema.parse(req.body || {});
    const data = await DailyQuizAttemptsService.submit({
      attemptId: Number(req.params.attemptId),
      studentId: req.user!.id,
      tenantId: tenantIdOf(req),
      answers: input.answers,
      submitToken: input.submit_token,
    });
    res.json({ success: true, data });
  }),
);

// ─── Parametric quiz routes ────────────────────────────────

router.post(
  '/:id/start',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const data = await DailyQuizAttemptsService.startAttempt({
      quizId: Number(req.params.id),
      studentId: req.user!.id,
      tenantId: tenantIdOf(req),
      ip: req.ip,
      userAgent: req.get('user-agent'),
      deviceInfo: req.body?.device_info || null,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  '/:id/result',
  authMiddleware(['student']),
  wrap(async (req, res) => {
    const data = await DailyQuizAttemptsService.getResultPayload(
      Number(req.params.id),
      req.user!.id,
      tenantIdOf(req),
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/:id/leaderboard',
  authMiddleware(['student', 'teacher', 'admin']),
  wrap(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const data = await DailyQuizLeaderboard.getDaily(
      Number(req.params.id),
      req.user!.role === 'student' ? req.user!.id : undefined,
      limit,
    );
    res.json({ success: true, data });
  }),
);
