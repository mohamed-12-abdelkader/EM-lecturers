import type { Server as SocketIOServer, Socket } from 'socket.io';
import { HttpError } from '../../../utils';
import { staffChatRoom, type StaffUser } from '../types';
import { StaffConversationService } from '../services/conversation.service';
import { StaffMessageService } from '../services/message.service';
import { StaffChatPresence } from '../services/presence.service';

function emitChatError(socket: Socket, code: string, message: string) {
  socket.emit('chat:error', { event: 'chat:error', code, message });
}

export function registerStaffChatSocket(io: SocketIOServer) {
  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { user?: StaffUser }).user;
    if (!user || (user.role !== 'admin' && user.role !== 'employee')) return;

    void (async () => {
      try {
        await StaffConversationService.assertStaffRole(user);
        const wasOffline = !StaffChatPresence.isOnline(user.id);
        StaffChatPresence.addSocket(user.id, socket.id);
        if (wasOffline) {
          io.emit('user:online', { userId: user.id });
        }
        const conversations = await StaffConversationService.listForUser(user.id);
        for (const c of conversations) {
          if (await StaffConversationService.isActiveMember(c.id, user.id)) {
            socket.join(staffChatRoom(c.id));
          }
        }
      } catch {
        /* inactive employee — no staff chat rooms */
      }
    })();

    socket.on('conversation:join', async (payload: { conversationId?: number }, ack?: (r: unknown) => void) => {
      try {
        const conversationId = Number(payload?.conversationId);
        if (!conversationId) return ack?.({ ok: false, code: 'INVALID_CONVERSATION' });
        await StaffConversationService.requireActiveMember(conversationId, user.id);
        const conv = await StaffConversationService.getById(conversationId);
        const can = await StaffConversationService.employeeCanAccessDirect(conv, user.id, user.role);
        if (!can) throw new HttpError(403, 'NOT_CONVERSATION_MEMBER');
        socket.join(staffChatRoom(conversationId));
        ack?.({ ok: true, room: staffChatRoom(conversationId) });
      } catch (e: any) {
        const code = e?.message === 'NOT_CONVERSATION_MEMBER' ? e.message : 'FORBIDDEN';
        ack?.({ ok: false, code, message: e?.message });
      }
    });

    socket.on('message:send', async (payload: { conversationId?: number; type?: string; content?: string }, ack?: (r: unknown) => void) => {
      try {
        if (user.role !== 'admin' && user.role !== 'employee') {
          return ack?.({ ok: false, code: 'FORBIDDEN' });
        }
        const conversationId = Number(payload?.conversationId);
        if (!conversationId || payload?.type !== 'text') {
          return ack?.({ ok: false, code: 'INVALID_PAYLOAD' });
        }
        const message = await StaffMessageService.sendText(conversationId, user, payload.content ?? '');
        io.to(staffChatRoom(conversationId)).emit('message:new', { event: 'message:new', message });
        ack?.({ ok: true, message });
      } catch (e: any) {
        const status = e instanceof HttpError ? e.status : 400;
        const code = e?.message || 'SEND_FAILED';
        emitChatError(socket, code, e?.message || 'فشل إرسال الرسالة');
        ack?.({ ok: false, code, status });
      }
    });

    socket.on('message:read', async (payload: { conversationId?: number; messageId?: number }, ack?: (r: unknown) => void) => {
      try {
        const conversationId = Number(payload?.conversationId);
        const messageId = Number(payload?.messageId);
        if (!conversationId || !messageId) return ack?.({ ok: false, code: 'INVALID_PAYLOAD' });
        const read = await StaffMessageService.markRead(conversationId, user.id, messageId);
        io.to(staffChatRoom(conversationId)).emit('message:read', {
          event: 'message:read',
          ...read,
        });
        ack?.({ ok: true, ...read });
      } catch (e: any) {
        ack?.({ ok: false, code: e?.message || 'READ_FAILED' });
      }
    });

    socket.on('typing:start', async (payload: { conversationId?: number }) => {
      const conversationId = Number(payload?.conversationId);
      if (!conversationId) return;
      if (!(await StaffConversationService.isActiveMember(conversationId, user.id))) return;
      socket.to(staffChatRoom(conversationId)).emit('typing:start', {
        conversationId,
        userId: user.id,
      });
    });

    socket.on('typing:stop', async (payload: { conversationId?: number }) => {
      const conversationId = Number(payload?.conversationId);
      if (!conversationId) return;
      if (!(await StaffConversationService.isActiveMember(conversationId, user.id))) return;
      socket.to(staffChatRoom(conversationId)).emit('typing:stop', {
        conversationId,
        userId: user.id,
      });
    });

    socket.on('disconnect', () => {
      const nowOffline = StaffChatPresence.removeSocket(user.id, socket.id);
      if (nowOffline) {
        io.emit('user:offline', { userId: user.id });
      }
    });
  });

  (io as any).staffChatEmitters = true;
}

export function attachStaffChatAppHelpers(app: any, io: SocketIOServer) {
  app.emitStaffChatMessage = (conversationId: number, message: unknown) => {
    io.to(staffChatRoom(conversationId)).emit('message:new', { event: 'message:new', message });
  };
  app.emitStaffChatMessageUpdated = (conversationId: number, message: unknown) => {
    io.to(staffChatRoom(conversationId)).emit('message:updated', { event: 'message:updated', message });
  };
  app.emitStaffChatMessageDeleted = (conversationId: number, message: unknown) => {
    io.to(staffChatRoom(conversationId)).emit('message:deleted', { event: 'message:deleted', message });
  };
  app.emitStaffChatRead = (conversationId: number, payload: unknown) => {
    io.to(staffChatRoom(conversationId)).emit('message:read', payload);
  };
}
