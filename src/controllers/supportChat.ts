import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { SupportChatService } from '../services/supportChat';
import { SupportChatSocketService } from '../services/supportChatSocket';
import { DeepSeekChatbotService } from '../services/deepseekChatbot';
import {
  handleTeacherMessage,
  TEACHER_DAILY_GREETING,
  TEACHER_QUICK_BUTTONS,
} from '../services/teacherSupportChatbot';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { uploadToCloudinary } from '../utils';
import { Server as SocketIOServer } from 'socket.io';

export const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../../uploads');
      fs.mkdirSync(dir, { recursive: true });
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
router.post(
  '/guest/start',
  asyncWrapper(async (req, res) => {
    const body = z.object({ guest_token: z.string().optional() }).safeParse(req.body || {});
    const guestToken = body.success ? body.data.guest_token : undefined;
    const chat = await SupportChatService.getOrCreateGuestChat(guestToken);
    res.status(200).json({
      chat_id: chat.id,
      guest_token: chat.guest_token,
      chat: {
        id: chat.id,
        status: chat.status,
        guest_token: chat.guest_token,
      },
    });
  }),
);

// جلب شات الضيف والرسائل (بدون token تسجيل دخول)
router.get(
  '/guest/chat',
  asyncWrapper(async (req, res) => {
    const guestToken = (req.query.guest_token as string)?.trim();
    if (!guestToken) {
      return res.status(400).json({ message: 'guest_token مطلوب' });
    }
    const chat = await SupportChatService.getChatByGuestToken(guestToken);
    if (!chat) {
      return res.status(404).json({ message: 'المحادثة غير موجودة أو انتهت. ابدأ محادثة جديدة.' });
    }
    const messages = await SupportChatService.getChatMessages(chat.id, 100);
    res.json({
      chat: {
        id: chat.id,
        status: chat.status,
        guest_token: chat.guest_token,
      },
      messages,
    });
  }),
);

