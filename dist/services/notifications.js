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
exports.NotificationService = void 0;
exports.setIOGetter = setIOGetter;
exports.emitLectureLockUpdated = emitLectureLockUpdated;
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const ExpoPushService = __importStar(require("./expoPushService"));
// Function to get Socket.IO instance
let getIOInstance = null;
function setIOGetter(getter) {
    getIOInstance = getter;
}
function getIO() {
    return getIOInstance ? getIOInstance() : null;
}
/** إرسال حدث لتحديث قفل المحاضرات للطالب (بعد ظهور نتيجة امتحان محاضرة) */
function emitLectureLockUpdated(studentId, courseId) {
    const io = getIO();
    if (io) {
        io.to(`user:${studentId}`).emit('lecture-lock-updated', { courseId });
    }
}
// Broadcast notification to user via Socket.IO
function broadcastNotification(userId, notification) {
    const io = getIO();
    if (io) {
        io.to(`user:${userId}`).emit('notification:new', notification);
        console.log(`📡 [Real-time] Broadcast notification to user:${userId} - ${notification.notification_type}`);
    }
    else {
        console.log(`⚠️ [Real-time] Socket.IO not available, skipping broadcast for user ${userId}`);
    }
}
// Broadcast remove-notification event (for ended live streams)
function broadcastNotificationRemoved(userId, notificationId) {
    const io = getIO();
    if (io) {
        io.to(`user:${userId}`).emit('notification:remove', {
            id: `notification_${notificationId}`,
            notification_type: 'live_stream_started',
        });
    }
}
class NotificationService {
    /**
     * إرسال إشعار لجميع الطلاب المشتركين في كورس معين
     */
    static async notifyCourseStudents(courseId, notificationData) {
        try {
            // جلب الطلاب المشتركين في الكورس (نشط وغير محظور فقط)
            const studentsResult = await pool_1.default.query(`SELECT user_id FROM enrollments
         WHERE course_id = $1
           AND (subscription_status IS NULL OR subscription_status = 'active')
           AND (is_blocked_by_teacher IS NULL OR is_blocked_by_teacher = false)`, [courseId]);
            console.log(`📢 [Notification] Course ${courseId}: Found ${studentsResult.rowCount || 0} enrolled students`);
            console.log(`📢 [Notification] Type: ${notificationData.type}, Title: ${notificationData.title}`);
            console.log(`📢 [Notification] Message: ${notificationData.message}`);
            if (studentsResult.rowCount === 0) {
                console.log(`⚠️ [Notification] No students enrolled in course ${courseId}`);
                return { success: true, notifiedCount: 0 };
            }
            console.log(`📋 [Notification] Student IDs: ${studentsResult.rows.map((r) => r.user_id).join(', ')}`);
            const notifications = studentsResult.rows.map((student) => ({
                user_id: student.user_id,
                ...notificationData,
                course_id: courseId,
            }));
            // إدخال الإشعارات في قاعدة البيانات (واحد تلو الآخر لضمان دعم جميع الحقول)
            const hasMetadata = notificationData.metadata != null || notificationData.meeting_id != null;
            const metadataPayload = notificationData.metadata
                ? { ...notificationData.metadata, ...(notificationData.meeting_id && { meeting_id: notificationData.meeting_id }) }
                : notificationData.meeting_id
                    ? { meeting_id: notificationData.meeting_id }
                    : null;
            let insertedCount = 0;
            for (const notification of notifications) {
                try {
                    const insertResult = hasMetadata
                        ? await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, course_id, lecture_id, exam_id, metadata) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb) RETURNING *`, [
                            notification.user_id,
                            notification.title,
                            notification.message,
                            notification.type,
                            notification.course_id || null,
                            notification.lecture_id || null,
                            notification.exam_id || null,
                            JSON.stringify(metadataPayload),
                        ])
                        : await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, course_id, lecture_id, exam_id) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [
                            notification.user_id,
                            notification.title,
                            notification.message,
                            notification.type,
                            notification.course_id || null,
                            notification.lecture_id || null,
                            notification.exam_id || null,
                        ]);
                    // Broadcast real-time notification
                    const insertedNotification = insertResult.rows[0];
                    const broadcastPayload = {
                        id: `notification_${insertedNotification.id}`,
                        type: 'notification',
                        notification_type: notification.type,
                        title: insertedNotification.title,
                        message: insertedNotification.message,
                        course_id: insertedNotification.course_id,
                        lecture_id: insertedNotification.lecture_id,
                        exam_id: insertedNotification.exam_id,
                        is_read: insertedNotification.is_read,
                        created_at: insertedNotification.created_at,
                    };
                    if (insertedNotification.metadata)
                        broadcastPayload.metadata = insertedNotification.metadata;
                    if (notificationData.meeting_id)
                        broadcastPayload.meeting_id = notificationData.meeting_id;
                    broadcastNotification(notification.user_id, broadcastPayload);
                    insertedCount++;
                }
                catch (insertError) {
                    console.error(`❌ [Notification] Failed to insert notification for user ${notification.user_id}:`, insertError);
                }
            }
            console.log(`✅ [Notification] Inserted ${insertedCount} notifications for course ${courseId}`);
            // إرسال push notifications (OneSignal للويب)
            const pushPayload = {
                type: notificationData.type,
                course_id: courseId,
                lecture_id: notificationData.lecture_id || undefined,
                exam_id: notificationData.exam_id || undefined,
            };
            if (notificationData.meeting_id)
                pushPayload.meeting_id = notificationData.meeting_id;
            try {
                const externalUserIds = notifications.map((n) => n.user_id);
                await (0, utils_1.sendPushNotification)(externalUserIds, notificationData.title, notificationData.message, pushPayload);
                console.log(`📱 [Notification] Push notifications sent to ${externalUserIds.length} users`);
            }
            catch (pushError) {
                console.error('❌ [Notification] Error sending push notifications:', pushError);
                // لا نوقف العملية إذا فشل push notification
            }
            // إرسال Expo Push للموبايل (إضافة فقط، لا يؤثر على الويب)
            ExpoPushService.sendPushNotificationToMany(notifications.map((n) => n.user_id), notificationData.title, notificationData.message, {
                type: notificationData.type,
                course_id: courseId,
                lecture_id: notificationData.lecture_id || undefined,
                meeting_id: notificationData.meeting_id || undefined,
                exam_id: notificationData.exam_id || undefined,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notifiedCount: insertedCount };
        }
        catch (error) {
            console.error('خطأ في إرسال الإشعارات:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار واحد
     */
    static async sendNotification(userId, title, message, type, courseId, lectureId, postId, commentId, senderId, groupId, generalCourseId, description) {
        try {
            const result = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, description, type, course_id, general_course_id, lecture_id, post_id, comment_id, sender_id, group_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`, [
                userId,
                title,
                message,
                description || null,
                type,
                courseId || null,
                generalCourseId || null,
                lectureId || null,
                postId || null,
                commentId || null,
                senderId || null,
                groupId || null,
            ]);
            // Broadcast real-time notification
            const notification = result.rows[0];
            broadcastNotification(userId, {
                id: `notification_${notification.id}`,
                type: 'notification',
                notification_type: type,
                title: notification.title,
                message: notification.message,
                description: notification.description,
                course_id: notification.course_id,
                general_course_id: notification.general_course_id,
                lecture_id: notification.lecture_id,
                exam_id: notification.exam_id,
                video_id: notification.video_id,
                is_read: notification.is_read,
                created_at: notification.created_at,
            });
            // Expo Push للموبايل (إضافة فقط)
            ExpoPushService.sendPushNotification(userId, title, message, {
                type,
                course_id: courseId,
                general_course_id: generalCourseId,
                lecture_id: lectureId,
                post_id: postId,
                comment_id: commentId,
                sender_id: senderId,
                group_id: groupId,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notification: result.rows[0] };
        }
        catch (error) {
            console.error('خطأ في إرسال الإشعار:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إشعار متعلق بمهمة (يُخزَّن task_id للتوسعة والفلترة لاحقاً)
     */
    static async notifyUserAboutTask(userId, taskId, title, message, type, description) {
        try {
            const result = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, description, type, task_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`, [userId, title, message, description || null, type, taskId]);
            const notification = result.rows[0];
            broadcastNotification(userId, {
                id: `notification_${notification.id}`,
                type: 'notification',
                notification_type: type,
                title: notification.title,
                message: notification.message,
                description: notification.description,
                task_id: notification.task_id,
                is_read: notification.is_read,
                created_at: notification.created_at,
            });
            ExpoPushService.sendPushNotification(userId, title, message, {
                type,
                task_id: taskId,
            }).catch((e) => console.error('❌ [Notification] Expo push error (task):', e));
            return { success: true, notification: result.rows[0] };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعار المهمة:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * تذكير يومي للمدرسين لاستخدام مساعد توليد المنشورات والتصميمات.
     */
    static async notifyTeacherCreativeReminder(userId) {
        const title = 'مساعد السوشيال ميديا جاهز لك';
        const message = 'ابدأ يومك بفكرة منشور أو تصميم جديد لطلابك. افتح مساعد المدرسين الإبداعي واكتب المطلوب بالعربي.';
        const description = 'تذكير يومي لاستخدام مساعد توليد المنشورات والتصميمات للمدرسين';
        const metadata = {
            target: 'teacher_creative_chatbot',
            route: '/teacher/creative-chatbot',
            actions: ['post', 'image'],
        };
        try {
            const result = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, description, type, metadata)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         RETURNING *`, [
                userId,
                title,
                message,
                description,
                'teacher_creative_reminder',
                JSON.stringify(metadata),
            ]);
            const notification = result.rows[0];
            broadcastNotification(userId, {
                id: `notification_${notification.id}`,
                type: 'notification',
                notification_type: 'teacher_creative_reminder',
                title: notification.title,
                message: notification.message,
                description: notification.description,
                metadata: notification.metadata,
                is_read: notification.is_read,
                created_at: notification.created_at,
            });
            ExpoPushService.sendPushNotification(userId, title, message, {
                type: 'teacher_creative_reminder',
                ...metadata,
            }).catch((e) => console.error('❌ [Notification] Expo push error (teacher creative):', e));
            return { success: true, notification };
        }
        catch (error) {
            console.error('خطأ في إرسال تذكير مساعد المدرسين الإبداعي:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار عند إضافة محاضرة جديدة
     */
    static async notifyLectureAdded(courseId, lectureId, lectureTitle, courseTitle) {
        const notificationData = {
            title: 'محاضرة جديدة',
            message: `تم إضافة محاضرة جديدة "${lectureTitle}" في كورس "${courseTitle}"`,
            type: 'lecture_added',
            lecture_id: lectureId,
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة فيديو جديد
     */
    static async notifyVideoAdded(courseId, lectureId, videoTitle, lectureTitle, courseTitle) {
        const notificationData = {
            title: 'فيديو جديد',
            message: `تم إضافة فيديو جديد "${videoTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`,
            type: 'video_added',
            lecture_id: lectureId,
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة ملف PDF جديد
     */
    static async notifyFileAdded(courseId, lectureId, fileName, lectureTitle, courseTitle) {
        const notificationData = {
            title: 'ملف جديد',
            message: `تم إضافة ملف جديد "${fileName}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`,
            type: 'file_added',
            lecture_id: lectureId,
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * إرسال إشعار للتفاعلات الاجتماعية
     */
    static async notifySocialInteraction(userId, postId, commentId, actorName, content, actionType, senderId) {
        try {
            let title;
            let message;
            let type;
            switch (actionType) {
                case 'comment':
                    title = 'تعليق جديد';
                    message = `${actorName} علق على منشورك: ${content.length > 50 ? content.substring(0, 50) + '...' : content}`;
                    type = 'social_comment';
                    break;
                case 'reply':
                    title = 'رد جديد';
                    message = `${actorName} رد على تعليقك: ${content.length > 50 ? content.substring(0, 50) + '...' : content}`;
                    type = 'social_reply';
                    break;
                case 'like':
                    title = 'إعجاب جديد';
                    message = `${actorName} أعجب بمنشورك`;
                    type = 'social_like';
                    break;
                case 'reaction':
                    title = 'تفاعل جديد';
                    message = `${actorName} تفاعل مع تعليقك`;
                    type = 'social_reaction';
                    break;
                default:
                    return { success: false, error: 'Invalid action type' };
            }
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const notificationData = {
                user_id: userId,
                title,
                message,
                type,
                post_id: postId || undefined,
                comment_id: commentId || undefined,
                sender_id: senderId || undefined,
            };
            const result = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, post_id, comment_id, sender_id) 
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`, [userId, title, message, type, postId, commentId, senderId]);
            await (0, utils_1.sendPushNotification)([userId], title, message, {
                type,
                post_id: postId,
                comment_id: commentId,
                sender_id: senderId,
            });
            ExpoPushService.sendPushNotification(userId, title, message, {
                type,
                post_id: postId,
                comment_id: commentId,
                sender_id: senderId,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notification: result.rows[0] };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعار التفاعل الاجتماعي:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لجميع أعضاء المجموعة عند إرسال رسالة
     * messageId اختياري لاستخدامه في البث الفوري (notifications:message)
     */
    static async notifyGroupMessage(groupId, senderId, senderName, messageText, groupName, messageId) {
        try {
            // جلب جميع أعضاء المجموعة عدا المرسل
            const membersResult = await pool_1.default.query('SELECT user_id FROM chat_group_members WHERE group_id = $1 AND user_id != $2', [groupId, senderId]);
            if (membersResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            const io = getIO();
            // معالجة كل عضو على حدة
            for (const member of membersResult.rows) {
                // البحث عن إشعار غير مقروء من نفس المجموعة
                const existingNotification = await pool_1.default.query(`SELECT id, message, metadata FROM notifications 
           WHERE user_id = $1 AND group_id = $2 AND type = 'group_message' AND is_read = false
           ORDER BY created_at DESC LIMIT 1`, [member.user_id, groupId]);
                if (existingNotification.rowCount && existingNotification.rowCount > 0) {
                    // تحديث الإشعار الموجود
                    const existing = existingNotification.rows[0];
                    const existingMetadata = existing.metadata
                        ? typeof existing.metadata === 'string'
                            ? JSON.parse(existing.metadata)
                            : existing.metadata
                        : {};
                    const messageCount = (existingMetadata.message_count || 1) + 1;
                    const updatedMessage = messageCount === 2
                        ? `لديك رسالتان جديدتان في ${groupName}`
                        : `لديك ${messageCount} رسائل جديدة في ${groupName}`;
                    const updatedMetadata = {
                        ...existingMetadata,
                        message_count: messageCount,
                        last_sender: senderName,
                        last_message: messageText.length > 30 ? messageText.substring(0, 30) + '...' : messageText,
                        group_name: groupName,
                    };
                    await pool_1.default.query(`UPDATE notifications 
             SET message = $1, metadata = $2, sender_id = $3, created_at = NOW()
             WHERE id = $4`, [updatedMessage, JSON.stringify(updatedMetadata), senderId, existing.id]);
                    await (0, utils_1.sendPushNotification)([member.user_id], 'رسالة جديدة في المجموعة', updatedMessage, {
                        type: 'group_message',
                        group_id: groupId,
                        sender_id: senderId,
                    });
                    ExpoPushService.sendPushNotification(member.user_id, 'رسالة جديدة في المجموعة', updatedMessage, { type: 'group_message', group_id: groupId, sender_id: senderId }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
                    if (io) {
                        const body = messageText.length > 120 ? messageText.slice(0, 120) + '...' : messageText;
                        io.to(`user:${member.user_id}`).emit('notifications:message', {
                            notification: {
                                id: `chat_${groupId}`,
                                type: 'chat_message',
                                title: `رسالة من ${senderName}`,
                                body,
                                sender_name: senderName,
                                created_at: new Date().toISOString(),
                                unread_count: messageCount,
                                is_unread: true,
                                data: { type: 'group_message', group_id: groupId, sender_id: senderId, message_id: messageId },
                                chat_group_id: groupId,
                                group_name: groupName,
                            },
                        });
                    }
                }
                else {
                    // إنشاء إشعار جديد
                    const notificationData = {
                        user_id: member.user_id,
                        title: 'رسالة جديدة في المجموعة',
                        message: `${senderName}: ${messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText}`,
                        type: 'group_message',
                        group_id: groupId,
                        sender_id: senderId,
                    };
                    await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, group_id, sender_id, metadata) 
             VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                        notificationData.user_id,
                        notificationData.title,
                        notificationData.message,
                        notificationData.type,
                        notificationData.group_id,
                        notificationData.sender_id,
                        JSON.stringify({
                            message_count: 1,
                            last_sender: senderName,
                            last_message: messageText.length > 30 ? messageText.substring(0, 30) + '...' : messageText,
                            group_name: groupName,
                        }),
                    ]);
                    await (0, utils_1.sendPushNotification)([member.user_id], notificationData.title, notificationData.message, {
                        type: 'group_message',
                        group_id: groupId,
                        sender_id: senderId,
                    });
                    ExpoPushService.sendPushNotification(member.user_id, notificationData.title, notificationData.message, { type: 'group_message', group_id: groupId, sender_id: senderId }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
                    if (io) {
                        const body = messageText.length > 120 ? messageText.slice(0, 120) + '...' : messageText;
                        io.to(`user:${member.user_id}`).emit('notifications:message', {
                            notification: {
                                id: `chat_${groupId}`,
                                type: 'chat_message',
                                title: `رسالة من ${senderName}`,
                                body,
                                sender_name: senderName,
                                created_at: new Date().toISOString(),
                                unread_count: 1,
                                is_unread: true,
                                data: { type: 'group_message', group_id: groupId, sender_id: senderId, message_id: messageId },
                                chat_group_id: groupId,
                                group_name: groupName,
                            },
                        });
                    }
                }
            }
            return { success: true, notifiedCount: membersResult.rowCount };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات المجموعة:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * جلب إشعارات المستخدم (يشمل إشعارات الرسائل)
     * يضمن أن الطلاب يرون فقط إشعارات الكورسات/الباقات/المجموعات المشتركين فيها
     */
    static async getUserNotifications(userId, limit = 20, offset = 0, userRole) {
        try {
            // جلب الإشعارات العادية من جدول notifications
            // للطلاب: فلترة الإشعارات بناءً على الاشتراكات
            let query = `
        SELECT 
          n.id,
          n.title,
          n.message,
          n.description,
          n.type,
          n.course_id,
          n.general_course_id,
          n.lecture_id,
          n.post_id,
          n.comment_id,
          n.group_id,
          n.sender_id,
          n.package_id,
          n.subject_id,
          n.lesson_id,
          n.assignment_id,
          n.exam_id,
          n.video_id,
          n.metadata,
          n.is_read,
          n.created_at,
          c.title as course_title,
          l.title as lecture_title,
          cg.name as group_name,
          gc.title as general_course_title,
          CASE WHEN u.role = 'admin' THEN 'EM Academy' ELSE u.name END as sender_name
         FROM notifications n
         LEFT JOIN courses c ON n.course_id = c.id
         LEFT JOIN lectures l ON n.lecture_id = l.id
         LEFT JOIN chat_groups cg ON n.group_id = cg.id
         LEFT JOIN general_courses gc ON n.general_course_id = gc.id
         LEFT JOIN users u ON n.sender_id = u.id
         WHERE n.user_id = $1
      `;
            // للطلاب: إضافة فلترة للاشتراكات
            if (userRole === 'student') {
                query += `
          AND (
            -- إشعارات الكورسات العادية: فقط إذا كان الطالب مشترك
            (n.course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM enrollments e WHERE e.user_id = $1 AND e.course_id = n.course_id
            ))
            OR
            -- إشعارات الكورسات العامة: فقط إذا كان الطالب مشترك
            (n.general_course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM general_course_enrollments gce 
              WHERE gce.student_id = $1 AND gce.general_course_id = n.general_course_id
            ))
            OR
            -- إشعارات الباقات: فقط إذا كان الطالب مشترك
            (n.package_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM package_activations pa 
              WHERE pa.student_id = $1 AND pa.package_id = n.package_id 
              AND pa.is_active = TRUE AND pa.activation_code_id IS NOT NULL
            ))
            OR
            -- إشعارات المجموعات: فقط إذا كان الطالب عضو
            (n.group_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM chat_group_members cgm 
              WHERE cgm.user_id = $1 AND cgm.group_id = n.group_id
            ))
            OR
            -- إشعارات الرسائل المباشرة (direct_message): دائماً مرئية
            (n.type = 'direct_message')
            OR
            -- إشعارات اجتماعية (social_*): دائماً مرئية
            (n.type LIKE 'social_%')
            OR
            -- إشعارات لا ترتبط بكيان محدد
            (n.course_id IS NULL AND n.general_course_id IS NULL AND n.package_id IS NULL AND n.group_id IS NULL)
          )
        `;
            }
            query += ` ORDER BY n.created_at DESC`;
            console.log(`📋 [Notifications] Fetching notifications for user ${userId} (role: ${userRole || 'unknown'})`);
            const regularNotifications = await pool_1.default.query(query, [userId]);
            console.log(`📋 [Notifications] Found ${regularNotifications.rowCount || 0} notifications`);
            // تحويل الإشعارات العادية إلى الصيغة المطلوبة
            const regularNotifs = regularNotifications.rows.map((row) => ({
                id: `notification_${row.id}`,
                type: 'notification',
                notification_type: row.type,
                title: row.title,
                message: row.message,
                description: row.description,
                course_id: row.course_id,
                general_course_id: row.general_course_id,
                lecture_id: row.lecture_id,
                post_id: row.post_id,
                comment_id: row.comment_id,
                group_id: row.group_id,
                sender_id: row.sender_id,
                package_id: row.package_id,
                subject_id: row.subject_id,
                lesson_id: row.lesson_id,
                assignment_id: row.assignment_id,
                exam_id: row.exam_id,
                video_id: row.video_id,
                metadata: row.metadata
                    ? typeof row.metadata === 'string'
                        ? JSON.parse(row.metadata)
                        : row.metadata
                    : null,
                is_read: row.is_read,
                created_at: row.created_at,
                course_title: row.course_title,
                general_course_title: row.general_course_title,
                lecture_title: row.lecture_title,
                group_name: row.group_name,
                sender_name: row.sender_name,
            }));
            // جلب إشعارات الرسائل (للطلاب والمدرسين فقط)
            let chatNotifs = [];
            if (userRole === 'student' || userRole === 'teacher') {
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { ChatService } = await import('./chat');
                    const chatNotifications = await ChatService.getChatNotifications({
                        userId,
                        role: userRole,
                        limit: 100, // جلب كل إشعارات الرسائل
                        offset: 0,
                        unreadOnly: false,
                    });
                    // تحويل إشعارات الرسائل إلى الصيغة المطلوبة
                    chatNotifs = chatNotifications.items
                        .filter((item) => (item.unread_count ?? 0) > 0) // فقط الجروبات اللي فيها رسائل غير مقروءة
                        .map((item) => {
                        const unreadCount = item.unread_count || 0;
                        const lastMsg = item.last_message;
                        const otherUser = item.other_user;
                        // تحديد نص الرسالة
                        let messageText = '';
                        if (lastMsg) {
                            if (lastMsg.text) {
                                messageText = lastMsg.text;
                            }
                            else if (lastMsg.attachment_type === 'image') {
                                messageText = 'صورة';
                            }
                            else if (lastMsg.attachment_type === 'audio') {
                                messageText = 'رسالة صوتية';
                            }
                            else if (lastMsg.attachment_type === 'file') {
                                messageText = 'ملف';
                            }
                            else {
                                messageText = 'رسالة';
                            }
                        }
                        // للمدرس: "لديك عدد 2 رسالة من محمد"
                        // للطالب: "أرسل لك مستر: عمرو مثلا رسالتين"
                        if (userRole === 'teacher') {
                            const studentName = otherUser?.name || 'طالب';
                            return {
                                id: `chat_${item.chat_group_id}`,
                                type: 'chat_message',
                                notification_type: 'رسالة من طالب',
                                title: `لديك ${unreadCount} ${unreadCount === 1 ? 'رسالة' : 'رسالة'} من ${studentName}`,
                                message: messageText || 'رسالة جديدة',
                                chat_group_id: item.chat_group_id,
                                sender_id: otherUser?.id,
                                sender_name: studentName,
                                sender_avatar: otherUser?.avatar,
                                unread_count: unreadCount,
                                created_at: lastMsg?.created_at || new Date().toISOString(),
                                is_read: false,
                            };
                        }
                        else {
                            // للطالب
                            const teacherName = otherUser?.name || 'مدرس';
                            const teacherTitle = teacherName.includes('مستر') || teacherName.includes('أستاذ')
                                ? teacherName
                                : `مستر: ${teacherName}`;
                            return {
                                id: `chat_${item.chat_group_id}`,
                                type: 'chat_message',
                                notification_type: 'رسالة من مدرس',
                                title: `أرسل لك ${teacherTitle} ${unreadCount} ${unreadCount === 1 ? 'رسالة' : 'رسالة'}`,
                                message: messageText || 'رسالة جديدة',
                                chat_group_id: item.chat_group_id,
                                sender_id: otherUser?.id,
                                sender_name: teacherName,
                                sender_avatar: otherUser?.avatar,
                                unread_count: unreadCount,
                                created_at: lastMsg?.created_at || new Date().toISOString(),
                                is_read: false,
                            };
                        }
                    });
                }
                catch (chatError) {
                    console.error('خطأ في جلب إشعارات الرسائل:', chatError);
                    // نستمر حتى لو فشل جلب إشعارات الرسائل
                }
            }
            // دمج الإشعارات وترتيبها حسب التاريخ
            const allNotifications = [...regularNotifs, ...chatNotifs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            // تطبيق pagination
            const paginatedNotifications = allNotifications.slice(offset, offset + limit);
            return {
                success: true,
                notifications: paginatedNotifications,
                total: allNotifications.length,
            };
        }
        catch (error) {
            console.error('خطأ في جلب الإشعارات:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * جلب إشعارات بدء البث المباشر فقط (live_stream_started)
     */
    static async getLiveStreamNotifications(userId, limit = 20, offset = 0, userRole) {
        try {
            let query = `
        SELECT 
          n.id,
          n.title,
          n.message,
          n.description,
          n.type,
          n.course_id,
          n.general_course_id,
          n.lecture_id,
          n.metadata,
          n.is_read,
          n.created_at,
          c.title as course_title,
          gc.title as general_course_title
         FROM notifications n
         LEFT JOIN courses c ON n.course_id = c.id
         LEFT JOIN general_courses gc ON n.general_course_id = gc.id
         WHERE n.user_id = $1
           AND n.type = 'live_stream_started'
      `;
            if (userRole === 'student') {
                query += `
          AND (
            (n.course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM enrollments e WHERE e.user_id = $1 AND e.course_id = n.course_id
            ))
            OR
            (n.general_course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM general_course_enrollments gce 
              WHERE gce.student_id = $1 AND gce.general_course_id = n.general_course_id
            ))
          )
        `;
            }
            // إذا انتهى اللايف، لا نظهر إشعاره في API الخاص باللايف
            query += `
        AND (
          n.metadata IS NULL
          OR n.metadata->>'meeting_id' IS NULL
          OR EXISTS (
            SELECT 1 FROM meeting m
            WHERE m.id::text = n.metadata->>'meeting_id'
              AND m.status != 'ended'
          )
          OR EXISTS (
            SELECT 1 FROM general_course_group_meeting gm
            WHERE gm.id::text = n.metadata->>'meeting_id'
              AND gm.status != 'ended'
          )
        )
      `;
            query += ` ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`;
            const notificationsRes = await pool_1.default.query(query, [userId, limit, offset]);
            let countQuery = `
        SELECT COUNT(*)::int AS total
        FROM notifications n
        WHERE n.user_id = $1
          AND n.type = 'live_stream_started'
      `;
            if (userRole === 'student') {
                countQuery += `
          AND (
            (n.course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM enrollments e WHERE e.user_id = $1 AND e.course_id = n.course_id
            ))
            OR
            (n.general_course_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM general_course_enrollments gce 
              WHERE gce.student_id = $1 AND gce.general_course_id = n.general_course_id
            ))
          )
        `;
            }
            countQuery += `
        AND (
          n.metadata IS NULL
          OR n.metadata->>'meeting_id' IS NULL
          OR EXISTS (
            SELECT 1 FROM meeting m
            WHERE m.id::text = n.metadata->>'meeting_id'
              AND m.status != 'ended'
          )
          OR EXISTS (
            SELECT 1 FROM general_course_group_meeting gm
            WHERE gm.id::text = n.metadata->>'meeting_id'
              AND gm.status != 'ended'
          )
        )
      `;
            const countRes = await pool_1.default.query(countQuery, [userId]);
            const notifications = notificationsRes.rows.map((row) => ({
                id: `notification_${row.id}`,
                type: 'notification',
                notification_type: row.type,
                title: row.title,
                message: row.message,
                description: row.description,
                course_id: row.course_id,
                general_course_id: row.general_course_id,
                lecture_id: row.lecture_id,
                metadata: row.metadata
                    ? typeof row.metadata === 'string'
                        ? JSON.parse(row.metadata)
                        : row.metadata
                    : null,
                meeting_id: row.metadata && typeof row.metadata === 'object' ? row.metadata.meeting_id || null : null,
                is_read: row.is_read,
                created_at: row.created_at,
                course_title: row.course_title,
                general_course_title: row.general_course_title,
            }));
            return { success: true, notifications, total: countRes.rows[0]?.total || 0 };
        }
        catch (error) {
            console.error('خطأ في جلب إشعارات اللايف:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إشعارات الرسائل الموحّدة للطالب والمدرس (دعم فني + دردشة مباشرة + جروب)
     * تنسيق متوافق مع Expo Push: كل عنصر يحتوي على data بنفس المفاتيح المرسلة في الـ Push
     */
    static async getMessageNotificationsUnified(userId, userRole, limit = 30, offset = 0) {
        const items = [];
        try {
            // 1) إشعارات الدعم الفني (مقروء = دخل الشات وشاف الرسالة)
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { SupportChatService } = await import('./supportChat');
            if (userRole === 'student') {
                const support = await SupportChatService.getMessageNotifications(userId, 'student', 50, 0, false);
                for (const n of support.notifications) {
                    const created = n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString();
                    const isRead = !n.is_unread;
                    items.push({
                        id: `support_student_${n.chat_id}_${n.message_id}`,
                        type: 'student_support',
                        title: 'دعم فني',
                        body: (n.text || '').slice(0, 120) + (n.text && n.text.length > 120 ? '...' : ''),
                        sender_name: n.sender_name || 'رد تلقائي',
                        created_at: created,
                        unread_count: isRead ? 0 : 1,
                        is_unread: n.is_unread,
                        is_read: isRead,
                        read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
                        data: {
                            type: 'student_support_chat',
                            chat_id: n.chat_id,
                            message_id: n.message_id,
                            sender_id: n.sender_id,
                        },
                        chat_id: n.chat_id,
                        message_id: n.message_id,
                    });
                }
            }
            else {
                const support = await SupportChatService.getTeacherSupportNotifications(userId, 50, 0, false);
                for (const n of support.notifications) {
                    const created = n.created_at ? new Date(n.created_at).toISOString() : new Date().toISOString();
                    const isRead = !n.is_unread;
                    items.push({
                        id: `support_teacher_${n.chat_id}_${n.message_id}`,
                        type: 'teacher_support',
                        title: n.sender_name || 'دعم فني',
                        body: (n.text || '').slice(0, 120) + (n.text && n.text.length > 120 ? '...' : ''),
                        sender_name: n.sender_name,
                        created_at: created,
                        unread_count: isRead ? 0 : 1,
                        is_unread: n.is_unread,
                        is_read: isRead,
                        read_at: n.read_at ? new Date(n.read_at).toISOString() : null,
                        data: {
                            type: 'teacher_support_chat',
                            chat_id: n.chat_id,
                            message_id: n.message_id,
                            sender_id: n.sender_id,
                        },
                        chat_id: n.chat_id,
                        message_id: n.message_id,
                    });
                }
            }
            // 2) إشعارات الدردشة (مباشرة + جروب) — متوافقة مع Expo group_message
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            const { ChatService } = await import('./chat');
            const chatNotifs = await ChatService.getChatNotifications({
                userId,
                role: userRole,
                limit: 100,
                offset: 0,
                unreadOnly: false,
            });
            for (const item of chatNotifs.items) {
                const unread = item.unread_count || 0;
                const lastMsg = item.last_message;
                const otherUser = item.other_user;
                const isRead = unread === 0;
                let body = 'رسالة جديدة';
                if (lastMsg) {
                    if (lastMsg.text)
                        body = lastMsg.text.slice(0, 120) + (lastMsg.text.length > 120 ? '...' : '');
                    else if (lastMsg.attachment_type === 'image')
                        body = 'صورة';
                    else if (lastMsg.attachment_type === 'audio')
                        body = 'رسالة صوتية';
                    else if (lastMsg.attachment_type === 'file')
                        body = 'ملف';
                }
                const created = lastMsg?.created_at
                    ? new Date(lastMsg.created_at).toISOString()
                    : new Date().toISOString();
                const senderName = otherUser?.name || (userRole === 'teacher' ? 'طالب' : 'مدرس');
                const title = userRole === 'teacher'
                    ? `لديك ${unread} ${unread === 1 ? 'رسالة' : 'رسالة'} من ${senderName}`
                    : `رسالة من ${senderName}`;
                items.push({
                    id: `chat_${item.chat_group_id}`,
                    type: 'chat_message',
                    title,
                    body,
                    sender_name: senderName,
                    created_at: created,
                    unread_count: unread,
                    is_unread: unread > 0,
                    is_read: isRead,
                    read_at: null,
                    data: {
                        type: 'group_message',
                        group_id: item.chat_group_id,
                        sender_id: lastMsg?.sender_id ?? otherUser?.id,
                        message_id: lastMsg?.id,
                    },
                    chat_group_id: item.chat_group_id,
                    chat_type: item.chat_type,
                    group_name: item.group_name,
                });
            }
            // ترتيب حسب الأحدث
            items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const total = items.length;
            const paginated = items.slice(offset, offset + limit);
            return { notifications: paginated, total };
        }
        catch (err) {
            console.error('getMessageNotificationsUnified error:', err);
            return { notifications: [], total: 0 };
        }
    }
    /**
     * تحديث حالة الإشعار كمقروء
     */
    static async markAsRead(notificationId, userId) {
        try {
            const result = await pool_1.default.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2 RETURNING id', [notificationId, userId]);
            return { success: result.rowCount && result.rowCount > 0 };
        }
        catch (error) {
            console.error('خطأ في تحديث حالة الإشعار:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * تحديث جميع إشعارات المستخدم كمقروءة
     */
    static async markAllAsRead(userId) {
        try {
            await pool_1.default.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [userId]);
            return { success: true };
        }
        catch (error) {
            console.error('خطأ في تحديث جميع الإشعارات:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * جلب عدد الإشعارات غير المقروءة للمستخدم
     */
    static async getUnreadCount(userId) {
        try {
            const result = await pool_1.default.query('SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND is_read = false', [userId]);
            return { success: true, count: parseInt(result.rows[0].count) };
        }
        catch (error) {
            console.error('خطأ في جلب عدد الإشعارات غير المقروءة:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * تغذية الطالب: دوريات ومسابقات جديدة متاحة لصفوفه
     */
    static async getStudentGradeFeed(userId, limit = 20, offset = 0) {
        try {
            const query = `
        (
          SELECT 
            'league' AS type,
            l.id AS item_id,
            l.name AS title,
            COALESCE(l.description, '') AS description,
            l.image_url,
            l.grade_id,
            g.name AS grade_name,
            l.created_at
          FROM leagues l
          JOIN user_grades ug ON ug.grade_id = l.grade_id
          LEFT JOIN grades g ON g.id = l.grade_id
          WHERE ug.user_id = $1
        )
        UNION ALL
        (
          SELECT 
            'competition' AS type,
            c.id AS item_id,
            c.title AS title,
            COALESCE(c.description, '') AS description,
            c.image_url,
            c.grade_id,
            g.name AS grade_name,
            c.created_at
          FROM competitions c
          JOIN user_grades ug ON ug.grade_id = c.grade_id
          LEFT JOIN grades g ON g.id = c.grade_id
          WHERE ug.user_id = $1 AND c.is_visible = TRUE AND c.is_active = TRUE
        )
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
            const result = await pool_1.default.query(query, [userId, limit, offset]);
            return { success: true, feed: result.rows };
        }
        catch (error) {
            console.error('خطأ في جلب تغذية الطالب:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لطلاب الكورس عند إنشاء امتحان مقالي
     */
    static async notifyEssayExamCreated(courseId, examTitle, lectureTitle, createdBy) {
        try {
            // جلب جميع الطلاب المشتركين في الكورس
            const studentsResult = await pool_1.default.query('SELECT user_id FROM enrollments WHERE course_id = $1', [courseId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            // إرسال إشعار لكل طالب
            for (const student of studentsResult.rows) {
                await NotificationService.sendNotification(student.user_id, 'امتحان مقالي جديد', `تم إضافة امتحان مقالي جديد: ${examTitle} في محاضرة ${lectureTitle}`, 'essay_exam_created', courseId, undefined, undefined, undefined, createdBy);
            }
            return { success: true, notifiedCount: studentsResult.rowCount };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات الامتحان المقالي:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لجميع الطلاب المشتركين في الباقة
     */
    static async notifyPackageStudents(packageId, notificationData) {
        try {
            // جلب جميع الطلاب المشتركين في الباقة
            const studentsResult = await pool_1.default.query(`SELECT DISTINCT pa.student_id
         FROM package_activations pa
         WHERE pa.package_id = $1 
           AND pa.is_active = TRUE
           AND pa.activation_code_id IS NOT NULL`, [packageId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            const studentIds = studentsResult.rows.map((row) => row.student_id);
            console.log(`📦 جلب ${studentIds.length} طالب مشترك في الباقة ${packageId}`);
            // إدخال الإشعارات في قاعدة البيانات (واحد تلو الآخر لضمان عدم حدوث أخطاء)
            for (const studentId of studentIds) {
                try {
                    const insertResult = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, package_id, subject_id, lesson_id, assignment_id, exam_id, video_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`, [
                        studentId,
                        notificationData.title,
                        notificationData.message,
                        notificationData.type,
                        packageId,
                        notificationData.subject_id || null,
                        notificationData.lesson_id || null,
                        notificationData.assignment_id || null,
                        notificationData.exam_id || null,
                        notificationData.video_id || null,
                    ]);
                    // Broadcast real-time notification
                    const insertedNotification = insertResult.rows[0];
                    broadcastNotification(studentId, {
                        id: `notification_${insertedNotification.id}`,
                        type: 'notification',
                        notification_type: notificationData.type,
                        title: insertedNotification.title,
                        message: insertedNotification.message,
                        package_id: insertedNotification.package_id,
                        subject_id: insertedNotification.subject_id,
                        lesson_id: insertedNotification.lesson_id,
                        assignment_id: insertedNotification.assignment_id,
                        exam_id: insertedNotification.exam_id,
                        video_id: insertedNotification.video_id,
                        is_read: insertedNotification.is_read,
                        created_at: insertedNotification.created_at,
                    });
                }
                catch (insertError) {
                    console.error(`❌ خطأ في إدخال إشعار للطالب ${studentId}:`, insertError);
                    // نستمر في إرسال الإشعارات للطلاب الآخرين
                }
            }
            // إرسال push notifications (OneSignal)
            try {
                await (0, utils_1.sendPushNotification)(studentIds, notificationData.title, notificationData.message, {
                    type: notificationData.type,
                    package_id: packageId,
                    subject_id: notificationData.subject_id,
                    lesson_id: notificationData.lesson_id,
                    assignment_id: notificationData.assignment_id,
                    exam_id: notificationData.exam_id,
                    video_id: notificationData.video_id,
                });
                console.log(`📱 تم إرسال push notifications لـ ${studentIds.length} طالب`);
            }
            catch (pushError) {
                console.error('❌ خطأ في إرسال push notifications:', pushError);
                // لا نوقف العملية إذا فشل push notification
            }
            ExpoPushService.sendPushNotificationToMany(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                package_id: packageId,
                subject_id: notificationData.subject_id,
                lesson_id: notificationData.lesson_id,
                assignment_id: notificationData.assignment_id,
                exam_id: notificationData.exam_id,
                video_id: notificationData.video_id,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            console.log(`✅ تم إرسال ${studentIds.length} إشعار للطلاب المشتركين في الباقة ${packageId}`);
            return { success: true, notifiedCount: studentIds.length };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات الباقة:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار عند إضافة درس جديد (فقط إذا كان visible)
     */
    static async notifyPackageLessonAdded(packageId, subjectId, lessonId, lessonName, subjectName, isVisible) {
        if (!isVisible) {
            console.log(`⚠️ الدرس "${lessonName}" مخفي، لن يتم إرسال إشعار`);
            return { success: true, notifiedCount: 0, message: 'الدرس مخفي، لن يتم إرسال إشعار' };
        }
        console.log(`📚 إرسال إشعار درس جديد: "${lessonName}" في مادة "${subjectName}" للباقة ${packageId}`);
        const notificationData = {
            title: 'درس جديد',
            message: `تم إضافة درس جديد "${lessonName}" في مادة "${subjectName}"`,
            type: 'package_lesson_added',
            subject_id: subjectId,
            lesson_id: lessonId,
        };
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة فيديو جديد (فقط إذا كان visible)
     */
    static async notifyPackageVideoAdded(packageId, subjectId, lessonId, videoId, videoName, lessonName, subjectName, isVisible) {
        if (!isVisible) {
            console.log(`⚠️ الفيديو "${videoName}" مخفي، لن يتم إرسال إشعار`);
            return { success: true, notifiedCount: 0, message: 'الفيديو مخفي، لن يتم إرسال إشعار' };
        }
        console.log(`🎥 إرسال إشعار فيديو جديد: "${videoName}" في درس "${lessonName}" للباقة ${packageId}`);
        const notificationData = {
            title: 'فيديو جديد',
            message: `تم إضافة فيديو جديد "${videoName}" في درس "${lessonName}" من مادة "${subjectName}"`,
            type: 'package_video_added',
            subject_id: subjectId,
            lesson_id: lessonId,
            video_id: videoId,
        };
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة واجب جديد (فقط إذا كان visible)
     */
    static async notifyPackageAssignmentAdded(packageId, subjectId, lessonId, assignmentId, assignmentName, lessonName, subjectName, isVisible) {
        if (!isVisible) {
            console.log(`⚠️ الواجب "${assignmentName}" مخفي، لن يتم إرسال إشعار`);
            return { success: true, notifiedCount: 0, message: 'الواجب مخفي، لن يتم إرسال إشعار' };
        }
        console.log(`📝 إرسال إشعار واجب جديد: "${assignmentName}" في درس "${lessonName}" للباقة ${packageId}`);
        const notificationData = {
            title: 'واجب جديد',
            message: `تم إضافة واجب جديد "${assignmentName}" في درس "${lessonName}" من مادة "${subjectName}"`,
            type: 'package_assignment_added',
            subject_id: subjectId,
            lesson_id: lessonId,
            assignment_id: assignmentId,
        };
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة امتحان جديد (فقط إذا كان visible)
     */
    static async notifyPackageExamAdded(packageId, subjectId, examId, examName, subjectName, isVisible) {
        if (!isVisible) {
            return { success: true, notifiedCount: 0, message: 'الامتحان مخفي، لن يتم إرسال إشعار' };
        }
        const notificationData = {
            title: 'امتحان جديد',
            message: `تم إضافة امتحان جديد "${examName}" في مادة "${subjectName}"`,
            type: 'package_exam_added',
            subject_id: subjectId,
            exam_id: examId,
        };
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار عند إضافة ملف جديد
     */
    static async notifyPackageFileAdded(packageId, subjectId, fileName, subjectName, lessonId, lessonName) {
        const notificationData = {
            title: 'ملف جديد',
            message: lessonId
                ? `تم إضافة ملف جديد "${fileName}" في درس "${lessonName}" من مادة "${subjectName}"`
                : `تم إضافة ملف جديد "${fileName}" في مادة "${subjectName}"`,
            type: 'package_file_added',
            subject_id: subjectId,
            lesson_id: lessonId || null,
        };
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار عند تحديث امتحان في الباقة
     */
    static async notifyPackageExamUpdated(packageId, subjectId, examId, examName, subjectName) {
        const notificationData = {
            title: 'تحديث امتحان',
            message: `تم تحديث امتحان "${examName}" في مادة "${subjectName}"`,
            type: 'package_exam_added', // Using same type for now
            subject_id: subjectId,
            exam_id: examId,
        };
        return await this.notifyPackageStudents(packageId, notificationData);
    }
    /**
     * إرسال إشعار لطلاب الكورس العام عند إضافة محاضرة
     */
    static async notifyGeneralCourseLectureAdded(generalCourseId, lectureId, lectureTitle) {
        try {
            // جلب جميع الطلاب المشتركين في الكورس العام
            const studentsResult = await pool_1.default.query('SELECT student_id FROM general_course_enrollments WHERE general_course_id = $1', [generalCourseId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            // جلب معلومات الكورس
            const courseResult = await pool_1.default.query('SELECT title FROM general_courses WHERE id = $1', [generalCourseId]);
            const courseTitle = courseResult.rowCount ? courseResult.rows[0].title : 'الكورس';
            const notificationData = {
                title: 'محاضرة جديدة',
                message: `تم إضافة محاضرة جديدة "${lectureTitle}" في كورس "${courseTitle}"`,
                type: 'lecture_added',
                general_course_id: generalCourseId,
            };
            // إرسال إشعار لكل طالب
            for (const student of studentsResult.rows) {
                await this.sendNotification(student.student_id, notificationData.title, notificationData.message, notificationData.type, undefined, // course_id
                lectureId, // lecture_id
                undefined, // post_id
                undefined, // comment_id
                undefined, // sender_id
                undefined, // group_id
                generalCourseId);
            }
            const studentIds = studentsResult.rows.map((row) => row.student_id);
            await (0, utils_1.sendPushNotification)(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                lecture_id: lectureId,
            });
            ExpoPushService.sendPushNotificationToMany(studentIds, notificationData.title, notificationData.message, { type: notificationData.type, general_course_id: generalCourseId, lecture_id: lectureId }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notifiedCount: studentIds.length };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات محاضرة الكورس العام:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لطلاب الكورس العام عند إضافة فيديو
     */
    static async notifyGeneralCourseVideoAdded(generalCourseId, lectureId, videoId, videoTitle, lectureTitle) {
        try {
            const studentsResult = await pool_1.default.query('SELECT student_id FROM general_course_enrollments WHERE general_course_id = $1', [generalCourseId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            const courseResult = await pool_1.default.query('SELECT title FROM general_courses WHERE id = $1', [generalCourseId]);
            const courseTitle = courseResult.rowCount ? courseResult.rows[0].title : 'الكورس';
            const notificationData = {
                title: 'فيديو جديد',
                message: `تم إضافة فيديو جديد "${videoTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`,
                type: 'video_added',
                general_course_id: generalCourseId,
            };
            for (const student of studentsResult.rows) {
                await this.sendNotification(student.student_id, notificationData.title, notificationData.message, notificationData.type, undefined, // course_id
                lectureId, // lecture_id
                undefined, // post_id
                undefined, // comment_id
                undefined, // sender_id
                undefined, // group_id
                generalCourseId);
            }
            const studentIds = studentsResult.rows.map((row) => row.student_id);
            await (0, utils_1.sendPushNotification)(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                lecture_id: lectureId,
                video_id: videoId,
            });
            ExpoPushService.sendPushNotificationToMany(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                lecture_id: lectureId,
                video_id: videoId,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notifiedCount: studentIds.length };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات فيديو الكورس العام:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لطلاب الكورس العام عند إضافة امتحان
     */
    static async notifyGeneralCourseExamAdded(generalCourseId, examId, examTitle, lectureTitle) {
        try {
            const studentsResult = await pool_1.default.query('SELECT student_id FROM general_course_enrollments WHERE general_course_id = $1', [generalCourseId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            const courseResult = await pool_1.default.query('SELECT title FROM general_courses WHERE id = $1', [generalCourseId]);
            const courseTitle = courseResult.rowCount ? courseResult.rows[0].title : 'الكورس';
            const message = lectureTitle
                ? `تم إضافة امتحان جديد "${examTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`
                : `تم إضافة امتحان جديد "${examTitle}" في كورس "${courseTitle}"`;
            const notificationData = {
                title: 'امتحان جديد',
                message,
                type: 'exam_added',
                general_course_id: generalCourseId,
            };
            for (const student of studentsResult.rows) {
                await this.sendNotification(student.student_id, notificationData.title, notificationData.message, notificationData.type, undefined, // course_id
                undefined, // lecture_id
                undefined, // post_id
                undefined, // comment_id
                undefined, // sender_id
                undefined, // group_id
                generalCourseId);
            }
            const studentIds = studentsResult.rows.map((row) => row.student_id);
            await (0, utils_1.sendPushNotification)(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                exam_id: examId,
            });
            return { success: true, notifiedCount: studentIds.length };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات امتحان الكورس العام:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار لطلاب الكورس العام عند تحديث امتحان
     */
    static async notifyGeneralCourseExamUpdated(generalCourseId, examId, examTitle, lectureTitle) {
        try {
            const studentsResult = await pool_1.default.query('SELECT student_id FROM general_course_enrollments WHERE general_course_id = $1', [generalCourseId]);
            if (studentsResult.rowCount === 0) {
                return { success: true, notifiedCount: 0 };
            }
            const courseResult = await pool_1.default.query('SELECT title FROM general_courses WHERE id = $1', [generalCourseId]);
            const courseTitle = courseResult.rowCount ? courseResult.rows[0].title : 'الكورس';
            const message = lectureTitle
                ? `تم تحديث امتحان "${examTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`
                : `تم تحديث امتحان "${examTitle}" في كورس "${courseTitle}"`;
            const notificationData = {
                title: 'تحديث امتحان',
                message,
                type: 'exam_updated',
                general_course_id: generalCourseId,
            };
            for (const student of studentsResult.rows) {
                await this.sendNotification(student.student_id, notificationData.title, notificationData.message, notificationData.type, undefined, // course_id
                undefined, // lecture_id
                undefined, // post_id
                undefined, // comment_id
                undefined, // sender_id
                undefined, // group_id
                generalCourseId);
            }
            const studentIds = studentsResult.rows.map((row) => row.student_id);
            await (0, utils_1.sendPushNotification)(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                exam_id: examId,
            });
            ExpoPushService.sendPushNotificationToMany(studentIds, notificationData.title, notificationData.message, {
                type: notificationData.type,
                general_course_id: generalCourseId,
                exam_id: examId,
            }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            return { success: true, notifiedCount: studentIds.length };
        }
        catch (error) {
            console.error('خطأ في إرسال إشعارات تحديث امتحان الكورس العام:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار عند إضافة امتحان في كورس عادي
     */
    static async notifyExamAdded(courseId, lectureId, examId, examTitle, lectureTitle, courseTitle) {
        const message = lectureTitle
            ? `تم إضافة امتحان جديد "${examTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`
            : `تم إضافة امتحان جديد "${examTitle}" في كورس "${courseTitle}"`;
        const notificationData = {
            title: 'امتحان جديد',
            message,
            type: 'exam_added',
            lecture_id: lectureId,
            exam_id: examId,
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * إرسال إشعار عند تحديث امتحان في كورس عادي
     */
    static async notifyExamUpdated(courseId, lectureId, examId, examTitle, lectureTitle, courseTitle) {
        const message = lectureTitle
            ? `تم تحديث امتحان "${examTitle}" في محاضرة "${lectureTitle}" من كورس "${courseTitle}"`
            : `تم تحديث امتحان "${examTitle}" في كورس "${courseTitle}"`;
        const notificationData = {
            title: 'تحديث امتحان',
            message,
            type: 'exam_updated',
            lecture_id: lectureId,
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * إرسال إشعار عند استلام رسالة مباشرة من مدرس أو أدمن
     */
    static async notifyDirectMessage(recipientId, senderId, senderName, messageText) {
        try {
            const title = 'رسالة جديدة';
            const message = `${senderName}: ${messageText.length > 50 ? messageText.substring(0, 50) + '...' : messageText}`;
            const result = await this.sendNotification(recipientId, title, message, 'direct_message', undefined, // course_id
            undefined, // lecture_id
            undefined, // post_id
            undefined, // comment_id
            senderId, // sender_id
            undefined);
            if (result.success) {
                await (0, utils_1.sendPushNotification)([recipientId], title, message, {
                    type: 'direct_message',
                    sender_id: senderId,
                });
                ExpoPushService.sendPushNotification(recipientId, title, message, {
                    type: 'direct_message',
                    sender_id: senderId,
                }).catch((e) => console.error('❌ [Notification] Expo push error:', e));
            }
            return result;
        }
        catch (error) {
            console.error('خطأ في إرسال إشعار رسالة مباشرة:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار عند إنشاء/بدء بث مباشر في الكورس — للطلاب المشتركين في نفس الكورس فقط (نشط وغير محظور).
     * @param meetingId معرف جلسة اللايف (UUID) لاستخدامه في فتح اللايف من الإشعار
     */
    static async notifyLiveStreamStarted(courseId, meetingTitle, courseTitle, isStarted = false, meetingId) {
        const notificationData = {
            title: isStarted ? 'بث مباشر جديد' : 'بث مباشر قادم',
            message: isStarted
                ? `بدأ المدرس بث مباشر "${meetingTitle}" في كورس "${courseTitle}"`
                : `أنشأ المدرس بث مباشر "${meetingTitle}" في كورس "${courseTitle}"`,
            type: 'live_stream_started',
            course_id: courseId,
            ...(meetingId && { meeting_id: meetingId }),
        };
        return await this.notifyCourseStudents(courseId, notificationData);
    }
    /**
     * حذف إشعارات بدء اللايف المرتبطة بجلسة محددة بعد انتهاء البث + بث حدث realtime لإخفائها من الواجهة.
     */
    static async removeLiveStreamNotificationsByMeetingId(meetingId) {
        try {
            const deleted = await pool_1.default.query(`DELETE FROM notifications
         WHERE type = 'live_stream_started'
           AND metadata->>'meeting_id' = $1
         RETURNING id, user_id`, [meetingId]);
            for (const row of deleted.rows) {
                broadcastNotificationRemoved(row.user_id, row.id);
            }
            return { success: true, removedCount: deleted.rowCount || 0 };
        }
        catch (error) {
            console.error('خطأ في حذف إشعارات اللايف المنتهي:', error);
            return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
        }
    }
    /**
     * إرسال إشعار عند إنشاء/بدء بث مباشر لمجموعة في كورس عام (لطلاب المجموعة فقط)
     */
    static async notifyGeneralCourseGroupLiveStreamStarted(groupId, generalCourseId, meetingTitle, courseTitle, isStarted = false) {
        try {
            const studentsResult = await pool_1.default.query('SELECT student_id FROM general_course_enrollments WHERE group_id = $1', [groupId]);
            if (studentsResult.rowCount === 0)
                return { success: true, notifiedCount: 0 };
            const title = isStarted ? 'بث مباشر جديد' : 'بث مباشر قادم';
            const message = isStarted
                ? `بدأ المدرس بث مباشر "${meetingTitle}" في كورس "${courseTitle}"`
                : `أنشأ المدرس بث مباشر "${meetingTitle}" في كورس "${courseTitle}"`;
            let insertedCount = 0;
            for (const row of studentsResult.rows) {
                const userId = row.student_id;
                try {
                    await this.sendNotification(userId, title, message, 'live_stream_started', undefined, undefined, undefined, undefined, undefined, groupId, generalCourseId);
                    insertedCount++;
                }
                catch (e) {
                    console.error('Error sending group meeting notification to user', userId, e);
                }
            }
            return { success: true, notifiedCount: insertedCount };
        }
        catch (err) {
            console.error('notifyGeneralCourseGroupLiveStreamStarted error:', err);
            return { success: false, notifiedCount: 0 };
        }
    }
}
exports.NotificationService = NotificationService;
