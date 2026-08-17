import { Router, Request, Response } from 'express';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError } from '../../../utils';
import { parseNumberInput } from '../../../utils/requestParsers';
import { getTeacherId, resolveTeacherId } from '../middleware/access';
import { AttendanceService, DashboardService } from '../services/attendance.service';
import { ExamsService } from '../services/exams.service';
import { GroupsService, StudentsService } from '../services/groups.service';
import { PaymentsService, SubscriptionsService } from '../services/subscriptions.service';
import {
  BulkAttendanceSchema,
  BulkUpdateSubscriptionsSchema,
  CreateGroupExamSchema,
  CreateGroupSchema,
  CreatePaymentSchema,
  CreateStudentSchema,
  ManualAttendanceSchema,
  OpenBillingMonthSchema,
  ScanAttendanceSchema,
  UpdateExamGradeSchema,
  UpdateGroupExamSchema,
  UpdateGroupSchema,
  UpdateStudentSchema,
  UpdateSubscriptionSchema,
  UpsertExamGradesSchema,
} from '../validators';

const CENTER_ROLES = ['teacher', 'admin'] as const;

function handleServiceError(res: Response, error: unknown) {
  if (error instanceof HttpError) {
    return res.status(error.status).json({
      success: false,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    });
  }
  throw error;
}

function actorId(req: Request): number {
  return req.user!.id;
}

export const centerRouter = Router();

centerRouter.use(authMiddleware([...CENTER_ROLES]));
centerRouter.use((req, _res, next) => {
  (req as Request & { teacherId?: number }).teacherId = resolveTeacherId(req);
  next();
});

// ========== Dashboard ==========
centerRouter.get(
  '/dashboard',
  asyncWrapper(async (req: Request, res: Response) => {
    const data = await DashboardService.get(getTeacherId(req));
    res.json({ success: true, data });
  }),
);

// ========== Groups ==========
centerRouter.get(
  '/groups',
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const page = parseNumberInput(req.query.page as string) ?? 1;
    const limit = parseNumberInput(req.query.limit as string) ?? 50;
    const status = req.query.status === 'paused' || req.query.status === 'active'
      ? req.query.status
      : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const data = await GroupsService.list(teacherId, {
      page: Math.max(1, page),
      limit: Math.min(100, Math.max(1, limit)),
      status,
      search,
    });
    res.json({ success: true, ...data });
  }),
);

centerRouter.post(
  '/groups',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = CreateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const group = await GroupsService.create(getTeacherId(req), actorId(req), parsed.data);
      res.status(201).json({ success: true, message: 'تم إنشاء المجموعة بنجاح', data: group });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/groups/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    const group = await GroupsService.get(getTeacherId(req), groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    res.json({ success: true, data: group });
  }),
);

centerRouter.patch(
  '/groups/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    const parsed = UpdateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const group = await GroupsService.update(
        getTeacherId(req),
        actorId(req),
        groupId,
        parsed.data,
      );
      res.json({ success: true, message: 'تم تحديث المجموعة', data: group });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.delete(
  '/groups/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    try {
      await GroupsService.remove(getTeacherId(req), actorId(req), groupId);
      res.json({ success: true, message: 'تم حذف المجموعة' });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

// ========== Students in group ==========
centerRouter.get(
  '/groups/:groupId/students',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    const group = await GroupsService.get(getTeacherId(req), groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    const students = await StudentsService.listByGroup(getTeacherId(req), groupId);
    res.json({ success: true, data: students });
  }),
);

