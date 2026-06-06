import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { ChatService } from '../services/chat';

export const router = Router();

// GET /api/support/chat - Get student chat (redirects to chat notifications)
router.get(
  '/chat',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    
    // Get chat notifications for the student
    const { items } = await ChatService.getChatNotifications({
      userId: user.id,
      role: 'student',
      limit: 1,
      offset: 0,
      unreadOnly: false,
    });

    // Return first chat or empty response
    if (items.length > 0) {
      return res.json({ chat: items[0] });
    }

    return res.json({ chat: null });
  })
);

// GET /api/support/notifications - Get chat notifications
router.get(
  '/notifications',
  authMiddleware(['student', 'teacher']),
  asyncWrapper(async (req, res) => {
    const user = req.user!;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string) : 0;
    const unreadOnly =
      req.query.unread_only === undefined ? false : String(req.query.unread_only).toLowerCase() === 'true';

    const { items, total } = await ChatService.getChatNotifications({
      userId: user.id,
      role: user.role as 'student' | 'teacher',
      limit,
      offset,
      unreadOnly,
    });

    // If unread_count = 0: don't return last_message
    const notifications = items.map((n: any) => {
      if ((n.unread_count ?? 0) > 0) return n;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { last_message, ...rest } = n;
      return rest;
    });

    return res.json({
      notifications,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total,
      },
    });
  })
);

