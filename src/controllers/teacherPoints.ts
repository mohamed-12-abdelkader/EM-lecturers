import { Router, Request } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherPointsService } from '../services/teacherPoints';

export const router = Router();

function resolveTeacherId(req: Request): number {
  const user = req.user!;
  if (user.role === 'teacher' || user.role === 'academy') {
    return user.id;
  }
  // admin acting — require teacherId query/body
  const raw = req.query.teacherId ?? req.body?.teacherId;
  const id = Number(raw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new HttpError(400, 'teacherId is required for admin');
  }
  return id;
}

const SettingsSchema = z.object({
  video_watch_enabled: z.boolean().optional(),
  video_watch_points: z.number().int().min(0).optional(),
  exam_start_enabled: z.boolean().optional(),
  exam_start_points: z.number().int().min(0).optional(),
  assignment_start_enabled: z.boolean().optional(),
  assignment_start_points: z.number().int().min(0).optional(),
  exam_score_enabled: z.boolean().optional(),
  assignment_score_enabled: z.boolean().optional(),
});

const ManualSchema = z.object({
  studentId: z.number().int().positive(),
  points: z.number().int().positive(),
  reason: z.string().min(1).max(500),
  gradeId: z.number().int().positive().optional().nullable(),
});

const ResetAllPointsSchema = z.object({
  confirm: z.literal('RESET_ALL_POINTS'),
  gradeId: z.number().int().positive().optional().nullable(),
  label: z.string().trim().max(200).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

const RestoreSeasonSchema = z.object({
  confirm: z.literal('RESTORE_POINTS_SEASON'),
});

/** GET /api/teacher/points/settings */
router.get(
  '/settings',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const settings = await TeacherPointsService.getOrCreateSettings(teacherId);
    res.json({ success: true, data: settings });
  }),
);

/** PUT /api/teacher/points/settings */
router.put(
  '/settings',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid settings payload',
        errors: parsed.error.errors,
      });
    }
    const settings = await TeacherPointsService.updateSettings(teacherId, parsed.data);
    res.json({ success: true, data: settings });
  }),
);

/** GET /api/teacher/points/leaderboard */
router.get(
  '/leaderboard',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const gradeId = req.query.gradeId ? Number(req.query.gradeId) : undefined;
    const groupId = req.query.groupId ? Number(req.query.groupId) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const page = req.query.page ? Number(req.query.page) : 1;
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const data = await TeacherPointsService.getTeacherLeaderboard({
      teacherId,
      gradeId: gradeId && Number.isFinite(gradeId) ? gradeId : null,
      groupId: groupId && Number.isFinite(groupId) ? groupId : null,
      search,
      page,
      limit,
    });
    res.json({ success: true, data });
  }),
);

/** POST /api/teacher/points/manual */
router.post(
  '/manual',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = ManualSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Invalid body: studentId, points, reason required',
        errors: parsed.error.errors,
      });
    }
    const result = await TeacherPointsService.addManualReward({
      teacherId,
      studentId: parsed.data.studentId,
      points: parsed.data.points,
      reason: parsed.data.reason,
      gradeId: parsed.data.gradeId,
    });
    res.json({
      success: true,
      data: {
        awarded: result.awarded,
        points: result.points,
        totalPoints: result.totalPoints,
        transactionId: result.transactionId,
      },
    });
  }),
);

/** GET /api/teacher/points/students/:studentId/transactions */
router.get(
  '/students/:studentId/transactions',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const studentId = Number(req.params.studentId);
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid studentId' });
    }
    const gradeId = req.query.gradeId ? Number(req.query.gradeId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const transactions = await TeacherPointsService.listStudentTransactions({
      teacherId,
      studentId,
      gradeId: gradeId && Number.isFinite(gradeId) ? gradeId : null,
      limit,
    });
    res.json({ success: true, data: { studentId, transactions } });
  }),
);

/**
 * DELETE /api/teacher/points/transactions/:transactionId
 * حذف نقاط منحها المدرس يدوياً (MANUAL_REWARD) وخصمها من رصيد الطالب
 */
router.delete(
  '/transactions/:transactionId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const transactionId = Number(req.params.transactionId);
    if (!Number.isFinite(transactionId) || transactionId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid transactionId' });
    }

    try {
      const result = await TeacherPointsService.revokeManualReward({
        teacherId,
        transactionId,
      });
      return res.json({
        success: true,
        message: 'تم حذف النقاط الممنوحة بنجاح',
        data: result,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }
      throw error;
    }
  }),
);

/**
 * POST /api/teacher/points/reset
 * تصفير نقاط الطلاب والبدء من الصفر مع حفظ الموسم السابق في الأرشيف
 * Body: { "confirm": "RESET_ALL_POINTS", "gradeId"?: number, "label"?: string, "reason"?: string }
 */
