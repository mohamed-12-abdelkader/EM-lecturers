import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { SupportChatService } from '../services/supportChat';
import { SupportAssistantService } from '../services/supportAssistant';

export const router = Router();

const GuestStartSchema = z.object({
  guest_token: z.string().min(8).optional(),
});

const GuestMessageSchema = z.object({
  guest_token: z.string().min(8, 'guest_token مطلوب'),
  text: z.string().min(1, 'نص الرسالة مطلوب').max(4000),
});

const StudentMessageSchema = z.object({
  text: z.string().min(1, 'نص الرسالة مطلوب').max(4000),
});

function publicMessage(m: {
  id: number;
  sender_role: string;
  text: string;
  intent: string | null;
  created_at: string;
}) {
  return {
    id: m.id,
    sender_role: m.sender_role,
    text: m.text,
    intent: m.intent,
    created_at: m.created_at,
  };
}

/** بدء / استئناف محادثة ضيف بدون تسجيل دخول */
router.post(
  '/guest/start',
  asyncWrapper(async (req, res) => {
    const parsed = GuestStartSchema.safeParse(req.body || {});
    const guestToken = parsed.success ? parsed.data.guest_token : undefined;
    const chat = await SupportChatService.getOrCreateGuestChat(guestToken);

    let welcome = null as ReturnType<typeof publicMessage> | null;
    const messages = await SupportChatService.getChatMessages(chat.id, 5);
    if (!messages.length) {
      const bot = await SupportChatService.addMessage({
        chatId: chat.id,
        senderRole: 'bot',
        text: 'أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟',
        intent: 'Greeting',
      });
      welcome = publicMessage(bot);
    }

    res.status(200).json({
      chat_id: chat.id,
      guest_token: chat.guest_token,
      chat: {
        id: chat.id,
        status: chat.status,
        guest_token: chat.guest_token,
        current_intent: chat.current_intent,
      },
      welcome_message: welcome,
    });
  }),
);

/** جلب محادثة الضيف والرسائل */
router.get(
  '/guest/chat',
  asyncWrapper(async (req, res) => {
    const guestToken = String(req.query.guest_token || '').trim();
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
        current_intent: chat.current_intent,
      },
      messages: messages.map(publicMessage),
    });
  }),
);

/** إرسال رسالة من الضيف + رد المساعد */
router.post(
  '/guest/messages',
  asyncWrapper(async (req, res) => {
    const parsed = GuestMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const chat = await SupportChatService.getChatByGuestToken(parsed.data.guest_token);
    if (!chat) {
      return res.status(404).json({ message: 'المحادثة غير موجودة. استخدم /guest/start أولاً.' });
    }
    if (chat.status === 'closed') {
      return res.status(400).json({ message: 'المحادثة مغلقة. ابدأ محادثة جديدة.' });
    }

    const result = await SupportAssistantService.analyzeAndReply({
      chat,
      message: parsed.data.text,
      senderRole: 'guest',
    });

    res.status(200).json({
      chat: result.chat,
      user_message: publicMessage(result.user_message),
      bot_message: publicMessage(result.bot_message),
      intent: result.intent,
      teachers: result.teachers,
    });
  }),
);

/** بدء / جلب محادثة طالب مسجّل */
router.post(
  '/student/start',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = (req as any).user.id as number;
    const chat = await SupportChatService.getOrCreateStudentChat(studentId);
    const messages = await SupportChatService.getChatMessages(chat.id, 5);

    let welcome = null as ReturnType<typeof publicMessage> | null;
    if (!messages.length) {
      const bot = await SupportChatService.addMessage({
        chatId: chat.id,
        senderRole: 'bot',
        text: 'أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟',
        intent: 'Greeting',
      });
      welcome = publicMessage(bot);
    }

    res.status(200).json({
      chat_id: chat.id,
      chat: {
        id: chat.id,
        status: chat.status,
        current_intent: chat.current_intent,
      },
      welcome_message: welcome,
    });
  }),
);

router.get(
  '/student/chat',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const studentId = (req as any).user.id as number;
    const chat = await SupportChatService.getOrCreateStudentChat(studentId);
    const messages = await SupportChatService.getChatMessages(chat.id, 100);
    res.json({
      chat: {
        id: chat.id,
        status: chat.status,
        current_intent: chat.current_intent,
      },
      messages: messages.map(publicMessage),
    });
  }),
);

router.post(
  '/student/messages',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const parsed = StudentMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const studentId = (req as any).user.id as number;
    const chat = await SupportChatService.getOrCreateStudentChat(studentId);
    if (chat.status === 'closed') {
      return res.status(400).json({ message: 'المحادثة مغلقة. تواصل مع الدعم لفتحها.' });
    }

    const result = await SupportAssistantService.analyzeAndReply({
      chat,
      message: parsed.data.text,
      senderId: studentId,
      senderRole: 'student',
    });

    res.status(200).json({
      chat: result.chat,
      user_message: publicMessage(result.user_message),
      bot_message: publicMessage(result.bot_message),
      intent: result.intent,
      teachers: result.teachers,
    });
  }),
);
