"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const teacherPlanGate_1 = require("../middleware/teacherPlanGate");
const utils_1 = require("../utils");
const dataAnalystChatbot_1 = require("../services/dataAnalystChatbot");
const dataAnalyst_prompts_1 = require("../services/dataAnalyst.prompts");
const teacherPlanPolicy_1 = require("../services/teacherPlanPolicy");
exports.router = (0, express_1.Router)();
const planGateDataAnalyst = (0, teacherPlanGate_1.requireTeacherPlanFeature)('data_analyst');
const MessageSchema = zod_1.z.object({
    message: zod_1.z.string().min(1).max(4000),
});
exports.router.get('/info', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const pkg = req.user.role === 'admin' ? null : await (0, teacherPlanPolicy_1.getTeacherPackage)(req.user.id);
    res.json({
        success: true,
        bot: dataAnalystChatbot_1.DataAnalystChatbotService.getBotInfo(),
        quick_commands: dataAnalyst_prompts_1.DATA_ANALYST_QUICK_COMMANDS,
        plan_access: req.user.role === 'admin'
            ? { allowed: true }
            : (0, teacherPlanPolicy_1.buildPlanFeatureAccess)(req.user.id, pkg, 'data_analyst'),
    });
}));
exports.router.get('/messages', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const teacherId = req.user.id;
    const limit = req.query.limit ? Number(req.query.limit) : 30;
    const offset = req.query.offset ? Number(req.query.offset) : 0;
    const history = await dataAnalystChatbot_1.DataAnalystChatbotService.getHistory(teacherId, limit, offset);
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
exports.router.post('/messages', (0, authentication_1.authMiddleware)(['teacher', 'admin']), planGateDataAnalyst, (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = MessageSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Validation failed', errors: parsed.error.errors });
    }
    const teacherId = req.user.id;
    const tenantId = req.tenant?.id ?? 1;
    const recentHistory = await dataAnalystChatbot_1.DataAnalystChatbotService.getHistory(teacherId, 10, 0);
    const recentMessages = recentHistory.messages.map((message) => ({
        role: message.role,
        text: message.message,
    }));
    const teacherMessage = await dataAnalystChatbot_1.DataAnalystChatbotService.saveMessage(teacherId, 'teacher', parsed.data.message);
    const result = await dataAnalystChatbot_1.DataAnalystChatbotService.handleMessage(teacherId, tenantId, parsed.data.message, recentMessages);
    const assistantMessage = await dataAnalystChatbot_1.DataAnalystChatbotService.saveMessage(teacherId, 'assistant', result.reply, result.report_type, result.context ?? {});
    res.status(201).json({
        success: true,
        bot_name: 'محلل البيانات',
        user_message: teacherMessage,
        assistant_message: assistantMessage,
        reply: result.reply,
        report_type: result.report_type,
    });
}));