// إرسال رسالة من الضيف + رد البوت (بدون token تسجيل دخول)
router.post(
  '/guest/messages',
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      guest_token: z.string().min(1, 'guest_token مطلوب'),
      text: z.string().min(1, 'نص الرسالة مطلوب'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const chat = await SupportChatService.getChatByGuestToken(parsed.data.guest_token);
    if (!chat) {
      return res.status(404).json({ message: 'المحادثة غير موجودة. استخدم /guest/start أولاً.' });
    }

    const chatId = chat.id;
    const appAny = req.app as any;
    const io: SocketIOServer | null = appAny?.io || null;

    const message = await SupportChatService.saveMessage(
      chatId,
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      null,
      'student',
      { text: parsed.data.text, message_type: 'text' },
    );
    if (io) {
      await SupportChatSocketService.emitNewMessage(io, chatId, message, 'student');
    }

    const context = await DeepSeekChatbotService.getChatContext(chatId, 0);
    const isSolved = await DeepSeekChatbotService.checkIfSolved(parsed.data.text);
    let botReply = null;

    if (isSolved) {
      const lastBotMsg = context.messages
        .slice()
        .reverse()
        .find((m: { role: string }) => m.role === 'bot')?.text;
      const askedConfirmClosing =
        lastBotMsg && lastBotMsg.includes('هل تم حل المشكلة بشكل نهائي');
      const confirmedClosing =
        askedConfirmClosing &&
        DeepSeekChatbotService.isPositiveConfirmationForClosing(parsed.data.text);
      if (confirmedClosing) {
        const closingMessage = await DeepSeekChatbotService.generateClosingResponse(parsed.data.text);
        const closingBotMessage = await SupportChatService.saveMessage(
          chatId,// eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
          null,
          'admin',
          { text: closingMessage, message_type: 'auto_reply', is_auto_reply: true },
        );
        botReply = closingBotMessage;
        await SupportChatService.updateChatStatus(chatId, 'resolved');
        if (io) await SupportChatSocketService.emitNewMessage(io, chatId, closingBotMessage, 'admin');
      } else {
        const confirmText =
          'هل تم حل المشكلة بشكل نهائي؟ لو نعم يمكننا إنهاء المحادثة، وإلا نكمل في الحل.';
        const confirmBotMessage = await SupportChatService.saveMessage(
          chatId,// eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
          null,
          'admin',
          { text: confirmText, message_type: 'auto_reply', is_auto_reply: true },
        );
        botReply = confirmBotMessage;
        if (io) await SupportChatSocketService.emitNewMessage(io, chatId, confirmBotMessage, 'admin');
      }
    } else {
      let intentResult = await DeepSeekChatbotService.detectIntent(parsed.data.text, context);
      if (
        context.currentIntent === 'ACTIVATION_CODE' &&
        /\d{8}/.test(parsed.data.text.replace(/\s/g, ''))
      ) {
        intentResult = { ...intentResult, intent: 'ACTIVATION_CODE' };
      }
      const lastBotMsg = context.messages
        .slice()
        .reverse()
        .find((m: { role: string }) => m.role === 'bot')?.text;
      if (
        context.currentIntent === 'ACTIVATION_CODE' &&
        lastBotMsg &&
        (lastBotMsg.includes('هل أنت هذا الطالب') ||
          lastBotMsg.includes('هل هذا حسابك') ||
          lastBotMsg.includes('أفعّل الكورس لك الآن') ||
          lastBotMsg.includes('افعل الكورس لك الآن'))
      ) {
        intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
      }
      const subText = parsed.data.text.trim().toLowerCase().replace(/\s+/g, ' ');
      const isSubscriptionRequest =
        subText.includes('عايز افعل كورس') ||
        subText.includes('عايز اشترك') ||
        subText.includes('عند مستر') ||
        subText.includes('مع مستر');
      if (isSubscriptionRequest) {
        intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
      }

      if (intentResult.requiresEscalation) {
        await SupportChatService.escalateChat(
          chatId,
          `Intent requires escalation: ${intentResult.intent}`,
        );
        await SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
        const escalationMessage = await SupportChatService.saveMessage(
          chatId,// eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
          null,
          'admin',
          {
            text: 'أفهم أن مشكلتك تحتاج إلى تدخل من فريق الدعم الفني. سأقوم بنقل هذه المحادثة إلى أحد المسؤولين. سيقوم أحد المسؤولين بالرد عليك قريباً.',
            message_type: 'auto_reply',
            is_auto_reply: true,
          },
        );
        botReply = escalationMessage;
        if (io) await SupportChatSocketService.emitNewMessage(io, chatId, escalationMessage, 'admin');
      } else {
        await SupportChatService.updateChatBotInfo(chatId, {
          current_intent: intentResult.intent,
          bot_attempts: context.botAttempts + 1,
        });
        const chatRow = await SupportChatService.getChatById(chatId);
        if (chatRow && chatRow.status !== 'bot_handling') {
          await SupportChatService.updateChatStatus(chatId, 'bot_handling');
        }
        const botResponse = await DeepSeekChatbotService.generateResponse(
          intentResult.intent,
          parsed.data.text,
          context,
        );
        if (botResponse.shouldEscalate) {
          await SupportChatService.escalateChat(
            chatId,
            botResponse.escalationReason || 'Bot response requires escalation',
          );
          await SupportChatService.updateChatStatus(chatId, 'waiting_for_admin');
        }// eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
        const botMessage = await SupportChatService.saveMessage(chatId, null, 'admin', {
          text: botResponse.message,
          message_type: 'auto_reply',
          is_auto_reply: true,
        });
        botReply = botMessage;
        if (io) await SupportChatSocketService.emitNewMessage(io, chatId, botMessage, 'admin');
      }
    }

    res.status(201).json({ message, bot_reply: botReply });
  }),
);

// 1. الحصول على شات الطالب — عند فتح الشات تُحدَّد كل الرسائل الواردة كمقروءة (تُمسح الإشعارات)
router.get(
  '/chat',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const chat = await SupportChatService.getOrCreateStudentChat(user.id);
    await SupportChatService.markChatAsRead(chat.id, user.id);
    res.json({ chat });
  }),
);

// ---------- شات دعم المدرس ----------

// الحصول على شات المدرس أو إنشاؤه + أزرار سريعة — عند فتح الشات تُحدَّد كل الرسائل الواردة كمقروءة (تُمسح الإشعارات)
router.get(
  '/teacher/chat',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const chat = await SupportChatService.getOrCreateTeacherChat(user.id);
    await SupportChatService.markTeacherChatAsRead(chat.id);
    // الشات لا يُقفل أبداً على المدرس — يمكنه الإرسال في كل الحالات (حتى بعد التصعيد أو رد الأدمن)
    res.json({ chat, quick_buttons: TEACHER_QUICK_BUTTONS, can_teacher_send: true });
  }),
);

