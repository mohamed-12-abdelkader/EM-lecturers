"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const chat_1 = require("../services/chat");
const notifications_1 = require("../services/notifications");
const zod_1 = require("zod");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const utils_2 = require("../utils");
exports.router = (0, express_1.Router)();
const upload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (req, file, cb) => {
            const dir = path_1.default.join(__dirname, '../../uploads');
            fs_1.default.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const uniqueName = `${Date.now()}-${file.originalname}`;
            cb(null, uniqueName);
        },
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
});
async function resolveChatGroupForRequest(groupIdParam, user) {
    // 1) If this is a package-subject-item group id, map it to a chat_groups row (create if missing)
    const pkgGroupRes = await pool_1.default.query(`SELECT
       g.id AS package_subject_group_id,
       g.teacher_id,
       psi.id AS subject_id,
       psi.package_id
     FROM package_subject_item_groups g
     JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
     WHERE g.id = $1`, [groupIdParam]);
    if (pkgGroupRes.rowCount) {
        const row = pkgGroupRes.rows[0];
        const packageSubjectGroupId = Number(row.package_subject_group_id);
        const teacherId = row.teacher_id ? Number(row.teacher_id) : null;
        const packageId = Number(row.package_id);
        // Authorization
        if (user.role === 'student') {
            const ok = await pool_1.default.query(`SELECT 1
         FROM package_subject_item_group_students gs
         JOIN package_activations pa ON pa.package_id = $2 AND pa.student_id = gs.student_id
         WHERE gs.group_id = $1
           AND gs.student_id = $3
           AND pa.is_active = TRUE
           AND pa.activation_code_id IS NOT NULL
         LIMIT 1`, [packageSubjectGroupId, packageId, user.id]);
            if (!ok.rowCount)
                return { allowed: false, reason: 'Not in this package group' };
        }
        else if (user.role === 'teacher') {
            if (!teacherId || teacherId !== user.id)
                return { allowed: false, reason: 'Not allowed' };
        } // admin allowed
        const chatGroup = await chat_1.ChatService.getOrCreatePackageSubjectGroupChat(packageSubjectGroupId);
        // ensure membership rows exist (keeps same structure as existing chat)
        if (user.role === 'student')
            await chat_1.ChatService.addMember(chatGroup.id, user.id, 'student');
        if (user.role === 'teacher')
            await chat_1.ChatService.addMember(chatGroup.id, user.id, 'teacher');
        return {
            allowed: true,
            kind: 'package',
            packageSubjectGroupId,
            chatGroupId: chatGroup.id,
        };
    }
    // 2) Legacy chat_groups id
    const legacy = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [
        groupIdParam,
    ]);
    if (!legacy.rowCount)
        return { allowed: false, reason: 'Group not found' };
    return { allowed: true, kind: 'legacy', chatGroupId: groupIdParam };
}
async function getRoomForChatGroup(chatGroupId) {
    const r = await pool_1.default.query(`SELECT id, package_subject_group_id
     FROM chat_groups
     WHERE id = $1`, [chatGroupId]);
    if (!r.rowCount)
        return `group:${chatGroupId}`;
    const row = r.rows[0];
    return row.package_subject_group_id ? `group_${Number(row.package_subject_group_id)}` : `group:${chatGroupId}`;
}
async function userCanAccessChatGroup(chatGroupId, user) {
    if (user.role === 'admin')
        return true;
    const cgRes = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id, direct_student_id, direct_teacher_id
     FROM chat_groups
     WHERE id = $1`, [chatGroupId]);
    if (!cgRes.rowCount)
        return false;
    const cg = cgRes.rows[0];
    // Direct chat: must be one of the two members
    if (cg.direct_student_id || cg.direct_teacher_id) {
        return Number(cg.direct_student_id) === user.id || Number(cg.direct_teacher_id) === user.id;
    }
    // Package-subject group chat: teacher is allowed if assigned to that group
    if (cg.package_subject_group_id) {
        if (user.role === 'teacher') {
            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [cg.package_subject_group_id, user.id]);
            if (ok.rowCount)
                return true;
        }
        // Student must be a member (we keep membership rows)
    }
    // Legacy grade chat: teacher owns group (owner_teacher_id) OR student/teacher is a member
    if (user.role === 'teacher' && cg.owner_teacher_id && Number(cg.owner_teacher_id) === user.id)
        return true;
    const mem = await pool_1.default.query(`SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2`, [
        chatGroupId,
        user.id,
    ]);
    return !!mem.rowCount;
}
// List groups for current user by grades
exports.router.get('/groups', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    if (user.role === 'student') {
        await chat_1.ChatService.ensureStudentMembershipForEnrollments(user.id);
        await chat_1.ChatService.ensureStudentMembershipForPackageSubjectGroups(user.id);
        const groups = await chat_1.ChatService.getGroupsForStudent(user.id);
        // Append teacher name to group label
        const withNames = await pool_1.default.query(`SELECT cg.id, u.name AS teacher_name FROM chat_groups cg JOIN users u ON u.id = cg.owner_teacher_id WHERE cg.id = ANY($1::int[])`, [groups.map((g) => g.id)]);
        const idToTeacher = {};
        for (const r of withNames.rows)
            idToTeacher[r.id] = r.teacher_name;
        // Package-subject groups the student belongs to (with teacher + students list)
        const pkgGroupsRes = await pool_1.default.query(`SELECT
           cg.id AS chat_group_id,
           cg.allow_student_send,
           g.id AS package_subject_group_id,
           g.name AS group_name,
           g.schedule_days,
           g.schedule_time,
           psi.id AS subject_id,
           psi.name AS subject_name,
           g.teacher_id,
           tu.name AS teacher_name,
           tu.avatar AS teacher_avatar
         FROM package_subject_item_group_students gs
         JOIN package_subject_item_groups g ON g.id = gs.group_id
         JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
         JOIN package_activations pa ON pa.package_id = psi.package_id
         JOIN chat_groups cg ON cg.package_subject_group_id = g.id
         LEFT JOIN users tu ON tu.id = g.teacher_id
         WHERE gs.student_id = $1
           AND pa.student_id = $1
           AND pa.is_active = TRUE
           AND pa.activation_code_id IS NOT NULL
         ORDER BY psi.id, g.id`, [user.id]);
        const packageGroupIds = pkgGroupsRes.rows.map((r) => Number(r.package_subject_group_id));
        const studentsByGroup = {};
        if (packageGroupIds.length) {
            const st = await pool_1.default.query(`SELECT gs.group_id, u.id, u.name, u.avatar
           FROM package_subject_item_group_students gs
           JOIN users u ON u.id = gs.student_id
           WHERE gs.group_id = ANY($1::int[])
           ORDER BY u.name`, [packageGroupIds]);
            for (const row of st.rows) {
                const gid = Number(row.group_id);
                if (!studentsByGroup[gid])
                    studentsByGroup[gid] = [];
                studentsByGroup[gid].push({ id: row.id, name: row.name, avatar: row.avatar ?? null });
            }
        }
        return res.json({
            groups: groups.map((g) => ({ ...g, name: idToTeacher[g.id] ? `${g.name} ${idToTeacher[g.id]}` : g.name })),
            package_subject_groups: pkgGroupsRes.rows.map((r) => ({
                type: 'package_subject_group',
                chat_group_id: Number(r.chat_group_id),
                allow_student_send: Boolean(r.allow_student_send),
                subject: { id: Number(r.subject_id), name: r.subject_name },
                group: {
                    id: Number(r.package_subject_group_id),
                    name: r.group_name,
                    schedule_days: r.schedule_days ?? null,
                    schedule_time: r.schedule_time ?? null,
                },
                teacher: r.teacher_id
                    ? { id: Number(r.teacher_id), name: r.teacher_name, avatar: r.teacher_avatar ?? null }
                    : null,
                students: studentsByGroup[Number(r.package_subject_group_id)] ?? [],
            })),
            // Unified list for clients that want both types in one array
            all_groups: [
                ...groups.map((g) => ({
                    type: 'grade_chat',
                    chat_group_id: g.id,
                    name: idToTeacher[g.id] ? `${g.name} ${idToTeacher[g.id]}` : g.name,
                    grade_id: g.grade_id,
                    owner_teacher_id: g.owner_teacher_id,
                    allow_student_send: g.allow_student_send,
                    created_at: g.created_at,
                })),
                ...pkgGroupsRes.rows.map((r) => ({
                    type: 'package_subject_group',
                    chat_group_id: Number(r.chat_group_id),
                    allow_student_send: Boolean(r.allow_student_send),
                    subject: { id: Number(r.subject_id), name: r.subject_name },
                    group: {
                        id: Number(r.package_subject_group_id),
                        name: r.group_name,
                        schedule_days: r.schedule_days ?? null,
                        schedule_time: r.schedule_time ?? null,
                    },
                    teacher: r.teacher_id
                        ? { id: Number(r.teacher_id), name: r.teacher_name, avatar: r.teacher_avatar ?? null }
                        : null,
                    students: studentsByGroup[Number(r.package_subject_group_id)] ?? [],
                })),
            ],
        });
    }
    // Teacher: groups per his grades (one per grade/teacher)
    if (user.role === 'teacher') {
        const result = await pool_1.default.query(`SELECT cg.*
         FROM chat_groups cg
         WHERE cg.owner_teacher_id = $1
         ORDER BY cg.grade_id`, [user.id]);
        // Package-subject groups assigned to this teacher (for realtime chat)
        const pkg = await pool_1.default.query(`SELECT
           cg.id AS chat_group_id,
           cg.allow_student_send,
           g.id AS package_subject_group_id,
           g.name AS group_name,
           g.schedule_days,
           g.schedule_time,
           psi.id AS subject_id,
           psi.name AS subject_name
         FROM package_subject_item_groups g
         JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
         JOIN chat_groups cg ON cg.package_subject_group_id = g.id
         WHERE g.teacher_id = $1
         ORDER BY psi.id, g.id`, [user.id]);
        return res.json({
            groups: result.rows,
            package_subject_groups: pkg.rows,
            all_groups: [
                ...result.rows.map((g) => ({ type: 'grade_chat', chat_group_id: g.id, ...g })),
                ...pkg.rows.map((r) => ({
                    type: 'package_subject_group',
                    chat_group_id: Number(r.chat_group_id),
                    allow_student_send: Boolean(r.allow_student_send),
                    subject: { id: Number(r.subject_id), name: r.subject_name },
                    group: {
                        id: Number(r.package_subject_group_id),
                        name: r.group_name,
                        schedule_days: r.schedule_days ?? null,
                        schedule_time: r.schedule_time ?? null,
                    },
                })),
            ],
        });
    }
    // Admin: all groups
    const result = await pool_1.default.query(`SELECT * FROM chat_groups ORDER BY grade_id`);
    const pkg = await pool_1.default.query(`SELECT
         cg.id AS chat_group_id,
         cg.allow_student_send,
         g.id AS package_subject_group_id,
         g.name AS group_name,
         g.schedule_days,
         g.schedule_time,
         psi.id AS subject_id,
         psi.name AS subject_name,
         g.teacher_id,
         tu.name AS teacher_name,
         tu.avatar AS teacher_avatar
       FROM package_subject_item_groups g
       JOIN package_subject_items psi ON psi.id = g.package_subject_item_id
       JOIN chat_groups cg ON cg.package_subject_group_id = g.id
       LEFT JOIN users tu ON tu.id = g.teacher_id
       ORDER BY psi.id, g.id`, []);
    return res.json({
        groups: result.rows,
        package_subject_groups: pkg.rows,
        all_groups: [
            ...result.rows.map((g) => ({ type: 'grade_chat', chat_group_id: g.id, ...g })),
            ...pkg.rows.map((r) => ({
                type: 'package_subject_group',
                chat_group_id: Number(r.chat_group_id),
                allow_student_send: Boolean(r.allow_student_send),
                subject: { id: Number(r.subject_id), name: r.subject_name },
                group: {
                    id: Number(r.package_subject_group_id),
                    name: r.group_name,
                    schedule_days: r.schedule_days ?? null,
                    schedule_time: r.schedule_time ?? null,
                },
                teacher: r.teacher_id
                    ? { id: Number(r.teacher_id), name: r.teacher_name, avatar: r.teacher_avatar ?? null }
                    : null,
            })),
        ],
    });
}));
// List direct chat contacts
// - student: returns teachers he can chat with (courses + package groups)
// - teacher: (optional) returns students who have an existing direct chat with him
exports.router.get('/contacts', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    if (user.role === 'student') {
        const teachers = await chat_1.ChatService.listDirectTeachersForStudent(user.id);
        return res.json({
            contacts: teachers.map((t) => ({
                type: 'teacher',
                teacher: { id: t.id, name: t.name, avatar: t.avatar ?? null },
                direct_chat_group_id: t.chat_group_id ? Number(t.chat_group_id) : null,
                last_message: t.last_message_id
                    ? {
                        id: Number(t.last_message_id),
                        text: t.last_message_text ?? null,
                        sender_id: t.last_message_sender_id ? Number(t.last_message_sender_id) : null,
                        created_at: t.last_message_created_at,
                        attachment_url: t.last_message_attachment_url ?? null,
                        attachment_type: t.last_message_attachment_type ?? null,
                    }
                    : null,
                unread_count: Number(t.unread_count || 0),
            })),
        });
    }
    if (user.role === 'teacher') {
        const r = await chat_1.ChatService.listDirectStudentsForTeacher(user.id);
        return res.json({
            contacts: r.map((s) => ({
                type: 'student',
                student: { id: s.id, name: s.name, avatar: s.avatar ?? null },
                direct_chat_group_id: s.chat_group_id ? Number(s.chat_group_id) : null,
                last_message: s.last_message_id
                    ? {
                        id: Number(s.last_message_id),
                        text: s.last_message_text ?? null,
                        sender_id: s.last_message_sender_id ? Number(s.last_message_sender_id) : null,
                        created_at: s.last_message_created_at,
                        attachment_url: s.last_message_attachment_url ?? null,
                        attachment_type: s.last_message_attachment_type ?? null,
                    }
                    : null,
                unread_count: Number(s.unread_count || 0),
            })),
        });
    }
    // admin: no direct contacts list (can be added later)
    return res.json({ contacts: [] });
}));
// Direct chat messages with a teacher/student
// For student: /direct/:otherId where otherId = teacherId
// For teacher: /direct/:otherId where otherId = studentId
exports.router.get('/direct/:otherId/messages', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const otherId = Number(req.params.otherId);
    if (isNaN(otherId))
        return res.status(400).json({ message: 'Invalid otherId' });
    const user = req.user;
    const { limit, before } = req.query;
    if (user.role === 'student') {
        const can = await chat_1.ChatService.studentCanChatWithTeacher(user.id, otherId);
        if (!can)
            return res.status(403).json({ message: 'Not allowed' });
        const cg = await chat_1.ChatService.getOrCreateDirectChat(user.id, otherId);
        const messages = await chat_1.ChatService.getHistory(cg.id, limit ? Number(limit) : 50, before);
        const otherUser = await pool_1.default.query(`SELECT id, name, avatar, role FROM users WHERE id = $1`, [otherId]);
        return res.json({
            chat_group_id: cg.id,
            other_user: otherUser.rowCount
                ? {
                    id: otherUser.rows[0].id,
                    name: otherUser.rows[0].name,
                    avatar: otherUser.rows[0].avatar ?? null,
                    role: otherUser.rows[0].role,
                }
                : null,
            messages,
        });
    }
    if (user.role === 'teacher') {
        const can = await chat_1.ChatService.teacherCanChatWithStudent(user.id, otherId);
        if (!can)
            return res.status(403).json({ message: 'Not allowed' });
        const cg = await chat_1.ChatService.getOrCreateDirectChat(otherId, user.id);
        const messages = await chat_1.ChatService.getHistory(cg.id, limit ? Number(limit) : 50, before);
        const otherUser = await pool_1.default.query(`SELECT id, name, avatar, role FROM users WHERE id = $1`, [otherId]);
        return res.json({
            chat_group_id: cg.id,
            other_user: otherUser.rowCount
                ? {
                    id: otherUser.rows[0].id,
                    name: otherUser.rows[0].name,
                    avatar: otherUser.rows[0].avatar ?? null,
                    role: otherUser.rows[0].role,
                }
                : null,
            messages,
        });
    }
    // admin can read if direct chat exists
    const cgRes = await pool_1.default.query(`SELECT id FROM chat_groups WHERE (direct_student_id = $1 AND direct_teacher_id IS NOT NULL) OR (direct_teacher_id = $1 AND direct_student_id IS NOT NULL) LIMIT 1`, [otherId]);
    if (!cgRes.rowCount)
        return res.status(404).json({ message: 'Not found' });
    const messages = await chat_1.ChatService.getHistory(Number(cgRes.rows[0].id), limit ? Number(limit) : 50, before);
    const otherUser = await pool_1.default.query(`SELECT id, name, avatar, role FROM users WHERE id = $1`, [otherId]);
    return res.json({
        chat_group_id: Number(cgRes.rows[0].id),
        other_user: otherUser.rowCount
            ? {
                id: otherUser.rows[0].id,
                name: otherUser.rows[0].name,
                avatar: otherUser.rows[0].avatar ?? null,
                role: otherUser.rows[0].role,
            }
            : null,
        messages,
    });
}));
exports.router.post('/direct/:otherId/messages', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const otherId = Number(req.params.otherId);
    if (isNaN(otherId))
        return res.status(400).json({ message: 'Invalid otherId' });
    const user = req.user;
    const schema = zod_1.z.object({
        message: zod_1.z.string().min(1).optional(),
        text: zod_1.z.string().min(1).optional(),
        reply_to_message_id: zod_1.z
            .any()
            .optional()
            .transform((val) => {
            if (val === undefined || val === null || val === '')
                return null;
            const num = typeof val === 'string' ? parseInt(val, 10) : val;
            if (typeof num === 'number' && !isNaN(num) && num > 0)
                return num;
            return null;
        }),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({
            message: 'Invalid request body',
            errors: parsed.error.errors,
        });
    }
    const text = (parsed.data.message ?? parsed.data.text ?? '').trim();
    if (!text)
        return res.status(400).json({ message: 'message is required' });
    let chatGroupId = null;
    if (user.role === 'student') {
        const can = await chat_1.ChatService.studentCanChatWithTeacher(user.id, otherId);
        if (!can)
            return res.status(403).json({ message: 'Not allowed' });
        const cg = await chat_1.ChatService.getOrCreateDirectChat(user.id, otherId);
        chatGroupId = cg.id;
    }
    else if (user.role === 'teacher') {
        const can = await chat_1.ChatService.teacherCanChatWithStudent(user.id, otherId);
        if (!can)
            return res.status(403).json({ message: 'Not allowed' });
        const cg = await chat_1.ChatService.getOrCreateDirectChat(otherId, user.id);
        chatGroupId = cg.id;
    }
    else {
        return res.status(403).json({ message: 'Not allowed' });
    }
    // Validate reply_to_message_id if provided
    const replyTo = parsed.data.reply_to_message_id ?? null;
    if (replyTo !== null) {
        const replyCheck = await pool_1.default.query(`SELECT id, group_id FROM chat_messages WHERE id = $1 AND group_id = $2`, [replyTo, chatGroupId]);
        if (!replyCheck.rowCount) {
            return res.status(400).json({ message: 'Reply message not found in this chat' });
        }
    }
    const saved = await chat_1.ChatService.saveMessage(chatGroupId, user.id, text, replyTo);
    const appAny = req.app;
    const io = appAny.io;
    // Payload للريال تايم: الطالب يستقبل على حدث chat:new-message بنفس شكل عنصر من GET messages
    const senderRes = await pool_1.default.query('SELECT name FROM users WHERE id = $1', [user.id]);
    const senderName = senderRes.rowCount ? senderRes.rows[0].name : 'مستخدم';
    const realtimePayload = { ...saved, sender_name: senderName, chat_group_id: chatGroupId };
    if (typeof appAny.emitChatMessage === 'function')
        appAny.emitChatMessage(chatGroupId, realtimePayload);
    // إرسال فوري للطرف الآخر (الطالب يشوف رسالة المدرس في نفس اللحظة)
    if (io) {
        const recipientId = user.role === 'student' ? otherId : user.role === 'teacher' ? otherId : null;
        if (recipientId)
            io.to(`user:${recipientId}`).emit('chat:new-message', realtimePayload);
    }
    return res.status(201).json({ chat_group_id: chatGroupId, message: saved });
}));
// Update a chat message (sender only; admin can also update)
exports.router.put('/messages/:messageId', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const messageId = Number(req.params.messageId);
    if (isNaN(messageId))
        return res.status(400).json({ message: 'Invalid message id' });
    const schema = zod_1.z.object({ message: zod_1.z.string().min(1).optional(), text: zod_1.z.string().min(1).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ message: 'message is required' });
    const text = (parsed.data.message ?? parsed.data.text ?? '').trim();
    if (!text)
        return res.status(400).json({ message: 'message is required' });
    const user = req.user;
    const existing = await pool_1.default.query(`SELECT id, group_id, sender_id, attachment_url, attachment_type
       FROM chat_messages
       WHERE id = $1`, [messageId]);
    if (!existing.rowCount)
        return res.status(404).json({ message: 'Message not found' });
    const msg = existing.rows[0];
    const canAccess = await userCanAccessChatGroup(Number(msg.group_id), user);
    if (!canAccess)
        return res.status(403).json({ message: 'Not allowed' });
    if (user.role !== 'admin' && Number(msg.sender_id) !== user.id) {
        return res.status(403).json({ message: 'Only sender can edit this message' });
    }
    // keep attachments; only update text
    const updated = await pool_1.default.query(`UPDATE chat_messages
       SET text = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`, [text, messageId]);
    const room = await getRoomForChatGroup(Number(msg.group_id));
    const appAny = req.app;
    const io = appAny.io;
    if (io)
        io.to(room).emit('chat:message-updated', { message: updated.rows[0] });
    return res.json({ success: true, message: updated.rows[0] });
}));
// Delete a chat message (sender only; admin can delete)
exports.router.delete('/messages/:messageId', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const messageId = Number(req.params.messageId);
    if (isNaN(messageId))
        return res.status(400).json({ message: 'Invalid message id' });
    const user = req.user;
    const existing = await pool_1.default.query(`SELECT id, group_id, sender_id FROM chat_messages WHERE id = $1`, [messageId]);
    if (!existing.rowCount)
        return res.status(404).json({ message: 'Message not found' });
    const msg = existing.rows[0];
    const canAccess = await userCanAccessChatGroup(Number(msg.group_id), user);
    if (!canAccess)
        return res.status(403).json({ message: 'Not allowed' });
    if (user.role !== 'admin' && Number(msg.sender_id) !== user.id) {
        return res.status(403).json({ message: 'Only sender can delete this message' });
    }
    await pool_1.default.query(`DELETE FROM chat_messages WHERE id = $1`, [messageId]);
    const room = await getRoomForChatGroup(Number(msg.group_id));
    const appAny = req.app;
    const io = appAny.io;
    if (io)
        io.to(room).emit('chat:message-deleted', { message_id: messageId, group_id: Number(msg.group_id) });
    return res.json({ success: true });
}));
// Get messages for a group (supports package-subject groupId OR legacy chat_group_id)
// GET /api/chat/groups/:groupId/messages?limit=50&before=2026-01-01T00:00:00.000Z
exports.router.get('/groups/:groupId/messages', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupIdParam = Number(req.params.groupId);
    if (isNaN(groupIdParam))
        return res.status(400).json({ message: 'Invalid group id' });
    const user = req.user;
    const resolved = await resolveChatGroupForRequest(groupIdParam, user);
    if (!resolved.allowed)
        return res.status(403).json({ message: resolved.reason });
    const { limit, before } = req.query;
    const messages = await chat_1.ChatService.getHistory(resolved.chatGroupId, limit ? Number(limit) : 50, before);
    return res.json({
        group_id: groupIdParam,
        kind: resolved.kind,
        messages,
    });
}));
// Get chat history for a group (auth + membership)
exports.router.get('/groups/:groupId/history', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    const user = req.user;
    if (isNaN(groupId))
        return res.status(400).json({ message: 'Invalid group id' });
    // Backward compatible alias for older clients
    const resolved = await resolveChatGroupForRequest(groupId, user);
    if (!resolved.allowed)
        return res.status(403).json({ message: resolved.reason });
    // Access rules:
    // - admin: always allowed
    // - teacher: allowed if he owns this group (grade group) OR is assigned to this package-subject group
    // - student: must be a member of the group
    if (user.role !== 'admin') {
        if (user.role === 'teacher') {
            const cgRes = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [groupId]);
            if (!cgRes.rowCount)
                return res.status(404).json({ message: 'Group not found' });
            const cg = cgRes.rows[0];
            if (cg.package_subject_group_id) {
                const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [cg.package_subject_group_id, user.id]);
                if (!ok.rowCount)
                    return res.status(403).json({ message: 'Not in this group' });
            }
            else {
                if (Number(cg.owner_teacher_id) !== user.id)
                    return res.status(403).json({ message: 'Not in this group' });
            }
        }
        else {
            const mem = await pool_1.default.query(`SELECT 1 FROM chat_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, user.id]);
            if (!mem.rowCount)
                return res.status(403).json({ message: 'Not in this group' });
        }
    }
    const { limit, before } = req.query;
    const history = await chat_1.ChatService.getHistory(resolved.chatGroupId, limit ? Number(limit) : 50, before);
    res.json({ messages: history });
}));
// List members in a group (teacher or admin)
exports.router.get('/groups/:groupId/members', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId))
        return res.status(400).json({ message: 'Invalid group id' });
    if (req.user.role === 'teacher') {
        const cgRes = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [groupId]);
        if (!cgRes.rowCount)
            return res.status(404).json({ message: 'Group not found' });
        const cg = cgRes.rows[0];
        if (cg.package_subject_group_id) {
            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [cg.package_subject_group_id, req.user.id]);
            if (!ok.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
        else {
            if (Number(cg.owner_teacher_id) !== req.user.id)
                return res.status(403).json({ message: 'Not allowed' });
        }
    }
    const members = await chat_1.ChatService.listMembers(groupId);
    res.json({ members });
}));
// Toggle student permission (teacher or admin)
exports.router.patch('/groups/:groupId/permission', (0, authentication_1.authMiddleware)(['teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    const { allow_student_send } = req.body;
    if (typeof allow_student_send !== 'boolean') {
        return res.status(400).json({ message: 'allow_student_send (boolean) is required' });
    }
    // Verify teacher owns this group (admin bypass)
    if (req.user.role === 'teacher') {
        const cgRes = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [groupId]);
        if (!cgRes.rowCount)
            return res.status(404).json({ message: 'Group not found' });
        const cg = cgRes.rows[0];
        if (cg.package_subject_group_id) {
            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [cg.package_subject_group_id, req.user.id]);
            if (!ok.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
        else {
            if (Number(cg.owner_teacher_id) !== req.user.id)
                return res.status(403).json({ message: 'Not allowed' });
        }
    }
    await chat_1.ChatService.setStudentPermission(groupId, allow_student_send);
    // broadcast via socket if available
    const appAny = req.app;
    if (typeof appAny.emitChatPermission === 'function') {
        appAny.emitChatPermission(groupId, allow_student_send);
    }
    res.json({ success: true });
}));
// Send message via REST (teacher or student member)
exports.router.post('/groups/:groupId/messages', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupIdParam = Number(req.params.groupId);
    if (isNaN(groupIdParam))
        return res.status(400).json({ message: 'Invalid group id' });
    // Accept both {message} (new) and {text} (legacy)
    const schema = zod_1.z.object({ message: zod_1.z.string().min(1).optional(), text: zod_1.z.string().min(1).optional() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({ message: 'message is required' });
    const text = (parsed.data.message ?? parsed.data.text ?? '').trim();
    if (!text)
        return res.status(400).json({ message: 'message is required' });
    const user = req.user;
    const replyTo = req.body?.reply_to ? Number(req.body.reply_to) : null;
    const resolved = await resolveChatGroupForRequest(groupIdParam, user);
    if (!resolved.allowed)
        return res.status(403).json({ message: resolved.reason });
    const chatGroupId = resolved.chatGroupId;
    // Access rules are same as socket send
    if (user.role === 'admin') {
        // allowed
    }
    else if (user.role === 'teacher') {
        const cg = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [chatGroupId]);
        if (!cg.rowCount)
            return res.status(404).json({ message: 'Group not found' });
        const row = cg.rows[0];
        if (row.package_subject_group_id) {
            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [row.package_subject_group_id, user.id]);
            if (!ok.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
        else {
            // grade chat: teacher must teach the grade
            const teachRes = await pool_1.default.query(`SELECT 1 FROM chat_groups cg JOIN teacher_grades tg ON tg.grade_id = cg.grade_id
         WHERE cg.id = $1 AND tg.teacher_id = $2`, [chatGroupId, user.id]);
            if (!teachRes.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
    }
    else {
        const mem = await pool_1.default.query(`SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2`, [chatGroupId, user.id]);
        if (!mem.rowCount)
            return res.status(403).json({ message: 'Not in this group' });
        const role = mem.rows[0].role;
        if (role === 'student') {
            const can = await chat_1.ChatService.canStudentSend(chatGroupId);
            if (!can)
                return res.status(403).json({ message: 'Sending disabled by teacher' });
        }
    }
    if (replyTo) {
        const r = await pool_1.default.query('SELECT id, group_id FROM chat_messages WHERE id = $1', [replyTo]);
        if (!r.rowCount || r.rows[0].group_id !== chatGroupId) {
            return res.status(400).json({ message: 'Invalid reply_to for this group' });
        }
    }
    const saved = await chat_1.ChatService.saveMessage(chatGroupId, user.id, text, replyTo);
    // إرسال إشعارات لأعضاء المجموعة
    try {
        const groupResult = await pool_1.default.query('SELECT name FROM chat_groups WHERE id = $1', [chatGroupId]);
        const groupName = groupResult.rows[0]?.name || 'المجموعة';
        // جلب اسم المستخدم من قاعدة البيانات
        const userResult = await pool_1.default.query('SELECT name FROM users WHERE id = $1', [user.id]);
        const senderName = user.role === 'admin' ? 'EM Academy' : (userResult.rows[0]?.name || 'مستخدم');
        await notifications_1.NotificationService.notifyGroupMessage(chatGroupId, user.id, senderName, text, groupName, saved.id);
    }
    catch (error) {
        console.error('خطأ في إرسال إشعارات الرسائل:', error);
    }
    const appAny = req.app;
    if (typeof appAny.emitChatMessage === 'function') {
        // For package groups: broadcast to room group_{packageGroupId}
        if (resolved.kind === 'package') {
            appAny.emitChatMessage(`group_${resolved.packageSubjectGroupId}`, saved);
        }
        else {
            appAny.emitChatMessage(chatGroupId, saved);
        }
    }
    res.status(201).json({ message: saved });
}));
// Send attachment (image/file) via REST
exports.router.post('/groups/:groupId/attachments', (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']), upload.single('file'), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (isNaN(groupId))
        return res.status(400).json({ message: 'Invalid group id' });
    const user = req.user;
    // Access rules
    if (user.role === 'admin') {
        // allowed
    }
    else if (user.role === 'teacher') {
        const cg = await pool_1.default.query(`SELECT id, owner_teacher_id, package_subject_group_id FROM chat_groups WHERE id = $1`, [groupId]);
        if (!cg.rowCount)
            return res.status(404).json({ message: 'Group not found' });
        const row = cg.rows[0];
        if (row.package_subject_group_id) {
            const ok = await pool_1.default.query(`SELECT 1 FROM package_subject_item_groups g WHERE g.id = $1 AND g.teacher_id = $2`, [row.package_subject_group_id, user.id]);
            if (!ok.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
        else {
            const teachRes = await pool_1.default.query(`SELECT 1 FROM chat_groups cg JOIN teacher_grades tg ON tg.grade_id = cg.grade_id
         WHERE cg.id = $1 AND tg.teacher_id = $2`, [groupId, user.id]);
            if (!teachRes.rowCount)
                return res.status(403).json({ message: 'Not allowed' });
        }
    }
    else {
        const mem = await pool_1.default.query(`SELECT role FROM chat_group_members WHERE group_id = $1 AND user_id = $2`, [groupId, user.id]);
        if (!mem.rowCount)
            return res.status(403).json({ message: 'Not in this group' });
        const role = mem.rows[0].role;
        if (role === 'student') {
            const can = await chat_1.ChatService.canStudentSend(groupId);
            if (!can)
                return res.status(403).json({ message: 'Sending disabled by teacher' });
        }
    }
    const file = req.file;
    const text = typeof req.body?.text === 'string' ? req.body.text : undefined;
    if (!file)
        return res
            .status(400)
            .json({ message: 'file is required (multipart/form-data, field "file")' });
    // Upload to cloudinary (or keep local if desired)
    const uploaded = await (0, utils_2.uploadToCloudinary)(file.path);
    const mime = file.mimetype;
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const saved = await chat_1.ChatService.saveAttachmentMessage(groupId, user.id, {
        url: uploaded.secure_url,
        type: isAudio ? 'audio' : isImage ? 'image' : 'file',
        name: file.originalname,
        mime,
        size: file.size,
        text: text ?? null,
        // اختياري: في حال إرسال مدة الصوت بالـ ms ضمن الحقول
        durationMs: req.body?.duration_ms ? Number(req.body.duration_ms) : null,
    });
    // إرسال إشعارات لأعضاء المجموعة
    try {
        const groupResult = await pool_1.default.query('SELECT name FROM chat_groups WHERE id = $1', [groupId]);
        const groupName = groupResult.rows[0]?.name || 'المجموعة';
        // جلب اسم المستخدم من قاعدة البيانات
        const userResult = await pool_1.default.query('SELECT name FROM users WHERE id = $1', [user.id]);
        const senderName = user.role === 'admin' ? 'EM Academy' : (userResult.rows[0]?.name || 'مستخدم');
        const messageText = text || (isImage ? 'صورة' : isAudio ? 'رسالة صوتية' : 'ملف');
        await notifications_1.NotificationService.notifyGroupMessage(groupId, user.id, senderName, messageText, groupName, saved.id);
    }
    catch (error) {
        console.error('خطأ في إرسال إشعارات الرسائل:', error);
    }
    const appAny = req.app;
    if (typeof appAny.emitChatMessage === 'function')
        appAny.emitChatMessage(groupId, saved);
    res.status(201).json({ message: saved });
}));
// Get chat notifications for student or teacher
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
exports.default = exports.router;
