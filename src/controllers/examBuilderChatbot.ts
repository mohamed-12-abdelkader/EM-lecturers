import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { requireTeacherPlanFeature } from '../middleware/teacherPlanGate';
import { asyncWrapper } from '../utils';
import { ExamBuilderChatbotService } from '../services/examBuilderChatbot';
import {
  buildPlanFeatureAccess,
  getTeacherPackage,
} from '../services/teacherPlanPolicy';

export const router = Router();

const planGateExamBuilder = requireTeacherPlanFeature('exam_builder_ai');

const MessageSchema = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().uuid().optional(),
});

const ApproveSchema = z.object({
  create_exam: z.boolean().optional(),
  lecture_id: z.number().int().positive().optional(),
  course_id: z.number().int().positive().optional(),
  title: z.string().min(1).max(255).optional(),
  type: z.string().optional(),
  duration: z.number().int().positive().nullable().optional(),
  duration_minutes: z.number().int().positive().optional(),
  total_grade: z.number().positive().optional(),
});

const AdjustSchema = z.object({
  remove_ids: z.array(z.number().int().positive()).optional(),
  replace_ids: z.array(z.number().int().positive()).optional(),
  remove_positions: z.array(z.number().int()).optional(),
  replace_positions: z.array(z.number().int()).optional(),
  refill_removed: z.boolean().optional(),
});

router.get(
  '/info',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const pkg = await getTeacherPackage(req.user!.id);
    res.json({
      success: true,
      bot: ExamBuilderChatbotService.getBotInfo(),
      plan_access: buildPlanFeatureAccess(req.user!.id, pkg, 'exam_builder_ai'),
    });
  }),
);

router.get(
  '/catalog',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const catalog = await ExamBuilderChatbotService.getTeacherCatalog(req.user!.id);
    res.json({ success: true, catalog });
  }),
);

router.get(
  '/history',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed = ['proposed', 'approved', 'cancelled'];
    const statusFilter = allowed.includes(status ?? '')
      ? (status as 'proposed' | 'approved' | 'cancelled')
      : undefined;

    const history = await ExamBuilderChatbotService.getSessionsHistory(
      req.user!.id,
      limit,
      offset,
      statusFilter,
    );

    res.json({
      success: true,
      history: history.items,
      pagination: {
        limit: Math.min(Math.max(limit, 1), 50),
        offset: Math.max(offset, 0),
        total: history.total,
        has_more: history.total > Math.max(offset, 0) + history.items.length,
      },
    });
  }),
);

router.get(
  '/sessions',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed = ['proposed', 'approved', 'cancelled'];
    const statusFilter = allowed.includes(status ?? '')
      ? (status as 'proposed' | 'approved' | 'cancelled')
      : undefined;

    const history = await ExamBuilderChatbotService.getSessionsHistory(
      req.user!.id,
      limit,
      offset,
      statusFilter,
    );

    res.json({
      success: true,
      sessions: history.items,
      pagination: {
        limit: Math.min(Math.max(limit, 1), 50),
        offset: Math.max(offset, 0),
        total: history.total,
        has_more: history.total > Math.max(offset, 0) + history.items.length,
      },
    });
  }),
);

router.get(
  '/messages',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const history = await ExamBuilderChatbotService.getHistory(req.user!.id, limit, offset);
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
  '/chat',
  authMiddleware(['teacher']),
  planGateExamBuilder,
  asyncWrapper(async (req, res) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const teacherId = req.user!.id;
    const result = await ExamBuilderChatbotService.handleChatMessage(
      teacherId,
      parsed.data.message,
      parsed.data.session_id,
    );

    const teacherMessage = await ExamBuilderChatbotService.saveMessage(
      teacherId,
      'teacher',
      parsed.data.message,
      result.session?.id ?? null,
      {
        action: result.session ? 'request_or_adjust' : 'request',
        session_id: result.session?.id ?? null,
      },
    );

    const assistantMessage = await ExamBuilderChatbotService.saveMessage(
      teacherId,
      'assistant',
      result.reply,
      result.session?.id ?? null,
      {
        action: 'proposal',
        session_id: result.session?.id ?? null,
        status: result.session ? 'proposal_ready' : 'message_only',
        thinking_ms: result.thinking_ms,
        actions: result.actions,
        questions_count: result.session?.selected_questions.length ?? 0,
        reply: result.reply,
        session: result.session,
        questions: result.session?.selected_questions ?? [],
      },
    );

    res.status(201).json({
      success: true,
      status: result.session ? 'proposal_ready' : 'message_only',
      bot_name: 'مساعد إنشاء الامتحانات',
      reply: result.reply,
      thinking_ms: result.thinking_ms,
      session: result.session,
      questions: result.session?.selected_questions ?? [],
      actions: result.actions,
      user_message: teacherMessage,
      assistant_message: assistantMessage,
    });
  }),
);