// جلب رسائل شات المدرس (للمدرس: شاته فقط) — عند الفتح تُحدَّد الرسائل الواردة كمقروءة
router.get(
  '/teacher/messages',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const chat = await SupportChatService.getTeacherChatByTeacherId(user.id);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    await SupportChatService.markTeacherChatAsRead(chat.id);
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const before = req.query.before as string | undefined;
    const messages = await SupportChatService.getTeacherChatMessages(chat.id, limit, before);
    res.json({ messages });
  }),
);

// إشعارات شات الدعم للمدرس: نرجع فقط غير المقروءة دائماً.
// بمجرد دخول الشات (GET /teacher/chat أو GET /teacher/messages) تُحدَّد كل الرسائل كمقروءة، فيرجع هذا الـ API فاضياً.
router.get(
  '/teacher/notifications',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    // دائماً غير المقروءة فقط — لا نرجع أبداً الإشعارات المقروءة
    const { notifications, total } = await SupportChatService.getTeacherSupportNotifications(
      user.id,
      limit,
      offset,
      true, // unreadOnly = true دائماً
    );
    const unreadCount = await SupportChatService.getUnreadCount(user.id, 'teacher');
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
  }),
);

// آخر إشعار واحد فقط (غير مقروء) — مناسب لـ Expo Push وعرض بادج: عنوان + نص + بيانات للتنقل
router.get(
  '/teacher/notifications/latest',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const latest = await SupportChatService.getTeacherLatestUnreadNotification(user.id);
    const unreadCount = await SupportChatService.getUnreadCount(user.id, 'teacher');
    res.json({
      notification: latest,
      unread_count: unreadCount,
    });
  }),
);

// إرسال رسالة من المدرس + رد البوت
router.post(
  '/teacher/messages',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({ text: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const user = req.user!;
    const chat = await SupportChatService.getOrCreateTeacherChat(user.id);

    // جلب آخر رسائل الشات كسياق للبوت (قبل إضافة الرسالة الحالية) ليفهم المتابعة (مثلاً كود الطالب بعد طلب البوت)
    const recentRaw = await SupportChatService.getTeacherChatMessages(chat.id, 20);
    const recentMessages = recentRaw.map((m) => ({
      role: m.sender_role as 'teacher' | 'admin',
      text: m.text,
    }));

    // المدرس يمكنه الاستمرار في الإرسال حتى بعد تحويل المشكلة للأدمن (لا يُقفل الشات كالطالب)
    const message = await SupportChatService.saveTeacherMessage(
      chat.id,
      user.id,
      'teacher',
      { text: parsed.data.text, message_type: 'text' },
    );

    const appAny = req.app as any;
    const io: SocketIOServer | null = appAny.io || null;
    if (io) {
      await SupportChatSocketService.emitNewTeacherMessage(
        io,
        chat.id,
        user.id,
        message,
        'teacher',
      );
    }

    const result = await handleTeacherMessage(parsed.data.text, user.id, recentMessages);

    if (result.createTicket) {
      await SupportChatService.createSupportTicket(chat.id, user.id, parsed.data.text);
    }
    if (result.escalate) {
      await SupportChatService.escalateTeacherChat(
        chat.id,
        result.intent === 'problem' ? 'مشكلة من المدرس' : result.intent,
      );
      await SupportChatService.updateTeacherChatStatus(chat.id, 'waiting_for_admin');
      // إشعار الأدمن بالمشكلة والمدرس الذي أبلغ عنها
      if (result.intent === 'problem' && io) {
        SupportChatSocketService.emitTeacherProblemEscalatedToAdmin(
          io,
          chat.id,
          user.id,
          chat.teacher_name ?? 'مدرس',
          chat.teacher_email ?? null,
          parsed.data.text,
        );
      }
    }

    const botMessage = await SupportChatService.saveTeacherMessage(
      chat.id,
      user.id,
      'admin',
      {
        text: result.reply,
        message_type: 'auto_reply',
        is_auto_reply: true,
      },
    );

    if (io) {
      await SupportChatSocketService.emitNewTeacherMessage(
        io,
        chat.id,
        user.id,
        botMessage,
        'admin',
      );
    }

    res.status(201).json({
      message,
      bot_reply: botMessage,
      can_teacher_send: true,
    });
  }),
);

