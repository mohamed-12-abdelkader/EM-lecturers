import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherPointsService } from '../services/teacherPoints';

export const router = Router();

async function requireStudentContext(studentId: number) {
  const ctx = await TeacherPointsService.resolveStudentPointsContext(studentId);
  if (!ctx) {
    throw new HttpError(400, 'تعذر تحديد المدرس أو الصف للطالب');
  }
  return ctx;
}

/** GET /api/student/points/summary */
router.get(
  '/summary',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;
    const ctx = await requireStudentContext(studentId);
    const summary = await TeacherPointsService.getStudentRankSummary({
      studentId,
      teacherId: ctx.teacherId,
      gradeId: ctx.gradeId,
    });
    res.json({
      success: true,
      data: summary,
    });
  }),
);

/** GET /api/student/points/leaderboard — top 10 in class */
router.get(
  '/leaderboard',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = req.user!.id;
    const ctx = await requireStudentContext(studentId);
    const limitRaw = req.query.limit ? Number(req.query.limit) : 10;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 10) : 10;
    const data = await TeacherPointsService.getTopLeaderboard({
      teacherId: ctx.teacherId,
      gradeId: ctx.gradeId,
      limit,
    });
    res.json({
      success: true,
      data,
    });
  }),
);
