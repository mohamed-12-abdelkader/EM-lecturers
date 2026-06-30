"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const teacherPlanGate_1 = require("../middleware/teacherPlanGate");
const utils_1 = require("../utils");
const examBuilderChatbot_1 = require("../services/examBuilderChatbot");
const teacherPlanPolicy_1 = require("../services/teacherPlanPolicy");
exports.router = (0, express_1.Router)();
const planGateExamBuilder = (0, teacherPlanGate_1.requireTeacherPlanFeature)('exam_builder_ai');
const MessageSchema = zod_1.z.object({
    message: zod_1.z.string().min(1).max(4000),
});
const ApproveSchema = zod_1.z.object({
    create_exam: zod_1.z.boolean().optional(),
    lecture_id: zod_1.z.number().int().positive().optional(),
    course_id: zod_1.z.number().int().positive().optional(),
    title: zod_1.z.string().min(1).max(255).optional(),
    type: zod_1.z.string().optional(),
    duration: zod_1.z.number().int().positive().nullable().optional(),
    duration_minutes: zod_1.z.number().int().positive().optional(),
    total_grade: zod_1.z.number().positive().optional(),
});
exports.router.get('/info', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const pkg = await (0, teacherPlanPolicy_1.getTeacherPackage)(req.user.id);
    res.json({
        success: true,
        bot: examBuilderChatbot_1.ExamBuilderChatbotService.getBotInfo(),
        plan_access: (0, teacherPlanPolicy_1.buildPlanFeatureAccess)(req.user.id, pkg, 'exam_builder_ai'),
    });
}));
exports.router.get('/catalog', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const catalog = await examBuilderChatbot_1.ExamBuilderChatbotService.getTeacherCatalog(req.user.id);
    res.json({ success: true, catalog });
}));
exports.router.get('/history', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed = ['proposed', 'approved', 'cancelled'];
    const statusFilter = allowed.includes(status ?? '')
        ? status
        : undefined;
    const history = await examBuilderChatbot_1.ExamBuilderChatbotService.getSessionsHistory(req.user.id, limit, offset, statusFilter);
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
}));
exports.router.get('/sessions', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const allowed = ['proposed', 'approved', 'cancelled'];
    const statusFilter = allowed.includes(status ?? '')
        ? status
        : undefined;
    const history = await examBuilderChatbot_1.ExamBuilderChatbotService.getSessionsHistory(req.user.id, limit, offset, statusFilter);
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
}));
exports.router.get('/messages', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const history = await examBuilderChatbot_1.ExamBuilderChatbotService.getHistory(req.user.id, limit, offset);
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
}));
exports.router.post('/chat', (0, authentication_1.authMiddleware)(['teacher']), planGateExamBuilder, (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: parsed.error.errors,
        });
    }
    const teacherId = req.user.id;
    const result = await examBuilderChatbot_1.ExamBuilderChatbotService.handleChatMessage(teacherId, parsed.data.message);
    const teacherMessage = await examBuilderChatbot_1.ExamBuilderChatbotService.saveMessage(teacherId, 'teacher', parsed.data.message, result.session?.id ?? null, { action: 'request', session_id: result.session?.id ?? null });
    const assistantMessage = await examBuilderChatbot_1.ExamBuilderChatbotService.saveMessage(teacherId, 'assistant', result.reply, result.session?.id ?? null, {
        action: 'proposal',
        session_id: result.session?.id ?? null,
        status: result.session ? 'proposal_ready' : 'message_only',
        thinking_ms: result.thinking_ms,
        actions: result.actions,
        questions_count: result.session?.selected_questions.length ?? 0,
        reply: result.reply,
        session: result.session,
        questions: result.session?.selected_questions ?? [],
    });
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
}));
exports.router.get('/sessions/:sessionId', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const item = await examBuilderChatbot_1.ExamBuilderChatbotService.getSessionHistoryItem(req.params.sessionId, req.user.id);
    res.json({
        success: true,
        session: item,
        questions: item.selected_questions,
    });
}));
exports.router.post('/sessions/:sessionId/regenerate', (0, authentication_1.authMiddleware)(['teacher']), planGateExamBuilder, (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = req.user.id;
    const result = await examBuilderChatbot_1.ExamBuilderChatbotService.regenerateSession(req.params.sessionId, teacherId);
    const assistantMessage = await examBuilderChatbot_1.ExamBuilderChatbotService.saveMessage(teacherId, 'assistant', result.reply, result.session?.id ?? null, {
        action: 'regenerate',
        session_id: result.session?.id ?? null,
        status: 'proposal_ready',
        thinking_ms: result.thinking_ms,
        questions_count: result.session?.selected_questions.length ?? 0,
        reply: result.reply,
        session: result.session,
        questions: result.session?.selected_questions ?? [],
        actions: result.actions,
    });
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
}));
exports.router.post('/sessions/:sessionId/approve', (0, authentication_1.authMiddleware)(['teacher']), planGateExamBuilder, (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = ApproveSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: parsed.error.errors,
        });
    }
    const teacherId = req.user.id;
    const result = await examBuilderChatbot_1.ExamBuilderChatbotService.approveSession(teacherId, req.params.sessionId, parsed.data);
    await examBuilderChatbot_1.ExamBuilderChatbotService.saveMessage(teacherId, 'assistant', result.exam_id
        ? `✅ تم اعتماد الأسئلة وإنشاء الامتحان (#${result.exam_id}) بنجاح.`
        : `✅ تم اعتماد ${result.question_ids.length} سؤالاً. يمكنك الآن إضافتها لنموذج إنشاء الامتحان.`, req.params.sessionId, {
        action: 'approve',
        exam_id: result.exam_id,
        question_ids: result.question_ids,
    });
    res.json({
        success: true,
        status: 'approved',
        message: result.exam_id
            ? 'تم اعتماد الأسئلة وإنشاء الامتحان'
            : 'تم اعتماد الأسئلة',
        ...result,
    });
}));
exports.router.get('/questions/:source/:questionId/preview', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const questionId = Number(req.params.questionId);
    const source = req.params.source;
    if (!Number.isInteger(questionId) || questionId <= 0) {
        return res.status(400).json({ success: false, message: 'معرف السؤال غير صحيح' });
    }
    if (source !== 'v1' && source !== 'v2') {
        return res.status(400).json({ success: false, message: 'مصدر السؤال يجب أن يكون v1 أو v2' });
    }
    const preview = await examBuilderChatbot_1.ExamBuilderChatbotService.getQuestionPreview(req.user.id, questionId, source);
    res.json({ success: true, data: preview });
}));
