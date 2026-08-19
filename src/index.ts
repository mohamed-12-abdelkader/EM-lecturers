import { applyMigrations } from './db/migrate';
import { app, server } from './app';
import { Server as SocketIOServer } from 'socket.io';
import * as jwt from 'jsonwebtoken';
import { config, generateToken, isAccessSessionReplaced, logger } from './utils';
import { getServerInfo, isCorsOriginAllowed } from './config/appUrls';
import pool from './db/pool';
import { ChatService } from './services/chat';
import { GameService } from './services/GameService';
// Support assistant: REST /api/support — intent-aware replies
import { ScientificChatbotService } from './services/scientificChatbot';
import { router as packageSubjectLessonsRouter } from './controllers/packageSubjectLessons';
import { router as packageSubjectExamsRouter } from './controllers/packageSubjectExams';
import { router as packageSubjectItemsRouter } from './controllers/packageSubjectItems'; // Assuming this import is needed for packageSubjectItemsRouter

// Store for socket.io instance to be used in controllers
let globalIO: SocketIOServer | null = null;

const { PORT } = config;

// Register API routes
app.use('/api/subjects', packageSubjectExamsRouter); // Register exams router on same prefix for consistency
app.use('/api/subjects', packageSubjectLessonsRouter);
app.use('/api/package-subjects', packageSubjectItemsRouter);

