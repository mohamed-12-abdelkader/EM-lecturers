import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { requireTeacherPlanFeature } from '../middleware/teacherPlanGate';
import { asyncWrapper } from '../utils';
import { DataAnalystChatbotService } from '../services/dataAnalystChatbot';
import { DATA_ANALYST_QUICK_COMMANDS } from '../services/dataAnalyst.prompts';
import {
  buildPlanFeatureAccess,
  getTeacherPackage,
} from '../services/teacherPlanPolicy';

export const router = Router();

const planGateDataAnalyst = requireTeacherPlanFeature('data_analyst');

const MessageSchema = z.object({
  message: z.string().min(1).max(4000),
});

router.get(
  '/info',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const pkg =
      req.user!.role === 'admin' ? null : await getTeacherPackage(req.user!.id);
    res.json({
      success: true,
      bot: DataAnalystChatbotService.getBotInfo(),
      quick_commands: DATA_ANALYST_QUICK_COMMANDS,
      plan_access:
        req.user!.role === 'admin'
          ? { allowed: true }
          : buildPlanFeatureAccess(req.user!.id, pkg, 'data_analyst'),
    });
  }),
);

router.get(
  '/messages',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const history = await DataAnalystChatbotService.getHistory(teacherId, limit, offset);
    res.json({
      success: true,
      messages: history.messages,
      pagination: {
        limit: Math.min(Math.max(limit, 1), 100),
        offset: Math.max(offset, 0),
        total: history.total,
        has_more: history.total > Math.max(offset, 0) + history.messages.length,
      },
    });
  }),
);

router.post(
  '/messages',
  authMiddleware(['teacher', 'admin']),
  planGateDataAnalyst,
  asyncWrapper(async (req, res) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }

    const teacherId = req.user!.id;
    const tenantId = req.tenant?.id ?? 1;
    const recentHistory = await DataAnalystChatbotService.getHistory(teacherId, 10, 0);
    const recentMessages = recentHistory.messages.map((message) => ({
      role: message.role,
      text: message.message,
    }));

    const teacherMessage = await DataAnalystChatbotService.saveMessage(
      teacherId,
      'teacher',
      parsed.data.message,
    );

    const result = await DataAnalystChatbotService.handleMessage(
      teacherId,
      tenantId,
      parsed.data.message,
      recentMessages,
    );

    const assistantMessage = await DataAnalystChatbotService.saveMessage(
      teacherId,
      'assistant',
      result.reply,
      result.report_type,
      result.context ?? {},
    );

    res.status(201).json({
      success: true,
      bot_name: 'محلل البيانات',
      user_message: teacherMessage,
      assistant_message: assistantMessage,
      reply: result.reply,
      report_type: result.report_type,
    });
  }),
);
