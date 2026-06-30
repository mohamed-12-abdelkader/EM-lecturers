import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { NotificationService } from '../services/notifications';
import { saveExpoPushToken } from '../services/expoPushService';
import { WebPushSubscriptionService } from '../services/webPushSubscriptionService';
import { NotificationDispatchService } from '../services/notificationDispatchService';
import { webPushConfig } from '../config/webPush';
import {
  pushSubscribeRateLimit,
  notificationSendRateLimit,
  notificationBroadcastRateLimit,
} from '../middleware/notificationRateLimit';

const router = Router();

const sendPayloadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(2000),
  icon: z.string().url().optional(),
  image: z.string().url().optional(),
  url: z.string().max(500).optional(),
  type: z.string().min(1).max(64).default('custom'),
});

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  browser: z.string().max(100).optional(),
  device_label: z.string().max(120).optional(),
});

// GET /api/notifications/vapid-public-key
router.get(
  '/vapid-public-key',
  asyncWrapper(async (_req, res) => {
    if (!webPushConfig.enabled) {
      return res.status(503).json({ message: 'Web Push is not configured on this server' });
    }
    res.json({ publicKey: webPushConfig.publicKey });
  }),
);

// GET /api/notifications - Get user notifications
router.get(
  '/',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await NotificationService.getUserNotifications(userId, limit, offset, userRole);

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
  }),
);

// GET /api/notifications/unread
router.get(
  '/unread',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const result = await NotificationDispatchService.getUnreadNotifications(userId, limit, offset);
    res.json({
      notifications: result.notifications,
      pagination: {
        limit,
        offset,
        total: result.total,
        hasMore: result.total > offset + limit,
      },
    });
  }),
);

// GET /api/notifications/messages
router.get(
  '/messages',
  authMiddleware(['student', 'teacher']),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const userRole = req.user!.role as 'student' | 'teacher';
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 30;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await NotificationService.getMessageNotificationsUnified(userId, userRole, limit, offset);

    res.json({
      notifications: result.notifications,
      pagination: {
        limit,
        offset,
        total: result.total,
        has_more: result.total > offset + limit,
      },
    });
  }),
);

router.get(
  '/live-stream',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const userRole = req.user!.role;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;

    const result = await NotificationService.getLiveStreamNotifications(userId, limit, offset, userRole);

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
  }),
);

router.get(
  '/unread-count',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const userId = req.user!.id;
    const result = await NotificationService.getUnreadCount(userId);
    if (!result.success) {
      return res.status(500).json({ message: 'Failed to get unread count' });
    }
    res.json({ count: result.count || 0 });
  }),
);

const markAllReadHandler = asyncWrapper(async (req, res) => {
  const userId = req.user!.id;
  const result = await NotificationService.markAllAsRead(userId);
  if (!result.success) {
    return res.status(500).json({ message: 'Failed to mark notifications as read' });
  }
  res.json({ message: 'All notifications marked as read' });
});

router.put('/read-all', authMiddleware(['student', 'teacher', 'admin']), markAllReadHandler);
router.patch('/read-all', authMiddleware(['student', 'teacher', 'admin']), markAllReadHandler);

// Push subscription management
router.post(
  '/push-subscribe',
  pushSubscribeRateLimit,
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const userId = req.user!.id;
    const userAgent = req.headers['user-agent'];
    const subscription = await WebPushSubscriptionService.subscribe(userId, {
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
  }),
);

router.get(
  '/push-subscriptions',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const subscriptions = await WebPushSubscriptionService.listUserSubscriptions(req.user!.id);
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
  }),
);

router.put(
  '/push-subscribe/:subscriptionId(\\d+)',
  pushSubscribeRateLimit,
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const parsed = subscribeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    const updated = await WebPushSubscriptionService.updateSubscription(req.user!.id, subscriptionId, {
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
  }),
);

