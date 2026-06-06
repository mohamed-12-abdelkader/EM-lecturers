"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const pool_1 = __importDefault(require("../db/pool"));
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const notifications_1 = require("../services/notifications");
const courseAccess_1 = require("../utils/courseAccess");
exports.router = (0, express_1.Router)();
// Create a comment or reply
exports.router.post('/lecture/:lectureId/comments', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const { content, parent_comment_id } = req.body;
    const user = req.user;
    if (!content || !content.trim()) {
        return res.status(400).json({ message: 'content is required' });
    }
    if (!(await (0, courseAccess_1.canAccessLecture)(Number(lectureId), user.id, user.role))) {
        return res.status(403).json({ message: 'Not allowed to comment on this lecture' });
    }
    // Resolve course_id for lecture (يدعم lectures و course_lectures)
    let courseId = null;
    const courseLectureResult = await pool_1.default.query('SELECT course_id FROM course_lectures WHERE id = $1', [lectureId]);
    if (courseLectureResult.rowCount) {
        courseId = courseLectureResult.rows[0].course_id;
    }
    else {
        const lectureResult = await pool_1.default.query('SELECT course_id FROM lectures WHERE id = $1', [
            lectureId,
        ]);
        if (lectureResult.rowCount) {
            courseId = lectureResult.rows[0].course_id;
        }
    }
    if (!courseId) {
        return res.status(404).json({ message: 'Lecture not found' });
    }
    // Optional: validate parent belongs to same lecture
    if (parent_comment_id) {
        const pRes = await pool_1.default.query('SELECT id FROM lecture_comments WHERE id = $1 AND lecture_id = $2', [parent_comment_id, lectureId]);
        if (!pRes.rowCount) {
            return res.status(400).json({ message: 'Invalid parent_comment_id' });
        }
    }
    const result = await pool_1.default.query(`INSERT INTO lecture_comments (lecture_id, course_id, user_id, parent_comment_id, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`, [lectureId, courseId, user.id, parent_comment_id || null, content.trim()]);
    const comment = result.rows[0];
    // جلب بيانات المستخدم (الاسم والصورة)
    const userRes = await pool_1.default.query(`SELECT name AS user_name, avatar AS user_avatar FROM users WHERE id = $1`, [user.id]);
    if (userRes.rowCount && userRes.rowCount > 0) {
        comment.user_name = userRes.rows[0].user_name;
        comment.user_avatar = userRes.rows[0].user_avatar;
    }
    // Emit SSE event if stream open
    lectureStreamEmit(lectureId, { type: 'comment_created', comment });
    // If reply, notify parent comment owner
    if (parent_comment_id) {
        const ownerRes = await pool_1.default.query(`SELECT lc.user_id, u.name AS owner_name
         FROM lecture_comments lc
         JOIN users u ON lc.user_id = u.id
         WHERE lc.id = $1`, [parent_comment_id]);
        if (ownerRes.rowCount) {
            const ownerId = ownerRes.rows[0].user_id;
            if (ownerId !== user.id) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-expect-error
                await notifications_1.NotificationService.notifyUser(ownerId, {
                    title: 'رد جديد على تعليقك',
                    message: `${user.role === 'teacher' ? 'المدرس' : 'الطالب'} قام بالرد على تعليقك`,
                    type: 'comment_reply',
                    lecture_id: lectureId,
                    course_id: courseId,
                    comment_id: comment.id,
                });
            }
        }
    }
    res.status(201).json({ comment });
}));
// List comments (threaded shape)
exports.router.get('/lecture/:lectureId/comments', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const user = req.user;
    if (!(await (0, courseAccess_1.canAccessLecture)(Number(lectureId), user.id, user.role))) {
        return res.status(403).json({ message: 'Not allowed to view comments' });
    }
    const result = await pool_1.default.query(`SELECT lc.*, u.name AS user_name, u.avatar AS user_avatar
       FROM lecture_comments lc
       JOIN users u ON lc.user_id = u.id
       WHERE lc.lecture_id = $1
       ORDER BY lc.created_at ASC`, [lectureId]);
    // Build nested tree client-side friendly
    const byId = {};
    const roots = [];
    for (const row of result.rows) {
        byId[row.id] = { ...row, replies: [] };
    }
    for (const row of result.rows) {
        const node = byId[row.id];
        if (row.parent_comment_id) {
            const parent = byId[row.parent_comment_id];
            if (parent)
                parent.replies.push(node);
            else
                roots.push(node);
        }
        else {
            roots.push(node);
        }
    }
    res.json({ comments: roots });
}));
const lectureClients = new Map();
function lectureStreamEmit(lectureId, event) {
    const clients = lectureClients.get(lectureId) || [];
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of clients) {
        try {
            client.res.write(data);
        }
        catch (_err) {
            // ...
        }
    }
}
// SSE stream for a lecture
exports.router.get('/lecture/:lectureId/comments/stream', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const user = req.user;
    if (!(await (0, courseAccess_1.canAccessLecture)(Number(lectureId), user.id, user.role))) {
        return res.status(403).json({ message: 'Not allowed to subscribe' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const list = lectureClients.get(lectureId) || [];
    const client = { id: user.id, res };
    list.push(client);
    lectureClients.set(lectureId, list);
    // Initial ping
    res.write(`event: welcome\n`);
    res.write(`data: {"ok":true}\n\n`);
    req.on('close', () => {
        const arr = lectureClients.get(lectureId) || [];
        const filtered = arr.filter((c) => c !== client);
        lectureClients.set(lectureId, filtered);
    });
}));
exports.default = exports.router;