// قائمة شاتات المدرسين (للأدمن)
router.get(
  '/teacher/chats',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const status = req.query.status as string | undefined;
    const { chats, total } = await SupportChatService.getAllTeacherChats(limit, offset, status);
    res.json({
      chats,
      pagination: { total, limit, offset, has_more: offset + limit < total },
    });
  }),
);

// قائمة تذاكر الدعم / مشاكل المدرسين (للأدمن)
router.get(
  '/teacher/tickets',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const status = req.query.status as string | undefined;
    const { tickets, total } = await SupportChatService.getAllSupportTickets(limit, offset, status);
    res.json({
      tickets,
      pagination: { total, limit, offset, has_more: offset + limit < total },
    });
  }),
);

// تحديث حالة تذكرة (مشكلة مدرس) + إرسال رسالة للمدرس عند الحل
router.patch(
  '/teacher/tickets/:ticketId',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const ticketId = parseInt(req.params.ticketId);
    if (isNaN(ticketId)) {
      return res.status(400).json({ message: 'Invalid ticket id' });
    }
    const ticket = await SupportChatService.getSupportTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }
    const schema = z.object({
      status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
      admin_notes: z.string().optional(),
      message_to_teacher: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const { status, admin_notes, message_to_teacher } = parsed.data || {};
    const updateData: { status?: string; admin_notes?: string } = {};
    if (status !== undefined) updateData.status = status;
    if (admin_notes !== undefined) updateData.admin_notes = admin_notes;
    const updated = await SupportChatService.updateSupportTicket(ticketId, updateData);
    const adminId = req.user!.id;
    const io: SocketIOServer | null = (req.app as any).io || null;
    const chatId = ticket.chat_id;
    const teacherId = ticket.teacher_id;
    const resolvedStatuses = ['resolved', 'closed'];
    const shouldNotifyTeacher =
      status && resolvedStatuses.includes(status) && chatId && teacherId;
    if (shouldNotifyTeacher) {
      const text =
        message_to_teacher?.trim() || 'تم حل مشكلتك. لو عندك أي استفسار آخر اكتب هنا.';
      const botMessage = await SupportChatService.saveTeacherMessage(
        chatId,
        adminId,
        'admin',
        {
          text,
          message_type: 'auto_reply',
          is_auto_reply: true,
        },
      );
      if (io) {
        await SupportChatSocketService.emitNewTeacherMessage(
          io,
          chatId,
          teacherId,
          botMessage,
          'admin',
        );
      }
    }
    res.json({
      ticket: updated,
      ...(shouldNotifyTeacher && { message_sent_to_teacher: true }),
    });
  }),
);

// جلب رسائل شات معين للمدرسين (أدمن أو المدرس صاحب الشات)
router.get(
  '/teacher/chats/:chatId/messages',
  authMiddleware(['teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
      return res.status(400).json({ message: 'Invalid chat id' });
    }
    const user = req.user!;
    const chat = await SupportChatService.getTeacherChatById(chatId);
    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }
    if (user.role === 'teacher' && chat.teacher_id !== user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const before = req.query.before as string | undefined;
    const messages = await SupportChatService.getTeacherChatMessages(chatId, limit, before);
    res.json({ messages, ...(user.role === 'teacher' && { can_teacher_send: true }) });
  }),
);

// 2. جلب جميع الشاتات (للأدمن)
router.get(
  '/chats',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const status = req.query.status as 'open' | 'closed' | 'resolved' | undefined;

    const { chats, total } = await SupportChatService.getAllChats(limit, offset, status);

    res.json({
      chats,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  }),
);

// 3. جلب رسائل الشات
router.get(
  '/chats/:chatId/messages',
  authMiddleware(['student', 'admin']),
  asyncWrapper(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
      return res.status(400).json({ message: 'Invalid chat id' });
    }

    const user = req.user!;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const before = req.query.before as string | undefined;

    // التحقق من الصلاحيات
    if (user.role === 'student') {
      const chatCheck = await SupportChatService.getOrCreateStudentChat(user.id);
      if (chatCheck.id !== chatId) {
        return res.status(403).json({ message: 'Access denied' });
      }
      
      // للطالب: تحديد جميع الرسائل غير المقروءة كمقروءة عند فتح الشات
      await SupportChatService.markChatAsRead(chatId, user.id);
      
      // إرسال event لإلغاء الإشعارات (Real-Time)
      const appAny = req.app as any;
      const io: SocketIOServer | null = appAny.io || null;
      if (io) {
        SupportChatSocketService.emitNotificationsCleared(io, chatId, user.id);
      }
    }

    const messages = await SupportChatService.getChatMessages(chatId, limit, before);
    res.json({ messages });
  }),
);

