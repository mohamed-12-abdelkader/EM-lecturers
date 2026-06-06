"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const supportChat_1 = require("../services/supportChat");
const supportChatSocket_1 = require("../services/supportChatSocket");
const deepseekChatbot_1 = require("../services/deepseekChatbot");
const teacherSupportChatbot_1 = require("../services/teacherSupportChatbot");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_2 = require("../utils");
exports.router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            const dir = path_1.default.join(__dirname, '../../uploads');
            fs_1.default.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const uniqueName = `${Date.now()}-${file.originalname}`;
            cb(null, uniqueName);
        },
    }),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});
// ========== شات الدعم للضيف (بدون تسجيل دخول) ==========
// للزائر الذي يواجه مشكلة في إنشاء الحساب أو تسجيل الدخول — يستخدم guest_token بدل الـ token
// بدء محادثة ضيف: إنشاء شات جديد أو إرجاع الشات الحالي إذا أُرسل guest_token
exports.router.post('/guest/start', (0, utils_1.asyncWrapper)(async (req, res) => {
    const body = zod_1.z.object({ guest_token: zod_1.z.string().optional() }).safeParse(req.body || {});
    const guestToken = body.success ? body.data.guest_token : undefined;
    const chat = await supportChat_1.SupportChatService.getOrCreateGuestChat(guestToken);
    res.status(200).json({
        chat_id: chat.id,
        guest_token: chat.guest_token,
        chat: {
            id: chat.id,
            status: chat.status,
            guest_token: chat.guest_token,
        },
    });
}));
// جلب شات الضيف والرسائل (بدون token تسجيل دخول)
exports.router.get('/guest/chat', (0, utils_1.asyncWrapper)(async (req, res) => {
    const guestToken = req.query.guest_token?.trim();
    if (!guestToken) {
        return res.status(400).json({ message: 'guest_token مطلوب' });
    }
    const chat = await supportChat_1.SupportChatService.getChatByGuestToken(guestToken);
    if (!chat) {
        return res.status(404).json({ message: 'المحادثة غير موجودة أو انتهت. ابدأ محادثة جديدة.' });
    }
    const messages = await supportChat_1.SupportChatService.getChatMessages(chat.id, 100);
    res.json({
        chat: {
            id: chat.id,
            status: chat.status,
            guest_token: chat.guest_token,
        },
        messages,
    });
}));
// إرسال رسالة من الضيف + رد البوت (بدون token تسجيل دخول)
exports.router.post('/guest/messages', (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        guest_token: zod_1.z.string().min(1, 'guest_token مطلوب'),
        text: zod_1.z.string().min(1, 'نص الرسالة مطلوب'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const chat = await supportChat_1.SupportChatService.getChatByGuestToken(parsed.data.guest_token);
    if (!chat) {
        return res.status(404).json({ message: 'المحادثة غير موجودة. استخدم /guest/start أولاً.' });
    }
    const chatId = chat.id;
    const appAny = req.app;
    const io = appAny?.io || null;
    const message = await supportChat_1.SupportChatService.saveMessage(chatId, 
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    null, 'student', { text: parsed.data.text, message_type: 'text' });
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, message, 'student');
    }
    const context = await deepseekChatbot_1.DeepSeekChatbotService.getChatContext(chatId, 0);
    const isSolved = await deepseekChatbot_1.DeepSeekChatbotService.checkIfSolved(parsed.data.text);
    let botReply = null;
    if (isSolved) {
        const lastBotMsg = context.messages
            .slice()
            .reverse()
            .find((m) => m.role === 'bot')?.text;
        const askedConfirmClosing = lastBotMsg && lastBotMsg.includes('هل تم حل المشكلة بشكل نهائي');
        const confirmedClosing = askedConfirmClosing &&
            deepseekChatbot_1.DeepSeekChatbotService.isPositiveConfirmationForClosing(parsed.data.text);
        if (confirmedClosing) {
            const closingMessage = await deepseekChatbot_1.DeepSeekChatbotService.generateClosingResponse(parsed.data.text);
            const closingBotMessage = await supportChat_1.SupportChatService.saveMessage(chatId, // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            null, 'admin', { text: closingMessage, message_type: 'auto_reply', is_auto_reply: true });
            botReply = closingBotMessage;
            await supportChat_1.SupportChatService.updateChatStatus(chatId, 'resolved');
            if (io)
                await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, closingBotMessage, 'admin');
        }
        else {
            const confirmText = 'هل تم حل المشكلة بشكل نهائي؟ لو نعم يمكننا إنهاء المحادثة، وإلا نكمل في الحل.';
            const confirmBotMessage = await supportChat_1.SupportChatService.saveMessage(chatId, // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            null, 'admin', { text: confirmText, message_type: 'auto_reply', is_auto_reply: true });
            botReply = confirmBotMessage;
            if (io)
                await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, confirmBotMessage, 'admin');
        }
    }
    else {
        let intentResult = await deepseekChatbot_1.DeepSeekChatbotService.detectIntent(parsed.data.text, context);
        if (context.currentIntent === 'ACTIVATION_CODE' &&
            /\d{8}/.test(parsed.data.text.replace(/\s/g, ''))) {
            intentResult = { ...intentResult, intent: 'ACTIVATION_CODE' };
        }
        const lastBotMsg = context.messages
            .slice()
            .reverse()
            .find((m) => m.role === 'bot')?.text;
        if (context.currentIntent === 'ACTIVATION_CODE' &&
            lastBotMsg &&
            (lastBotMsg.includes('هل أنت هذا الطالب') ||
                lastBotMsg.includes('هل هذا حسابك') ||
                lastBotMsg.includes('أفعّل الكورس لك الآن') ||
                lastBotMsg.includes('افعل الكورس لك الآن'))) {
            intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
        }
        const subText = parsed.data.text.trim().toLowerCase().replace(/\s+/g, ' ');
        const isSubscriptionRequest = subText.includes('عايز افعل كورس') ||
            subText.includes('عايز اشترك') ||
            subText.includes('عند مستر') ||
            subText.includes('مع مستر');
        if (isSubscriptionRequest) {
            intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
        }
        if (intentResult.requiresEscalation) {
            await supportChat_1.SupportChatService.escalateChat(chatId, `Intent requires escalation: ${intentResult.intent}`);
            await supportChat_1.SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
            const escalationMessage = await supportChat_1.SupportChatService.saveMessage(chatId, // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            null, 'admin', {
                text: 'أفهم أن مشكلتك تحتاج إلى تدخل من فريق الدعم الفني. سأقوم بنقل هذه المحادثة إلى أحد المسؤولين. سيقوم أحد المسؤولين بالرد عليك قريباً.',
                message_type: 'auto_reply',
                is_auto_reply: true,
            });
            botReply = escalationMessage;
            if (io)
                await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, escalationMessage, 'admin');
        }
        else {
            await supportChat_1.SupportChatService.updateChatBotInfo(chatId, {
                current_intent: intentResult.intent,
                bot_attempts: context.botAttempts + 1,
            });
            const chatRow = await supportChat_1.SupportChatService.getChatById(chatId);
            if (chatRow && chatRow.status !== 'bot_handling') {
                await supportChat_1.SupportChatService.updateChatStatus(chatId, 'bot_handling');
            }
            const botResponse = await deepseekChatbot_1.DeepSeekChatbotService.generateResponse(intentResult.intent, parsed.data.text, context);
            if (botResponse.shouldEscalate) {
                await supportChat_1.SupportChatService.escalateChat(chatId, botResponse.escalationReason || 'Bot response requires escalation');
                await supportChat_1.SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
            } // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const botMessage = await supportChat_1.SupportChatService.saveMessage(chatId, null, 'admin', {
                text: botResponse.message,
                message_type: 'auto_reply',
                is_auto_reply: true,
            });
            botReply = botMessage;
            if (io)
                await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, botMessage, 'admin');
        }
    }
    res.status(201).json({ message, bot_reply: botReply });
}));
// 1. الحصول على شات الطالب — عند فتح الشات تُحدَّد كل الرسائل الواردة كمقروءة (تُمسح الإشعارات)
exports.router.get('/chat', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const chat = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
    await supportChat_1.SupportChatService.markChatAsRead(chat.id, user.id);
    res.json({ chat });
}));
// ---------- شات دعم المدرس ----------
// الحصول على شات المدرس أو إنشاؤه + أزرار سريعة — عند فتح الشات تُحدَّد كل الرسائل الواردة كمقروءة (تُمسح الإشعارات)
exports.router.get('/teacher/chat', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const chat = await supportChat_1.SupportChatService.getOrCreateTeacherChat(user.id);
    await supportChat_1.SupportChatService.markTeacherChatAsRead(chat.id);
    // الشات لا يُقفل أبداً على المدرس — يمكنه الإرسال في كل الحالات (حتى بعد التصعيد أو رد الأدمن)
    res.json({ chat, quick_buttons: teacherSupportChatbot_1.TEACHER_QUICK_BUTTONS, can_teacher_send: true });
}));
// جلب رسائل شات المدرس (للمدرس: شاته فقط) — عند الفتح تُحدَّد الرسائل الواردة كمقروءة
exports.router.get('/teacher/messages', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const chat = await supportChat_1.SupportChatService.getTeacherChatByTeacherId(user.id);
    if (!chat) {
        return res.status(404).json({ message: 'Chat not found' });
    }
    await supportChat_1.SupportChatService.markTeacherChatAsRead(chat.id);
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const before = req.query.before;
    const messages = await supportChat_1.SupportChatService.getTeacherChatMessages(chat.id, limit, before);
    res.json({ messages });
}));
// إشعارات شات الدعم للمدرس: نرجع فقط غير المقروءة دائماً.
// بمجرد دخول الشات (GET /teacher/chat أو GET /teacher/messages) تُحدَّد كل الرسائل كمقروءة، فيرجع هذا الـ API فاضياً.
exports.router.get('/teacher/notifications', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    // دائماً غير المقروءة فقط — لا نرجع أبداً الإشعارات المقروءة
    const { notifications, total } = await supportChat_1.SupportChatService.getTeacherSupportNotifications(user.id, limit, offset, true);
    const unreadCount = await supportChat_1.SupportChatService.getUnreadCount(user.id, 'teacher');
    res.json({
        notifications,
        unread_count: unreadCount,
        pagination: {
            total,
            limit,
            offset,
            has_more: offset + limit < total,
        },
    });
}));
// آخر إشعار واحد فقط (غير مقروء) — مناسب لـ Expo Push وعرض بادج: عنوان + نص + بيانات للتنقل
exports.router.get('/teacher/notifications/latest', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const latest = await supportChat_1.SupportChatService.getTeacherLatestUnreadNotification(user.id);
    const unreadCount = await supportChat_1.SupportChatService.getUnreadCount(user.id, 'teacher');
    res.json({
        notification: latest,
        unread_count: unreadCount,
    });
}));
// إرسال رسالة من المدرس + رد البوت
exports.router.post('/teacher/messages', (0, authentication_1.authMiddleware)(['teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({ text: zod_1.z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const user = req.user;
    const chat = await supportChat_1.SupportChatService.getOrCreateTeacherChat(user.id);
    // جلب آخر رسائل الشات كسياق للبوت (قبل إضافة الرسالة الحالية) ليفهم المتابعة (مثلاً كود الطالب بعد طلب البوت)
    const recentRaw = await supportChat_1.SupportChatService.getTeacherChatMessages(chat.id, 20);
    const recentMessages = recentRaw.map((m) => ({
        role: m.sender_role,
        text: m.text,
    }));
    // المدرس يمكنه الاستمرار في الإرسال حتى بعد تحويل المشكلة للأدمن (لا يُقفل الشات كالطالب)
    const message = await supportChat_1.SupportChatService.saveTeacherMessage(chat.id, user.id, 'teacher', { text: parsed.data.text, message_type: 'text' });
    const appAny = req.app;
    const io = appAny.io || null;
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewTeacherMessage(io, chat.id, user.id, message, 'teacher');
    }
    const result = await (0, teacherSupportChatbot_1.handleTeacherMessage)(parsed.data.text, user.id, recentMessages);
    if (result.createTicket) {
        await supportChat_1.SupportChatService.createSupportTicket(chat.id, user.id, parsed.data.text);
    }
    if (result.escalate) {
        await supportChat_1.SupportChatService.escalateTeacherChat(chat.id, result.intent === 'problem' ? 'مشكلة من المدرس' : result.intent);
        await supportChat_1.SupportChatService.updateTeacherChatStatus(chat.id, 'waiting_for_admin');
        // إشعار الأدمن بالمشكلة والمدرس الذي أبلغ عنها
        if (result.intent === 'problem' && io) {
            supportChatSocket_1.SupportChatSocketService.emitTeacherProblemEscalatedToAdmin(io, chat.id, user.id, chat.teacher_name ?? 'مدرس', chat.teacher_email ?? null, parsed.data.text);
        }
    }
    const botMessage = await supportChat_1.SupportChatService.saveTeacherMessage(chat.id, user.id, 'admin', {
        text: result.reply,
        message_type: 'auto_reply',
        is_auto_reply: true,
    });
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewTeacherMessage(io, chat.id, user.id, botMessage, 'admin');
    }
    res.status(201).json({
        message,
        bot_reply: botMessage,
        can_teacher_send: true,
    });
}));
// قائمة شاتات المدرسين (للأدمن)
exports.router.get('/teacher/chats', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const status = req.query.status;
    const { chats, total } = await supportChat_1.SupportChatService.getAllTeacherChats(limit, offset, status);
    res.json({
        chats,
        pagination: { total, limit, offset, has_more: offset + limit < total },
    });
}));
// قائمة تذاكر الدعم / مشاكل المدرسين (للأدمن)
exports.router.get('/teacher/tickets', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const status = req.query.status;
    const { tickets, total } = await supportChat_1.SupportChatService.getAllSupportTickets(limit, offset, status);
    res.json({
        tickets,
        pagination: { total, limit, offset, has_more: offset + limit < total },
    });
}));
// تحديث حالة تذكرة (مشكلة مدرس) + إرسال رسالة للمدرس عند الحل
exports.router.patch('/teacher/tickets/:ticketId', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const ticketId = parseInt(req.params.ticketId);
    if (isNaN(ticketId)) {
        return res.status(400).json({ message: 'Invalid ticket id' });
    }
    const ticket = await supportChat_1.SupportChatService.getSupportTicketById(ticketId);
    if (!ticket) {
        return res.status(404).json({ message: 'Ticket not found' });
    }
    const schema = zod_1.z.object({
        status: zod_1.z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
        admin_notes: zod_1.z.string().optional(),
        message_to_teacher: zod_1.z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const { status, admin_notes, message_to_teacher } = parsed.data || {};
    const updateData = {};
    if (status !== undefined)
        updateData.status = status;
    if (admin_notes !== undefined)
        updateData.admin_notes = admin_notes;
    const updated = await supportChat_1.SupportChatService.updateSupportTicket(ticketId, updateData);
    const adminId = req.user.id;
    const io = req.app.io || null;
    const chatId = ticket.chat_id;
    const teacherId = ticket.teacher_id;
    const resolvedStatuses = ['resolved', 'closed'];
    const shouldNotifyTeacher = status && resolvedStatuses.includes(status) && chatId && teacherId;
    if (shouldNotifyTeacher) {
        const text = message_to_teacher?.trim() || 'تم حل مشكلتك. لو عندك أي استفسار آخر اكتب هنا.';
        const botMessage = await supportChat_1.SupportChatService.saveTeacherMessage(chatId, adminId, 'admin', {
            text,
            message_type: 'auto_reply',
            is_auto_reply: true,
        });
        if (io) {
            await supportChatSocket_1.SupportChatSocketService.emitNewTeacherMessage(io, chatId, teacherId, botMessage, 'admin');
        }
    }
    res.json({
        ticket: updated,
        ...(shouldNotifyTeacher && { message_sent_to_teacher: true }),
    });
}));
// جلب رسائل شات معين للمدرسين (أدمن أو المدرس صاحب الشات)
exports.router.get('/teacher/chats/:chatId/messages', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
        return res.status(400).json({ message: 'Invalid chat id' });
    }
    const user = req.user;
    const chat = await supportChat_1.SupportChatService.getTeacherChatById(chatId);
    if (!chat) {
        return res.status(404).json({ message: 'Chat not found' });
    }
    if (user.role === 'teacher' && chat.teacher_id !== user.id) {
        return res.status(403).json({ message: 'Access denied' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const before = req.query.before;
    const messages = await supportChat_1.SupportChatService.getTeacherChatMessages(chatId, limit, before);
    res.json({ messages, ...(user.role === 'teacher' && { can_teacher_send: true }) });
}));
// 2. جلب جميع الشاتات (للأدمن)
exports.router.get('/chats', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const status = req.query.status;
    const { chats, total } = await supportChat_1.SupportChatService.getAllChats(limit, offset, status);
    res.json({
        chats,
        pagination: {
            total,
            limit,
            offset,
            has_more: offset + limit < total,
        },
    });
}));
// 3. جلب رسائل الشات
exports.router.get('/chats/:chatId/messages', (0, authentication_1.authMiddleware)(['student', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
        return res.status(400).json({ message: 'Invalid chat id' });
    }
    const user = req.user;
    const limit = req.query.limit ? parseInt(req.query.limit) : 50;
    const before = req.query.before;
    // التحقق من الصلاحيات
    if (user.role === 'student') {
        const chatCheck = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
        if (chatCheck.id !== chatId) {
            return res.status(403).json({ message: 'Access denied' });
        }
        // للطالب: تحديد جميع الرسائل غير المقروءة كمقروءة عند فتح الشات
        await supportChat_1.SupportChatService.markChatAsRead(chatId, user.id);
        // إرسال event لإلغاء الإشعارات (Real-Time)
        const appAny = req.app;
        const io = appAny.io || null;
        if (io) {
            supportChatSocket_1.SupportChatSocketService.emitNotificationsCleared(io, chatId, user.id);
        }
    }
    const messages = await supportChat_1.SupportChatService.getChatMessages(chatId, limit, before);
    res.json({ messages });
}));
// 4. إرسال رسالة نصية
exports.router.post('/messages', (0, authentication_1.authMiddleware)(['student', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        text: zod_1.z.string().min(1),
        chat_id: zod_1.z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const user = req.user;
    let chatId = parsed.data.chat_id;
    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
        const chat = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
        chatId = chat.id;
        // منع الطالب من إرسال رسائل عندما يكون الشات في انتظار الأدمن
        if (chat.status === 'waiting_for_admin') {
            return res.status(403).json({
                message: 'Please wait for admin response. You cannot send messages while waiting for support team.',
                status: 'waiting_for_admin',
            });
        }
    }
    else if (!chatId) {
        return res.status(400).json({ message: 'chat_id is required for admin' });
    }
    const appAny = req.app;
    const io = appAny.io || null;
    // رد الأدمن على شات المدرس
    if (user.role === 'admin') {
        const teacherChat = await supportChat_1.SupportChatService.getTeacherChatById(chatId);
        if (teacherChat) {
            const message = await supportChat_1.SupportChatService.saveTeacherMessage(chatId, user.id, 'admin', { text: parsed.data.text, message_type: 'text' });
            if (teacherChat.status === 'waiting_for_admin') {
                await supportChat_1.SupportChatService.updateTeacherChatStatus(chatId, 'admin_handling');
            }
            if (io) {
                await supportChatSocket_1.SupportChatSocketService.emitNewTeacherMessage(io, chatId, teacherChat.teacher_id, message, 'admin');
            }
            return res.status(201).json({ message });
        }
    }
    const message = await supportChat_1.SupportChatService.saveMessage(chatId, user.id, user.role, {
        text: parsed.data.text,
        message_type: 'text',
    });
    // إذا كان الأدمن يرسل رسالة لشات في انتظار الأدمن، قم بتغيير الحالة إلى admin_handling
    if (user.role === 'admin') {
        const chat = await supportChat_1.SupportChatService.getChatById(chatId);
        if (chat && chat.status === 'waiting_for_admin') {
            await supportChat_1.SupportChatService.updateChatStatus(chatId, 'admin_handling');
            // تحديث معلومات الشات - لا نحتاج لمسح escalation_reason، يمكن تركه كما هو
        }
    }
    // إرسال الرسالة عبر Socket.io للـ Real-time
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, message, user.role);
    }
    // معالجة البوت الذكي للطلاب
    let botReply = null;
    if (user.role === 'student') {
        const chat = await supportChat_1.SupportChatService.getChatById(chatId);
        // لا حد لعدد رسائل البوت؛ التحويل للأدمن فقط عندما البوت فعلاً لا يستطيع الحل. وعندما يرسل الطالب رسالة بعد رد الأدمن، البوت يرد مرة أخرى كالمعتاد.
        const context = await deepseekChatbot_1.DeepSeekChatbotService.getChatContext(chatId, user.id);
        const isSolved = await deepseekChatbot_1.DeepSeekChatbotService.checkIfSolved(parsed.data.text);
        if (isSolved) {
            const lastBotMsg = context.messages
                .slice()
                .reverse()
                .find((m) => m.role === 'bot')?.text;
            const askedConfirmClosing = lastBotMsg && lastBotMsg.includes('هل تم حل المشكلة بشكل نهائي');
            const confirmedClosing = askedConfirmClosing &&
                deepseekChatbot_1.DeepSeekChatbotService.isPositiveConfirmationForClosing(parsed.data.text);
            if (confirmedClosing) {
                // الطالب أكد أن المشكلة حُلّت → إرسال رسالة شكر وإغلاق
                const closingMessage = await deepseekChatbot_1.DeepSeekChatbotService.generateClosingResponse(parsed.data.text);
                const closingBotMessage = await supportChat_1.SupportChatService.saveMessage(chatId, user.id, 'admin', {
                    text: closingMessage,
                    message_type: 'auto_reply',
                    is_auto_reply: true,
                });
                botReply = closingBotMessage;
                if (chat)
                    await supportChat_1.SupportChatService.updateChatStatus(chatId, 'resolved');
                if (io) {
                    await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, closingBotMessage, 'admin');
                }
            }
            else {
                // أول مرة يبدو أن المشكلة حُلّت → نسأل تأكيد قبل الإغلاق
                const confirmText = 'هل تم حل المشكلة بشكل نهائي؟ لو نعم يمكننا إنهاء المحادثة، وإلا نكمل في الحل.';
                const confirmBotMessage = await supportChat_1.SupportChatService.saveMessage(chatId, user.id, 'admin', {
                    text: confirmText,
                    message_type: 'auto_reply',
                    is_auto_reply: true,
                });
                botReply = confirmBotMessage;
                if (io) {
                    await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, confirmBotMessage, 'admin');
                }
            }
        }
        else {
            // الحصول على سياق المحادثة (سواء الشات مع البوت أو تم تحويله للأدمن - عند رسالة جديدة من الطالب البوت يحاول الرد أولاً)
            // اكتشاف النية (Intent Detection)
            let intentResult = await deepseekChatbot_1.DeepSeekChatbotService.detectIntent(parsed.data.text, context);
            // إذا كان البوت ينتظر كود التفعيل والطالب أرسل ما يشبه الكود (8 أرقام)، نعتبر النية ACTIVATION_CODE
            if (context.currentIntent === 'ACTIVATION_CODE' &&
                /\d{8}/.test(parsed.data.text.replace(/\s/g, ''))) {
                intentResult = { ...intentResult, intent: 'ACTIVATION_CODE' };
            }
            // إذا البوت سأل عن كود التفعيل (هل أنت هذا الطالب؟ أو هل تحب أن أفعّل الكورس؟) والطالب رد، نبقى في ACTIVATION_CODE ولا نصعّد
            const lastBotMsg = context.messages
                .slice()
                .reverse()
                .find((m) => m.role === 'bot')?.text;
            if (context.currentIntent === 'ACTIVATION_CODE' &&
                lastBotMsg &&
                (lastBotMsg.includes('هل أنت هذا الطالب') ||
                    lastBotMsg.includes('هل انت الطالب') ||
                    lastBotMsg.includes('هل هذا حسابك') ||
                    lastBotMsg.includes('أفعّل الكورس لك الآن') ||
                    lastBotMsg.includes('افعل الكورس لك الآن'))) {
                intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
            }
            // طلب اشتراك/تفعيل عند مستر معين (عايز أفعل كورس عند مستر / عايز أشترك مع...) → نثبت النية ACTIVATION_CODE
            const subText = parsed.data.text.trim().toLowerCase().replace(/\s+/g, ' ');
            const isSubscriptionRequest = subText.includes('عايز افعل كورس') ||
                subText.includes('عايز اشترك') ||
                subText.includes('عند مستر') ||
                subText.includes('مع مستر') ||
                subText.includes('شراء كورس') ||
                (subText.includes('مستر') && (subText.includes('كورس') || subText.includes('اشترك')));
            if (isSubscriptionRequest) {
                intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
            }
            // التحقق من الحاجة للتصعيد الفوري (لا نُصعّد بسبب عدد الرسائل، فقط عندما البوت لا يستطيع الحل)
            if (intentResult.requiresEscalation) {
                await supportChat_1.SupportChatService.escalateChat(chatId, `Intent requires escalation: ${intentResult.intent}`);
                await supportChat_1.SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
                const escalationMessage = await supportChat_1.SupportChatService.saveMessage(chatId, user.id, 'admin', {
                    text: 'أفهم أن مشكلتك تحتاج إلى تدخل من فريق الدعم الفني. سأقوم بنقل هذه المحادثة إلى أحد المسؤولين. سيقوم أحد المسؤولين بالرد عليك قريباً.',
                    message_type: 'auto_reply',
                    is_auto_reply: true,
                });
                botReply = escalationMessage;
                if (io) {
                    await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, escalationMessage, 'admin');
                }
            }
            else {
                const newBotAttempts = context.botAttempts + 1;
                await supportChat_1.SupportChatService.updateChatBotInfo(chatId, {
                    current_intent: intentResult.intent,
                    bot_attempts: newBotAttempts,
                });
                // عند أي رد من البوت نعيد الحالة إلى bot_handling (بما فيها بعد رد الأدمن - الطالب يرسل رسالة والبوت يرد عادي)
                if (chat && chat.status !== 'bot_handling') {
                    await supportChat_1.SupportChatService.updateChatStatus(chatId, 'bot_handling');
                }
                const botResponse = await deepseekChatbot_1.DeepSeekChatbotService.generateResponse(intentResult.intent, parsed.data.text, context);
                if (botResponse.shouldEscalate) {
                    await supportChat_1.SupportChatService.escalateChat(chatId, botResponse.escalationReason || 'Bot response requires escalation');
                    await supportChat_1.SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
                }
                const botMessage = await supportChat_1.SupportChatService.saveMessage(chatId, user.id, 'admin', {
                    text: botResponse.message,
                    message_type: 'auto_reply',
                    is_auto_reply: true,
                });
                botReply = botMessage;
                if (io) {
                    await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, chatId, botMessage, 'admin');
                }
            }
        }
    }
    res.status(201).json({
        message,
        ...(botReply && { bot_reply: botReply }),
    });
}));
// 5. إرسال ميديا (صورة/فيديو/ملف)
exports.router.post('/messages/media', (0, authentication_1.authMiddleware)(['student', 'admin']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const file = req.file;
    const chatId = req.body.chat_id ? parseInt(req.body.chat_id) : undefined;
    const text = req.body.text || null;
    if (!file) {
        return res.status(400).json({ message: 'file is required' });
    }
    let finalChatId = chatId;
    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
        const chat = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
        finalChatId = chat.id;
    }
    else if (!finalChatId) {
        return res.status(400).json({ message: 'chat_id is required for admin' });
    }
    // رفع الملف على Cloudinary
    const mime = file.mimetype;
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');
    // تحديد resource_type حسب نوع الملف
    const resourceType = isAudio ? 'raw' : isVideo ? 'video' : 'image';
    const uploaded = await (0, utils_2.uploadToCloudinary)(file.path, { resource_type: resourceType });
    const messageType = isAudio ? 'audio' : isImage ? 'image' : 'file';
    const message = await supportChat_1.SupportChatService.saveMessage(finalChatId, user.id, user.role, {
        text,
        message_type: messageType,
        media_url: uploaded.secure_url,
        media_type: mime,
        media_name: file.originalname,
        media_size: file.size,
    });
    // إرسال الرسالة عبر Socket.io للـ Real-time
    const appAny = req.app;
    const io = appAny.io || null;
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, finalChatId, message, user.role);
    }
    res.status(201).json({ message });
}));
// 6. إرسال رسالة صوتية
exports.router.post('/messages/audio', (0, authentication_1.authMiddleware)(['student', 'admin']), upload.single('audio'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const file = req.file;
    const chatId = req.body.chat_id ? parseInt(req.body.chat_id) : undefined;
    const duration = req.body.duration ? parseFloat(req.body.duration) : null;
    if (!file) {
        return res.status(400).json({ message: 'audio file is required' });
    }
    let finalChatId = chatId;
    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
        const chat = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
        finalChatId = chat.id;
    }
    else if (!finalChatId) {
        return res.status(400).json({ message: 'chat_id is required for admin' });
    }
    // رفع الملف على Cloudinary (استخدام raw للملفات الصوتية)
    const uploaded = await (0, utils_2.uploadToCloudinary)(file.path, { resource_type: 'raw' });
    const message = await supportChat_1.SupportChatService.saveMessage(finalChatId, user.id, user.role, {
        message_type: 'audio',
        media_url: uploaded.secure_url,
        media_type: file.mimetype,
        media_name: file.originalname,
        media_size: file.size,
        duration: duration ? Math.round(duration) : undefined,
    });
    // إرسال الرسالة عبر Socket.io للـ Real-time
    const appAny = req.app;
    const io = appAny.io || null;
    if (io) {
        await supportChatSocket_1.SupportChatSocketService.emitNewMessage(io, finalChatId, message, user.role);
    }
    res.status(201).json({ message });
}));
// 7. تحديث حالة الشات (للأدمن)
exports.router.patch('/chats/:chatId/status', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
        return res.status(400).json({ message: 'Invalid chat id' });
    }
    const schema = zod_1.z.object({
        status: zod_1.z.enum([
            'open',
            'closed',
            'resolved',
            'bot_handling',
            'waiting_for_admin',
            'admin_handling',
        ]),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    await supportChat_1.SupportChatService.updateChatStatus(chatId, parsed.data.status);
    res.json({ message: 'Chat status updated' });
}));
// 8. تعيين أدمن للشات
exports.router.post('/chats/:chatId/assign', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
        return res.status(400).json({ message: 'Invalid chat id' });
    }
    const user = req.user;
    await supportChat_1.SupportChatService.assignAdmin(chatId, user.id);
    // تحديث حالة الشات إلى admin_handling عند تعيين أدمن
    await supportChat_1.SupportChatService.updateChatStatus(chatId, 'admin_handling');
    res.json({ message: 'Admin assigned to chat' });
}));
// 9. عدد الرسائل غير المقروءة (طالب: شات الدعم؛ مدرس: شات دعم المدرس؛ أدمن: رسائل الطلاب)
exports.router.get('/unread-count', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const count = await supportChat_1.SupportChatService.getUnreadCount(user.id, user.role);
    res.json({ unread_count: count });
}));
// 10. جلب إشعارات الرسائل — للطالب: غير المقروءة فقط (تُمسح بمجرد دخول الشات، مثل teacher)؛ للأدمن: رسائل الطلاب
exports.router.get('/notifications', (0, authentication_1.authMiddleware)(['student', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const role = user.role;
    // للطالب: دائماً غير المقروءة فقط (بعد دخول الشات GET /support/chat تُحدَّد كمقروءة فترجع القائمة فاضية)
    const unreadOnly = role === 'student' ? true : undefined;
    const result = await supportChat_1.SupportChatService.getMessageNotifications(user.id, role, limit, offset, unreadOnly ?? true);
    const unreadCount = role === 'student' ? await supportChat_1.SupportChatService.getUnreadCount(user.id, 'student') : undefined;
    res.json({
        notifications: result.notifications,
        ...(unreadCount !== undefined && { unread_count: unreadCount }),
        pagination: {
            total: result.total,
            limit,
            offset,
            has_more: offset + limit < result.total,
        },
    });
}));
// آخر إشعار واحد غير مقروء للطالب — مناسب لـ Expo Push والبادج (نفس سلوك teacher/notifications/latest)
exports.router.get('/notifications/latest', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const latest = await supportChat_1.SupportChatService.getStudentLatestUnreadNotification(user.id);
    const unreadCount = await supportChat_1.SupportChatService.getUnreadCount(user.id, 'student');
    res.json({
        notification: latest,
        unread_count: unreadCount,
    });
}));
// 11. جلب الأسئلة التلقائية المتاحة (للطالب) — عند استدعاء هذا الـ API تُمسح إشعارات الشات (تُحدَّد كمقروءة) فيرجع GET /notifications فاضياً حتى إشعار جديد
exports.router.get('/faq', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const chatId = await supportChat_1.SupportChatService.getStudentChatId(user.id);
    if (chatId != null) {
        await supportChat_1.SupportChatService.markChatAsRead(chatId, user.id);
    }
    const faqs = await supportChat_1.SupportChatService.getAllFAQs(true);
    const publicFaqs = faqs.map((faq) => ({
        id: faq.id,
        question: faq.question,
        answer: faq.answer,
        priority: faq.priority,
    }));
    res.json({ faqs: publicFaqs });
}));
// APIs للأسئلة الثابتة (FAQ)
// 1. إنشاء سؤال ثابت
exports.router.post('/faq', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        question: zod_1.z.string().min(1),
        answer: zod_1.z.string().min(1),
        keywords: zod_1.z.array(zod_1.z.string()).optional(),
        priority: zod_1.z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const user = req.user;
    const faq = await supportChat_1.SupportChatService.createFAQ(parsed.data.question, parsed.data.answer, parsed.data.keywords || [], parsed.data.priority || 0, user.id);
    res.status(201).json({ faq });
}));
// 2. جلب جميع الأسئلة (للأدمن)
exports.router.get('/faq/admin', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const activeOnly = req.query.active_only === 'true';
    const faqs = await supportChat_1.SupportChatService.getAllFAQs(activeOnly);
    res.json({ faqs });
}));
// 3. تحديث سؤال
exports.router.put('/faq/:id', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid FAQ id' });
    }
    const schema = zod_1.z.object({
        question: zod_1.z.string().optional(),
        answer: zod_1.z.string().optional(),
        keywords: zod_1.z.array(zod_1.z.string()).optional(),
        is_active: zod_1.z.boolean().optional(),
        priority: zod_1.z.number().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const faq = await supportChat_1.SupportChatService.updateFAQ(id, parsed.data);
    res.json({ faq });
}));
// 4. حذف سؤال
exports.router.delete('/faq/:id', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
        return res.status(400).json({ message: 'Invalid FAQ id' });
    }
    await supportChat_1.SupportChatService.deleteFAQ(id);
    res.json({ message: 'FAQ deleted' });
}));
// 5. اختبار مطابقة السؤال
exports.router.post('/faq/test-match', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        question: zod_1.z.string().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const faq = await supportChat_1.SupportChatService.findMatchingFAQ(parsed.data.question);
    res.json({
        question: parsed.data.question,
        matched: !!faq,
        ...(faq && { faq }),
    });
}));
