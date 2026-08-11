import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { authMiddleware } from '../../../middleware/authentication';
import { validate } from '../../../middleware/validateReq';
import { asyncWrapper, HttpError } from '../../../utils';
import { TeacherWhatsAppService } from '../services/teacherWhatsApp.service';

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
