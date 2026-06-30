"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const zod_1 = require("zod");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const notifications_1 = require("../services/notifications");
const expoPushService_1 = require("../services/expoPushService");
const webPushSubscriptionService_1 = require("../services/webPushSubscriptionService");
const notificationDispatchService_1 = require("../services/notificationDispatchService");
const webPush_1 = require("../config/webPush");
const notificationRateLimit_1 = require("../middleware/notificationRateLimit");
const router = (0, express_1.Router)();
exports.router = router;
const sendPayloadSchema = zod_1.z.object({
    title: zod_1.z.string().min(1).max(200),
    body: zod_1.z.string().min(1).max(2000),
    icon: zod_1.z.string().url().optional(),
    image: zod_1.z.string().url().optional(),
    url: zod_1.z.string().max(500).optional(),
    type: zod_1.z.string().min(1).max(64).default('custom'),
});
const subscribeSchema = zod_1.z.object({
    endpoint: zod_1.z.string().url(),
    keys: zod_1.z.object({
        p256dh: zod_1.z.string().min(1),
        auth: zod_1.z.string().min(1),
    }),
    browser: zod_1.z.string().max(100).optional(),
    device_label: zod_1.z.string().max(120).optional(),
});
// GET /api/notifications/vapid-public-key
router.get('/vapid-public-key', (0, utils_1.asyncWrapper)(async (_req, res) => {
    if (!webPush_1.webPushConfig.enabled) {
        return res.status(503).json({ message: 'Web Push is not configured on this server' });
    }
    res.json({ publicKey: webPush_1.webPushConfig.publicKey });
}));
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
// GET /api/notifications/unread
router.get('/unread', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const result = await notificationDispatchService_1.NotificationDispatchService.getUnreadNotifications(userId, limit, offset);
    res.json({
        notifications: result.notifications,
        pagination: {
            limit,
            offset,
            total: result.total,
            hasMore: result.total > offset + limit,
        },
    });
}));
// GET /api/notifications/messages
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
router.get('/unread-count', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const result = await notifications_1.NotificationService.getUnreadCount(userId);
    if (!result.success) {
        return res.status(500).json({ message: 'Failed to get unread count' });
    }
    res.json({ count: result.count || 0 });
}));
const markAllReadHandler = (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const result = await notifications_1.NotificationService.markAllAsRead(userId);
    if (!result.success) {
        return res.status(500).json({ message: 'Failed to mark notifications as read' });
    }
    res.json({ message: 'All notifications marked as read' });
});
router.put('/read-all', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), markAllReadHandler);
router.patch('/read-all', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), markAllReadHandler);
// Push subscription management
router.post('/push-subscribe', notificationRateLimit_1.pushSubscribeRateLimit, (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const userId = req.user.id;
    const userAgent = req.headers['user-agent'];
    const subscription = await webPushSubscriptionService_1.WebPushSubscriptionService.subscribe(userId, {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth_key: parsed.data.keys.auth,
        user_agent: typeof userAgent === 'string' ? userAgent : undefined,
        browser: parsed.data.browser,
        device_label: parsed.data.device_label,
    });
    res.status(201).json({
        message: 'Push subscription saved',
        subscription: {
            id: subscription.id,
            endpoint: subscription.endpoint,
            browser: subscription.browser,
            device_label: subscription.device_label,
            created_at: subscription.created_at,
            updated_at: subscription.updated_at,
        },
    });
}));
router.get('/push-subscriptions', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subscriptions = await webPushSubscriptionService_1.WebPushSubscriptionService.listUserSubscriptions(req.user.id);
    res.json({
        subscriptions: subscriptions.map((s) => ({
            id: s.id,
            endpoint: s.endpoint,
            browser: s.browser,
            device_label: s.device_label,
            user_agent: s.user_agent,
            created_at: s.created_at,
            updated_at: s.updated_at,
        })),
    });
}));
router.put('/push-subscribe/:subscriptionId(\\d+)', notificationRateLimit_1.pushSubscribeRateLimit, (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = subscribeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    const updated = await webPushSubscriptionService_1.WebPushSubscriptionService.updateSubscription(req.user.id, subscriptionId, {
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys?.p256dh,
        auth_key: parsed.data.keys?.auth,
        browser: parsed.data.browser,
        device_label: parsed.data.device_label,
        user_agent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });
    if (!updated) {
        return res.status(404).json({ message: 'Subscription not found' });
    }
    res.json({ message: 'Subscription updated', subscription: updated });
}));
router.delete('/push-subscribe/:subscriptionId(\\d+)', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    const deleted = await webPushSubscriptionService_1.WebPushSubscriptionService.deleteSubscription(req.user.id, subscriptionId);
    if (!deleted) {
        return res.status(404).json({ message: 'Subscription not found' });
    }
    res.json({ message: 'Subscription removed' });
}));
// Send APIs
router.post('/send', notificationRateLimit_1.notificationSendRateLimit, (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const bodySchema = sendPayloadSchema.extend({
        user_id: zod_1.z.coerce.number().int().positive(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const sender = req.user;
    if (sender.role === 'teacher') {
        const allowed = await notificationDispatchService_1.NotificationDispatchService.assertTeacherCanNotifyUsers(sender.id, [
            parsed.data.user_id,
        ]);
        if (!allowed) {
            return res.status(403).json({ message: 'You can only notify your enrolled students' });
        }
    }
    const result = await notificationDispatchService_1.NotificationDispatchService.dispatchToUser({
        user_id: parsed.data.user_id,
        title: parsed.data.title,
        body: parsed.data.body,
        type: parsed.data.type,
        icon: parsed.data.icon,
        image: parsed.data.image,
        url: parsed.data.url,
    });
    res.status(201).json(result);
}));
router.post('/send-bulk', notificationRateLimit_1.notificationSendRateLimit, (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const bodySchema = sendPayloadSchema.extend({
        user_ids: zod_1.z.array(zod_1.z.coerce.number().int().positive()).min(1).max(5000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const sender = req.user;
    if (sender.role === 'teacher') {
        const allowed = await notificationDispatchService_1.NotificationDispatchService.assertTeacherCanNotifyUsers(sender.id, parsed.data.user_ids);
        if (!allowed) {
            return res.status(403).json({ message: 'You can only notify your enrolled students' });
        }
    }
    const result = await notificationDispatchService_1.NotificationDispatchService.dispatchToUsers(parsed.data.user_ids, parsed.data);
    res.status(201).json(result);
}));
router.post('/broadcast', notificationRateLimit_1.notificationBroadcastRateLimit, (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const parsed = sendPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const result = await notificationDispatchService_1.NotificationDispatchService.broadcastToAllUsers({
        ...parsed.data,
        type: parsed.data.type || 'broadcast',
    });
    res.status(201).json(result);
}));
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
const markReadHandler = (0, utils_1.asyncWrapper)(async (req, res) => {
    const userId = req.user.id;
    const notificationId = parseInt(req.params.notificationId, 10);
    if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const result = await notifications_1.NotificationService.markAsRead(notificationId, userId);
    if (!result.success) {
        return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification marked as read' });
});
router.put('/:notificationId(\\d+)/read', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), markReadHandler);
router.patch('/:notificationId(\\d+)/read', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), markReadHandler);
router.put('/notification_:notificationId(\\d+)/read', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), markReadHandler);
router.delete('/:notificationId(\\d+)', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const notificationId = parseInt(req.params.notificationId, 10);
    if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const deleted = await notificationDispatchService_1.NotificationDispatchService.deleteNotification(notificationId, req.user.id);
    if (!deleted) {
        return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification deleted' });
}));