const startServer = async () => {
  try {
    logger.info('Applying database migrations...');
    try {
      await applyMigrations(config.DATABASE_URL, 'up');
      logger.info('✅ Migrations completed successfully');
    } catch (migrationError: any) {
      logger.error('❌ Migration failed:', migrationError.message);
      const connectionIssue =
        migrationError.message?.includes('ETIMEDOUT') ||
        migrationError.message?.includes('ENOTFOUND') ||
        migrationError.message?.includes('getaddrinfo') ||
        migrationError.message?.includes('ECONNREFUSED') ||
        migrationError.message?.includes('connect');
      if (connectionIssue) {
        logger.error('⚠️  Skipping migrations due to database connection issue');
        logger.error(
          '   Server will start but database operations will fail until connection is restored',
        );
      } else {
        throw migrationError; // Re-throw if it's not a connection error
      }
    }

    try {
      await pool.query(`
        ALTER TABLE course_exam_submissions
        ADD COLUMN IF NOT EXISTS attempts_count INTEGER DEFAULT 1
      `);
      await pool.query(`
        UPDATE course_exam_submissions
        SET attempts_count = 1
        WHERE attempts_count IS NULL
      `);
      logger.info('✅ Verified course_exam_submissions.attempts_count column');
    } catch (schemaError: any) {
      logger.error('❌ Failed to verify attempts_count column:', schemaError.message);
      throw schemaError;
    }

    // Initialize Milvus client and collection for scientific chatbot
    try {
      logger.info('Initializing Milvus client...');

      logger.info('Initializing Milvus collection for scientific chatbot...');
      await ScientificChatbotService.initializeCollection();
      logger.info('✅ Scientific chatbot collection initialized');
    } catch (milvusError: any) {
      logger.warn('⚠️  Failed to initialize Milvus:', milvusError.message);
      logger.warn(
        '   Scientific chatbot features will not be available until Milvus is configured',
      );
      // Don't throw - allow server to start without Milvus
    }

    server.listen(PORT, '0.0.0.0', () => {
      const info = getServerInfo();
      logger.info(`🚀 Server is running on port ${PORT}`);
      logger.info(`   Local:  ${info.local_url}`);
      if (info.use_ngrok && info.ngrok_url) {
        logger.info(`   Public: ${info.base_url}`);
        logger.info(`   API:    ${info.api_url}`);
        logger.info(`   Socket: ${info.socket_url}`);
        logger.warn(
          '   Ngrok URL is from .env.ngrok.local — the tunnel is NOT started by `npm run dev`. Run `npm run dev:expo` or `npm run ngrok` in another terminal.',
        );

        void (async () => {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const res = await fetch(`${info.api_url}/server-info`, {
              headers: { 'ngrok-skip-browser-warning': 'true' },
              signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            logger.info('   ✅ Ngrok tunnel is online — external API requests will reach this server');
          } catch {
            logger.error(
              '   ❌ Ngrok tunnel is OFFLINE — requests to the Public/API URL will NOT reach this server',
            );
            logger.error('   Fix: npm run dev:expo   OR   npm run ngrok (2nd terminal, keep open)');
          }
        })();
      }
    });

    // Socket.IO setup for both Chat and Game systems
    const io = new SocketIOServer(server, {
      cors: {
        origin: (origin, callback) => {
          if (!origin || isCorsOriginAllowed(origin)) {
            callback(null, true);
          } else {
            callback(new Error('CORS not allowed'));
          }
        },
        credentials: true,
      },
    });

    // Store io instance globally for use in controllers
    globalIO = io;
    (app as any).io = io;

    // Set IO getter for NotificationService
    const { setIOGetter } = await import('./services/notifications.js');
    setIOGetter(() => globalIO);

    const { setNotificationDispatchIO } = await import('./services/notificationDispatchService.js');
    setNotificationDispatchIO(() => globalIO);

    const { startNotificationPushWorker } = await import('./workers/notificationPushWorker.js');
    startNotificationPushWorker();

    const { startWhatsAppWorker } = await import('./modules/whatsapp/workers/whatsappWorker.js');
    startWhatsAppWorker();

    io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth?.token ||
          socket.handshake.headers?.authorization?.toString().split(' ')[1];
        if (!token) return next(new Error('Unauthorized'));

        let decoded: any;
        let tokenWasExpired = false;
        try {
          decoded = jwt.verify(token, config.SECRET_KEY) as any;
        } catch (err: any) {
          if (err?.name !== 'TokenExpiredError') return next(new Error('Invalid token'));
          // نفس سلوك HTTP: توكن منتهي يُقبل ويُجدَّد بدون إعادة تسجيل دخول
          decoded = jwt.verify(token, config.SECRET_KEY, { ignoreExpiration: true }) as any;
          tokenWasExpired = true;
        }

        const { id } = decoded;
        if (!id || isNaN(Number(id))) return next(new Error('Invalid token'));

        const userRes = await pool.query(
          'SELECT id, role, jti, tenant_id, account_status FROM users WHERE id = $1',
          [id],
        );
        if (!userRes.rowCount) return next(new Error('User not found'));
        const user = userRes.rows[0];

        if (user.role === 'teacher' && user.account_status && user.account_status !== 'active') {
          return next(new Error('Teacher account is not active'));
        }

        if (isAccessSessionReplaced(decoded, user)) {
          return next(new Error('SESSION_REPLACED'));
        }

        (socket as any).user = user;

        if (tokenWasExpired) {
          const newToken = await generateToken(user, pool, {
            sessionTenantId: user.tenant_id ?? undefined,
            jti: user.jti,
          });
          socket.emit('auth:token-refreshed', { token: newToken });
        }

        next();
      } catch {
        next(new Error('Invalid token'));
      }
    });

    io.on('connection', async (socket) => {
      const user = (socket as any).user as { id: number; role: string };
      // Personal room for realtime delivery (direct chat / notifications)
      socket.join(`user:${user.id}`);
      // Join all relevant group rooms
      if (user.role === 'student') {
        // Ensure memberships (grade chat + package subject group chat)
        await ChatService.ensureStudentMembershipForEnrollments(user.id);
        await ChatService.ensureStudentMembershipForPackageSubjectGroups(user.id);
        const res = await pool.query(`SELECT group_id FROM chat_group_members WHERE user_id = $1`, [user.id]);
        for (const r of res.rows as any[]) socket.join(`group:${r.group_id}`);
      } else if (user.role === 'teacher') {
        // Join grade rooms the teacher owns + any rooms he's a member of (includes direct chats)
        const res = await pool.query(
          `SELECT DISTINCT cg.id
           FROM chat_groups cg
           LEFT JOIN package_subject_item_groups pg ON pg.id = cg.package_subject_group_id
           LEFT JOIN chat_group_members cgm ON cgm.group_id = cg.id AND cgm.user_id = $1
           WHERE (cg.package_subject_group_id IS NULL AND cg.owner_teacher_id = $1)
              OR (cg.package_subject_group_id IS NOT NULL AND pg.teacher_id = $1)
              OR (cgm.user_id = $1)`,
          [user.id],
        );
        for (const row of res.rows as any[]) socket.join(`group:${row.id}`);
      }

      socket.on('chat:send', async (payload: { groupId: any; text?: string; message?: string; replyTo?: number | null }) => {
        try {
          
          // eslint-disable-next-line prefer-const
          let { groupId, replyTo } = payload || ({} as any);
          const text = (payload as any)?.message ?? (payload as any)?.text;

          // Sanitize groupId
          let parsedGroupId = Number(groupId);
          if (isNaN(parsedGroupId) && typeof groupId === 'string') {
            const match = groupId.match(/(\d+)/);
            if (match) parsedGroupId = Number(match[0]);
          }
          groupId = parsedGroupId;

          if (!groupId || isNaN(groupId) || !text || !String(text).trim()) return;

          // If groupId matches a package-subject group, resolve to chat group and emit to group_{packageGroupId}
          const pkg = await pool.query(`SELECT id FROM package_subject_item_groups WHERE id = $1`, [groupId]);
          if (pkg.rowCount) {
            // permission
            if (user.role === 'student') {
              const ok = await pool.query(
                `SELECT 1
                 FROM package_subject_item_group_students gs
                 JOIN package_subject_item_groups g ON g.id = gs.group_id
                 JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
                 JOIN package_activations pa ON pa.package_id = psi.package_id
                 WHERE gs.group_id = $1
                   AND gs.student_id = $2
                   AND pa.student_id = $2
                   AND pa.is_active = TRUE
                   AND pa.activation_code_id IS NOT NULL
                 LIMIT 1`,
                [groupId, user.id],
              );
              if (!ok.rowCount) return;
            } else if (user.role === 'teacher') {
              const ok = await pool.query(`SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2`, [groupId, user.id]);
              if (!ok.rowCount) return;
            }

            const chatGroup = await ChatService.getOrCreatePackageSubjectGroupChat(groupId);
            await ChatService.addMember(chatGroup.id, user.id, user.role === 'teacher' ? 'teacher' : 'student');

            if (user.role === 'student') {
              const can = await ChatService.canStudentSend(chatGroup.id);
              if (!can) return;
            }

            let parentOk = true;
            if (replyTo) {
              const r = await pool.query('SELECT id, group_id FROM chat_messages WHERE id = $1', [replyTo]);
              parentOk = !!(r.rowCount && r.rows[0].group_id === chatGroup.id);
            }
            if (!parentOk) return;

            const saved = await ChatService.saveMessage(chatGroup.id, user.id, String(text).trim(), replyTo ?? null);
            io.to(`group_${groupId}`).emit('chat:new-message', { ...saved, sender_name: undefined });
            return;
          }

          // Legacy chat group id flow (keep old behavior)
          const mem = await pool.query('SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
          if (!mem.rowCount) return;
          const role = mem.rows[0].role as 'student' | 'teacher';
          if (role === 'student') {
            const can = await ChatService.canStudentSend(groupId);
            if (!can) return;
          }
        } catch (e) {
          console.error('Error in chat:send:', e);
        }
      },
      );

      socket.on('chat:join-group', async (rawGroupId: any) => {
        let groupId = Number(rawGroupId);
        if (isNaN(groupId) && typeof rawGroupId === 'string') {
          const match = rawGroupId.match(/(\d+)/);
          if (match) groupId = Number(match[0]);
        }

        if (!groupId || isNaN(groupId)) return;

        // package group room
        const pkg = await pool.query(`SELECT id FROM package_subject_item_groups WHERE id = $1`, [groupId]);
        if (pkg.rowCount) {
          if (user.role === 'admin') {
            socket.join(`group_${groupId}`);
            return;
          }
          if (user.role === 'teacher') {
            const ok = await pool.query(`SELECT 1 FROM package_subject_item_groups WHERE id = $1 AND teacher_id = $2`, [groupId, user.id]);
            if (ok.rowCount) socket.join(`group_${groupId}`);
            return;
          }
          const ok = await pool.query(
            `SELECT 1
             FROM package_subject_item_group_students gs
             JOIN package_subject_item_groups g ON g.id = gs.group_id
             JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
             JOIN package_activations pa ON pa.package_id = psi.package_id
             WHERE gs.group_id = $1
               AND gs.student_id = $2
               AND pa.student_id = $2
               AND pa.is_active = TRUE
               AND pa.activation_code_id IS NOT NULL
             LIMIT 1`,
            [groupId, user.id],
          );
          if (ok.rowCount) socket.join(`group_${groupId}`);
          return;
        }

        // legacy
        const mem = await pool.query('SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2', [groupId, user.id]);
        if (mem.rowCount) socket.join(`group:${groupId}`);
      });

      // Direct chat: join by other user id (student -> teacherId, teacher -> studentId)
      socket.on('chat:join-direct', async (payload: { otherId: number }, ack?: (resp: any) => void) => {
        try {
          const otherId = Number(payload?.otherId);
          if (!otherId || isNaN(otherId)) return ack?.({ ok: false, error: 'Invalid otherId' });

          if (user.role === 'student') {
            const can = await ChatService.studentCanChatWithTeacher(user.id, otherId);
            if (!can) return ack?.({ ok: false, error: 'Not allowed' });
            const cg = await ChatService.getOrCreateDirectChat(user.id, otherId);
            socket.join(`group:${cg.id}`);
            return ack?.({ ok: true, chat_group_id: cg.id, room: `group:${cg.id}` });
          }

          if (user.role === 'teacher') {
            const can = await ChatService.teacherCanChatWithStudent(user.id, otherId);
            if (!can) return ack?.({ ok: false, error: 'Not allowed' });
            const cg = await ChatService.getOrCreateDirectChat(otherId, user.id);
            socket.join(`group:${cg.id}`);
            return ack?.({ ok: true, chat_group_id: cg.id, room: `group:${cg.id}` });
          }

          return ack?.({ ok: false, error: 'Not allowed' });
        } catch (e: any) {
          return ack?.({ ok: false, error: e?.message || 'Error' });
        }
      });

      // Direct chat: send by other user id (server resolves chat_group_id, saves, broadcasts)
      socket.on(
        'chat:send-direct',
        async (payload: { otherId: number; message?: string; text?: string; replyTo?: number | null }, ack?: (resp: any) => void) => {
          try {
            const otherId = Number(payload?.otherId);
            const text = String(payload?.message ?? payload?.text ?? '').trim();
            if (!otherId || isNaN(otherId)) return ack?.({ ok: false, error: 'Invalid otherId' });
            if (!text) return ack?.({ ok: false, error: 'message is required' });

            let cgId: number | null = null;
            if (user.role === 'student') {
              const can = await ChatService.studentCanChatWithTeacher(user.id, otherId);
              if (!can) return ack?.({ ok: false, error: 'Not allowed' });
              const cg = await ChatService.getOrCreateDirectChat(user.id, otherId);
              cgId = cg.id;
            } else if (user.role === 'teacher') {
              const can = await ChatService.teacherCanChatWithStudent(user.id, otherId);
              if (!can) return ack?.({ ok: false, error: 'Not allowed' });
              const cg = await ChatService.getOrCreateDirectChat(otherId, user.id);
              cgId = cg.id;
            } else {
              return ack?.({ ok: false, error: 'Not allowed' });
            }

            socket.join(`group:${cgId}`);

            const saved = await ChatService.saveMessage(cgId, user.id, text, payload?.replyTo ?? null);
            const senderInfo = await pool.query('SELECT name FROM users WHERE id = $1', [user.id]);
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

                await NotificationService.notifyDirectMessage(
                  otherId,
                  user.id,
                  senderName,
                  text,
                );
              } catch (notifError) {
                console.error('Error sending direct message notification:', notifError);
              }
            }

            return ack?.({ ok: true, chat_group_id: cgId, message: saved });
          } catch (e: any) {
            return ack?.({ ok: false, error: e?.message || 'Error' });
          }
        },
      );


      // Event جديد: message:send (للتوافق مع المطلوب)
      socket.on('message:send', async (payload: { chat_id?: number; text: string }) => {
        socket.emit('chat:send-message', payload);
      });
    });

    // Game System Socket Handlers
    const connectedUsers = new Map<number, { socketId: string; userId: number; name: string }>();

    io.on('connection', (socket) => {
      // Game System Events
      socket.on('user:join', async (data: { userId: number; name: string }) => {
        connectedUsers.set(data.userId, {
          socketId: socket.id,
          userId: data.userId,
          name: data.name,
        });
        console.log(`User ${data.name} (${data.userId}) joined with socket ${socket.id}`);

        // Send existing invitations to the user
        try {
          const invitations = await pool.query(
            `SELECT gi.*, u.name as inviter_name
             FROM game_invitations gi
             JOIN users u ON u.id = gi.inviter_id
             WHERE gi.invitee_id = $1 AND gi.status = 'pending' AND gi.expires_at > CURRENT_TIMESTAMP
             ORDER BY gi.created_at DESC`,
            [data.userId],
          );

          if (invitations.rows.length > 0) {
            socket.emit(
              'game:pending_invitations',
              invitations.rows.map((inv) => ({
                invitationId: inv.id,
                inviterName: inv.inviter_name,
                inviterId: inv.inviter_id,
                lessonIds: inv.lesson_ids.map((id: string) => parseInt(id)),
                questionsCount: inv.questions_count,
                expiresAt: inv.expires_at,
              })),
            );
          }
        } catch (error) {
          console.error('Error fetching invitations:', error);
        }
      });

      socket.on(
        'game:send_invitation',
        async (data: { inviteeIds: number[]; lessonIds: number[]; questionsCount: number }) => {
          const inviter = Array.from(connectedUsers.values()).find((u) => u.socketId === socket.id);
          if (!inviter) {
            socket.emit('error', { message: 'Authentication required' });
            return;
          }

          console.log(
            `[Socket game:send_invitation] Creating bulk invitations via Socket.IO, inviter.userId: ${inviter.userId} (type: ${typeof inviter.userId})`,
          );

          try {
            // التحقق من صحة البيانات
            if (
              !data.inviteeIds ||
              !Array.isArray(data.inviteeIds) ||
              data.inviteeIds.length === 0
            ) {
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
            const invitations = await GameService.createBulkInvitations(
              inviter.userId,
              data.inviteeIds,
              data.lessonIds,
              data.questionsCount,
            );

            console.log(`[Socket game:send_invitation] Bulk invitations created via Socket.IO:`);
            console.log(`  - Total invitations: ${invitations.length}`);
            console.log(
              `  - Successfully sent to: ${invitations.filter((inv) => inv.success).length} students`,
            );
            console.log(
              `  - Failed to send to: ${invitations.filter((inv) => !inv.success).length} students`,
            );

            // إرسال الدعوات للطلاب المتصلين
            const successfulInvitations = invitations.filter((inv) => inv.success);
            for (const invitationResult of successfulInvitations) {
              const inviteeSocket = Array.from(connectedUsers.values()).find(
                (u) => u.userId === invitationResult.inviteeId,
              );
              if (inviteeSocket) {
                const inviteeSocketObj = io.sockets.sockets.get(inviteeSocket.socketId);
                if (inviteeSocketObj) {
                  const lessonIds = (
                    invitationResult.invitation?.lesson_ids ||
                    invitationResult.invitation?.selected_lessons ||
                    []
                  ).map((id: string) => parseInt(id));
                  inviteeSocketObj.emit('game:invitation_received', {
                    invitationId: invitationResult.invitation.id,
                    inviterName: inviter.name,
                    inviterId: inviter.userId,
                    lessonIds: lessonIds,
                    questionsCount: data.questionsCount,
                    expiresAt: invitationResult.invitation.expires_at,
                  });

                  // إرسال تحديث لـ latest incoming invitation
                  const emitLatestIncoming = (app as any).emitLatestIncomingUpdate;
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
          } catch (error: any) {
            console.error('Error sending bulk invitations:', error);
            socket.emit('error', { message: error.message || 'Failed to send invitations' });
          }
        },
      );

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
        const expiredResult = await pool.query(
          `UPDATE game_invitations 
           SET status = 'expired' 
           WHERE expires_at < CURRENT_TIMESTAMP AND status = 'pending'
           RETURNING invitee_id, inviter_id`,
        );

        // Notify invitees and inviters about expired invitations
        if (expiredResult.rowCount && expiredResult.rowCount > 0) {
          const affectedInvitees = new Set<number>();
          const affectedInviters = new Set<number>();

          expiredResult.rows.forEach((row: any) => {
            affectedInvitees.add(row.invitee_id);
            affectedInviters.add(row.inviter_id);
          });

          // إرسال تحديثات للطلاب المستلمين
          for (const inviteeId of affectedInvitees) {
            const emitLatestIncoming = (app as any).emitLatestIncomingUpdate;
            if (emitLatestIncoming) {
              await emitLatestIncoming(inviteeId);
            }
          }

          // إرسال تحديثات للطلاب المرسلين
          for (const inviterId of affectedInviters) {
            const expiredInvitation = expiredResult.rows.find(
              (r: any) => r.inviter_id === inviterId,
            );
            if (expiredInvitation) {
              const emitInvitationUpdate = (app as any).emitInvitationStatusUpdate;
              if (emitInvitationUpdate) {
                // Find the invitation ID
                const invitationResult = await pool.query(
                  `SELECT id FROM game_invitations 
                   WHERE inviter_id = $1::INTEGER 
                     AND invitee_id = $2::INTEGER 
                     AND status = 'expired'
                   ORDER BY created_at DESC LIMIT 1`,
                  [inviterId, expiredInvitation.invitee_id],
                );
                if (invitationResult.rowCount && invitationResult.rowCount > 0) {
                  await emitInvitationUpdate(inviterId, invitationResult.rows[0].id);
                }
              }
            }
          }
        }
      } catch (error) {
        console.error('Error cleaning up expired invitations:', error);
      }
    }, 60 * 1000); // Every minute

    // يومياً 8 صباحاً: تذكير المدرسين باستخدام مساعد توليد المنشورات والتصميمات
    setInterval(async () => {
      try {
        const { runTeacherCreativeReminderJob, isTeacherCreativeReminderTime } = await import(
          './services/teacherCreativeReminderJob.js'
        );
        if (isTeacherCreativeReminderTime()) {
          await runTeacherCreativeReminderJob();
        }
      } catch (err) {
        logger.error('Teacher creative reminder job error:', err);
      }
    }, 60 * 1000);

    // المسابقة اليومية: إشعارات البدء / قبل الانتهاء / النتائج + أرشفة شهرية
    setInterval(async () => {
      try {
        const { DailyQuizNotificationJob } = await import('./services/dailyQuiz/notifications.js');
        await DailyQuizNotificationJob.run();
      } catch (err) {
        logger.error('Daily quiz notification job error:', err);
      }
    }, 60 * 1000);

    // حذف الاستوريات المنتهية (بعد 24 ساعة) عند التشغيل ثم كل ساعة
    (async () => {
      try {
        const { SocialService } = await import('./services/social.js');
        const deleted = await SocialService.deleteExpiredStories();
        if (deleted > 0) logger.info(`Deleted ${deleted} expired social story/stories`);
      } catch (err) {
        logger.error('Expired stories cleanup error:', err);
      }
    })();
    setInterval(async () => {
      try {
        const { SocialService } = await import('./services/social.js');
        const deleted = await SocialService.deleteExpiredStories();
        if (deleted > 0) logger.info(`Deleted ${deleted} expired social story/stories`);
      } catch (err) {
        logger.error('Expired stories cleanup error:', err);
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
      } catch (err) {
        logger.error('Task deadline / overdue job error:', err);
      }
    }, 60 * 60 * 1000);

    // اشتراكات المدرسين: انتهاء الباقة → فترة سماح → إيقاف المنصة
    setInterval(async () => {
      try {
        const { TeacherPlatformSubscriptionsService } = await import(
          './services/teacherPlatformSubscriptions.js'
        );
        await TeacherPlatformSubscriptionsService.syncSubscriptionLifecycle();
      } catch (err) {
        logger.error('Teacher subscription lifecycle sync error:', err);
      }
    }, 60 * 60 * 1000);

    // Broadcast helper when permissions change
    (app as any).emitChatPermission = (groupId: number, allow: boolean) => {
      io.to(`group:${groupId}`).emit('chat:permission-changed', {
        groupId,
        allow_student_send: allow,
      });
    };

    // Broadcast helper for new messages
    (app as any).emitChatMessage = (groupIdOrRoom: any, message: any) => {
      if (typeof groupIdOrRoom === 'string' && groupIdOrRoom.startsWith('group_')) {
        io.to(groupIdOrRoom).emit('chat:new-message', message);
        return;
      }
      io.to(`group:${groupIdOrRoom}`).emit('chat:new-message', message);
    };

    // Social realtime channels
    (app as any).emitPostCreated = (post: any) => {
      io.emit('social:post-created', post);
    };
    (app as any).emitCommentCreated = (payload: any) => {
      io.emit('social:comment-created', payload);
    };

    // Store io and connectedUsers globally for use in controllers
    (global as any).app = app;
    (app as any).io = io;
    (app as any).connectedUsers = connectedUsers;

    // Game invitation status update helper
    (app as any).emitInvitationStatusUpdate = async (inviterId: number, invitationId: number) => {
      try {
        // جلب بيانات الدعوة المحدثة
        const updatedInvitation = await pool.query(
          `SELECT gi.id, gi.invitee_id, gi.status, gi.accepted_at, gi.rejected_at,
                  u.name as invitee_name
           FROM game_invitations gi
           LEFT JOIN users u ON u.id = gi.invitee_id
           WHERE gi.id = $1`,
          [invitationId],
        );

        if (updatedInvitation.rowCount && updatedInvitation.rowCount > 0) {
          const inv = updatedInvitation.rows[0];

          // إرسال تحديث بسيط
          const inviterSocket = Array.from(connectedUsers.values()).find(
            (u) => u.userId === inviterId,
          );
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
              const refInv = await pool.query(
                `SELECT id, inviter_id, lesson_ids, selected_lessons, created_at, questions_count, expires_at
                 FROM game_invitations 
                 WHERE id = $1`,
                [invitationId],
              );

              if (refInv.rowCount && refInv.rowCount > 0) {
                const refInvData = refInv.rows[0];
                const createdAtStart = new Date(new Date(refInvData.created_at).getTime() - 10000);
                const createdAtEnd = new Date(new Date(refInvData.created_at).getTime() + 10000);

                const groupInvitations = await pool.query(
                  `SELECT gi.id, gi.invitee_id, gi.status, gi.created_at, gi.expires_at, 
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
                   ORDER BY gi.created_at DESC, gi.id`,
                  [inviterId, createdAtStart, createdAtEnd, refInvData.questions_count],
                );

                const invitations = groupInvitations.rows.map((inv) => {
                  let statusMessage = '';
                  if (inv.current_status === 'pending') {
                    statusMessage = 'في انتظار الرد';
                  } else if (inv.current_status === 'accepted') {
                    statusMessage = 'تم قبول الدعوة';
                  } else if (inv.current_status === 'rejected') {
                    statusMessage = 'تم رفض الدعوة';
                  } else if (inv.current_status === 'expired') {
                    statusMessage = 'الدعوة منتهية الصلاحية';
                  }

                  const lessonIds = inv.lesson_ids || inv.selected_lessons || [];
                  const lessonIdsArray = Array.isArray(lessonIds)
                    ? lessonIds
                      .map((id: any) => parseInt(String(id)))
                      .filter((id: number) => !isNaN(id))
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
                let lessonNames: { id: number; name: string }[] = [];
                if (allLessonIds.length > 0) {
                  const lessonsResult = await pool.query(
                    `SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`,
                    [allLessonIds],
                  );
                  lessonNames = lessonsResult.rows.map((lesson: any) => ({
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

                const canStartGame =
                  summary.accepted > 0 &&
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
      } catch (error) {
        console.error('Error emitting invitation status update:', error);
      }
    };

    // Helper function to emit latest incoming invitation update to invitee
    (app as any).emitLatestIncomingUpdate = async (inviteeId: number) => {
      try {
        // جلب آخر دعوة واردة
        const latestInvitation = await pool.query(
          `SELECT gi.id, gi.inviter_id, gi.invitee_id, gi.questions_count, gi.status,
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
           LIMIT 1`,
          [inviteeId],
        );

        const inviteeSocket = Array.from(connectedUsers.values()).find(
          (u) => u.userId === inviteeId,
        );

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
            } else {
              const invitation = latestInvitation.rows[0];

              // معالجة lesson_ids
              const rawDbCheck = await pool.query(
                `SELECT id, lesson_ids, selected_lessons 
                 FROM game_invitations 
                 WHERE id = $1::INTEGER`,
                [invitation.id],
              );

              const rawData = rawDbCheck.rows[0];
              let lessonIds: any[] = [];

              if (rawData) {
                if (rawData.lesson_ids !== null && rawData.lesson_ids !== undefined) {
                  if (Array.isArray(rawData.lesson_ids)) {
                    lessonIds = rawData.lesson_ids;
                  } else {
                    try {
                      const parsed = JSON.parse(rawData.lesson_ids);
                      if (Array.isArray(parsed)) {
                        lessonIds = parsed;
                      }
                    } catch {
                      // ignore parse error
                    }
                  }
                }

                if (
                  lessonIds.length === 0 &&
                  rawData.selected_lessons !== null &&
                  rawData.selected_lessons !== undefined
                ) {
                  if (Array.isArray(rawData.selected_lessons)) {
                    lessonIds = rawData.selected_lessons;
                  }
                }
              }

              if (lessonIds.length === 0) {
                if (invitation.lesson_ids && Array.isArray(invitation.lesson_ids)) {
                  lessonIds = invitation.lesson_ids;
                } else if (
                  invitation.selected_lessons &&
                  Array.isArray(invitation.selected_lessons)
                ) {
                  lessonIds = invitation.selected_lessons;
                }
              }

              const lessonIdsArray = lessonIds
                .map((id: any) => {
                  if (typeof id === 'number') {
                    return id;
                  }
                  if (typeof id === 'string') {
                    const parsed = parseInt(id);
                    return isNaN(parsed) ? null : parsed;
                  }
                  return null;
                })
                .filter((id: number | null): id is number => id !== null);

              // جلب أسماء الدروس
              let lessonNames: { id: number; name: string }[] = [];
              if (lessonIdsArray.length > 0) {
                try {
                  const lessonsResult = await pool.query(
                    `SELECT id, name FROM lessons WHERE id = ANY($1::INTEGER[])`,
                    [lessonIdsArray],
                  );
                  lessonNames = lessonsResult.rows.map((lesson: any) => ({
                    id: parseInt(lesson.id),
                    name: lesson.name,
                  }));
                } catch (error) {
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
      } catch (error) {
        console.error('Error emitting latest incoming invitation update:', error);
      }
    };

    // Graceful shutdown
    const shutdown = () => {
      logger.info('Received shutdown signal. Closing server...');
      server.close(() => {
        logger.info('HTTP server closed.');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