// 4. إرسال رسالة نصية
router.post(
  '/messages',
  authMiddleware(['student', 'admin']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      text: z.string().min(1),
      chat_id: z.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const user = req.user!;
    let chatId = parsed.data.chat_id;

    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
      const chat = await SupportChatService.getOrCreateStudentChat(user.id);
      chatId = chat.id;

      // منع الطالب من إرسال رسائل عندما يكون الشات في انتظار الأدمن
      if (chat.status === 'waiting_for_admin') {
        return res.status(403).json({
          message:
            'Please wait for admin response. You cannot send messages while waiting for support team.',
          status: 'waiting_for_admin',
        });
      }
    } else if (!chatId) {
      return res.status(400).json({ message: 'chat_id is required for admin' });
    }

    const appAny = req.app as any;
    const io: SocketIOServer | null = appAny.io || null;

    // رد الأدمن على شات المدرس
    if (user.role === 'admin') {
      const teacherChat = await SupportChatService.getTeacherChatById(chatId!);
      if (teacherChat) {
        const message = await SupportChatService.saveTeacherMessage(
          chatId!,
          user.id,
          'admin',
          { text: parsed.data.text, message_type: 'text' },
        );
        if (teacherChat.status === 'waiting_for_admin') {
          await SupportChatService.updateTeacherChatStatus(chatId!, 'admin_handling');
        }
        if (io) {
          await SupportChatSocketService.emitNewTeacherMessage(
            io,
            chatId!,
            teacherChat.teacher_id,
            message,
            'admin',
          );
        }
        return res.status(201).json({ message });
      }
    }

    const message = await SupportChatService.saveMessage(
      chatId!,
      user.id,
      user.role as 'student' | 'admin',
      {
        text: parsed.data.text,
        message_type: 'text',
      },
    );

    // إذا كان الأدمن يرسل رسالة لشات في انتظار الأدمن، قم بتغيير الحالة إلى admin_handling
    if (user.role === 'admin') {
      const chat = await SupportChatService.getChatById(chatId!);
      if (chat && chat.status === 'waiting_for_admin') {
        await SupportChatService.updateChatStatus(chatId!, 'admin_handling');
        // تحديث معلومات الشات - لا نحتاج لمسح escalation_reason، يمكن تركه كما هو
      }
    }

    // إرسال الرسالة عبر Socket.io للـ Real-time
    if (io) {
      await SupportChatSocketService.emitNewMessage(
        io,
        chatId!,
        message,
        user.role as 'student' | 'admin',
      );
    }

    // معالجة البوت الذكي للطلاب
    let botReply = null;
    if (user.role === 'student') {
      const chat = await SupportChatService.getChatById(chatId!);

      // لا حد لعدد رسائل البوت؛ التحويل للأدمن فقط عندما البوت فعلاً لا يستطيع الحل. وعندما يرسل الطالب رسالة بعد رد الأدمن، البوت يرد مرة أخرى كالمعتاد.
      const context = await DeepSeekChatbotService.getChatContext(chatId!, user.id);
      const isSolved = await DeepSeekChatbotService.checkIfSolved(parsed.data.text);

      if (isSolved) {
        const lastBotMsg = context.messages
          .slice()
          .reverse()
          .find((m: { role: string }) => m.role === 'bot')?.text;
        const askedConfirmClosing =
          lastBotMsg && lastBotMsg.includes('هل تم حل المشكلة بشكل نهائي');
        const confirmedClosing =
          askedConfirmClosing &&
          DeepSeekChatbotService.isPositiveConfirmationForClosing(parsed.data.text);

        if (confirmedClosing) {
          // الطالب أكد أن المشكلة حُلّت → إرسال رسالة شكر وإغلاق
          const closingMessage = await DeepSeekChatbotService.generateClosingResponse(
            parsed.data.text,
          );
          const closingBotMessage = await SupportChatService.saveMessage(
            chatId!,
            user.id,
            'admin',
            {
              text: closingMessage,
              message_type: 'auto_reply',
              is_auto_reply: true,
            },
          );
          botReply = closingBotMessage;
          if (chat) await SupportChatService.updateChatStatus(chatId!, 'resolved');
          if (io) {
            await SupportChatSocketService.emitNewMessage(io, chatId!, closingBotMessage, 'admin');
          }
        } else {
          // أول مرة يبدو أن المشكلة حُلّت → نسأل تأكيد قبل الإغلاق
          const confirmText =
            'هل تم حل المشكلة بشكل نهائي؟ لو نعم يمكننا إنهاء المحادثة، وإلا نكمل في الحل.';
          const confirmBotMessage = await SupportChatService.saveMessage(
            chatId!,
            user.id,
            'admin',
            {
              text: confirmText,
              message_type: 'auto_reply',
              is_auto_reply: true,
            },
          );
          botReply = confirmBotMessage;
          if (io) {
            await SupportChatSocketService.emitNewMessage(io, chatId!, confirmBotMessage, 'admin');
          }
        }
      } else {
        // الحصول على سياق المحادثة (سواء الشات مع البوت أو تم تحويله للأدمن - عند رسالة جديدة من الطالب البوت يحاول الرد أولاً)

          // اكتشاف النية (Intent Detection)
          let intentResult = await DeepSeekChatbotService.detectIntent(parsed.data.text, context);

          // إذا كان البوت ينتظر كود التفعيل والطالب أرسل ما يشبه الكود (8 أرقام)، نعتبر النية ACTIVATION_CODE
          if (
            context.currentIntent === 'ACTIVATION_CODE' &&
            /\d{8}/.test(parsed.data.text.replace(/\s/g, ''))
          ) {
            intentResult = { ...intentResult, intent: 'ACTIVATION_CODE' };
          }

          // إذا البوت سأل عن كود التفعيل (هل أنت هذا الطالب؟ أو هل تحب أن أفعّل الكورس؟) والطالب رد، نبقى في ACTIVATION_CODE ولا نصعّد
          const lastBotMsg = context.messages
            .slice()
            .reverse()
            .find((m: { role: string }) => m.role === 'bot')?.text;
          if (
            context.currentIntent === 'ACTIVATION_CODE' &&
            lastBotMsg &&
            (lastBotMsg.includes('هل أنت هذا الطالب') ||
              lastBotMsg.includes('هل انت الطالب') ||
              lastBotMsg.includes('هل هذا حسابك') ||
              lastBotMsg.includes('أفعّل الكورس لك الآن') ||
              lastBotMsg.includes('افعل الكورس لك الآن'))
          ) {
            intentResult = { ...intentResult, intent: 'ACTIVATION_CODE', requiresEscalation: false };
          }

          // طلب اشتراك/تفعيل عند مستر معين (عايز أفعل كورس عند مستر / عايز أشترك مع...) → نثبت النية ACTIVATION_CODE
          const subText = parsed.data.text.trim().toLowerCase().replace(/\s+/g, ' ');
          const isSubscriptionRequest =
            subText.includes('عايز افعل كورس') ||
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
            await SupportChatService.escalateChat(
              chatId!,
              `Intent requires escalation: ${intentResult.intent}`,
            );
            await SupportChatService.updateChatStatus(chatId!, 'waiting_for_admin');

            const escalationMessage = await SupportChatService.saveMessage(
              chatId!,
              user.id,
              'admin',
              {
                text: 'أفهم أن مشكلتك تحتاج إلى تدخل من فريق الدعم الفني. سأقوم بنقل هذه المحادثة إلى أحد المسؤولين. سيقوم أحد المسؤولين بالرد عليك قريباً.',
                message_type: 'auto_reply',
                is_auto_reply: true,
              },
            );

            botReply = escalationMessage;

            if (io) {
              await SupportChatSocketService.emitNewMessage(
                io,
                chatId!,
                escalationMessage,
                'admin',
              );
            }
          } else {
            const newBotAttempts = context.botAttempts + 1;
            await SupportChatService.updateChatBotInfo(chatId!, {
              current_intent: intentResult.intent,
              bot_attempts: newBotAttempts,
            });

            // عند أي رد من البوت نعيد الحالة إلى bot_handling (بما فيها بعد رد الأدمن - الطالب يرسل رسالة والبوت يرد عادي)
            if (chat && chat.status !== 'bot_handling') {
              await SupportChatService.updateChatStatus(chatId!, 'bot_handling');
            }

            const botResponse = await DeepSeekChatbotService.generateResponse(
              intentResult.intent,
              parsed.data.text,
              context,
            );

            if (botResponse.shouldEscalate) {
              await SupportChatService.escalateChat(
                chatId!,
                botResponse.escalationReason || 'Bot response requires escalation',
              );
              await SupportChatService.updateChatStatus(chatId!, 'waiting_for_admin');
            }

            const botMessage = await SupportChatService.saveMessage(chatId!, user.id, 'admin', {
              text: botResponse.message,
              message_type: 'auto_reply',
              is_auto_reply: true,
            });

            botReply = botMessage;

            if (io) {
              await SupportChatSocketService.emitNewMessage(io, chatId!, botMessage, 'admin');
            }
          }
        }
    }

    res.status(201).json({
      message,
      ...(botReply && { bot_reply: botReply }),
    });
  }),
);