router.delete(
  '/push-subscribe/:subscriptionId(\\d+)',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const subscriptionId = parseInt(req.params.subscriptionId, 10);
    const deleted = await WebPushSubscriptionService.deleteSubscription(req.user!.id, subscriptionId);
    if (!deleted) {
      return res.status(404).json({ message: 'Subscription not found' });
    }
    res.json({ message: 'Subscription removed' });
  }),
);

// Send APIs
router.post(
  '/send',
  notificationSendRateLimit,
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const bodySchema = sendPayloadSchema.extend({
      user_id: z.coerce.number().int().positive(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const sender = req.user!;
    if (sender.role === 'teacher') {
      const allowed = await NotificationDispatchService.assertTeacherCanNotifyUsers(sender.id, [
        parsed.data.user_id,
      ]);
      if (!allowed) {
        return res.status(403).json({ message: 'You can only notify your enrolled students' });
      }
    }

    const result = await NotificationDispatchService.dispatchToUser({
      user_id: parsed.data.user_id,
      title: parsed.data.title,
      body: parsed.data.body,
      type: parsed.data.type,
      icon: parsed.data.icon,
      image: parsed.data.image,
      url: parsed.data.url,
    });

    res.status(201).json(result);
  }),
);

router.post(
  '/send-bulk',
  notificationSendRateLimit,
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req, res) => {
    const bodySchema = sendPayloadSchema.extend({
      user_ids: z.array(z.coerce.number().int().positive()).min(1).max(5000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }

    const sender = req.user!;
    if (sender.role === 'teacher') {
      const allowed = await NotificationDispatchService.assertTeacherCanNotifyUsers(
        sender.id,
        parsed.data.user_ids,
      );
      if (!allowed) {
        return res.status(403).json({ message: 'You can only notify your enrolled students' });
      }
    }

    const result = await NotificationDispatchService.dispatchToUsers(parsed.data.user_ids, parsed.data);
    res.status(201).json(result);
  }),
);

router.post(
  '/broadcast',
  notificationBroadcastRateLimit,
  authMiddleware(['admin']),
  asyncWrapper(async (req, res) => {
    const parsed = sendPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const result = await NotificationDispatchService.broadcastToAllUsers({
      ...parsed.data,
      type: parsed.data.type || 'broadcast',
    });
    res.status(201).json(result);
  }),
);

router.post(
  '/push-token',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const schema = z.object({
      token: z.string().min(1, 'Token is required'),
      device_id: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Validation failed', errors: parsed.error.errors });
    }
    const userId = req.user!.id;
    const result = await saveExpoPushToken(userId, parsed.data.token, parsed.data.device_id);
    if (!result.success) {
      return res.status(400).json({ message: result.error || 'Failed to save push token' });
    }
    res.status(200).json({ message: 'Push token saved successfully' });
  }),
);

const markReadHandler = asyncWrapper(async (req, res) => {
  const userId = req.user!.id;
  const notificationId = parseInt(req.params.notificationId, 10);
  if (isNaN(notificationId)) {
    return res.status(400).json({ message: 'Invalid notification ID' });
  }
  const result = await NotificationService.markAsRead(notificationId, userId);
  if (!result.success) {
    return res.status(404).json({ message: 'Notification not found' });
  }
  res.json({ message: 'Notification marked as read' });
});

router.put('/:notificationId(\\d+)/read', authMiddleware(['student', 'teacher', 'admin']), markReadHandler);
router.patch('/:notificationId(\\d+)/read', authMiddleware(['student', 'teacher', 'admin']), markReadHandler);

router.put(
  '/notification_:notificationId(\\d+)/read',
  authMiddleware(['student', 'teacher', 'admin']),
  markReadHandler,
);

router.delete(
  '/:notificationId(\\d+)',
  authMiddleware(['student', 'teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const notificationId = parseInt(req.params.notificationId, 10);
    if (isNaN(notificationId)) {
      return res.status(400).json({ message: 'Invalid notification ID' });
    }
    const deleted = await NotificationDispatchService.deleteNotification(notificationId, req.user!.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    res.json({ message: 'Notification deleted' });
  }),
);

export { router };
