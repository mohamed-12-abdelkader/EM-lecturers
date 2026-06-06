"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const notifications_1 = require("../services/notifications");
const expoPushService_1 = require("../services/expoPushService");
const router = (0, express_1.Router)();
exports.router = router;
// GET /api/notifications - Get user notifications
router.get('/', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const result = await notifications_1.NotificationService.getUserNotifications(userId, limit, offset, userRole);
    if (!result.success) {
        return res.status(500).json({ message: result.error || 'Failed to fetch notifications' });
    }
    res.json({
        notifications: result.notifications,
        pagination: {
            limit,
            offset,
            total: result.total || 0,
            hasMore: (result.total || 0) > offset + limit,
        },
    });
}));
// GET /api/notifications/messages - إشعارات الرسائل الموحّدة (دعم فني + دردشة مباشرة + جروب) بتنسيق متوافق مع Expo Push
router.get('/messages', (0, authentication_1.authMiddleware)(['student', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const limit = req.query.limit ? parseInt(req.query.limit) : 30;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const result = await notifications_1.NotificationService.getMessageNotificationsUnified(userId, userRole, limit, offset);
    res.json({
        notifications: result.notifications,
        pagination: {
            limit,
            offset,
            total: result.total,
            has_more: result.total > offset + limit,
        },
    });
}));
// GET /api/notifications/live-stream - إشعارات بدء اللايف فقط
router.get('/live-stream', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const result = await notifications_1.NotificationService.getLiveStreamNotifications(userId, limit, offset, userRole);
    if (!result.success) {
        return res.status(500).json({ message: result.error || 'Failed to fetch live stream notifications' });
    }
    res.json({
        notifications: result.notifications,
        pagination: {
            limit,
            offset,
            total: result.total || 0,
            hasMore: (result.total || 0) > offset + limit,
        },
    });
}));
// GET /api/notifications/unread-count - Get unread notifications count
// يجب أن يكون قبل /:notificationId/read لتجنب conflict
router.get('/unread-count', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const result = await notifications_1.NotificationService.getUnreadCount(userId);
    if (!result.success) {
        return res.status(500).json({ message: 'Failed to get unread count' });
    }
    res.json({ count: result.count || 0 });
}));
// PUT /api/notifications/read-all - Mark all notifications as read
// يجب أن يكون قبل /:notificationId/read لتجنب conflict
router.put('/read-all', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const result = await notifications_1.NotificationService.markAllAsRead(userId);
    if (!result.success) {
        return res.status(500).json({ message: 'Failed to mark notifications as read' });
    }
    res.json({ message: 'All notifications marked as read' });
}));
// POST /api/notifications/push-token - تسجيل/تحديث Expo Push Token (تطبيق الموبايل)
router.post('/push-token', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const schema = zod_1.z.object({
        token: zod_1.z.string().min(1, 'Token is required'),
        device_id: zod_1.z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const userId = req.user.id;
    const result = await (0, expoPushService_1.saveExpoPushToken)(userId, parsed.data.token, parsed.data.device_id);
    if (!result.success) {
        return res.status(400).json({ message: result.error || 'Failed to save push token' });
    }
    res.status(200).json({ message: 'Push token saved successfully' });
}));
// PUT /api/notifications/:notificationId/read - Mark notification as read
// يجب أن يكون بعد routes الثابتة مثل /read-all و /unread-count
// استخدام regex للتأكد من أن notificationId رقم وليس نص
router.put('/:notificationId(\\d+)/read', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.notificationId);
    if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const result = await notifications_1.NotificationService.markAsRead(notificationId, userId);
    if (!result.success) {
        return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification marked as read' });
}));
// PUT /api/notifications/notification_:notificationId/read - Mark notification as read (with prefix)
// للدعم مع format "notification_123"
router.put('/notification_:notificationId(\\d+)/read', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.notificationId);
    if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const result = await notifications_1.NotificationService.markAsRead(notificationId, userId);
    if (!result.success) {
        return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification marked as read' });
}));
