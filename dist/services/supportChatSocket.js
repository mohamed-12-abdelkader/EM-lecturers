"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SupportChatSocketService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const supportChat_1 = require("./supportChat");
const ExpoPushService = __importStar(require("./expoPushService"));
/**
 * Helper functions to emit Socket.io events for Support Chat
 * This ensures real-time updates when messages are sent via REST API
 */
class SupportChatSocketService {
    /**
     * Emit new message to all users in the chat
     * مع منع التكرار باستخدام message ID
     */
    static async emitNewMessage(io, chatId, message, senderRole) {
        // إضافة timestamp و unique identifier لمنع التكرار
        const messagePayload = {
            ...message,
            _timestamp: Date.now(),
            _uniqueId: `msg_${message.id}_${Date.now()}`,
        };
        // إرسال الرسالة لجميع المستخدمين في الشات
        io.to(`support:chat:${chatId}`).emit('message:receive', {
            message: messagePayload,
            chat_id: chatId,
            timestamp: Date.now(),
        });
        // Event legacy للتوافق مع الكود القديم
        io.to(`support:chat:${chatId}`).emit('support:new-message', messagePayload);
        // تحديث حالة الرسالة تلقائياً (delivered)
        setTimeout(async () => {
            await supportChat_1.SupportChatService.updateMessageStatus(message.id, 'delivered');
            io.to(`support:chat:${chatId}`).emit('message:status-updated', {
                message_id: message.id,
                status: 'delivered',
                delivered_at: new Date().toISOString(),
            });
        }, 100);
        // إذا كان الطالب أرسل، إرسال notification للأدمن
        if (senderRole === 'student') {
            const chatResult = await pool_1.default.query(`SELECT sc.*, u.name AS student_name, u.email AS student_email
         FROM support_chats sc
         JOIN users u ON u.id = sc.student_id
         WHERE sc.id = $1`, [chatId]);
            if (chatResult.rowCount) {
                const chat = chatResult.rows[0];
                const unreadCount = await SupportChatSocketService.getUnreadCountForChat(chatId);
                // إرسال notification محسّن للأدمن (Real-Time)
                const adminNotification = {
                    type: 'support_chat_message',
                    notification_type: 'student_message',
                    chat_id: chatId,
                    student_id: chat.student_id,
                    student_name: chat.student_name,
                    student_email: chat.student_email,
                    message: {
                        id: message.id,
                        message_id: message.id,
                        chat_id: chatId,
                        sender_id: message.sender_id,
                        sender_role: message.sender_role,
                        sender_name: message.sender_name,
                        message_type: message.message_type,
                        text: message.text,
                        media_url: message.media_url,
                        media_type: message.media_type,
                        is_auto_reply: message.is_auto_reply,
                        created_at: message.created_at
                    },
                    unread_count: unreadCount,
                    timestamp: Date.now()
                };
                // Event جديد محسّن
                io.to('support:admin').emit('support:notification', adminNotification);
                io.to('support:admin').emit('notification:new', adminNotification);
                // Event legacy
                io.to('support:admin').emit('support:new-chat-message', {
                    chat_id: chatId,
                    student_id: chat.student_id,
                    student_name: chat.student_name,
                    student_email: chat.student_email,
                    message: messagePayload,
                    unread_count: unreadCount
                });
                // تحديث قائمة المحادثات للأدمن
                await this.emitConversationUpdate(io, chatId);
            }
        }
        else {
            // إذا كان الأدمن أرسل، إرسال notification للطالب
            const chatResult = await pool_1.default.query(`SELECT student_id FROM support_chats WHERE id = $1`, [
                chatId,
            ]);
            if (chatResult.rowCount) {
                const studentId = chatResult.rows[0].student_id;
                // إرسال الرسالة مباشرة للطالب عبر room خاص به (Real-Time)
                // هذا مهم جداً لأن الطالب قد يكون في مشروع Frontend منفصل
                io.to(`support:student:${studentId}`).emit('message:receive', {
                    message: messagePayload,
                    chat_id: chatId,
                    timestamp: Date.now(),
                });
                io.to(`support:student:${studentId}`).emit('support:new-message', messagePayload);
                // إرسال أيضاً إلى room الشات (للتوافق)
                io.to(`support:chat:${chatId}`).emit('message:receive', {
                    message: messagePayload,
                    chat_id: chatId,
                    timestamp: Date.now(),
                });
                io.to(`support:chat:${chatId}`).emit('support:new-message', messagePayload);
                // إذا كانت رسالة auto_reply، إرسالها للأدمن أيضاً (ليظهر في شات الأدمن)
                if (messagePayload.is_auto_reply) {
                    io.to('support:admin').emit('message:receive', {
                        message: messagePayload,
                        chat_id: chatId,
                        timestamp: Date.now(),
                    });
                    io.to('support:admin').emit('support:new-message', messagePayload);
                }
                // إرسال notification محسّن للطالب (Real-Time)
                const studentNotification = {
                    type: 'support_chat_message',
                    notification_type: 'admin_reply',
                    chat_id: chatId,
                    message: {
                        id: message.id,
                        message_id: message.id,
                        chat_id: chatId,
                        sender_id: message.sender_id,
                        sender_role: message.sender_role,
                        sender_name: message.sender_name,
                        message_type: message.message_type,
                        text: message.text,
                        media_url: message.media_url,
                        media_type: message.media_type,
                        is_auto_reply: message.is_auto_reply,
                        created_at: message.created_at
                    },
                    timestamp: Date.now()
                };
                // Event جديد محسّن
                io.to(`support:student:${studentId}`).emit('support:notification', studentNotification);
                io.to(`support:student:${studentId}`).emit('notification:new', studentNotification);
                io.to(`support:chat:${chatId}`).emit('support:notification', studentNotification);
                io.to(`support:chat:${chatId}`).emit('notification:new', studentNotification);
                // Event legacy
                io.to(`support:student:${studentId}`).emit('support:admin-message', {
                    chat_id: chatId,
                    message: messagePayload,
                });
                io.to(`support:chat:${chatId}`).emit('support:admin-message', {
                    chat_id: chatId,
                    message: messagePayload,
                });
                // Real-time عنصر موحّد لـ GET /api/notifications/messages
                const createdAt = message.created_at ? new Date(message.created_at).toISOString() : new Date().toISOString();
                const unifiedItem = {
                    id: `support_student_${chatId}_${message.id}`,
                    type: 'student_support',
                    title: 'دعم فني',
                    body: (message.text || '').slice(0, 120) + (message.text && message.text.length > 120 ? '...' : ''),
                    sender_name: message.sender_name || 'رد تلقائي',
                    created_at: createdAt,
                    unread_count: 1,
                    is_unread: true,
                    data: {
                        type: 'student_support_chat',
                        chat_id: chatId,
                        message_id: message.id,
                        sender_id: message.sender_id,
                    },
                    chat_id: chatId,
                    message_id: message.id,
                };
                io.to(`user:${studentId}`).emit('notifications:message', { notification: unifiedItem });
            }
        }
    }
    /**
     * إرسال رسالة شات المدرس (للطالب والأدمن)
     */
    static async emitNewTeacherMessage(io, chatId, teacherId, message, senderRole) {
        const messagePayload = {
            ...message,
            _timestamp: Date.now(),
            _uniqueId: `tmsg_${message.id}_${Date.now()}`,
        };
        io.to(`support:teacher:${teacherId}`).emit('message:receive', {
            message: messagePayload,
            chat_id: chatId,
            timestamp: Date.now(),
        });
        io.to(`support:teacher:${teacherId}`).emit('support:new-message', messagePayload);
        io.to(`support:teacher-chat:${chatId}`).emit('message:receive', {
            message: messagePayload,
            chat_id: chatId,
            timestamp: Date.now(),
        });
        io.to(`support:teacher-chat:${chatId}`).emit('support:new-message', messagePayload);
        if (senderRole === 'teacher') {
            const chatResult = await pool_1.default.query(`SELECT tsc.*, u.name AS teacher_name, u.email AS teacher_email
         FROM teacher_support_chats tsc
         JOIN users u ON u.id = tsc.teacher_id
         WHERE tsc.id = $1`, [chatId]);
            if (chatResult.rowCount) {
                const chat = chatResult.rows[0];
                const unreadCount = await pool_1.default.query(`SELECT COUNT(*) FROM teacher_support_messages WHERE chat_id = $1 AND sender_role = 'teacher' AND read_at IS NULL`, [chatId]);
                const payload = {
                    type: 'teacher_support_chat_message',
                    notification_type: 'teacher_message',
                    chat_id: chatId,
                    teacher_id: teacherId,
                    teacher_name: chat.teacher_name,
                    teacher_email: chat.teacher_email,
                    message: messagePayload,
                    unread_count: parseInt(unreadCount.rows[0]?.count || '0', 10),
                    timestamp: Date.now(),
                };
                io.to('support:admin').emit('support:notification', payload);
                io.to('support:admin').emit('support:teacher-message', payload);
            }
        }
        else {
            // إشعار فوري للمدرس بنفس شكل عنصر من GET /api/support/teacher/notifications (Real-Time)
            const notificationItem = {
                message_id: message.id,
                chat_id: message.chat_id,
                sender_id: message.sender_id,
                sender_role: message.sender_role,
                sender_name: message.sender_name ?? (message.is_auto_reply ? 'رد تلقائي' : 'مستخدم'),
                message_type: message.message_type,
                text: message.text,
                media_url: message.media_url,
                media_type: message.media_type,
                is_auto_reply: message.is_auto_reply,
                is_unread: true,
                created_at: message.created_at,
            };
            const unreadCount = await supportChat_1.SupportChatService.getUnreadCount(teacherId, 'teacher');
            io.to(`support:teacher:${teacherId}`).emit('support:teacher-notification', {
                notification: notificationItem,
                unread_count: unreadCount,
                timestamp: Date.now(),
            });
            // Event legacy للتوافق مع أي كلانت يعتمد على support:notification
            io.to(`support:teacher:${teacherId}`).emit('support:notification', {
                type: 'teacher_support_chat_message',
                notification_type: 'admin_reply',
                chat_id: chatId,
                message: messagePayload,
                notification: notificationItem,
                unread_count: unreadCount,
                timestamp: Date.now(),
            });
            // إرسال Expo Push للمدرس (تطبيق الموبايل) لربط إشعارات الشات بنظام Expo Push
            const pushTitle = message.is_auto_reply ? 'دعم فني' : (notificationItem.sender_name || 'دعم فني');
            const pushBody = (message.text || '').slice(0, 120) + (message.text && message.text.length > 120 ? '...' : '');
            ExpoPushService.sendPushNotification(teacherId, pushTitle, pushBody, {
                type: 'teacher_support_chat',
                chat_id: chatId,
                message_id: message.id,
            }).catch((err) => console.error('[SupportChatSocket] Expo push to teacher failed:', err));
            // Real-time عنصر موحّد لـ GET /api/notifications/messages
            const createdAt = message.created_at ? new Date(message.created_at).toISOString() : new Date().toISOString();
            const unifiedItem = {
                id: `support_teacher_${chatId}_${message.id}`,
                type: 'teacher_support',
                title: notificationItem.sender_name || 'دعم فني',
                body: (message.text || '').slice(0, 120) + (message.text && message.text.length > 120 ? '...' : ''),
                sender_name: notificationItem.sender_name,
                created_at: createdAt,
                unread_count: unreadCount,
                is_unread: true,
                data: {
                    type: 'teacher_support_chat',
                    chat_id: chatId,
                    message_id: message.id,
                    sender_id: message.sender_id,
                },
                chat_id: chatId,
                message_id: message.id,
            };
            io.to(`user:${teacherId}`).emit('notifications:message', { notification: unifiedItem });
        }
    }
    /**
     * إشعار الأدمن عند تحويل مشكلة من مدرس: المشكلة + بيانات المدرس
     */
    static emitTeacherProblemEscalatedToAdmin(io, chatId, teacherId, teacherName, teacherEmail, problemText) {
        const payload = {
            type: 'teacher_problem_escalated',
            notification_type: 'teacher_problem_escalated',
            chat_id: chatId,
            teacher_id: teacherId,
            teacher_name: teacherName,
            teacher_email: teacherEmail || undefined,
            problem_text: problemText,
            message: `مدرس "${teacherName}" أبلغ عن مشكلة: ${problemText.slice(0, 200)}${problemText.length > 200 ? '...' : ''}`,
            timestamp: Date.now(),
        };
        io.to('support:admin').emit('support:notification', payload);
        io.to('support:admin').emit('support:teacher-problem-escalated', payload);
    }
    /**
     * Emit conversation update (للتحديث التلقائي لقائمة المحادثات)
     */
    static async emitConversationUpdate(io, chatId) {
        try {
            // جلب معلومات الشات المحدثة
            const chatResult = await pool_1.default.query(`SELECT 
          sc.*,
          u.name AS student_name,
          u.email AS student_email,
          (SELECT COUNT(*) FROM support_messages sm 
           WHERE sm.chat_id = sc.id 
             AND sm.sender_role = 'student' 
             AND sm.read_at IS NULL) AS unread_count,
          (SELECT text FROM support_messages 
           WHERE chat_id = sc.id 
           ORDER BY created_at DESC LIMIT 1) AS last_message_text,
          (SELECT created_at FROM support_messages 
           WHERE chat_id = sc.id 
           ORDER BY created_at DESC LIMIT 1) AS last_message_at
         FROM support_chats sc
         JOIN users u ON u.id = sc.student_id
         WHERE sc.id = $1`, [chatId]);
            if (chatResult.rowCount) {
                const chat = chatResult.rows[0];
                const conversationData = {
                    id: chat.id,
                    student_id: chat.student_id,
                    admin_id: chat.admin_id,
                    status: chat.status,
                    last_message_at: chat.last_message_at || chat.created_at,
                    student_name: chat.student_name,
                    student_email: chat.student_email,
                    unread_count: parseInt(chat.unread_count) || 0,
                    last_message: chat.last_message_text || null,
                };
                // إرسال تحديث للأدمن فقط (لأنهم من يحتاجون قائمة المحادثات)
                io.to('support:admin').emit('conversation:update', {
                    conversation: conversationData,
                });
                // Event legacy
                io.to('support:admin').emit('support:conversation-updated', conversationData);
            }
        }
        catch (error) {
            console.error('Error emitting conversation update:', error);
        }
    }
    /**
     * Get unread count for a specific chat
     */
    static async getUnreadCountForChat(chatId) {
        const result = await pool_1.default.query(`SELECT COUNT(*) 
       FROM support_messages 
       WHERE chat_id = $1 
         AND sender_role = 'student' 
         AND read_at IS NULL`, [chatId]);
        return parseInt(result.rows[0]?.count || '0');
    }
    /**
     * Emit message status update
     */
    static emitMessageStatusUpdate(io, messageId, status, timestamp) {
        io.emit('message:status-updated', {
            message_id: messageId,
            status,
            ...(status === 'delivered' && { delivered_at: timestamp }),
            ...(status === 'read' && { read_at: timestamp }),
        });
        // Event legacy
        io.emit('support:message-status-updated', {
            message_id: messageId,
            status,
            ...(status === 'delivered' && { delivered_at: timestamp }),
            ...(status === 'read' && { read_at: timestamp }),
        });
    }
    /**
     * Emit chat read status
     */
    static emitChatRead(io, chatId, readerId) {
        io.to(`support:chat:${chatId}`).emit('messages:read', {
            chat_id: chatId,
            reader_id: readerId,
        });
        // Event legacy
        io.to(`support:chat:${chatId}`).emit('support:messages-read', {
            chat_id: chatId,
            reader_id: readerId,
        });
    }
    /**
     * Emit notifications cleared (للطالب عند فتح الشات)
     */
    static async emitNotificationsCleared(io, chatId, studentId) {
        // جلب عدد الرسائل غير المقروءة بعد التحديث (يجب أن يكون 0)
        const unreadCount = await this.getUnreadCountForChat(chatId);
        const notification = {
            type: 'support_notifications_cleared',
            chat_id: chatId,
            unread_count: unreadCount,
            timestamp: Date.now()
        };
        // إرسال للطالب عبر room خاص به
        io.to(`support:student:${studentId}`).emit('support:notifications-cleared', notification);
        io.to(`support:chat:${chatId}`).emit('support:notifications-cleared', notification);
        // Event بديل
        io.to(`support:student:${studentId}`).emit('notifications:cleared', notification);
    }
}
exports.SupportChatSocketService = SupportChatSocketService;