router.get(
  '/sessions/:sessionId',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const item = await ExamBuilderChatbotService.getSessionHistoryItem(
      req.params.sessionId,
      req.user!.id,
    );
    res.json({
      success: true,
      session: item,
      questions: item.selected_questions,
    });
  }),
);

router.post(
  '/sessions/:sessionId/regenerate',
  authMiddleware(['teacher']),
  planGateExamBuilder,
  asyncWrapper(async (req, res) => {
    const teacherId = req.user!.id;
    const result = await ExamBuilderChatbotService.regenerateSession(
      req.params.sessionId,
      teacherId,
    );

    const assistantMessage = await ExamBuilderChatbotService.saveMessage(
      teacherId,
      'assistant',
      result.reply,
      result.session?.id ?? null,
      {
        action: 'regenerate',
        session_id: result.session?.id ?? null,
        status: 'proposal_ready',
        thinking_ms: result.thinking_ms,
        questions_count: result.session?.selected_questions.length ?? 0,
        reply: result.reply,
        session: result.session,
        questions: result.session?.selected_questions ?? [],
        actions: result.actions,
      },
    );

    res.json({
      success: true,
      status: 'proposal_ready',
      reply: result.reply,
      thinking_ms: result.thinking_ms,
      session: result.session,
      questions: result.session?.selected_questions ?? [],
      actions: result.actions,
      assistant_message: assistantMessage,
    });
  }),
);

router.post(
  '/sessions/:sessionId/adjust',
  authMiddleware(['teacher']),
  planGateExamBuilder,
  asyncWrapper(async (req, res) => {
    const parsed = AdjustSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const teacherId = req.user!.id;
    const result = await ExamBuilderChatbotService.adjustSession(
      req.params.sessionId,
      teacherId,
      parsed.data,
    );

    const assistantMessage = await ExamBuilderChatbotService.saveMessage(
      teacherId,
      'assistant',
      result.reply,
      result.session?.id ?? null,
      {
        action: 'adjust',
        session_id: result.session?.id ?? null,
        status: 'proposal_ready',
        thinking_ms: result.thinking_ms,
        questions_count: result.session?.selected_questions.length ?? 0,
        reply: result.reply,
        session: result.session,
        questions: result.session?.selected_questions ?? [],
        actions: result.actions,
        adjust: parsed.data,
      },
    );

    res.json({
      success: true,
      status: 'proposal_ready',
      reply: result.reply,
      thinking_ms: result.thinking_ms,
      session: result.session,
      questions: result.session?.selected_questions ?? [],
      actions: result.actions,
      assistant_message: assistantMessage,
    });
  }),
);

router.post(
  '/sessions/:sessionId/approve',
  authMiddleware(['teacher']),
  planGateExamBuilder,
  asyncWrapper(async (req, res) => {
    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: parsed.error.errors,
      });
    }

    const teacherId = req.user!.id;
    const result = await ExamBuilderChatbotService.approveSession(
      teacherId,
      req.params.sessionId,
      parsed.data,
    );

    await ExamBuilderChatbotService.saveMessage(
      teacherId,
      'assistant',
      result.exam_id
        ? `✅ تم اعتماد الأسئلة وإنشاء الامتحان (#${result.exam_id}) بنجاح.`
        : `✅ تم اعتماد ${result.question_ids.length} سؤالاً. يمكنك الآن إضافتها لنموذج إنشاء الامتحان.`,
      req.params.sessionId,
      {
        action: 'approve',
        exam_id: result.exam_id,
        question_ids: result.question_ids,
      },
    );

    res.json({
      success: true,
      status: 'approved',
      message: result.exam_id
        ? 'تم اعتماد الأسئلة وإنشاء الامتحان'
        : 'تم اعتماد الأسئلة',
      ...result,
    });
  }),
);

router.get(
  '/questions/:source/:questionId/preview',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const source = req.params.source;
    if (!Number.isInteger(questionId) || questionId <= 0) {
      return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    }
    if (source !== 'v1' && source !== 'v2') {
      return res.status(400).json({ success: false, message: 'مصدر السؤال يجب أن يكون v1 أو v2' });
    }

    const preview = await ExamBuilderChatbotService.getQuestionPreview(
      req.user!.id,
      questionId,
      source,
    );
    res.json({ success: true, data: preview });
  }),
);