// 5. إرسال ميديا (صورة/فيديو/ملف)
router.post(
  '/messages/media',
  authMiddleware(['student', 'admin']),
  upload.single('file'),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const file = (req as any).file as Express.Multer.File | undefined;
    const chatId = req.body.chat_id ? parseInt(req.body.chat_id) : undefined;
    const text = req.body.text || null;

    if (!file) {
      return res.status(400).json({ message: 'file is required' });
    }

    let finalChatId = chatId;

    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
      const chat = await SupportChatService.getOrCreateStudentChat(user.id);
      finalChatId = chat.id;
    } else if (!finalChatId) {
      return res.status(400).json({ message: 'chat_id is required for admin' });
    }

    // رفع الملف على Cloudinary
    const mime = file.mimetype;
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');

    // تحديد resource_type حسب نوع الملف
    const resourceType = isAudio ? 'raw' : isVideo ? 'video' : 'image';
    const uploaded = await uploadToCloudinary(file.path, { resource_type: resourceType });

    const messageType = isAudio ? 'audio' : isImage ? 'image' : 'file';

    const message = await SupportChatService.saveMessage(
      finalChatId!,
      user.id,
      user.role as 'student' | 'admin',
      {
        text,
        message_type: messageType,
        media_url: uploaded.secure_url,
        media_type: mime,
        media_name: file.originalname,
        media_size: file.size,
      },
    );

    // إرسال الرسالة عبر Socket.io للـ Real-time
    const appAny = req.app as any;
    const io: SocketIOServer | null = appAny.io || null;
    if (io) {
      await SupportChatSocketService.emitNewMessage(
        io,
        finalChatId!,
        message,
        user.role as 'student' | 'admin',
      );
    }

    res.status(201).json({ message });
  }),
);

