import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { authMiddleware } from '../../../middleware/authentication';
import { validate } from '../../../middleware/validateReq';
import { asyncWrapper, HttpError } from '../../../utils';
import { TeacherWhatsAppService } from '../services/teacherWhatsApp.service';
import { ParentsExamNotifyService } from '../automations/parentsExamNotify/service';

export const whatsappTeacherRouter = Router();

whatsappTeacherRouter.use(authMiddleware(['teacher']));

function gatewayError(err: unknown): never {
  if (axios.isAxiosError(err)) {
    const status = err.response?.status ?? 502;
    const detail = err.response?.data ?? err.message;
    throw new HttpError(status >= 400 && status < 600 ? status : 502, 'WhatsApp gateway error', {
      detail,
    });
  }
  throw err;
}

whatsappTeacherRouter.get(
  '/status',
  asyncWrapper(async (req, res) => {
    const data = await TeacherWhatsAppService.getStatus(req.user!.id);
    res.json({ success: true, data });
  }),
);

whatsappTeacherRouter.get(
  '/services',
  asyncWrapper(async (req, res) => {
    const services = await TeacherWhatsAppService.listServices(req.user!.id);
    res.json({ success: true, data: { services } });
  }),
);

const ReplaceSessionsBody = z.object({
  sessions: z.array(z.string().min(1)).max(2),
});

whatsappTeacherRouter.put(
  '/services/:key/sessions',
  validate(ReplaceSessionsBody),
  asyncWrapper(async (req, res) => {
    const services = await TeacherWhatsAppService.replaceServiceSessions(
      req.user!.id,
      req.params.key,
      req.body.sessions,
    );
    res.json({ success: true, message: 'تم تحديث أرقام الخدمة', data: { services } });
  }),
);

whatsappTeacherRouter.get(
  '/sessions',
  asyncWrapper(async (req, res) => {
    try {
      const sessions = await TeacherWhatsAppService.listSessions(req.user!.id);
      res.json({ success: true, data: { sessions } });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

const CreateSessionBody = z.object({
  label: z.string().max(200).optional().nullable(),
});

whatsappTeacherRouter.post(
  '/sessions',
  validate(CreateSessionBody),
  asyncWrapper(async (req, res) => {
    try {
      const session = await TeacherWhatsAppService.createSession(
        req.user!.id,
        req.body.label ?? null,
      );
      res.status(201).json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappTeacherRouter.get(
  '/sessions/:slug',
  asyncWrapper(async (req, res) => {
    try {
      const session = await TeacherWhatsAppService.getSession(req.user!.id, req.params.slug);
      res.json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappTeacherRouter.post(
  '/sessions/:slug/reconnect',
  asyncWrapper(async (req, res) => {
    try {
      const session = await TeacherWhatsAppService.reconnectSession(
        req.user!.id,
        req.params.slug,
      );
      res.json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappTeacherRouter.delete(
  '/sessions/:slug',
  asyncWrapper(async (req, res) => {
    try {
      await TeacherWhatsAppService.deleteSession(req.user!.id, req.params.slug);
      res.json({ success: true, message: 'تم حذف الجلسة' });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

const NotifyStudentsBody = z.object({
  message: z.string().min(1).max(1000),
  student_ids: z.array(z.number().int().positive()).min(1).max(50),
});

whatsappTeacherRouter.post(
  '/notify-students',
  validate(NotifyStudentsBody),
  asyncWrapper(async (req, res) => {
    const data = await TeacherWhatsAppService.notifyStudents(
      req.user!.id,
      req.body.message,
      req.body.student_ids,
    );
    res.json({ success: true, data });
  }),
);

const ParentReportsBody = z.object({
  student_ids: z.array(z.number().int().positive()).min(1).max(50),
});

whatsappTeacherRouter.post(
  '/parent-reports',
  validate(ParentReportsBody),
  asyncWrapper(async (req, res) => {
    const data = await TeacherWhatsAppService.sendParentReports(
      req.user!.id,
      req.body.student_ids,
    );
    res.json({ success: true, data });
  }),
);

const TeacherParentPrefsBody = z.object({
  auto_send: z.boolean(),
  notify_passed: z.boolean(),
  notify_failed: z.boolean(),
  notify_absent: z.boolean(),
  pass_percentage: z.number().min(0).max(100),
  template_passed: z.string().min(1).max(500),
  template_failed: z.string().min(1).max(500),
  template_absent: z.string().min(1).max(500),
});

whatsappTeacherRouter.get(
  '/parents-exam/settings',
  asyncWrapper(async (req, res) => {
    res.json({ success: true, data: await ParentsExamNotifyService.getTeacherPrefs(req.user!.id) });
  }),
);

whatsappTeacherRouter.put(
  '/parents-exam/settings',
  validate(TeacherParentPrefsBody),
  asyncWrapper(async (req, res) => {
    const prefs = await ParentsExamNotifyService.saveTeacherPrefs(req.user!.id, req.body);
    res.json({ success: true, data: prefs });
  }),
);

whatsappTeacherRouter.get(
  '/parents-exam/exams',
  asyncWrapper(async (req, res) => {
    const exams = await ParentsExamNotifyService.listExams(req.user!.id);
    res.json({ success: true, data: { exams } });
  }),
);

whatsappTeacherRouter.get(
  '/parents-exam/exams/:examId/preview',
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    res.json({ success: true, data: await ParentsExamNotifyService.preview(examId) });
  }),
);

whatsappTeacherRouter.put(
  '/parents-exam/exams/:examId',
  validate(z.object({ enabled: z.boolean() })),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    res.json({ success: true, data: await ParentsExamNotifyService.setExamEnabled(examId, req.body.enabled) });
  }),
);

whatsappTeacherRouter.post(
  '/parents-exam/exams/:examId/send-missing',
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    const data = await ParentsExamNotifyService.sendMissing(examId);
    res.status(202).json({ success: true, data });
  }),
);

whatsappTeacherRouter.post(
  '/parents-exam/exams/:examId/test',
  validate(
    z.object({
      studentId: z.number().int().positive(),
      cohort: z.enum(['passed', 'failed', 'absent']),
    }),
  ),
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    const data = await ParentsExamNotifyService.testSend(examId, req.body.studentId, req.body.cohort);
    res.status(202).json({ success: true, data });
  }),
);

whatsappTeacherRouter.post(
  '/parents-exam/exams/:examId/pause',
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    res.json({ success: true, data: await ParentsExamNotifyService.pause(examId) });
  }),
);

whatsappTeacherRouter.post(
  '/parents-exam/exams/:examId/resume',
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    res.json({ success: true, data: await ParentsExamNotifyService.resume(examId) });
  }),
);

whatsappTeacherRouter.post(
  '/parents-exam/exams/:examId/cancel-pending',
  asyncWrapper(async (req, res) => {
    const examId = Number(req.params.examId);
    await ParentsExamNotifyService.assertOwned(req.user!.id, examId);
    res.json({ success: true, data: await ParentsExamNotifyService.cancelPending(examId) });
  }),
);
