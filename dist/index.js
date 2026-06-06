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
const migrate_1 = require("./db/migrate");
const app_1 = require("./app");
const socket_io_1 = require("socket.io");
const jwt = __importStar(require("jsonwebtoken"));
const utils_1 = require("./utils");
const pool_1 = __importDefault(require("./db/pool"));
const chat_1 = require("./services/chat");
const supportChat_1 = require("./services/supportChat");
const supportChatSocket_1 = require("./services/supportChatSocket");
const GameService_1 = require("./services/GameService");
const scientificChatbot_1 = require("./services/scientificChatbot");
const packageSubjectLessons_1 = require("./controllers/packageSubjectLessons");
const packageSubjectExams_1 = require("./controllers/packageSubjectExams");
const packageSubjectItems_1 = require("./controllers/packageSubjectItems"); // Assuming this import is needed for packageSubjectItemsRouter
// Store for socket.io instance to be used in controllers
let globalIO = null;
const { PORT } = utils_1.config;
// Register API routes
app_1.app.use('/api/subjects', packageSubjectExams_1.router); // Register exams router on same prefix for consistency
app_1.app.use('/api/subjects', packageSubjectLessons_1.router);
app_1.app.use('/api/package-subjects', packageSubjectItems_1.router);
const startServer = async () => {
    try {
        utils_1.logger.info('Applying database migrations...');
        try {
            await (0, migrate_1.applyMigrations)(utils_1.config.DATABASE_URL, 'up');
            utils_1.logger.info('✅ Migrations completed successfully');
        }
        catch (migrationError) {
            utils_1.logger.error('❌ Migration failed:', migrationError.message);
            if (migrationError.message?.includes('ETIMEDOUT') ||
                migrationError.message?.includes('connect')) {
                utils_1.logger.error('⚠️  Skipping migrations due to database connection issue');
                utils_1.logger.error('   Server will start but database operations will fail until connection is restored');
            }
            else {
                throw migrationError; // Re-throw if it's not a connection error
            }
        }
        try {
            await pool_1.default.query(`
        ALTER TABLE course_exam_submissions
        ADD COLUMN IF NOT EXISTS attempts_count INTEGER DEFAULT 1
      `);
            await pool_1.default.query(`
        UPDATE course_exam_submissions
        SET attempts_count = 1
        WHERE attempts_count IS NULL
      `);
            utils_1.logger.info('✅ Verified course_exam_submissions.attempts_count column');
        }
        catch (schemaError) {
            utils_1.logger.error('❌ Failed to verify attempts_count column:', schemaError.message);
            throw schemaError;
        }
        // Initialize Milvus client and collection for scientific chatbot
        try {
            utils_1.logger.info('Initializing Milvus client...');
            utils_1.logger.info('Initializing Milvus collection for scientific chatbot...');
            await scientificChatbot_1.ScientificChatbotService.initializeCollection();
            utils_1.logger.info('✅ Scientific chatbot collection initialized');
        }
        catch (milvusError) {
            utils_1.logger.warn('⚠️  Failed to initialize Milvus:', milvusError.message);
            utils_1.logger.warn('   Scientific chatbot features will not be available until Milvus is configured');
            // Don't throw - allow server to start without Milvus
        }
        app_1.server.listen(PORT, '0.0.0.0', () => {
            utils_1.logger.info(`🚀 Server is running on port ${PORT}`);
        });
        // Socket.IO setup for both Chat and Game systems
        const io = new socket_io_1.Server(app_1.server, {
            cors: { origin: utils_1.config.CORS_ORIGIN.split(',').map((o) => o.trim()), credentials: true },
        });
        // Store io instance globally for use in controllers
        globalIO = io;
        app_1.app.io = io;
        // Set IO getter for NotificationService
        const { setIOGetter } = await import('./services/notifications.js');
        setIOGetter(() => globalIO);
        io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth?.token ||
                    socket.handshake.headers?.authorization?.toString().split(' ')[1];
                if (!token)
                    return next(new Error('Unauthorized'));
                const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
                const { id, jti } = decoded;
                const userRes = await pool_1.default.query('SELECT id, role, jti FROM users WHERE id = $1', [id]);
                if (!userRes.rowCount)
                    return next(new Error('User not found'));
                const user = userRes.rows[0];
                // Match HTTP auth behavior: do not block student realtime on jti mismatch.
                // This keeps live notifications reliable across devices/sessions.
                socket.user = user;
                next();
            }
            catch {
                next(new Error('Invalid token'));
            }
        });
        io.on('connection', async (socket) => {
            const user = socket.user;
            // Personal room for realtime delivery (direct chat / notifications)
            socket.join(`user:${user.id}`);
            // Join all relevant group rooms
            if (user.role === 'student') {
                // Ensure memberships (grade chat + package subject group chat)
                await chat_1.ChatService.ensureStudentMembershipForEnrollments(user.id);
                await chat_1.ChatService.ensureStudentMembershipForPackageSubjectGroups(user.id);
                const res = await pool_1.default.query(`SELECT group_id FROM chat_group_members WHERE user_id = $1`, [user.id]);
                for (const r of res.rows)
                    socket.join(`group:${r.group_id}`);
            }
            else if (user.role === 'teacher') {
                // Join grade rooms the teacher owns + any rooms he's a member of (includes direct chats)
                const res = await pool_1.default.query(`SELECT DISTINCT cg.id
           FROM chat_groups cg
           LEFT JOIN package_subject_item_groups pg ON pg.id = cg.package_subject_group_id
           LEFT JOIN chat_group_members cgm ON cgm.group_id = cg.id AND cgm.user_id = $1
           WHERE (cg.package_subject_group_id IS NULL AND cg.owner_teacher_id = $1)
              OR (cg.package_subject_group_id IS NOT NULL AND pg.teacher_id = $1)
              OR (cgm.user_id = $1)`, [user.id]);
                for (const row of res.rows)
                    socket.join(`group:${row.id}`);
                // شات دعم فني المدرس
                socket.join(`support:teacher:${user.id}`);
            }
            socket.on('chat:send', async (payload) => {
                try {
                    // eslint-disable-next-line prefer-const
                    let { groupId, replyTo } = payload || {};
                    const text = payload?.message ?? payload?.text;
                    // Sanitize groupId
                    let parsedGroupId = Number(groupId);
                    if (isNaN(parsedGroupId) && typeof groupId === 'string') {
                        const match = groupId.match(/(\d+)/);
                        if (match)
                            parsedGroupId = Number(match[0]);
                    }
                    groupId = parsedGroupId;
                    if (!groupId || isNaN(groupId) || !text || !String(text).trim())
                        return;
                    // If groupId matches a package-subject group, resolve to chat group and emit to group_{packageGroupId}
                    const pkg = await pool_1.default.query(`SELECT id FROM package_subject_item_groups WHERE id = $1`, [groupId]);
                    if (pkg.rowCount) {
                        // permission
                        if (user.role === 'student') {
                            const ok = await pool_1.default.query(`SELECT 1
                 FROM package_subject_item_group_students gs
                 JOIN package_subject_item_groups g ON g.id = gs.group_id
                 JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
                 JOIN package_activations pa ON pa.package_id = psi.package_id
                 WHERE gs.group_id = $1
                   AND gs.student_id = $2
                   AND pa.student_id = $2
                   AND pa.is_active = TRUE
                   AND pa.activation_code_id IS NOT NULL
                 LIMIT 1`, [groupId, user.id]);
                            if (!ok.rowCount)
                                return;
                        }
                        else if (user.role === 'teacher') {
                            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2`, [groupId, user.id]);
                            if (!ok.rowCount)
                                return;
                        }
                        const chatGroup = await chat_1.ChatService.getOrCreatePackageSubjectGroupChat(groupId);
                        await chat_1.ChatService.addMember(chatGroup.id, user.id, user.role === 'teacher' ? 'teacher' : 'student');
                        if (user.role === 'student') {
                            const can = await chat_1.ChatService.canStudentSend(chatGroup.id);
                            if (!can)
                                return;
                        }
                        let parentOk = true;
                        if (replyTo) {
                            const r = await pool_1.default.query('SELECT id, group_id FROM chat_messages WHERE id = $1', [replyTo]);
                            parentOk = !!(r.rowCount && r.rows[0].group_id === chatGroup.id);
                        }
                        if (!parentOk)
                            return;
                        const saved = await chat_1.ChatService.saveMessage(chatGroup.id, user.id, String(text).trim(), replyTo ?? null);
                        io.to(`group_${groupId}`).emit('chat:new-message', { ...saved, sender_name: undefined });
                        return;
                    }
                    // Legacy chat group id flow (keep old behavior)
                    const mem = await pool_1.default.query('SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
                    if (!mem.rowCount)
                        return;
                    const role = mem.rows[0].role;
                    if (role === 'student') {
                        const can = await chat_1.ChatService.canStudentSend(groupId);
                        if (!can)
                            return;
                    }
                }
                catch (e) {
                    console.error('Error in chat:send:', e);
                }
            });
            socket.on('chat:join-group', async (rawGroupId) => {
                let groupId = Number(rawGroupId);
                if (isNaN(groupId) && typeof rawGroupId === 'string') {
                    const match = rawGroupId.match(/(\d+)/);
                    if (match)
                        groupId = Number(match[0]);
                }
                if (!groupId || isNaN(groupId))
                    return;
                // package group room
                const pkg = await pool_1.default.query(`SELECT id FROM package_subject_item_groups WHERE id = $1`, [groupId]);
                if (pkg.rowCount) {
                    if (user.role === 'admin') {
                        socket.join(`group_${groupId}`);
                        return;
                    }
                    if (user.role === 'teacher') {
                        const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2`, [groupId, user.id]);
                        if (ok.rowCount)
                            socket.join(`group_${groupId}`);
                        return;
                    }
                    const ok = await pool_1.default.query(`SELECT 1
             FROM package_subject_item_group_students gs
             JOIN package_subject_item_groups g ON g.id = gs.group_id
             JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
             JOIN package_activations pa ON pa.package_id = psi.package_id
             WHERE gs.group_id = $1
               AND gs.student_id = $2
               AND pa.student_id = $2
               AND pa.is_active = TRUE
               AND pa.activation_code_id IS NOT NULL
             LIMIT 1`, [groupId, user.id]);
                    if (ok.rowCount)
                        socket.join(`group_${groupId}`);
                    return;
                }
                // legacy
                const mem = await pool_1.default.query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
                if (mem.rowCount)
                    socket.join(`group:${groupId}`);
            });
            // Direct chat: join by other user id (student -> teacherId, teacher -> studentId)
            socket.on('chat:join-direct', async (payload, ack) => {
                try {
                    const otherId = Number(payload?.otherId);
                    if (!otherId || isNaN(otherId))
                        return ack?.({ ok: false, error: 'Invalid otherId' });
                    if (user.role === 'student') {
                        const can = await chat_1.ChatService.studentCanChatWithTeacher(user.id, otherId);
                        if (!can)
                            return ack?.({ ok: false, error: 'Not allowed' });
                        const cg = await chat_1.ChatService.getOrCreateDirectChat(user.id, otherId);
                        socket.join(`group:${cg.id}`);
                        return ack?.({ ok: true, chat_group_id: cg.id, room: `group:${cg.id}` });
                    }
                    if (user.role === 'teacher') {
                        const can = await chat_1.ChatService.teacherCanChatWithStudent(user.id, otherId);
                        if (!can)
                            return ack?.({ ok: false, error: 'Not allowed' });
                        const cg = await chat_1.ChatService.getOrCreateDirectChat(otherId, user.id);
                        socket.join(`group:${cg.id}`);
                        return ack?.({ ok: true, chat_group_id: cg.id, room: `group:${cg.id}` });
                    }
                    return ack?.({ ok: false, error: 'Not allowed' });
                }
                catch (e) {
                    return ack?.({ ok: false, error: e?.message || 'Error' });
                }
            });
            // Direct chat: send by other user id (server resolves chat_group_id, saves, broadcasts)
            socket.on('chat:send-direct', async (payload, ack) => {
                try {
                    const otherId = Number(payload?.otherId);
                    const text = String(payload?.message ?? payload?.text ?? '').trim();
                    if (!otherId || isNaN(otherId))
                        return ack?.({ ok: false, error: 'Invalid otherId' });
                    if (!text)
                        return ack?.({ ok: false, error: 'message is required' });
                    let cgId = null;
                    if (user.role === 'student') {
                        const can = await chat_1.ChatService.studentCanChatWithTeacher(user.id, otherId);
                        if (!can)
                            return ack?.({ ok: false, error: 'Not allowed' });
                        const cg = await chat_1.ChatService.getOrCreateDirectChat(user.id, otherId);
                        cgId = cg.id;
                    }
                    else if (user.role === 'teacher') {
                        const can = await chat_1.ChatService.teacherCanChatWithStudent(user.id, otherId);
                        if (!can)
                            return ack?.({ ok: false, error: 'Not allowed' });
                        const cg = await chat_1.ChatService.getOrCreateDirectChat(otherId, user.id);
                        cgId = cg.id;
                    }
                    else {
                        return ack?.({ ok: false, error: 'Not allowed' });
                    }
                    socket.join(`group:${cgId}`);
                    const saved = await chat_1.ChatService.saveMessage(cgId, user.id, text, payload?.replyTo ?? null);
                    const senderInfo = await pool_1.default.query('SELECT name FROM users WHERE id = $1', [user.id]);
                    const senderName = senderInfo.rowCount ? senderInfo.rows[0].name : 'مدرس';
                    const realtimePayload = { ...saved, sender_name: senderName, chat_group_id: cgId, reply: null, reply_preview: null };
                    io.to(`group:${cgId}`).emit('chat:new-message', realtimePayload);
                    io.to(`user:${otherId}`).emit('chat:new-message', realtimePayload);
                    // إرسال إشعار للرسائل المباشرة (فقط إذا كان المرسل مدرس أو أدمن)
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    if ((user.role === 'teacher' || user.role === 'admin') && otherId) {
                        try {
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            // @ts-ignore
                            const { NotificationService } = await import('./services/notifications');
                            await NotificationService.notifyDirectMessage(otherId, user.id, senderName, text);
                        }
                        catch (notifError) {
                            console.error('Error sending direct message notification:', notifError);
                        }
                    }
                    return ack?.({ ok: true, chat_group_id: cgId, message: saved });
                }
                catch (e) {
                    return ack?.({ ok: false, error: e?.message || 'Error' });
                }
            });
            // الانضمام لشات
            socket.on('support:join-chat', async (chatId) => {
                try {
                    let isTeacherChat = false;
                    // التحقق من الصلاحيات
                    if (user.role === 'admin') {
                        const chatTypeRes = await pool_1.default.query(`SELECT 'teacher' AS type FROM teacher_support_chats WHERE id = $1
               UNION ALL
               SELECT 'student' FROM support_chats WHERE id = $1`, [chatId, chatId]);
                        isTeacherChat = chatTypeRes.rows.some((r) => r.type === 'teacher');
                        const room = isTeacherChat ? `support:teacher-chat:${chatId}` : `support:chat:${chatId}`;
                        socket.join(room);
                        socket.emit('support:joined-chat', { chat_id: chatId, chat_type: isTeacherChat ? 'teacher' : 'student' });
                        if (!isTeacherChat) {
                            io.to(`support:chat:${chatId}`).emit('support:admin-viewing', {
                                chat_id: chatId,
                                admin_id: user.id,
                            });
                        }
                        else {
                            io.to(`support:teacher-chat:${chatId}`).emit('support:admin-viewing', {
                                chat_id: chatId,
                                admin_id: user.id,
                            });
                        }
                    }
                    else if (user.role === 'student') {
                        // للطالب: التحقق من أن الشات خاص به
                        const chat = await supportChat_1.SupportChatService.getOrCreateStudentChat(user.id);
                        if (chat.id === chatId) {
                            socket.join(`support:chat:${chatId}`);
                            socket.emit('support:joined-chat', { chat_id: chatId });
                        }
                    }
                    else if (user.role === 'teacher') {
                        const chat = await supportChat_1.SupportChatService.getTeacherChatByTeacherId(user.id);
                        if (chat && chat.id === chatId) {
                            socket.join(`support:teacher-chat:${chatId}`);
                            socket.emit('support:joined-chat', { chat_id: chatId });
                        }
                    }
                    if (user.role === 'student' || (user.role === 'admin' && !isTeacherChat)) {
                        await pool_1.default.query(`UPDATE support_messages 
               SET delivered_at = COALESCE(delivered_at, NOW())
               WHERE chat_id = $1 AND sender_id != $2 AND delivered_at IS NULL`, [chatId, user.id]);
                        await supportChat_1.SupportChatService.markChatAsRead(chatId, user.id);
                    }
                    else if (user.role === 'teacher' || (user.role === 'admin' && isTeacherChat)) {
                        const chat = user.role === 'teacher'
                            ? await supportChat_1.SupportChatService.getTeacherChatByTeacherId(user.id)
                            : { id: chatId };
                        if (chat && chat.id === chatId) {
                            await pool_1.default.query(`UPDATE teacher_support_messages 
                 SET delivered_at = COALESCE(delivered_at, NOW()), read_at = COALESCE(read_at, NOW())
                 WHERE chat_id = $1 AND sender_id != $2`, [chatId, user.id]);
                        }
                    }
                    socket.emit('chat:ready', {
                        chat_id: chatId,
                        timestamp: Date.now(),
                    });
                }
                catch (error) {
                    console.error('Error in support:join-chat:', error);
                }
            });
            // مغادرة الشات
            socket.on('support:leave-chat', (chatId) => {
                socket.leave(`support:chat:${chatId}`);
            });
            // Typing indicator
            socket.on('support:typing', (payload) => {
                const { chat_id, is_typing } = payload;
                const userResult = pool_1.default
                    .query('SELECT name FROM users WHERE id = $1', [user.id])
                    .then((r) => r.rows[0]);
                userResult.then((userData) => {
                    socket.to(`support:chat:${chat_id}`).emit('support:user-typing', {
                        chat_id,
                        user_id: user.id,
                        user_role: user.role,
                        user_name: userData?.name || 'مستخدم',
                        is_typing,
                    });
                });
            });
            // تحديد رسالة كمستلمة
            socket.on('support:mark-delivered', async (messageId) => {
                try {
                    await supportChat_1.SupportChatService.updateMessageStatus(messageId, 'delivered');
                    const result = await pool_1.default.query('SELECT delivered_at FROM support_messages WHERE id = $1', [messageId]);
                    if (result.rowCount) {
                        supportChatSocket_1.SupportChatSocketService.emitMessageStatusUpdate(io, messageId, 'delivered', result.rows[0].delivered_at);
                    }
                }
                catch (error) {
                    console.error('Error marking message as delivered:', error);
                }
            });
            // تحديد رسالة كمقروءة
            socket.on('support:mark-read', async (messageId) => {
                try {
                    await supportChat_1.SupportChatService.updateMessageStatus(messageId, 'read');
                    const result = await pool_1.default.query('SELECT read_at FROM support_messages WHERE id = $1', [
                        messageId,
                    ]);
                    if (result.rowCount) {
                        supportChatSocket_1.SupportChatSocketService.emitMessageStatusUpdate(io, messageId, 'read', result.rows[0].read_at);
                    }
                }
                catch (error) {
                    console.error('Error marking message as read:', error);
                }
            });
            // تحديد جميع رسائل الشات كمقروءة
            socket.on('support:mark-chat-read', async (chatId) => {
                try {
                    await supportChat_1.SupportChatService.markChatAsRead(chatId, user.id);
                    supportChatSocket_1.SupportChatSocketService.emitChatRead(io, chatId, user.id);
                }
                catch (error) {
                    console.error('Error marking chat as read:', error);
                }
            });
            // Event جديد: message:send (للتوافق مع المطلوب)
            socket.on('message:send', async (payload) => {
                // نفس منطق support:send-message
                socket.emit('support:send-message', payload);
            });
        });
        // Game System Socket Handlers
        const connectedUsers = new Map();
        io.on('connection', (socket) => {
            // Game System Events
            socket.on('user:join', async (data) => {
                connectedUsers.set(data.userId, {
                    socketId: socket.id,
                    userId: data.userId,
                    name: data.name,
                });
                console.log(`User ${data.name} (${data.userId}) joined with socket ${socket.id}`);
                // Send existing invitations to the user
                try {
                    const invitations = await pool_1.default.query(`SELECT gi.*, u.name as inviter_name
             FROM game_invitations gi
             JOIN users u ON u.id = gi.inviter_id
             WHERE gi.invitee_id = $1 AND gi.status = 'pending' AND gi.expires_at > CURRENT_TIMESTAMP
             ORDER BY gi.created_at DESC`, [data.userId]);
                    if (invitations.rows.length > 0) {
                        socket.emit('game:pending_invitations', invitations.rows.map((inv) => ({
                            invitationId: inv.id,
                            inviterName: inv.inviter_name,
                            inviterId: inv.inviter_id,
                            lessonIds: inv.lesson_ids.map((id) => parseInt(id)),
                            questionsCount: inv.questions_count,
                            expiresAt: inv.expires_at,
                        })));
                    }
                }
                catch (error) {
                    console.error('Error fetching invitations:', error);
                }
            });
            socket.on('game:send_invitation', async (data) => {
                const inviter = Array.from(connectedUsers.values()).find((u) => u.socketId === socket.id);
                if (!inviter) {
                    socket.emit('error', { message: 'Authentication required' });
                    return;
                }
                console.log(`[Socket game:send_invitation] Creating bulk invitations via Socket.IO, inviter.userId: ${inviter.userId} (type: ${typeof inviter.userId})`);
                try {
                    // التحقق من صحة البيانات
                    if (!data.inviteeIds ||
                        !Array.isArray(data.inviteeIds) ||
                        data.inviteeIds.length === 0) {
                        socket.emit('error', { message: 'يجب تحديد الطلاب المدعوين' });
                        return;
                    }
                    if (!data.lessonIds || !Array.isArray(data.lessonIds) || data.lessonIds.length === 0) {
                        socket.emit('error', { message: 'يجب تحديد الدروس' });
                        return;
                    }
                    // التحقق من الحد الأقصى للطلاب (8 طلاب)
                    if (data.inviteeIds.length > 8) {
                        socket.emit('error', {
                            message: 'لا يمكن إرسال دعوة لأكثر من 8 طلاب في المرة الواحدة',
                        });
                        return;
                    }
                    // التحقق من أن المستخدم لا يرسل دعوة لنفسه
                    if (data.inviteeIds.includes(inviter.userId)) {
                        socket.emit('error', { message: 'لا يمكنك إرسال دعوة لنفسك' });
                        return;
                    }
                    // التحقق من عدم تكرار الطلاب
                    const uniqueInviteeIds = [...new Set(data.inviteeIds)];
                    if (uniqueInviteeIds.length !== data.inviteeIds.length) {
                        socket.emit('error', { message: 'لا يمكن إرسال دعوة لنفس الطالب أكثر من مرة' });
                        return;
                    }
                    // استخدام GameService لإنشاء الدعوات المتعددة
                    const invitations = await GameService_1.GameService.createBulkInvitations(inviter.userId, data.inviteeIds, data.lessonIds, data.questionsCount);
                    console.log(`[Socket game:send_invitation] Bulk invitations created via Socket.IO:`);
                    console.log(`  - Total invitations: ${invitations.length}`);
                    console.log(`  - Successfully sent to: ${invitations.filter((inv) => inv.success).length} students`);
                    console.log(`  - Failed to send to: ${invitations.filter((inv) => !inv.success).length} students`);
                    // إرسال الدعوات للطلاب المتصلين
                    const successfulInvitations = invitations.filter((inv) => inv.success);
                    for (const invitationResult of successfulInvitations) {
                        const inviteeSocket = Array.from(connectedUsers.values()).find((u) => u.userId === invitationResult.inviteeId);
                        if (inviteeSocket) {
                            const inviteeSocketObj = io.sockets.sockets.get(inviteeSocket.socketId);
                            if (inviteeSocketObj) {
                                const lessonIds = (invitationResult.invitation?.lesson_ids ||
                                    invitationResult.invitation?.selected_lessons ||
                                    []).map((id) => parseInt(id));
                                inviteeSocketObj.emit('game:invitation_received', {
                                    invitationId: invitationResult.invitation.id,
                                    inviterName: inviter.name,
                                    inviterId: inviter.userId,
                                    lessonIds: lessonIds,
                                    questionsCount: data.questionsCount,
                                    expiresAt: invitationResult.invitation.expires_at,
                                });
                                // إرسال تحديث لـ latest incoming invitation
                                const emitLatestIncoming = app_1.app.emitLatestIncomingUpdate;
                                if (emitLatestIncoming) {
                                    await emitLatestIncoming(invitationResult.inviteeId);
                                }
                            }
                        }
                    }
                    // إرسال النتيجة للمرسل
                    socket.emit('game:invitations_sent', {
                        totalInvited: data.inviteeIds.length,
                        successfulInvitations: successfulInvitations.length,
                        failedInvitations: invitations.filter((inv) => !inv.success).length,
                        lessonIds: data.lessonIds,
                        questionsCount: data.questionsCount,
                        invitations: invitations.map((inv) => ({
                            inviteeId: inv.inviteeId,
                            success: inv.success,
                            invitationId: inv.invitation?.id || null,
                            error: inv.error || null,
                        })),
                    });
                }
                catch (error) {
                    console.error('Error sending bulk invitations:', error);
                    socket.emit('error', { message: error.message || 'Failed to send invitations' });
                }
            });
            socket.on('disconnect', () => {
                console.log(`Socket disconnected: ${socket.id}`);
                // Remove user from connected users
                for (const [userId, user] of connectedUsers.entries()) {
                    if (user.socketId === socket.id) {
                        connectedUsers.delete(userId);
                        break;
                    }
                }
            });
        });
        // Cleanup expired invitations periodically and notify users
        setInterval(async () => {
            try {
                // Update expired invitations
                const expiredResult = await pool_1.default.query(`UPDATE game_invitations 
           SET status = 'expired' 
           WHERE expires_at < CURRENT_TIMESTAMP AND status = 'pending'
           RETURNING invitee_id, inviter_id`);
                // Notify invitees and inviters about expired invitations
                if (expiredResult.rowCount && expiredResult.rowCount > 0) {
                    const affectedInvitees = new Set();
                    const affectedInviters = new Set();
                    expiredResult.rows.forEach((row) => {
                        affectedInvitees.add(row.invitee_id);
                        affectedInviters.add(row.inviter_id);
                    });
                    // إرسال تحديثات للطلاب المستلمين
                    for (const inviteeId of affectedInvitees) {
                        const emitLatestIncoming = app_1.app.emitLatestIncomingUpdate;
                        if (emitLatestIncoming) {
                            await emitLatestIncoming(inviteeId);
                        }
                    }
                    // إرسال تحديثات للطلاب المرسلين
                    for (const inviterId of affectedInviters) {
                        const expiredInvitation = expiredResult.rows.find((r) => r.inviter_id === inviterId);
                        if (expiredInvitation) {
                            const emitInvitationUpdate = app_1.app.emitInvitationStatusUpdate;
                            if (emitInvitationUpdate) {
                                // Find the invitation ID
                                const invitationResult = await pool_1.default.query(`SELECT id FROM game_invitations 
                   WHERE inviter_id = $1::INTEGER 
                     AND invitee_id = $2::INTEGER 
                     AND status = 'expired'
                   ORDER BY created_at DESC LIMIT 1`, [inviterId, expiredInvitation.invitee_id]);
                                if (invitationResult.rowCount && invitationResult.rowCount > 0) {
                                    await emitInvitationUpdate(inviterId, invitationResult.rows[0].id);
                                }
                            }
                        }
                    }
                }
            }
            catch (error) {
                console.error('Error cleaning up expired invitations:', error);
            }
        }, 60 * 1000); // Every minute
        // يومياً 7 مساءً: إرسال التقرير اليومي تلقائياً (محاضرات وامتحانات متراكمة) في شات الدعم الفني لكل طالب
        setInterval(async () => {
            try {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                const { runSupportDailyReportJob, isDailyReportTime } = await import(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                './services/supportDailyReportJob');
                if (isDailyReportTime()) {
                    await runSupportDailyReportJob(globalIO);
                }
            }
            catch (err) {
                utils_1.logger.error('Support daily report job error:', err);
            }
        }, 60 * 1000);
        // يومياً 8 صباحاً: إرسال التحية اليومية للمدرسين في شات الدعم الفني
        setInterval(async () => {
            try {
                const { runTeacherDailyGreetingJob, isTeacherDailyGreetingTime,
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                 } = await import('./services/supportDailyReportJob');
                if (isTeacherDailyGreetingTime()) {
                    await runTeacherDailyGreetingJob(globalIO);
                }
            }
            catch (err) {
                utils_1.logger.error('Teacher daily greeting job error:', err);
            }
        }, 60 * 1000);
        // حذف الاستوريات المنتهية (بعد 24 ساعة) عند التشغيل ثم كل ساعة
        (async () => {
            try {
                const { SocialService } = await import('./services/social.js');
                const deleted = await SocialService.deleteExpiredStories();
                if (deleted > 0)
                    utils_1.logger.info(`Deleted ${deleted} expired social story/stories`);
            }
            catch (err) {
                utils_1.logger.error('Expired stories cleanup error:', err);
            }
        })();
        setInterval(async () => {
            try {
                const { SocialService } = await import('./services/social.js');
                const deleted = await SocialService.deleteExpiredStories();
                if (deleted > 0)
                    utils_1.logger.info(`Deleted ${deleted} expired social story/stories`);
            }
            catch (err) {
                utils_1.logger.error('Expired stories cleanup error:', err);
            }
        }, 60 * 60 * 1000);
        // مهام: تحديث حالة overdue + تذكير قبل يوم من الموعد
        setInterval(async () => {
            try {
                // eslint-disable-next-line prettier/prettier, @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const { TaskService } = await import('./services/tasks');
                await TaskService.applyOverdueRules();
                await TaskService.runDeadlineReminders();
            }
            catch (err) {
                utils_1.logger.error('Task deadline / overdue job error:', err);
            }
        }, 60 * 60 * 1000);
        // Broadcast helper when permissions change
        app_1.app.emitChatPermission = (groupId, allow) => {
            io.to(`group:${groupId}`).emit('chat:permission-changed', {
                groupId,
                allow_student_send: allow,
            });
        };
        // Broadcast helper for new messages
        app_1.app.emitChatMessage = (groupIdOrRoom, message) => {
            if (typeof groupIdOrRoom === 'string' && groupIdOrRoom.startsWith('group_')) {
                io.to(groupIdOrRoom).emit('chat:new-message', message);
                return;
            }
            io.to(`group:${groupIdOrRoom}`).emit('chat:new-message', message);
        };
        // Social realtime channels
        app_1.app.emitPostCreated = (post) => {
            io.emit('social:post-created', post);
        };
        app_1.app.emitCommentCreated = (payload) => {
            io.emit('social:comment-created', payload);
        };
        // Store io and connectedUsers globally for use in controllers
        global.app = app_1.app;
        app_1.app.io = io;
        app_1.app.connectedUsers = connectedUsers;
        // Game invitation status update helper
        app_1.app.emitInvitationStatusUpdate = async (inviterId, invitationId) => {
            try {
                // جلب بيانات الدعوة المحدثة
                const updatedInvitation = await pool_1.default.query(`SELECT gi.id, gi.invitee_id, gi.status, gi.accepted_at, gi.rejected_at,
                  u.name as invitee_name
           FROM game_invitations gi
           LEFT JOIN users u ON u.id = gi.invitee_id
           WHERE gi.id = $1`, [invitationId]);
                if (updatedInvitation.rowCount && updatedInvitation.rowCount > 0) {
                    const inv = updatedInvitation.rows[0];
                    // إرسال تحديث بسيط
                    const inviterSocket = Array.from(connectedUsers.values()).find((u) => u.userId === inviterId);
                    if (inviterSocket) {
                        const inviterSocketObj = io.sockets.sockets.get(inviterSocket.socketId);
                        if (inviterSocketObj) {
                            inviterSocketObj.emit('game:invitation_status_updated', {
                                invitationId: invitationId,
                                inviteeId: inv.invitee_id,
                                inviteeName: inv.invitee_name,
                                status: inv.status,
                                acceptedAt: inv.accepted_at,
                                rejectedAt: inv.rejected_at,
                            });
                            // إرسال بيانات كاملة لمجموعة الدعوات (latest-outgoing data)
                            const refInv = await pool_1.default.query(`SELECT id, inviter_id, lesson_ids, selected_lessons, created_at, questions_count, expires_at
                 FROM game_invitations 
                 WHERE id = $1`, [invitationId]);
                            if (refInv.rowCount && refInv.rowCount > 0) {
                                const refInvData = refInv.rows[0];
                                const createdAtStart = new Date(new Date(refInvData.created_at).getTime() - 10000);
                                const createdAtEnd = new Date(new Date(refInvData.created_at).getTime() + 10000);
                                const groupInvitations = await pool_1.default.query(`SELECT gi.id, gi.invitee_id, gi.status, gi.created_at, gi.expires_at, 
                          gi.accepted_at, gi.rejected_at, gi.questions_count,
                          gi.lesson_ids, gi.selected_lessons,
                          u.name as invitee_name,
                          (CASE 
                            WHEN gi.expires_at < NOW() AND gi.status = 'pending' THEN 'expired'
                            WHEN gi.status = 'pending' AND gi.accepted_at IS NULL AND gi.rejected_at IS NULL THEN 'pending'
                            WHEN gi.status = 'accepted' THEN 'accepted'
                            WHEN gi.status = 'rejected' THEN 'rejected'
                            ELSE gi.status
                          END) as current_status
                   FROM game_invitations gi
                   LEFT JOIN users u ON u.id = gi.invitee_id
                   WHERE gi.inviter_id = $1::INTEGER
                     AND gi.created_at >= $2::TIMESTAMP
                     AND gi.created_at <= $3::TIMESTAMP
                     AND gi.questions_count = $4::INTEGER
                   ORDER BY gi.created_at DESC, gi.id`, [inviterId, createdAtStart, createdAtEnd, refInvData.questions_count]);
                                const invitations = groupInvitations.rows.map((inv) => {
                                    let statusMessage = '';
                                    if (inv.current_status === 'pending') {
                                        statusMessage = 'في انتظار الرد';
                                    }
                                    else if (inv.current_status === 'accepted') {
                                        statusMessage = 'تم قبول الدعوة';
                                    }
                                    else if (inv.current_status === 'rejected') {
                                        statusMessage = 'تم رفض الدعوة';
                                    }
                                    else if (inv.current_status === 'expired') {
                                        statusMessage = 'الدعوة منتهية الصلاحية';
                                    }
                                    const lessonIds = inv.lesson_ids || inv.selected_lessons || [];
                                    const lessonIdsArray = Array.isArray(lessonIds)
                                        ? lessonIds
                                            .map((id) => parseInt(String(id)))
                                            .filter((id) => !isNaN(id))
                                        : [];
                                    return {
                                        id: inv.id,
                                        inviteeId: inv.invitee_id,
                                        inviteeName: inv.invitee_name || 'غير معروف',
                                        status: inv.current_status,
                                        statusMessage: statusMessage,
                                        createdAt: inv.created_at,
                                        expiresAt: inv.expires_at,
                                        acceptedAt: inv.accepted_at,
                                        rejectedAt: inv.rejected_at,
                                        questionsCount: inv.questions_count,
                                        lessonIds: lessonIdsArray,
                                    };
                                });
                                const allLessonIds = [...new Set(invitations.flatMap((inv) => inv.lessonIds))];
                                let lessonNames = [];
                                if (allLessonIds.length > 0) {
                                    const lessonsResult = await pool_1.default.query(`SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`, [allLessonIds]);
                                    lessonNames = lessonsResult.rows.map((lesson) => ({
                                        id: parseInt(lesson.id),
                                        name: lesson.name,
                                    }));
                                }
                                const summary = {
                                    accepted: invitations.filter((inv) => inv.status === 'accepted').length,
                                    rejected: invitations.filter((inv) => inv.status === 'rejected').length,
                                    pending: invitations.filter((inv) => inv.status === 'pending').length,
                                    expired: invitations.filter((inv) => inv.status === 'expired').length,
                                };
                                const canStartGame = summary.accepted > 0 &&
                                    groupInvitations.rows[0]?.expires_at &&
                                    new Date(groupInvitations.rows[0].expires_at) < new Date();
                                inviterSocketObj.emit('game:latest_outgoing_updated', {
                                    success: true,
                                    data: {
                                        invitationGroupId: refInvData.id,
                                        totalInvited: invitations.length,
                                        questionsCount: refInvData.questions_count,
                                        lessonIds: allLessonIds,
                                        lessonNames: lessonNames,
                                        createdAt: refInvData.created_at,
                                        expiresAt: groupInvitations.rows[0]?.expires_at,
                                        canStartGame: canStartGame,
                                        invitations: invitations,
                                        summary: summary,
                                    },
                                });
                            }
                        }
                    }
                }
            }
            catch (error) {
                console.error('Error emitting invitation status update:', error);
            }
        };
        // Helper function to emit latest incoming invitation update to invitee
        app_1.app.emitLatestIncomingUpdate = async (inviteeId) => {
            try {
                // جلب آخر دعوة واردة
                const latestInvitation = await pool_1.default.query(`SELECT gi.id, gi.inviter_id, gi.invitee_id, gi.questions_count, gi.status,
                  gi.created_at, gi.expires_at, gi.accepted_at, gi.rejected_at,
                  gi.lesson_ids, gi.selected_lessons,
                  u.name as inviter_name
           FROM game_invitations gi
           JOIN users u ON u.id = gi.inviter_id
           WHERE gi.invitee_id = $1::INTEGER
             AND gi.status = 'pending'
             AND gi.accepted_at IS NULL
             AND gi.rejected_at IS NULL
             AND gi.expires_at > NOW()
           ORDER BY gi.created_at DESC
           LIMIT 1`, [inviteeId]);
                const inviteeSocket = Array.from(connectedUsers.values()).find((u) => u.userId === inviteeId);
                if (inviteeSocket) {
                    const inviteeSocketObj = io.sockets.sockets.get(inviteeSocket.socketId);
                    if (inviteeSocketObj) {
                        if (latestInvitation.rowCount === 0) {
                            // لا توجد دعوة معلقة - إرسال null
                            inviteeSocketObj.emit('game:latest_incoming_updated', {
                                success: true,
                                data: null,
                                message: 'لا توجد دعوات معلقة',
                            });
                        }
                        else {
                            const invitation = latestInvitation.rows[0];
                            // معالجة lesson_ids
                            const rawDbCheck = await pool_1.default.query(`SELECT id, lesson_ids, selected_lessons 
                 FROM game_invitations 
                 WHERE id = $1::INTEGER`, [invitation.id]);
                            const rawData = rawDbCheck.rows[0];
                            let lessonIds = [];
                            if (rawData) {
                                if (rawData.lesson_ids !== null && rawData.lesson_ids !== undefined) {
                                    if (Array.isArray(rawData.lesson_ids)) {
                                        lessonIds = rawData.lesson_ids;
                                    }
                                    else {
                                        try {
                                            const parsed = JSON.parse(rawData.lesson_ids);
                                            if (Array.isArray(parsed)) {
                                                lessonIds = parsed;
                                            }
                                        }
                                        catch {
                                            // ignore parse error
                                        }
                                    }
                                }
                                if (lessonIds.length === 0 &&
                                    rawData.selected_lessons !== null &&
                                    rawData.selected_lessons !== undefined) {
                                    if (Array.isArray(rawData.selected_lessons)) {
                                        lessonIds = rawData.selected_lessons;
                                    }
                                }
                            }
                            if (lessonIds.length === 0) {
                                if (invitation.lesson_ids && Array.isArray(invitation.lesson_ids)) {
                                    lessonIds = invitation.lesson_ids;
                                }
                                else if (invitation.selected_lessons &&
                                    Array.isArray(invitation.selected_lessons)) {
                                    lessonIds = invitation.selected_lessons;
                                }
                            }
                            const lessonIdsArray = lessonIds
                                .map((id) => {
                                if (typeof id === 'number') {
                                    return id;
                                }
                                if (typeof id === 'string') {
                                    const parsed = parseInt(id);
                                    return isNaN(parsed) ? null : parsed;
                                }
                                return null;
                            })
                                .filter((id) => id !== null);
                            // جلب أسماء الدروس
                            let lessonNames = [];
                            if (lessonIdsArray.length > 0) {
                                try {
                                    const lessonsResult = await pool_1.default.query(`SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`, [lessonIdsArray]);
                                    lessonNames = lessonsResult.rows.map((lesson) => ({
                                        id: parseInt(lesson.id),
                                        name: lesson.name,
                                    }));
                                }
                                catch (error) {
                                    console.error('Error fetching lesson names:', error);
                                }
                            }
                            inviteeSocketObj.emit('game:latest_incoming_updated', {
                                success: true,
                                data: {
                                    id: invitation.id,
                                    inviterId: invitation.inviter_id,
                                    inviterName: invitation.inviter_name || 'غير معروف',
                                    lessonIds: lessonIdsArray,
                                    lessonNames: lessonNames,
                                    questionsCount: invitation.questions_count,
                                    status: invitation.status,
                                    createdAt: invitation.created_at,
                                    expiresAt: invitation.expires_at,
                                },
                            });
                        }
                    }
                }
            }
            catch (error) {
                console.error('Error emitting latest incoming invitation update:', error);
            }
        };
        // Graceful shutdown
        const shutdown = () => {
            utils_1.logger.info('Received shutdown signal. Closing server...');
            app_1.server.close(() => {
                utils_1.logger.info('HTTP server closed.');
                process.exit(0);
            });
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
    }
    catch (error) {
        console.log("err", error);
        utils_1.logger.error('❌ Failed to start server:', error);
        process.exit(1);
    }
};
startServer();
