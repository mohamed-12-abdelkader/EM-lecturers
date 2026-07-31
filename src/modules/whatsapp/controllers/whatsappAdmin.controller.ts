import { Router } from 'express';
import { z } from 'zod';
import axios from 'axios';
import { authMiddleware } from '../../../middleware/authentication';
import { requireDefaultTenantMiddleware } from '../../../middleware/tenantContext';
import { validate } from '../../../middleware/validateReq';
import { asyncWrapper, HttpError } from '../../../utils';
import { isWhatsAppConfigured } from '../gateway/whatsappGatewayClient';
import { whatsappConfig } from '../config/whatsapp';
import { WhatsAppSessionService } from '../sessions/whatsappSession.service';
import { WhatsAppServiceAdmin } from '../services/whatsappServiceAdmin.service';
import { WhatsAppOutboundQueue } from '../queue/whatsappOutboundQueue';
import { SessionPoolService } from '../routing/sessionPool.service';

export const whatsappAdminRouter = Router();

whatsappAdminRouter.use(requireDefaultTenantMiddleware());
whatsappAdminRouter.use(authMiddleware(['admin']));

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

// ---------- Status ----------
whatsappAdminRouter.get(
  '/status',
  asyncWrapper(async (_req, res) => {
    res.json({
      success: true,
      data: {
        configured: isWhatsAppConfigured(),
        gatewayUrl: whatsappConfig.gatewayUrl,
        workerEnabled: whatsappConfig.workerEnabled,
      },
    });
  }),
);

// ---------- Sessions ----------
whatsappAdminRouter.get(
  '/sessions',
  asyncWrapper(async (_req, res) => {
    try {
      const sessions = await WhatsAppSessionService.listMerged();
      res.json({ success: true, data: { sessions } });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

const CreateSessionBody = z.object({
  id: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'id must be alphanumeric (a-z, 0-9, _, -)'),
  label: z.string().max(200).optional().nullable(),
});

whatsappAdminRouter.post(
  '/sessions',
  validate(CreateSessionBody),
  asyncWrapper(async (req, res) => {
    try {
      const session = await WhatsAppSessionService.create(req.body.id, req.body.label ?? undefined);
      res.status(201).json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappAdminRouter.get(
  '/sessions/:id',
  asyncWrapper(async (req, res) => {
    try {
      const session = await WhatsAppSessionService.get(req.params.id);
      res.json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappAdminRouter.post(
  '/sessions/:id/reconnect',
  asyncWrapper(async (req, res) => {
    try {
      const session = await WhatsAppSessionService.reconnect(req.params.id);
      res.json({ success: true, data: session });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

whatsappAdminRouter.delete(
  '/sessions/:id',
  asyncWrapper(async (req, res) => {
    try {
      await WhatsAppSessionService.remove(req.params.id);
      res.json({ success: true, message: 'تم حذف الجلسة' });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      gatewayError(err);
    }
  }),
);

const PatchSessionBody = z.object({
  label: z.string().max(200).optional().nullable(),
  is_enabled: z.boolean().optional(),
  max_messages_per_minute: z.number().int().min(1).max(120).optional(),
});

whatsappAdminRouter.patch(
  '/sessions/:id',
  validate(PatchSessionBody),
  asyncWrapper(async (req, res) => {
    const row = await WhatsAppSessionService.patchLocal(req.params.id, req.body);
    res.json({ success: true, data: row });
  }),
);

// ---------- Services & pools ----------
whatsappAdminRouter.get(
  '/services',
  asyncWrapper(async (_req, res) => {
    const services = await WhatsAppServiceAdmin.list();
    res.json({ success: true, data: { services } });
  }),
);

whatsappAdminRouter.get(
  '/services/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف الخدمة غير صحيح');
    const data = await WhatsAppServiceAdmin.getById(id);
    res.json({ success: true, data });
  }),
);

const PatchServiceBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  is_enabled: z.boolean().optional(),
  config: z.record(z.string(), z.any()).optional(),
});

whatsappAdminRouter.patch(
  '/services/:id',
  validate(PatchServiceBody),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف الخدمة غير صحيح');
    const service = await WhatsAppServiceAdmin.patch(id, req.body);
    res.json({ success: true, data: service });
  }),
);

const ReplacePoolBody = z.object({
  sessions: z.array(
    z.object({
      session_slug: z.string().min(1),
      weight: z.number().int().min(1).max(100).optional(),
      priority: z.number().int().optional(),
      role: z.enum(['primary', 'fallback']).optional(),
      is_enabled: z.boolean().optional(),
    }),
  ),
});

whatsappAdminRouter.put(
  '/services/:id/sessions',
  validate(ReplacePoolBody),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف الخدمة غير صحيح');
    await WhatsAppServiceAdmin.replacePool(id, req.body.sessions);
    const data = await WhatsAppServiceAdmin.getById(id);
    res.json({ success: true, message: 'تم تحديث مجموعة الأرقام', data });
  }),
);

// ---------- Conversations / monitor ----------
whatsappAdminRouter.get(
  '/conversations',
  asyncWrapper(async (req, res) => {
    const serviceId = req.query.service_id ? Number(req.query.service_id) : undefined;
    const data = await WhatsAppServiceAdmin.listConversations({
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
      serviceId: serviceId && !Number.isNaN(serviceId) ? serviceId : undefined,
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
    });
    res.json({
      success: true,
      data: {
        ...data,
        limit: Math.min(200, Math.max(1, Number(req.query.limit) || 50)),
        offset: Math.max(0, Number(req.query.offset) || 0),
      },
    });
  }),
);

whatsappAdminRouter.get(
  '/conversations/:id',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف المحادثة غير صحيح');
    const conversation = await WhatsAppServiceAdmin.getConversation(id);
    res.json({ success: true, data: conversation });
  }),
);

whatsappAdminRouter.get(
  '/conversations/:id/messages',
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف المحادثة غير صحيح');
    const data = await WhatsAppServiceAdmin.listMessages(id, {
      limit: Number(req.query.limit) || 100,
    });
    res.json({ success: true, data });
  }),
);

const PatchConversationBody = z.object({
  status: z.enum(['bot', 'waiting_human', 'human', 'closed']),
});

whatsappAdminRouter.patch(
  '/conversations/:id',
  validate(PatchConversationBody),
  asyncWrapper(async (req, res) => {
    const id = Number(req.params.id);
    if (!id) throw new HttpError(400, 'معرف المحادثة غير صحيح');
    const conversation = await WhatsAppServiceAdmin.updateConversationStatus(
      id,
      req.body.status,
    );
    res.json({ success: true, data: conversation });
  }),
);

whatsappAdminRouter.get(
  '/queue/stats',
  asyncWrapper(async (_req, res) => {
    const stats = await WhatsAppOutboundQueue.getStats();
    res.json({ success: true, data: stats });
  }),
);

const SendMessageBody = z
  .object({
    service_key: z.string().min(1).optional(),
    to: z.string().min(8).optional(),
    body: z.string().min(1).max(4000),
    conversation_id: z.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.conversation_id) return;
    if (!data.service_key) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service_key مطلوب بدون conversation_id',
        path: ['service_key'],
      });
    }
    if (!data.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'to مطلوب بدون conversation_id',
        path: ['to'],
      });
    }
  });

