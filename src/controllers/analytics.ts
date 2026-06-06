import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import { AnalyticsIntelligenceService } from '../services/analyticsIntelligence';

export const router = Router();

function tenantIdOrDefault(reqTenantId: number | undefined): number {
  return reqTenantId ?? 1;
}

function parseId(value: string, fieldName: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, `Invalid ${fieldName}`);
  return id;
}

router.get(
  '/course/:courseId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const courseId = parseId(req.params.courseId, 'course id');
    const data = await AnalyticsIntelligenceService.getCourseAnalytics(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      courseId,
      { from: req.query.from as string | undefined, to: req.query.to as string | undefined },
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/lecture/:lectureId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const lectureId = parseId(req.params.lectureId, 'lecture id');
    const data = await AnalyticsIntelligenceService.getLectureAnalytics(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      lectureId,
      { from: req.query.from as string | undefined, to: req.query.to as string | undefined },
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/student/:studentId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const studentId = parseId(req.params.studentId, 'student id');
    const data = await AnalyticsIntelligenceService.getStudentAnalytics(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      studentId,
      { from: req.query.from as string | undefined, to: req.query.to as string | undefined },
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/exam/:examId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const examId = parseId(req.params.examId, 'exam id');
    const data = await AnalyticsIntelligenceService.getExamAnalytics(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      examId,
      { from: req.query.from as string | undefined, to: req.query.to as string | undefined },
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/questions/difficult',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await AnalyticsIntelligenceService.getDifficultQuestions(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      Number.isFinite(limit) && limit > 0 ? limit : 20,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/students/top',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await AnalyticsIntelligenceService.getTopStudents(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      Number.isFinite(limit) && limit > 0 ? limit : 20,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/students/at-risk',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const data = await AnalyticsIntelligenceService.getAtRiskStudents(
      { tenantId: tenantIdOrDefault(req.tenant?.id) },
      Number.isFinite(limit) && limit > 0 ? limit : 20,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  '/performance-summary',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const data = await AnalyticsIntelligenceService.getPerformanceSummary({
      tenantId: tenantIdOrDefault(req.tenant?.id),
    });
    res.json({ success: true, data });
  }),
);