centerRouter.post(
  '/groups/:groupId/students',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    const body = {
      ...req.body,
      full_name: req.body.full_name ?? req.body.name,
    };
    const parsed = CreateStudentSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const student = await StudentsService.createInGroup(
        getTeacherId(req),
        actorId(req),
        groupId,
        parsed.data,
      );
      res.status(201).json({
        success: true,
        message: 'تم إضافة الطالب بنجاح',
        data: student,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

// ========== Group exams (امتحانات السنتر ورصد الدرجات) ==========
centerRouter.get(
  '/groups/:groupId/exams',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    try {
      const exams = await ExamsService.list(getTeacherId(req), groupId);
      res.json({ success: true, data: exams });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/groups/:groupId/exams',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف المجموعة غير صالح' });
    }
    const parsed = CreateGroupExamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await ExamsService.create(
        getTeacherId(req),
        actorId(req),
        groupId,
        parsed.data,
      );
      res.status(201).json({ success: true, message: 'تم إضافة الامتحان', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/groups/:groupId/exams/:examId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    if (Number.isNaN(groupId) || Number.isNaN(examId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    try {
      const data = await ExamsService.get(getTeacherId(req), groupId, examId);
      res.json({ success: true, data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.patch(
  '/groups/:groupId/exams/:examId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    if (Number.isNaN(groupId) || Number.isNaN(examId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    const parsed = UpdateGroupExamSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await ExamsService.update(
        getTeacherId(req),
        actorId(req),
        groupId,
        examId,
        parsed.data,
      );
      res.json({ success: true, message: 'تم تحديث الامتحان', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.delete(
  '/groups/:groupId/exams/:examId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    if (Number.isNaN(groupId) || Number.isNaN(examId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    try {
      await ExamsService.remove(getTeacherId(req), actorId(req), groupId, examId);
      res.json({ success: true, message: 'تم حذف الامتحان' });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.put(
  '/groups/:groupId/exams/:examId/grades',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    if (Number.isNaN(groupId) || Number.isNaN(examId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    const parsed = UpsertExamGradesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await ExamsService.upsertGrades(
        getTeacherId(req),
        actorId(req),
        groupId,
        examId,
        parsed.data.grades,
      );
      res.json({ success: true, message: 'تم رصد الدرجات', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.patch(
  '/groups/:groupId/exams/:examId/grades/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(groupId) || Number.isNaN(examId) || Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    const parsed = UpdateExamGradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await ExamsService.updateStudentGrade(
        getTeacherId(req),
        actorId(req),
        groupId,
        examId,
        studentId,
        parsed.data,
      );
      res.json({ success: true, message: 'تم تحديث درجة الطالب', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.delete(
  '/groups/:groupId/exams/:examId/grades/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const examId = Number(req.params.examId);
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(groupId) || Number.isNaN(examId) || Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    try {
      const data = await ExamsService.deleteStudentGrade(
        getTeacherId(req),
        actorId(req),
        groupId,
        examId,
        studentId,
      );
      res.json({ success: true, message: 'تم حذف درجة الطالب', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

// ========== Students ==========
centerRouter.get(
  '/students',
  asyncWrapper(async (req: Request, res: Response) => {
    const teacherId = getTeacherId(req);
    const page = parseNumberInput(req.query.page as string) ?? 1;
    const limit = parseNumberInput(req.query.limit as string) ?? 50;
    const groupId = parseNumberInput(req.query.group_id as string) ?? undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const isActive =
      req.query.is_active === 'true' ? true : req.query.is_active === 'false' ? false : undefined;

    const data = await StudentsService.list(teacherId, {
      page: Math.max(1, page),
      limit: Math.min(100, Math.max(1, limit)),
      groupId: groupId ?? undefined,
      search,
      isActive,
    });
    res.json({ success: true, ...data });
  }),
);

centerRouter.get(
  '/students/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    const student = await StudentsService.get(getTeacherId(req), studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
    }
    res.json({ success: true, data: student });
  }),
);

centerRouter.get(
  '/students/:studentId/exams',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    const student = await StudentsService.get(getTeacherId(req), studentId);
    if (!student) {
      return res.status(404).json({ success: false, message: 'الطالب غير موجود' });
    }
    res.json({ success: true, data: student.exams ?? [] });
  }),
);

centerRouter.patch(
  '/students/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    const parsed = UpdateStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const student = await StudentsService.update(
        getTeacherId(req),
        actorId(req),
        studentId,
        parsed.data,
      );
      res.json({ success: true, message: 'تم تحديث بيانات الطالب', data: student });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.delete(
  '/students/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    try {
      await StudentsService.remove(getTeacherId(req), actorId(req), studentId);
      res.json({ success: true, message: 'تم حذف الطالب' });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/students/:studentId/qr',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    try {
      const qr = await StudentsService.getQr(getTeacherId(req), studentId);
      res.json({ success: true, data: qr });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/students/:studentId/groups/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(studentId) || Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    try {
      const enrollment = await StudentsService.enroll(
        getTeacherId(req),
        actorId(req),
        studentId,
        groupId,
      );
      res.status(201).json({ success: true, message: 'تم تسجيل الطالب في المجموعة', data: enrollment });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.delete(
  '/students/:studentId/groups/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(studentId) || Number.isNaN(groupId)) {
      return res.status(400).json({ success: false, message: 'معرّف غير صالح' });
    }
    try {
      await StudentsService.unenroll(getTeacherId(req), actorId(req), studentId, groupId);
      res.json({ success: true, message: 'تم إزالة الطالب من المجموعة' });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

// ========== Billing ==========
centerRouter.get(
  '/billing/months',
  asyncWrapper(async (req: Request, res: Response) => {
    const months = await SubscriptionsService.listMonths(getTeacherId(req));
    res.json({ success: true, data: months });
  }),
);

centerRouter.post(
  '/billing/months',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = OpenBillingMonthSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await SubscriptionsService.openMonth(
        getTeacherId(req),
        actorId(req),
        parsed.data,
      );
      res.status(201).json({
        success: true,
        message: 'تم فتح الشهر المالي وإنشاء الاشتراكات',
        data,
      });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/billing/months/:year/:month',
  asyncWrapper(async (req: Request, res: Response) => {
    const year = Number(req.params.year);
    const month = Number(req.params.month);
    if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ success: false, message: 'شهر أو سنة غير صالحة' });
    }
    const groupId = parseNumberInput(req.query.group_id as string) ?? undefined;
    const status =
      typeof req.query.status === 'string' &&
      ['paid', 'unpaid', 'partial', 'exempt'].includes(req.query.status)
        ? (req.query.status as 'paid' | 'unpaid' | 'partial' | 'exempt')
        : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;

    const data = await SubscriptionsService.getMonth(getTeacherId(req), year, month, {
      groupId: groupId ?? undefined,
      status,
      search,
    });
    res.json({ success: true, data });
  }),
);

centerRouter.patch(
  '/billing/subscriptions/:subscriptionId',
  asyncWrapper(async (req: Request, res: Response) => {
    const subscriptionId = Number(req.params.subscriptionId);
    if (Number.isNaN(subscriptionId)) {
      return res.status(400).json({ success: false, message: 'معرّف الاشتراك غير صالح' });
    }
    const parsed = UpdateSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await SubscriptionsService.updateSubscription(
        getTeacherId(req),
        actorId(req),
        subscriptionId,
        parsed.data,
      );
      res.json({ success: true, message: 'تم تحديث حالة الاشتراك', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/billing/subscriptions/bulk',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = BulkUpdateSubscriptionsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await SubscriptionsService.bulkUpdate(
        getTeacherId(req),
        actorId(req),
        parsed.data.updates,
      );
      res.json({ success: true, message: 'تم تحديث الاشتراكات', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/billing/payments',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = CreatePaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const payment = await PaymentsService.record(
        getTeacherId(req),
        actorId(req),
        parsed.data,
      );
      res.status(201).json({ success: true, message: 'تم تسجيل الدفعة', data: payment });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/billing/payments',
  asyncWrapper(async (req: Request, res: Response) => {
    const page = parseNumberInput(req.query.page as string) ?? 1;
    const limit = parseNumberInput(req.query.limit as string) ?? 50;
    const data = await PaymentsService.list(getTeacherId(req), {
      year: parseNumberInput(req.query.year as string) ?? undefined,
      month: parseNumberInput(req.query.month as string) ?? undefined,
      studentId: parseNumberInput(req.query.student_id as string) ?? undefined,
      groupId: parseNumberInput(req.query.group_id as string) ?? undefined,
      page: Math.max(1, page),
      limit: Math.min(100, Math.max(1, limit)),
    });
    res.json({ success: true, ...data });
  }),
);

// ========== Attendance ==========
centerRouter.post(
  '/attendance/manual',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = ManualAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await AttendanceService.markManual(
        getTeacherId(req),
        actorId(req),
        parsed.data,
      );
      res.status(201).json({ success: true, message: 'تم تسجيل الحضور', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/attendance/bulk',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = BulkAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await AttendanceService.markBulk(
        getTeacherId(req),
        actorId(req),
        parsed.data,
      );
      res.status(201).json({ success: true, message: 'تم تسجيل الحضور الجماعي', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.post(
  '/attendance/scan',
  asyncWrapper(async (req: Request, res: Response) => {
    const parsed = ScanAttendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.flatten(),
      });
    }
    try {
      const data = await AttendanceService.scanQr(
        getTeacherId(req),
        actorId(req),
        parsed.data,
      );
      res.status(201).json({ success: true, message: 'تم تسجيل الحضور بالـ QR', data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/attendance',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = parseNumberInput(req.query.group_id as string);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    if (!groupId || !date) {
      return res.status(400).json({
        success: false,
        message: 'group_id و date مطلوبان',
      });
    }
    const data = await AttendanceService.listByDate(getTeacherId(req), groupId, date);
    res.json({ success: true, data });
  }),
);

centerRouter.get(
  '/attendance/students/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    if (Number.isNaN(studentId)) {
      return res.status(400).json({ success: false, message: 'معرّف الطالب غير صالح' });
    }
    const groupId = parseNumberInput(req.query.group_id as string) ?? undefined;
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    const data = await AttendanceService.listByStudent(getTeacherId(req), studentId, {
      groupId: groupId ?? undefined,
      from,
      to,
    });
    res.json({ success: true, data });
  }),
);

centerRouter.get(
  '/reports/attendance/student/:studentId',
  asyncWrapper(async (req: Request, res: Response) => {
    const studentId = Number(req.params.studentId);
    const groupId = parseNumberInput(req.query.group_id as string);
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (Number.isNaN(studentId) || !groupId || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'studentId و group_id و from و to مطلوبة',
      });
    }
    try {
      const data = await AttendanceService.studentReport(
        getTeacherId(req),
        studentId,
        groupId,
        from,
        to,
      );
      res.json({ success: true, data });
    } catch (error) {
      handleServiceError(res, error);
    }
  }),
);

centerRouter.get(
  '/reports/attendance/group/:groupId',
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const from = typeof req.query.from === 'string' ? req.query.from : undefined;
    const to = typeof req.query.to === 'string' ? req.query.to : undefined;
    if (Number.isNaN(groupId) || !from || !to) {
      return res.status(400).json({
        success: false,
        message: 'groupId و from و to مطلوبة',
      });
    }
    const data = await AttendanceService.groupSummary(getTeacherId(req), groupId, from, to);
    res.json({ success: true, data });
  }),
);