whatsappAdminRouter.post(
  '/messages/send',
  validate(SendMessageBody),
  asyncWrapper(async (req, res) => {
    if (!isWhatsAppConfigured()) {
      throw new HttpError(503, 'WhatsApp gateway is not configured.');
    }

    const conversationId = req.body.conversation_id
      ? Number(req.body.conversation_id)
      : null;

    if (conversationId) {
      const conversation = await WhatsAppServiceAdmin.getConversation(conversationId);
      const status = String(conversation.status || '');
      if (!['bot', 'waiting_human', 'human'].includes(status)) {
        throw new HttpError(400, 'لا يمكن الإرسال في محادثة مغلقة');
      }
      if (!conversation.session_slug || !conversation.contact_phone) {
        throw new HttpError(400, 'بيانات المحادثة غير مكتملة');
      }

      const jobId = await WhatsAppOutboundQueue.enqueue({
        sessionSlug: conversation.session_slug,
        to: conversation.contact_phone,
        body: req.body.body,
        serviceId: conversation.service_id ?? null,
        conversationId,
        tenantId: conversation.tenant_id ?? null,
        triggerType: 'admin_reply',
        metadata: { source: 'admin_inbox' },
      });

      await WhatsAppServiceAdmin.markConversationHumanAndTouch(conversationId);

      res.status(202).json({
        success: true,
        message: 'تم إدراج الرسالة في قائمة الإرسال',
        data: {
          job_id: jobId,
          session_slug: conversation.session_slug,
          service_id: conversation.service_id ?? null,
          conversation_id: conversationId,
        },
      });
      return;
    }

    const { sessionSlug, serviceId } = await SessionPoolService.pickSession(
      req.body.service_key!,
      req.body.to!,
    );
    const jobId = await WhatsAppOutboundQueue.enqueue({
      sessionSlug,
      to: req.body.to!,
      body: req.body.body,
      serviceId,
      triggerType: 'admin_test',
      metadata: { source: 'admin_dashboard' },
    });
    res.status(202).json({
      success: true,
      message: 'تم إدراج الرسالة في قائمة الإرسال',
      data: { job_id: jobId, session_slug: sessionSlug, service_id: serviceId },
    });
  }),
);