router.post(
  '/reset',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = ResetAllPointsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'للتأكيد أرسل confirm: "RESET_ALL_POINTS" (واختياري gradeId / label / reason)',
        errors: parsed.error.errors,
      });
    }

    try {
      const result = await TeacherPointsService.resetAllStudentsPoints({
        teacherId,
        confirm: parsed.data.confirm,
        gradeId: parsed.data.gradeId,
        label: parsed.data.label,
        reason: parsed.data.reason,
      });
      return res.json({
        success: true,
        message:
          result.gradeId != null
            ? 'تم حفظ سجل نقاط الصف وتصفيرها — يمكنهم البدء من جديد ويمكنك استرجاع السجل لاحقًا'
            : 'تم حفظ سجل نقاط الطلاب وتصفيرها — يمكنهم البدء من جديد ويمكنك استرجاع السجل لاحقًا',
        data: result,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({
          success: false,
          message: error.message,
        });
      }
      throw error;
    }
  }),
);

/** GET /api/teacher/points/seasons — مواسم النقاط المؤرشفة */
router.get(
  '/seasons',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const gradeId = req.query.gradeId ? Number(req.query.gradeId) : null;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const seasons = await TeacherPointsService.listPointSeasons({
      teacherId,
      gradeId: gradeId && Number.isFinite(gradeId) ? gradeId : null,
      limit,
    });
    res.json({ success: true, data: { seasons } });
  }),
);

/** GET /api/teacher/points/seasons/:seasonId — تفاصيل موسم + أرصدة الطلاب */
router.get(
  '/seasons/:seasonId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const seasonId = Number(req.params.seasonId);
    if (!Number.isFinite(seasonId) || seasonId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid seasonId' });
    }
    const includeBalances = String(req.query.includeBalances ?? 'true') !== 'false';
    const balancesLimit = req.query.balancesLimit ? Number(req.query.balancesLimit) : 200;
    try {
      const data = await TeacherPointsService.getPointSeason({
        teacherId,
        seasonId,
        includeBalances,
        balancesLimit,
      });
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      throw error;
    }
  }),
);

/** GET /api/teacher/points/seasons/:seasonId/students/:studentId/transactions */
router.get(
  '/seasons/:seasonId/students/:studentId/transactions',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const seasonId = Number(req.params.seasonId);
    const studentId = Number(req.params.studentId);
    if (!Number.isFinite(seasonId) || seasonId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid seasonId' });
    }
    if (!Number.isFinite(studentId) || studentId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid studentId' });
    }
    const limit = req.query.limit ? Number(req.query.limit) : 200;
    try {
      const data = await TeacherPointsService.getSeasonStudentTransactions({
        teacherId,
        seasonId,
        studentId,
        limit,
      });
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      throw error;
    }
  }),
);

/**
 * POST /api/teacher/points/seasons/:seasonId/restore
 * استرجاع موسم سابق (مع نسخة احتياطية تلقائية للنقاط الحالية)
 * Body: { "confirm": "RESTORE_POINTS_SEASON" }
 */
router.post(
  '/seasons/:seasonId/restore',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const seasonId = Number(req.params.seasonId);
    if (!Number.isFinite(seasonId) || seasonId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid seasonId' });
    }
    const parsed = RestoreSeasonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'للتأكيد أرسل confirm: "RESTORE_POINTS_SEASON"',
        errors: parsed.error.errors,
      });
    }

    try {
      const result = await TeacherPointsService.restorePointSeason({
        teacherId,
        seasonId,
        confirm: parsed.data.confirm,
      });
      return res.json({
        success: true,
        message:
          result.backupSeasonId != null
            ? 'تم استرجاع الموسم — ونُسخت النقاط الحالية احتياطيًا قبل الاستبدال'
            : 'تم استرجاع موسم النقاط بنجاح',
        data: result,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      throw error;
    }
  }),
);

const ConsolidateLegacySchema = z.object({
  confirm: z.literal('CONSOLIDATE_EXAM_POINTS'),
});

/**
 * POST /api/teacher/points/consolidate-legacy
 * توحيد نقاط الامتحانات القديمة: أول محاولة فقط، وحذف تكرار المحاولات التالية
 */
router.post(
  '/consolidate-legacy',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = ConsolidateLegacySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'للتأكيد أرسل confirm: "CONSOLIDATE_EXAM_POINTS"',
        errors: parsed.error.errors,
      });
    }

    const result = await TeacherPointsService.consolidateLegacyOncePerExamPoints({
      teacherId,
    });
    return res.json({
      success: true,
      message:
        'تم توحيد نقاط الامتحانات: احتساب أول محاولة فقط وإلغاء تكرار المحاولات التالية',
      data: result,
    });
  }),
);
