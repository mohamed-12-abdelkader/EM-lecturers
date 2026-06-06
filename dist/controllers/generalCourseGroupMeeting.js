"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const livekit_server_sdk_1 = require("livekit-server-sdk");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const utils_2 = require("../utils");
const zod_1 = require("zod");
const meetings_room_services_1 = require("../services/meetings-room-services");
const teacherLivePackagePolicy_1 = require("../services/teacherLivePackagePolicy");
const router = (0, express_1.Router)();
exports.router = router;
const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL: LIVEKIT_SERVER_URL } = utils_2.config;
const roomService = new livekit_server_sdk_1.RoomServiceClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
async function canManageGroup(groupId, userId, role) {
    if (role === 'admin')
        return true;
    if (role !== 'teacher')
        return false;
    const r = await pool_1.default.query('SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2', [groupId, userId]);
    return (r.rowCount ?? 0) > 0;
}
async function loadGroupMeeting(meetingId) {
    const result = await pool_1.default.query(`SELECT * FROM general_course_group_meeting WHERE id = $1 LIMIT 1`, [meetingId]);
    return result.rowCount ? result.rows[0] : null;
}
async function singleActiveMeetingLimit(userId) {
    const [normal, group] = await Promise.all([
        pool_1.default.query(`SELECT 1 FROM meeting WHERE created_by = $1 AND status IN ('started', 'idle') LIMIT 1`, [userId]),
        pool_1.default.query(`SELECT 1 FROM general_course_group_meeting WHERE created_by = $1 AND status IN ('started', 'idle') LIMIT 1`, [userId]),
    ]);
    return (normal.rowCount ?? 0) > 0 || (group.rowCount ?? 0) > 0;
}
async function isEnrolledInGroup(groupId, userId) {
    const r = await pool_1.default.query(`SELECT 1 FROM general_course_enrollments WHERE group_id = $1 AND student_id = $2 LIMIT 1`, [groupId, userId]);
    return (r.rowCount ?? 0) > 0;
}
// إنشاء جلسة بث مباشر لمجموعة
router.post('/groups/:groupId/meeting', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const user = req.user;
    if (user.role === 'teacher') {
        await (0, teacherLivePackagePolicy_1.enforceTeacherLiveCreationLimit)(user.id);
    }
    const allowed = await canManageGroup(groupId, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية إدارة هذه المجموعة' });
    }
    const hasActive = await singleActiveMeetingLimit(user.id);
    if (hasActive) {
        return res.status(400).json({
            success: false,
            message: 'لديك بالفعل جلسة بث نشطة. يُرجى إنهاؤها قبل إنشاء جلسة جديدة.',
        });
    }
    const parse = zod_1.z.object({ title: zod_1.z.string().min(3, 'العنوان 3 أحرف على الأقل') }).safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: parse.error.errors });
    }
    const title = parse.data.title;
    const groupCheck = await pool_1.default.query('SELECT id, general_course_id FROM general_course_groups WHERE id = $1', [groupId]);
    if (!groupCheck.rowCount) {
        return res.status(404).json({ success: false, message: 'المجموعة غير موجودة' });
    }
    const general_course_id = groupCheck.rows[0].general_course_id;
    const insert = await pool_1.default.query(`INSERT INTO general_course_group_meeting (group_id, title, created_by, status)
       VALUES ($1, $2, $3, 'idle') RETURNING *`, [groupId, title, user.id]);
    const meeting = insert.rows[0];
    try {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { NotificationService } = await import('../services/notifications');
        const courseInfo = await pool_1.default.query('SELECT id, title FROM general_courses WHERE id = $1', [general_course_id]);
        if (courseInfo.rowCount) {
            await NotificationService.notifyGeneralCourseGroupLiveStreamStarted(groupId, general_course_id, meeting.title, courseInfo.rows[0].title, false);
        }
    }
    catch (e) {
        console.error('Error sending group meeting notification:', e);
    }
    res.status(201).json({ success: true, message: 'تم إنشاء جلسة البث بنجاح', meeting });
}));
// جلب جلسات البث لمجموعة
router.get('/groups/:groupId/meetings', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const user = req.user;
    const allowed = await canManageGroup(groupId, user.id, user.role);
    if (!allowed) {
        return res.status(403).json({ success: false, message: 'ليس لديك صلاحية عرض جلسات هذه المجموعة' });
    }
    const result = await pool_1.default.query(`SELECT m.*, u.name AS creator_name
       FROM general_course_group_meeting m
       JOIN users u ON u.id = m.created_by
       WHERE m.group_id = $1
       ORDER BY m.created_at DESC`, [groupId]);
    res.json({ success: true, meetings: result.rows });
}));
// تحديث جلسة بث (العنوان و/أو حفظ رابط التسجيل egress_url — مثل الكورس العادي)
router.put('/meeting/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بتعديل هذه الجلسة' });
    }
    const parse = zod_1.z
        .object({
        title: zod_1.z.string().min(3).optional(),
        egress_url: zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal(null)]).optional(),
    })
        .safeParse(req.body);
    if (!parse.success) {
        return res.status(400).json({ success: false, message: 'بيانات غير صحيحة', errors: parse.error.errors });
    }
    const { title, egress_url } = parse.data;
    const updates = ['updated_at = CURRENT_TIMESTAMP'];
    const values = [];
    let idx = 1;
    if (title !== undefined) {
        updates.push(`title = $${idx++}`);
        values.push(title);
    }
    if (egress_url !== undefined) {
        updates.push(`egress_url = $${idx++}`);
        values.push(egress_url);
    }
    if (values.length === 0) {
        return res.json({ success: true, message: 'تم التحديث', meeting });
    }
    values.push(meetingId);
    const result = await pool_1.default.query(`UPDATE general_course_group_meeting SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values);
    res.json({ success: true, message: 'تم التحديث', meeting: result.rows[0] });
}));
// حذف جلسة بث
router.delete('/meeting/:id', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بحذف هذه الجلسة' });
    }
    try {
        await roomService.deleteRoom(meetingId);
    }
    catch {
        // ignore
    }
    await pool_1.default.query('DELETE FROM general_course_group_meeting WHERE id = $1', [meetingId]);
    res.json({ success: true, message: 'تم حذف جلسة البث' });
}));
// إنهاء غرفة البث
router.post('/meeting/:id/close', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بإنهاء هذه الجلسة' });
    }
    try {
        await roomService.deleteRoom(meetingId);
    }
    catch {
        // ignore
    }
    await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'ended' WHERE id = $1`, [meetingId]);
    res.json({ success: true, message: 'تم إنهاء الجلسة' });
}));
// تحديث صلاحيات مشارك (مثل الكورس العادي)
router.patch('/meeting/:id/participant/:participantId', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const { participantId } = req.params;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بإدارة هذه الجلسة' });
    }
    const { permissions } = req.body;
    await roomService.updateParticipant(meetingId, participantId, undefined, {
        ...permissions,
        canSubscribe: true,
    });
    res.json({ success: true, message: 'تم تحديث صلاحيات المشارك' });
}));
// إظهار/إخفاء زر رفع اليد (مثل الكورس العادي)
router.patch('/meeting/:id/wavehand', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بإدارة هذه الجلسة' });
    }
    const visible = req.body?.visible === true;
    await roomService.updateRoomMetadata(meetingId, JSON.stringify({ waveHandVisible: visible }));
    res.json({ success: true, message: 'تم التحديث' });
}));
// إخراج مشارك من الجلسة (participantId = user_id رقمياً)
router.post('/meeting/:id/participant/:participantId/kick', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const participantIdParam = req.params.participantId;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    const user = req.user;
    const allowed = await canManageGroup(meeting.group_id, user.id, user.role);
    if (!allowed && meeting.created_by !== user.id) {
        return res.status(403).json({ success: false, message: 'غير مصرح بإخراج مشارك من هذه الجلسة' });
    }
    const userId = Number(participantIdParam);
    if (Number.isNaN(userId)) {
        return res.status(400).json({ success: false, message: 'معرف المشارك غير صحيح' });
    }
    const liveKitIdentity = `user_${userId}_meeting_${meetingId}`;
    try {
        await roomService.removeParticipant(meetingId, liveKitIdentity);
    }
    catch (e) {
        console.warn('LiveKit removeParticipant:', e);
    }
    await pool_1.default.query(`INSERT INTO general_course_group_meeting_kicked (meeting_id, user_id) VALUES ($1, $2)`, [meetingId, userId]);
    res.json({ success: true, message: 'تم إخراج المشارك بنجاح' });
}));
// معلومات قبل الدخول (للطالب/المدرس)
router.get('/meeting/:id/pre-join', (0, authentication_1.authMiddleware)(), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    if (meeting.status === 'ended') {
        return res.status(404).json({ success: false, message: 'انتهت جلسة البث' });
    }
    const user = req.user;
    const canAccess = user.role === 'admin' ||
        meeting.created_by === user.id ||
        (user.role === 'student' && (await isEnrolledInGroup(meeting.group_id, user.id))) ||
        (user.role === 'teacher' && (await canManageGroup(meeting.group_id, user.id, user.role)));
    if (!canAccess) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بالدخول لهذه الجلسة' });
    }
    const kicked = await pool_1.default.query(`SELECT 1 FROM general_course_group_meeting_kicked WHERE meeting_id = $1 AND user_id = $2`, [meetingId, user.id]);
    if (kicked.rowCount) {
        return res.status(403).json({ success: false, message: 'تم إخراجك من هذه الجلسة ولا يمكنك إعادة الدخول' });
    }
    const participantsCount = await (0, meetings_room_services_1.getParticipantsCount)(meetingId, roomService);
    const userRow = await pool_1.default.query('SELECT id, name, avatar FROM users WHERE id = $1 LIMIT 1', [user.id]);
    const dbUser = userRow.rows[0] || { id: user.id, name: user.name, avatar: null };
    const isOwner = meeting.created_by === user.id;
    // الطالب يمكنه الدخول فوراً دون انتظار وصول المحاضر (الفرونت يعتمد على canEnter لتفعيل زر الدخول)
    const canEnter = true;
    res.json({
        meeting: { ...meeting, participantsCount: participantsCount ?? 0 },
        user: {
            id: dbUser.id,
            isOwner,
            username: dbUser.name,
            avatar: dbUser.avatar,
        },
        canEnter,
    });
}));
// الحصول على توكن الدخول (LiveKit)
router.get('/meeting/:id/connection', (0, authentication_1.authMiddleware)(), (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = await loadGroupMeeting(meetingId);
    if (!meeting) {
        return res.status(404).json({ success: false, message: 'جلسة البث غير موجودة' });
    }
    if (meeting.status === 'ended') {
        return res.status(404).json({ success: false, message: 'انتهت جلسة البث' });
    }
    const user = req.user;
    const canAccess = user.role === 'admin' ||
        meeting.created_by === user.id ||
        (user.role === 'student' && (await isEnrolledInGroup(meeting.group_id, user.id))) ||
        (user.role === 'teacher' && (await canManageGroup(meeting.group_id, user.id, user.role)));
    if (!canAccess) {
        return res.status(403).json({ success: false, message: 'غير مصرح لك بالدخول لهذه الجلسة' });
    }
    const kicked = await pool_1.default.query(`SELECT 1 FROM general_course_group_meeting_kicked WHERE meeting_id = $1 AND user_id = $2`, [meetingId, user.id]);
    if (kicked.rowCount) {
        return res.status(403).json({ success: false, message: 'تم إخراجك من هذه الجلسة' });
    }
    const isOwner = meeting.created_by === user.id;
    // عند دخول المحاضر نحدّث الحالة إلى started فوراً حتى يظهر للطلاب أن الجلسة نشطة
    if (isOwner && meeting.status === 'idle') {
        await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'started', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [meetingId]);
    }
    const participantName = (typeof req.query.name === 'string' && req.query.name.trim()) || user.name || 'Guest';
    const participantIdentity = `user_${user.id}_meeting_${meetingId}`;
    const participantToken = await (0, meetings_room_services_1.generateParticipantToken)({
        roomName: meetingId,
        identity: participantIdentity,
        name: participantName,
        role: isOwner ? 'host' : 'participant',
        allowChat: meeting.allow_chat !== false,
        metadata: JSON.stringify({ avatar: user.avatar || null, role: isOwner ? 'host' : 'participant' }),
    });
    let screenShareToken;
    if (isOwner) {
        screenShareToken = await (0, meetings_room_services_1.generateParticipantToken)({
            roomName: meetingId,
            identity: `${participantIdentity}_screenShare`,
            name: participantName,
            role: 'host',
            metadata: JSON.stringify({ role: 'host', hidden: true }),
        });
    }
    res.json({
        participantToken,
        screenShareToken,
        serverUrl: LIVEKIT_SERVER_URL,
        roomName: meetingId,
        participantName,
        isOwner,
    });
}));
// جلسة البث النشطة الحالية (مدرس/أدمن) — تبحث في الجلسات العادية وجلسات المجموعات
router.get('/meeting/me/current', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const normal = await pool_1.default.query(`SELECT *, 'course' as source FROM meeting WHERE created_by = $1 AND status IN ('started', 'idle') ORDER BY created_at DESC LIMIT 1`, [user.id]);
    if (normal.rowCount) {
        return res.json({ meeting: normal.rows[0], source: 'course' });
    }
    const group = await pool_1.default.query(`SELECT *, 'general_course_group' as source FROM general_course_group_meeting WHERE created_by = $1 AND status IN ('started', 'idle') ORDER BY created_at DESC LIMIT 1`, [user.id]);
    if (group.rowCount) {
        return res.json({ meeting: group.rows[0], source: 'general_course_group' });
    }
    return res.status(404).json({ success: false, message: 'لا توجد جلسة بث نشطة' });
}));
// جلسات مجموعة (للطالب المشترك في المجموعة)
router.get('/groups/:groupId/meetings/student', (0, authentication_1.authMiddleware)(['student']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
        return res.status(400).json({ success: false, message: 'معرف المجموعة غير صحيح' });
    }
    const user = req.user;
    const enrolled = await isEnrolledInGroup(groupId, user.id);
    if (!enrolled) {
        return res.status(403).json({ success: false, message: 'أنت غير مسجل في هذه المجموعة' });
    }
    const result = await pool_1.default.query(`SELECT m.*, u.name AS creator_name
       FROM general_course_group_meeting m
       JOIN users u ON u.id = m.created_by
       WHERE m.group_id = $1
       ORDER BY m.created_at DESC`, [groupId]);
    res.json({ success: true, meetings: result.rows });
}));
