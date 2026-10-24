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

const ResetAndRebuildLastExamSchema = z.object({
  confirm: z.literal('RESET_AND_REBUILD_LAST_EXAM'),
  gradeId: z.number().int().positive().optional().nullable(),
  label: z.string().trim().max(200).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
});

const SetGradePointsAnchorSchema = z.object({
  startExamId: z.coerce.number().int().positive(),
});

const ResetAndStartFromExamSchema = z.object({
  confirm: z.literal('RESET_AND_START_FROM_EXAM'),
  gradeId: z.coerce.number().int().positive(),
  startExamId: z.coerce.number().int().positive(),
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

/** GET /api/teacher/points/grade-anchors — امتحان بداية النقاط لكل صف */
router.get(
  '/grade-anchors',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const data = await TeacherPointsService.listGradePointsAnchors(teacherId);
    res.json({ success: true, data });
  }),
);

/** GET /api/teacher/points/grade-anchors/:gradeId — تفاصيل + قائمة الامتحانات للاختيار */
router.get(
  '/grade-anchors/:gradeId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const gradeId = Number(req.params.gradeId);
    if (!Number.isFinite(gradeId) || gradeId <= 0) {
      return res.status(400).json({ success: false, message: 'gradeId غير صالح' });
    }
    const anchor = await TeacherPointsService.getGradePointsAnchor(teacherId, gradeId);
    const exams = await TeacherPointsService.listCourseExamsForGrade({ teacherId, gradeId });
    const eligibleExamIds = await TeacherPointsService.listEligibleCourseExamIds(
      teacherId,
      gradeId,
    );
    res.json({
      success: true,
      data: {
        gradeId,
        anchor,
        mode: anchor ? 'from_exam_onward' : 'last_exam_only',
        eligibleExamIds,
        exams,
      },
    });
  }),
);

/**
 * PUT /api/teacher/points/grade-anchors/:gradeId
 * تعيين امتحان بداية حساب النقاط للصف (بدون تصفير تلقائي)
 */
router.put(
  '/grade-anchors/:gradeId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const gradeId = Number(req.params.gradeId);
    if (!Number.isFinite(gradeId) || gradeId <= 0) {
      return res.status(400).json({ success: false, message: 'gradeId غير صالح' });
    }
    const parsed = SetGradePointsAnchorSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'أرسل startExamId',
        errors: parsed.error.errors,
      });
    }
    try {
      const data = await TeacherPointsService.setGradePointsAnchor({
        teacherId,
        gradeId,
        startExamId: parsed.data.startExamId,
      });
      return res.json({
        success: true,
        message: 'تم تعيين امتحان بداية النقاط لهذا الصف',
        data,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        return res.status(error.status).json({ success: false, message: error.message });
      }
      throw error;
    }
  }),
);

/**
 * POST /api/teacher/points/reset-and-start-from-exam
 * تصفير نقاط الصف + تعيين امتحان البداية + إعادة بناء النقاط منه ومن كل ما بعده
 */
router.post(
  '/reset-and-start-from-exam',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = ResetAndStartFromExamSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message:
          'للتأكيد أرسل confirm: "RESET_AND_START_FROM_EXAM" مع gradeId و startExamId',
        errors: parsed.error.errors,
      });
    }
    try {
      const result = await TeacherPointsService.resetAndStartFromExam({
        teacherId,
        confirm: parsed.data.confirm,
        gradeId: parsed.data.gradeId,
        startExamId: parsed.data.startExamId,
        label: parsed.data.label,
        reason: parsed.data.reason,
      });
      return res.json({
        success: true,
        message:
          'تم تصفير نقاط الصف وبدء حساب الترتيب من الامتحان المختار وجميع الامتحانات بعده',
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

/**
 * POST /api/teacher/points/reset-and-rebuild-last-exam
 * حذف كل النقاط ثم منح نقاط بدء + درجة آخر امتحان شامل فقط لكل صف
 */
router.post(
  '/reset-and-rebuild-last-exam',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const parsed = ResetAndRebuildLastExamSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message:
          'للتأكيد أرسل confirm: "RESET_AND_REBUILD_LAST_EXAM" (واختياري gradeId)',
        errors: parsed.error.errors,
      });
    }

    try {
      const result = await TeacherPointsService.resetAndRebuildFromLastExam({
        teacherId,
        confirm: parsed.data.confirm,
        gradeId: parsed.data.gradeId,
        label: parsed.data.label,
        reason: parsed.data.reason,
      });
      return res.json({
        success: true,
        message:
          'تم حذف كل النقاط وإعادة بنائها من آخر امتحان فقط (بدء + درجة) لكل صف',
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
 * POST /api/teacher/points/heal-last-exam-only
 * تنظيف ناعم: يحذف نقاط امتحانات المحاضرات/القديمة ويُبقي آخر امتحان شامل + اليدوي/الفيديو
 */
router.post(
  '/heal-last-exam-only',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = resolveTeacherId(req);
    const gradeIdRaw = req.body?.gradeId ?? req.query.gradeId;
    const gradeId =
      gradeIdRaw != null && Number.isFinite(Number(gradeIdRaw))
        ? Number(gradeIdRaw)
        : null;
    try {
      const result = await TeacherPointsService.healTeacherExamPointsToLastOnly({
        teacherId,
        gradeId,
      });
      return res.json({
        success: true,
        message:
          'تم حذف نقاط الامتحانات القديمة/المحاضرات والإبقاء على آخر امتحان شامل فقط',
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