// 6. إرسال رسالة صوتية
router.post(
  '/messages/audio',
  authMiddleware(['student', 'admin']),
  upload.single('audio'),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const file = (req as any).file as Express.Multer.File | undefined;
    const chatId = req.body.chat_id ? parseInt(req.body.chat_id) : undefined;
    const duration = req.body.duration ? parseFloat(req.body.duration) : null;

    if (!file) {
      return res.status(400).json({ message: 'audio file is required' });
    }

    let finalChatId = chatId;

    // للطالب: استخدام شاته الخاص
    if (user.role === 'student') {
      const chat = await SupportChatService.getOrCreateStudentChat(user.id);
      finalChatId = chat.id;
    } else if (!finalChatId) {
      return res.status(400).json({ message: 'chat_id is required for admin' });
    }

    // رفع الملف على Cloudinary (استخدام raw للملفات الصوتية)
    const uploaded = await uploadToCloudinary(file.path, { resource_type: 'raw' });

    const message = await SupportChatService.saveMessage(
      finalChatId!,
      user.id,
      user.role as 'student' | 'admin',
      {
        message_type: 'audio',
        media_url: uploaded.secure_url,
        media_type: file.mimetype,
        media_name: file.originalname,
        media_size: file.size,
        duration: duration ? Math.round(duration) : undefined,
      },
    );

    // إرسال الرسالة عبر Socket.io للـ Real-time
    const appAny = req.app as any;
    const io: SocketIOServer | null = appAny.io || null;
    if (io) {
      await SupportChatSocketService.emitNewMessage(
        io,
        finalChatId!,
        message,
        user.role as 'student' | 'admin',
      );
    }

    res.status(201).json({ message });
  }),
);

