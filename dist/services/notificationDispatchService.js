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
exports.NotificationPushQueue = exports.scheduleWebPushForUsers = exports.scheduleWebPushForUser = exports.NotificationDispatchService = void 0;
exports.setNotificationDispatchIO = setNotificationDispatchIO;
const pool_1 = __importDefault(require("../db/pool"));
const notificationPushQueue_1 = require("./notificationPushQueue");
Object.defineProperty(exports, "NotificationPushQueue", { enumerable: true, get: function () { return notificationPushQueue_1.NotificationPushQueue; } });
const webPushSender_1 = require("./webPushSender");
Object.defineProperty(exports, "scheduleWebPushForUser", { enumerable: true, get: function () { return webPushSender_1.scheduleWebPushForUser; } });
Object.defineProperty(exports, "scheduleWebPushForUsers", { enumerable: true, get: function () { return webPushSender_1.scheduleWebPushForUsers; } });
const ExpoPushService = __importStar(require("./expoPushService"));
const utils_1 = require("../utils");
const utils_2 = require("../utils");
let getIOInstance = null;
function setNotificationDispatchIO(getter) {
    getIOInstance = getter;
}
function broadcastNotification(userId, notification) {
    const io = getIOInstance?.();
    if (io) {
        io.to(`user:${userId}`).emit('notification:new', notification);
    }
}
function toApiRow(row) {
    return {
        id: row.id,
        user_id: row.user_id,
        title: row.title,
        body: row.message,
        message: row.message,
        type: row.type,
        icon: row.icon,
        image: row.image,
        url: row.url,
        is_read: row.is_read,
        course_id: row.course_id,
        lecture_id: row.lecture_id,
        exam_id: row.exam_id,
        metadata: row.metadata,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
class NotificationDispatchService {
    static async dispatchToUser(input) {
        const result = await pool_1.default.query(`INSERT INTO notifications (user_id, title, message, type, icon, image, url, course_id, lecture_id, exam_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`, [
            input.user_id,
            input.title,
            input.body,
            input.type,
            input.icon || null,
            input.image || null,
            input.url || null,
            input.course_id || null,
            input.lecture_id || null,
            input.exam_id || null,
            input.metadata ? JSON.stringify(input.metadata) : null,
        ]);
        const row = result.rows[0];
        const apiRow = toApiRow(row);
        broadcastNotification(input.user_id, {
            id: `notification_${row.id}`,
            type: 'notification',
            notification_type: input.type,
            title: row.title,
            message: row.message,
            body: row.message,
            icon: row.icon,
            image: row.image,
            url: row.url,
            course_id: row.course_id,
            lecture_id: row.lecture_id,
            exam_id: row.exam_id,
            is_read: row.is_read,
            created_at: row.created_at,
        });
        const pushPayload = {
            title: input.title,
            body: input.body,
            icon: input.icon,
            image: input.image,
            url: input.url,
            type: input.type,
            notification_id: row.id,
            data: {
                course_id: input.course_id,
                lecture_id: input.lecture_id,
                exam_id: input.exam_id,
                ...(input.metadata || {}),
            },
        };
        (0, webPushSender_1.scheduleWebPushForUser)(input.user_id, pushPayload, row.id);
        if (!input.skipLegacyPush) {
            (0, utils_1.sendPushNotification)([input.user_id], input.title, input.body, {
                type: input.type,
                course_id: input.course_id,
                lecture_id: input.lecture_id,
                exam_id: input.exam_id,
                url: input.url,
            }).catch((e) => utils_2.logger.warn({ e }, 'OneSignal push failed'));
            ExpoPushService.sendPushNotification(input.user_id, input.title, input.body, {
                type: input.type,
                course_id: input.course_id,
                lecture_id: input.lecture_id,
                exam_id: input.exam_id,
                url: input.url,
            }).catch((e) => utils_2.logger.warn({ e }, 'Expo push failed'));
        }
        return { success: true, notification: apiRow, notification_id: row.id };
    }
    static async dispatchToUsers(userIds, payload) {
        const uniqueIds = [...new Set(userIds.filter((id) => Number.isInteger(id) && id > 0))];
        if (uniqueIds.length === 0)
            return { success: true, notifiedCount: 0, notification_ids: [] };
        const notificationIds = [];
        for (const userId of uniqueIds) {
            const res = await this.dispatchToUser({
                user_id: userId,
                title: payload.title,
                body: payload.body,
                type: payload.type,
                icon: payload.icon,
                image: payload.image,
                url: payload.url,
                course_id: payload.course_id,
            });
            if (res.notification_id)
                notificationIds.push(res.notification_id);
        }
        return { success: true, notifiedCount: notificationIds.length, notification_ids: notificationIds };
    }
    static async broadcastToAllUsers(payload) {
        const users = await pool_1.default.query(`SELECT id FROM users WHERE role IN ('student', 'teacher', 'admin') AND account_status IS DISTINCT FROM 'suspended'`);
        const userIds = users.rows.map((r) => r.id);
        return this.dispatchToUsers(userIds, { ...payload, type: payload.type || 'broadcast' });
    }
    static async getUnreadNotifications(userId, limit = 20, offset = 0) {
        const result = await pool_1.default.query(`SELECT id, user_id, title, message, type, icon, image, url, is_read, course_id, lecture_id, exam_id, metadata, created_at, updated_at
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`, [userId, limit, offset]);
        const count = await pool_1.default.query(`SELECT COUNT(*)::int AS total FROM notifications WHERE user_id = $1 AND is_read = FALSE`, [userId]);
        return {
            notifications: result.rows.map(toApiRow),
            total: count.rows[0]?.total || 0,
        };
    }
    static async deleteNotification(notificationId, userId) {
        const result = await pool_1.default.query(`DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`, [notificationId, userId]);
        return (result.rowCount || 0) > 0;
    }
    static async assertTeacherCanNotifyUsers(teacherId, userIds) {
        if (userIds.length === 0)
            return true;
        const result = await pool_1.default.query(`SELECT COUNT(DISTINCT e.user_id)::int AS cnt
       FROM enrollments e
       INNER JOIN courses c ON c.id = e.course_id AND c.teacher_id = $1
       WHERE e.user_id = ANY($2::int[])`, [teacherId, userIds]);
        return (result.rows[0]?.cnt || 0) === userIds.length;
    }
}
exports.NotificationDispatchService = NotificationDispatchService;
