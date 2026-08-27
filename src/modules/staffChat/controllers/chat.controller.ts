import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { fileTypeFromFile } from 'file-type';
import { authMiddleware } from '../../../middleware/authentication';
import { asyncWrapper, HttpError, uploadToCloudinary } from '../../../utils';
import { staffChatConfig, staffChatMaxImageBytes } from '../config';
import { StaffConversationService } from '../services/conversation.service';
import { StaffMessageService } from '../services/message.service';
import { StaffChatPresence } from '../services/presence.service';
import {
  CreateDirectSchema,
  EditMessageSchema,
  MemberActionSchema,
  MessagesQuerySchema,
} from '../validators';

export const staffChatRouter = Router();

staffChatRouter.use(authMiddleware(['admin', 'employee']));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = path.join(process.cwd(), 'uploads', 'staff-chat');
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    },
  }),
  limits: { fileSize: staffChatMaxImageBytes() },
  fileFilter: (_req, file, cb) => {
    if (staffChatConfig.allowedImageMimes.includes(file.mimetype as any)) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مسموح'));
    }
  },
});

async function conversationSummary(conversationId: number, userId: number) {
  const conv = await StaffConversationService.getById(conversationId);
  const lastMessage = await StaffMessageService.lastMessage(conversationId);
  const unreadCount = await StaffConversationService.unreadCount(conversationId, userId);
  return {
    id: conv.id,
    type: conv.type,
    name: conv.name ?? (conv.type === 'group' ? staffChatConfig.groupName : null),
    last_message: lastMessage,
    last_message_at: lastMessage?.created_at ?? null,
    unread_count: unreadCount,
  };
}

/** GET /api/chat/conversations */
staffChatRouter.get(
  '/conversations',
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    await StaffConversationService.assertStaffRole(user);
    const conversations = await StaffConversationService.listForUser(user.id);
    const data = [];
    for (const c of conversations) {
      data.push(await conversationSummary(c.id, user.id));
    }
    res.json({ success: true, data });
  }),
);

/** POST /api/chat/conversations/direct — Admin: with employee, Employee: own chat with admin */
staffChatRouter.post(
  '/conversations/direct',
  asyncWrapper(async (req, res) => {
    await StaffConversationService.assertStaffRole(req.user!);
    let conv;
    if (req.user!.role === 'admin') {
      const parsed = CreateDirectSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors });
      const employeeUserId = await StaffConversationService.resolveEmployeeUserId(parsed.data.employee_id);
      conv = await StaffConversationService.getOrCreateDirect(req.user!.id, employeeUserId);
    } else {
      conv = await StaffConversationService.getOrCreateDirectForEmployee(req.user!.id);
    }
    res.status(201).json({
      success: true,
      data: await conversationSummary(conv.id, req.user!.id),
    });
  }),
);

/** GET /api/chat/conversations/:conversationId */
staffChatRouter.get(
  '/conversations/:conversationId',
  asyncWrapper(async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    const user = req.user!;
    await StaffConversationService.requireActiveMember(conversationId, user.id);
    const conv = await StaffConversationService.getById(conversationId);
    const can = await StaffConversationService.employeeCanAccessDirect(conv, user.id, user.role);
    if (!can) throw new HttpError(403, 'NOT_CONVERSATION_MEMBER');
    const members = await StaffConversationService.getMembers(conversationId);
    res.json({
      success: true,
      data: {
        ...(await conversationSummary(conversationId, user.id)),
        members: members.map((m: any) => ({
          user_id: m.user_id,
          name: m.name,
          role: m.role,
          joined_at: m.joined_at,
          is_online: StaffChatPresence.isOnline(m.user_id),
        })),
        permissions: {
          can_manage_members: user.role === 'admin' && conv.type === 'group',
          can_send: true,
        },
      },
    });
  }),
);

/** GET /api/chat/conversations/:conversationId/messages */
staffChatRouter.get(
  '/conversations/:conversationId/messages',
  asyncWrapper(async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    const parsed = MessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors });
    const data = await StaffMessageService.listMessages(conversationId, req.user!.id, parsed.data);
    res.json({ success: true, data });
  }),
);

/** POST /api/chat/conversations/:conversationId/images */
staffChatRouter.post(
  '/conversations/:conversationId/images',
  upload.single('image'),
  asyncWrapper(async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    if (!req.file) throw new HttpError(400, 'الصورة مطلوبة');
    const detected = await fileTypeFromFile(req.file.path);
    if (!detected || !staffChatConfig.allowedImageMimes.includes(detected.mime as any)) {
      fs.unlinkSync(req.file.path);
      throw new HttpError(400, 'نوع الملف غير مسموح');
    }
    let imageUrl: string;
    try {
      const uploaded = await uploadToCloudinary(req.file.path);
      imageUrl = uploaded.secure_url;
    } finally {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }
    const message = await StaffMessageService.sendImage(conversationId, req.user!, imageUrl);
    const io = (req.app as any).emitStaffChatMessage;
    if (io) io(conversationId, message);
    res.status(201).json({ success: true, data: message });
  }),
);

/** GET /api/chat/messages/:messageId/readers */
staffChatRouter.get(
  '/messages/:messageId/readers',
  asyncWrapper(async (req, res) => {
    const messageId = Number(req.params.messageId);
    const data = await StaffMessageService.getReaders(messageId, req.user!.id);
    res.json({ success: true, data });
  }),
);

/** PATCH /api/chat/messages/:messageId */
staffChatRouter.patch(
  '/messages/:messageId',
  asyncWrapper(async (req, res) => {
    const messageId = Number(req.params.messageId);
    const parsed = EditMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors });
    const message = await StaffMessageService.editMessage(messageId, req.user!, parsed.data.content);
    const io = (req.app as any).emitStaffChatMessageUpdated;
    if (io) io(message.conversation_id, message);
    res.json({ success: true, data: message });
  }),
);

/** DELETE /api/chat/messages/:messageId */
staffChatRouter.delete(
  '/messages/:messageId',
  asyncWrapper(async (req, res) => {
    const messageId = Number(req.params.messageId);
    const message = await StaffMessageService.softDelete(messageId, req.user!);
    const io = (req.app as any).emitStaffChatMessageDeleted;
    if (io) io(message.conversation_id, message);
    res.json({ success: true, data: message });
  }),
);

/** POST /api/chat/conversations/:conversationId/members — Admin */
staffChatRouter.post(
  '/conversations/:conversationId/members',
  asyncWrapper(async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    const parsed = MemberActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, errors: parsed.error.errors });
    await StaffConversationService.addMember(conversationId, parsed.data.user_id, req.user!);
    res.json({ success: true, message: 'تمت إضافة العضو' });
  }),
);

/** DELETE /api/chat/conversations/:conversationId/members/:userId — Admin */
staffChatRouter.delete(
  '/conversations/:conversationId/members/:userId',
  asyncWrapper(async (req, res) => {
    const conversationId = Number(req.params.conversationId);
    const userId = Number(req.params.userId);
    await StaffConversationService.removeMember(conversationId, userId, req.user!);
    res.json({ success: true, message: 'تمت إزالة العضو' });
  }),
);