// 7. تحديث حالة الشات (للأدمن)
router.patch(
  '/chats/:chatId/status',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
      return res.status(400).json({ message: 'Invalid chat id' });
    }

    const schema = z.object({
      status: z.enum([
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

    await SupportChatService.updateChatStatus(chatId, parsed.data.status);
    res.json({ message: 'Chat status updated' });
  }),
);

// 8. تعيين أدمن للشات
router.post(
  '/chats/:chatId/assign',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) {
      return res.status(400).json({ message: 'Invalid chat id' });
    }

    const user = req.user!;
    await SupportChatService.assignAdmin(chatId, user.id);
    // تحديث حالة الشات إلى admin_handling عند تعيين أدمن
    await SupportChatService.updateChatStatus(chatId, 'admin_handling');
    res.json({ message: 'Admin assigned to chat' });
  }),
);

// 9. عدد الرسائل غير المقروءة (طالب: شات الدعم؛ مدرس: شات دعم المدرس؛ أدمن: رسائل الطلاب)
router.get(
  '/unread-count',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const count = await SupportChatService.getUnreadCount(user.id, user.role);
    res.json({ unread_count: count });
  }),
);

// 10. جلب إشعارات الرسائل — للطالب: غير المقروءة فقط (تُمسح بمجرد دخول الشات، مثل teacher)؛ للأدمن: رسائل الطلاب
router.get(
  '/notifications',
  authMiddleware(['student', 'admin']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const role = user.role as 'student' | 'admin';
    // للطالب: دائماً غير المقروءة فقط (بعد دخول الشات GET /support/chat تُحدَّد كمقروءة فترجع القائمة فاضية)
    const unreadOnly = role === 'student' ? true : undefined;

    const result = await SupportChatService.getMessageNotifications(
      user.id,
      role,
      limit,
      offset,
      unreadOnly ?? true,
    );

    const unreadCount = role === 'student' ? await SupportChatService.getUnreadCount(user.id, 'student') : undefined;
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
  }),
);

// آخر إشعار واحد غير مقروء للطالب — مناسب لـ Expo Push والبادج (نفس سلوك teacher/notifications/latest)
router.get(
  '/notifications/latest',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const latest = await SupportChatService.getStudentLatestUnreadNotification(user.id);
    const unreadCount = await SupportChatService.getUnreadCount(user.id, 'student');
    res.json({
      notification: latest,
      unread_count: unreadCount,
    });
  }),
);

// 11. جلب الأسئلة التلقائية المتاحة (للطالب) — عند استدعاء هذا الـ API تُمسح إشعارات الشات (تُحدَّد كمقروءة) فيرجع GET /notifications فاضياً حتى إشعار جديد
router.get(
  '/faq',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const chatId = await SupportChatService.getStudentChatId(user.id);
    if (chatId != null) {
      await SupportChatService.markChatAsRead(chatId, user.id);
    }

    const faqs = await SupportChatService.getAllFAQs(true);
    const publicFaqs = faqs.map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      priority: faq.priority,
    }));

    res.json({ faqs: publicFaqs });
  }),
);

// APIs للأسئلة الثابتة (FAQ)

// 1. إنشاء سؤال ثابت
router.post(
  '/faq',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      question: z.string().min(1),
      answer: z.string().min(1),
      keywords: z.array(z.string()).optional(),
      priority: z.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const user = req.user!;
    const faq = await SupportChatService.createFAQ(
      parsed.data.question,
      parsed.data.answer,
      parsed.data.keywords || [],
      parsed.data.priority || 0,
      user.id,
    );

    res.status(201).json({ faq });
  }),
);

// 2. جلب جميع الأسئلة (للأدمن)
router.get(
  '/faq/admin',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const activeOnly = req.query.active_only === 'true';
    const faqs = await SupportChatService.getAllFAQs(activeOnly);
    res.json({ faqs });
  }),
);

// 3. تحديث سؤال
router.put(
  '/faq/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid FAQ id' });
    }

    const schema = z.object({
      question: z.string().optional(),
      answer: z.string().optional(),
      keywords: z.array(z.string()).optional(),
      is_active: z.boolean().optional(),
      priority: z.number().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const faq = await SupportChatService.updateFAQ(id, parsed.data);
    res.json({ faq });
  }),
);

// 4. حذف سؤال
router.delete(
  '/faq/:id',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid FAQ id' });
    }

    await SupportChatService.deleteFAQ(id);
    res.json({ message: 'FAQ deleted' });
  }),
);

// 5. اختبار مطابقة السؤال
router.post(
  '/faq/test-match',
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      question: z.string().min(1),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const faq = await SupportChatService.findMatchingFAQ(parsed.data.question);

    res.json({
      question: parsed.data.question,
      matched: !!faq,
      ...(faq && { faq }),
    });
  }),
);
