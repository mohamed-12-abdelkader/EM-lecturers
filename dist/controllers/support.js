"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const chat_1 = require("../services/chat");
exports.router = (0, express_1.Router)();
// GET /api/support/chat - Get student chat (redirects to chat notifications)
exports.router.get('/chat', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    // Get chat notifications for the student
    const { items } = await chat_1.ChatService.getChatNotifications({
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
}));
// GET /api/support/notifications - Get chat notifications
exports.router.get('/notifications', (0, authentication_1.authMiddleware)(['student', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset) : 0;
    const unreadOnly = req.query.unread_only === undefined ? false : String(req.query.unread_only).toLowerCase() === 'true';
    const { items, total } = await chat_1.ChatService.getChatNotifications({
        userId: user.id,
        role: user.role,
        limit,
        offset,
        unreadOnly,
    });
    // If unread_count = 0: don't return last_message
    const notifications = items.map((n) => {
        if ((n.unread_count ?? 0) > 0)
            return n;
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
}));
