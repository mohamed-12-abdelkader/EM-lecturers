"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const execPromise = (0, node_util_1.promisify)(node_child_process_1.exec);
const livekit_server_sdk_1 = require("livekit-server-sdk");
const express_1 = require("express");
const authentication_1 = require("../middleware/authentication");
const utils_1 = require("../utils");
const pool_1 = __importDefault(require("../db/pool"));
const utils_2 = require("../utils");
const zod_1 = require("zod");
const validateReq_1 = require("../middleware/validateReq");
const meetings_1 = require("../middleware/meetings");
const meetings_room_services_1 = require("../services/meetings-room-services");
const uploadToYoutube_1 = require("../services/uploadToYoutube");
const teacherLivePackagePolicy_1 = require("../services/teacherLivePackagePolicy");
const router = (0, express_1.Router)();
exports.router = router;
const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL: LIVEKIT_SERVER_URL } = utils_2.config;
const roomService = new livekit_server_sdk_1.RoomServiceClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
const egressClient = new livekit_server_sdk_1.EgressClient(LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
/**
 * -------------------------
 * MEETING MANAGEMENT
 * -------------------------
 */
// Create meeting (Teacher/Admin)
router.post('/', (0, authentication_1.authMiddleware)(['teacher', 'admin']), meetings_1.singleActiveMeetingLimit, (0, validateReq_1.validate)(zod_1.z.object({
    title: zod_1.z.string().min(3, 'Title must be at least 3 characters long'),
    course_id: zod_1.z.coerce.number().int().positive(),
})), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { title, course_id } = req.body;
    const user = req.user;
    if (user.role === 'teacher') {
        await (0, teacherLivePackagePolicy_1.enforceTeacherLiveCreationLimit)(user.id);
    }
    const { rows } = await pool_1.default.query(`INSERT INTO meeting (title, course_id, created_by, status)
       VALUES ($1, $2, $3, 'idle')
       RETURNING *`, [title, course_id, user.id]);
    res.status(201).json({ message: 'Meeting created', meeting: rows[0] });
}));
// Update meeting (title و/أو حفظ رابط التسجيل egress_url)
router.put('/:id', meetings_1.isMeetingOwnerOrAdmin, (0, validateReq_1.validate)(zod_1.z.object({
    title: zod_1.z.string().min(3).optional(),
    egress_url: zod_1.z.union([zod_1.z.string().url(), zod_1.z.literal(null)]).optional(),
})), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id } = req.params;
    const { title, egress_url } = req.body;
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
        const { rows } = await pool_1.default.query(`SELECT * FROM meeting WHERE id = $1 LIMIT 1`, [id]);
        return res.json({ message: 'Meeting updated', meeting: rows[0] });
    }
    values.push(id);
    const { rows } = await pool_1.default.query(`UPDATE meeting SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`, values);
    res.json({ message: 'Meeting updated', meeting: rows[0] });
}));
// Delete meeting
router.delete('/:id', meetings_1.isMeetingOwnerOrAdmin, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id } = req.params;
    const { rows } = await pool_1.default.query(`DELETE FROM meeting
       WHERE id = $1
       RETURNING *`, [id]);
    // Also close room in LiveKit if still active
    try {
        await roomService.deleteRoom(rows[0].room_name);
    }
    catch (err) {
        console.warn('LiveKit room deletion failed or room not found:', err);
    }
    res.json({ message: 'Meeting deleted', meeting: rows[0] });
}));
// Close meeting room (كورس عادي أو جلسة مجموعة كورس عام)
router.post('/:id/close', meetings_1.isMeetingOwnerOrAdminOrGroupManager, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id } = req.params;
    const meetingSource = req.meetingSource;
    try {
        await roomService.deleteRoom(id);
    }
    catch {
        // ignore
    }
    if (meetingSource === 'general_course_group') {
        await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'ended' WHERE id = $1`, [id]);
    }
    else {
        await pool_1.default.query(`UPDATE meeting SET status = 'ended' WHERE id = $1`, [id]);
    }
    res.json({ message: 'Meeting closed' });
}));
// Update participant permissions
router.patch('/:id/participant/:participantId', meetings_1.isMeetingOwnerOrAdmin, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id, participantId } = req.params;
    const { permissions } = req.body;
    // Update participant in LiveKit
    await roomService.updateParticipant(id, participantId, undefined, {
        ...permissions,
        canSubscribe: true,
    });
    res.json({ message: 'Participant permissions updated' });
}));
// Toggle wave hand button visibility
router.patch('/:id/wavehand', meetings_1.isMeetingOwnerOrAdmin, // only host/moderator can do this
(0, validateReq_1.validate)(zod_1.z.object({
    visible: zod_1.z.boolean(), // expected true/false
})), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id: meetingId } = req.params;
    const { visible } = req.body;
    await roomService.updateRoomMetadata(meetingId, JSON.stringify({
        waveHandVisible: visible,
    }));
    res.json({
        message: `Done.`,
    });
}));
// Kick participant
router.post('/:id/participant/:participantId/kick', meetings_1.isMeetingOwnerOrAdmin, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id: meetingId, participantId } = req.params;
    await roomService.removeParticipant(meetingId, participantId);
    await pool_1.default.query(`INSERT INTO kicked_participants (meeting_id, user_id) VALUES ($1, $2)`, [
        meetingId,
        participantId,
    ]);
    res.json({ message: 'Participant kicked successfully.' });
}));
/**
 * -------------------------
 * MEETING ACCESS
 * -------------------------
 */
// Pre-join info
router.get('/:id/pre-join', (0, authentication_1.authMiddleware)(), meetings_1.getActiveMeeting, meetings_1.checkKickedStatus, meetings_1.checkMeetingAccess, (0, utils_1.asyncWrapper)(async (req, res) => {
    const meetingId = req.params.id;
    const meeting = req.meeting;
    const authUser = req.user;
    // Get participants count
    const participantsCount = await (0, meetings_room_services_1.getParticipantsCount)(meetingId, roomService);
    // Get user fresh from DB
    const { rows } = await pool_1.default.query(`SELECT id, name, avatar FROM users WHERE id = $1 LIMIT 1`, [
        authUser.id,
    ]);
    const dbUser = rows[0];
    const user = {
        id: dbUser.id,
        isOwner: dbUser.id === meeting.created_by,
        username: dbUser.name,
        avatar: dbUser.avatar,
    };
    // الطالب يمكنه الدخول فوراً دون انتظار وصول المحاضر (يعتمد الفرونت على canEnter لتفعيل زر الدخول)
    const canEnter = true;
    res.json({
        meeting: { ...req.meeting, participantsCount: participantsCount ?? 0 },
        user,
        canEnter,
    });
}));
// Download recording (Teacher/Admin)
router.get('/:id/recording/download', meetings_1.isMeetingOwnerOrAdmin, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { id } = req.params;
    const recordingPath = `/recordings/${id}.mp4`;
    const lowResPath = `/recordings/${id}_low.mp4`;
    if (!node_fs_1.default.existsSync(recordingPath)) {
        return res.status(404).json({ message: 'Recording not found' });
    }
    // If compressed version doesn't exist, create it
    if (!node_fs_1.default.existsSync(lowResPath)) {
        try {
            console.log(`Starting compression for ${id}...`);
            // -crf 28 is a good balance for size/quality
            // -preset faster makes it reasonably quick
            await execPromise(`ffmpeg -i "${recordingPath}" -vcodec libx264 -crf 28 -preset faster -acodec aac -b:a 128k "${lowResPath}"`);
            console.log(`Compression finished for ${id}`);
        }
        catch (err) {
            console.error('Compression error:', err);
            // If compression fails, fallback to original
            return res.download(recordingPath, `recording-${id}.mp4`);
        }
    }
    res.download(lowResPath, `recording-${id}-low.mp4`);
}));
// Connection details (LiveKit token)
router.get('/:id/connection', (0, authentication_1.authMiddleware)(), meetings_1.getActiveMeeting, meetings_1.checkKickedStatus, meetings_1.checkMeetingAccess, (0, utils_1.asyncWrapper)(async (req, res) => {
    try {
        const meetingId = req.params.id;
        const user = req.user;
        const meeting = req.meeting;
        const meetingSource = req.meetingSource;
        const isOwner = user.id === meeting.created_by;
        // عند دخول المحاضر (صاحب الجلسة) نحدّث الحالة إلى started فوراً حتى يظهر للطلاب أن الجلسة نشطة (بدون الاعتماد على webhook LiveKit)
        if (isOwner && meeting.status === 'idle') {
            if (meetingSource === 'general_course_group') {
                await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'started', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [meetingId]);
            }
            else {
                await pool_1.default.query(`UPDATE meeting SET status = 'started', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [meetingId]);
                // إشعار لحظي ودقيق عند البدء الفعلي للبث (للطلاب المشتركين في نفس الكورس فقط).
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    const courseInfo = await pool_1.default.query(`SELECT id, title FROM courses WHERE id = $1 LIMIT 1`, [
                        meeting.course_id,
                    ]);
                    if (courseInfo.rowCount && courseInfo.rowCount > 0) {
                        await NotificationService.notifyLiveStreamStarted(meeting.course_id, meeting.title, courseInfo.rows[0].title, true, meetingId);
                    }
                }
                catch (notifError) {
                    console.error('❌ [Notification] Error sending live-start notification:', notifError);
                }
            }
        }
        const participantName = (typeof req.query.name === 'string' && req.query.name.trim()) || user.name || 'Guest';
        const participantIdentity = `user_${user.id}_meeting_${meetingId}`;
        const participantToken = await (0, meetings_room_services_1.generateParticipantToken)({
            roomName: meetingId, // meeting.id is also the LiveKit room name
            identity: participantIdentity,
            name: participantName,
            role: isOwner ? 'host' : 'participant',
            allowChat: meeting.allow_chat !== false,
            metadata: JSON.stringify({
                avatar: user.avatar || null,
                role: isOwner ? 'host' : 'participant',
            }),
        });
        let screenShareToken;
        if (isOwner) {
            screenShareToken = await (0, meetings_room_services_1.generateParticipantToken)({
                roomName: meetingId, // meeting.id is also the LiveKit room name
                identity: `${participantIdentity}_screenShare`,
                name: participantName,
                role: 'host',
                metadata: JSON.stringify({
                    role: 'host',
                    hidden: true,
                }),
            });
        }
        return res.json({
            participantToken,
            screenShareToken,
            serverUrl: LIVEKIT_SERVER_URL,
            roomName: meetingId,
            participantName,
            isOwner,
        });
    }
    catch (err) {
        console.log('error', err);
    }
}));
// Get current active meeting
router.get('/me/current', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const result = await pool_1.default.query(`
      SELECT *
      FROM meeting
      WHERE created_by = $1
        AND status IN ('started', 'idle')
      ORDER BY created_at DESC
      LIMIT 1
      `, [user.id]);
    if (result.rowCount === 0) {
        return res.status(404).json({ message: 'No active meeting found' });
    }
    return res.json({ meeting: result.rows[0] });
}));
/**
 * -------------------------
 * MEETING LISTINGS
 * -------------------------
 */
// Get my meetings (optionally filter by course)
router.get('/me', (0, authentication_1.authMiddleware)(['admin', 'teacher']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const user = req.user;
    const { courseId, limit = 10, skip = 0 } = req.query;
    let query = `
      SELECT m.*
      FROM meeting m
      WHERE m.created_by = $1
    `;
    const params = [user.id];
    let paramIndex = 2;
    if (courseId) {
        query += ` AND m.course_id = $${paramIndex++}`;
        params.push(courseId);
    }
    query += ` ORDER BY m.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
    params.push(Number(limit), Number(skip));
    const result = await pool_1.default.query(query, params);
    res.json({
        meetings: result.rows,
        pagination: {
            limit: Number(limit),
            skip: Number(skip),
            count: result.rows.length,
        },
    });
}));
// Admin: list all meetings (optionally filter by course) with pagination
router.get('/', (0, authentication_1.authMiddleware)(['admin']), (0, utils_1.asyncWrapper)(async (req, res) => {
    const { courseId, limit = 10, skip = 0 } = req.query;
    const limitNum = Number(limit);
    const skipNum = Number(skip);
    // Base query
    let query = `
      SELECT m.*, u.name AS creator_name, c.title AS course_title
      FROM meeting m
      JOIN users u ON u.id = m.created_by
      JOIN courses c ON c.id = m.course_id
    `;
    const params = [];
    if (courseId) {
        query += ` WHERE m.course_id = $1`;
        params.push(courseId);
    }
    query += ` ORDER BY m.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, skipNum);
    const result = await pool_1.default.query(query, params);
    // Count total rows (for pagination UI)
    let countQuery = `SELECT COUNT(*) FROM meeting`;
    const countParams = [];
    if (courseId) {
        countQuery += ` WHERE course_id = $1`;
        countParams.push(courseId);
    }
    const countResult = await pool_1.default.query(countQuery, countParams);
    const total = Number(countResult.rows[0].count);
    res.json({
        meetings: result.rows,
        pagination: {
            total,
            page: Math.floor(skipNum / limitNum) + 1,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
        },
    });
}));
// Get meetings for a specific course
router.get('/course/:courseId', meetings_1.isEnrolledInMeetingCourse, (0, utils_1.asyncWrapper)(async (req, res) => {
    const { courseId } = req.params;
    const result = await pool_1.default.query(`
      SELECT m.*, u.name AS creator_name
      FROM meeting m
      JOIN users u ON u.id = m.created_by
      WHERE m.course_id = $1
      ORDER BY m.created_at DESC
      `, [courseId]);
    res.json({ meetings: result.rows });
}));
/**
 * -------------------------
 * WEBHOOKS
 * -------------------------
 */
const receiver = new livekit_server_sdk_1.WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
// Handle LiveKit events
router.post('/webhook', async (req, res) => {
    try {
        const event = await receiver.receive(req.body, req.get('Authorization'));
        if (event.event === 'room_started') {
            const { name, sid } = event.room;
            const updateResult = await pool_1.default.query(`UPDATE meeting SET status = 'started', room_sid = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 'idle'
         RETURNING *`, [sid, name]);
            let isGroupMeeting = false;
            if (updateResult.rowCount === 0) {
                const groupUpdate = await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'started', room_sid = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND status = 'idle'
           RETURNING *`, [sid, name]);
                if (groupUpdate.rowCount && groupUpdate.rowCount > 0) {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    isGroupMeeting = true;
                    try {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        const { NotificationService } = await import('../services/notifications');
                        const meeting = groupUpdate.rows[0];
                        const groupRow = await pool_1.default.query(`SELECT g.general_course_id, c.title FROM general_course_groups g
               JOIN general_courses c ON c.id = g.general_course_id WHERE g.id = $1`, [meeting.group_id]);
                        if (groupRow.rowCount) {
                            await NotificationService.notifyGeneralCourseGroupLiveStreamStarted(meeting.group_id, groupRow.rows[0].general_course_id, meeting.title, groupRow.rows[0].title, true);
                        }
                    }
                    catch (notifError) {
                        console.error('Error sending group live stream notification:', notifError);
                    }
                }
            }
            else {
                // إرسال إشعار للطلاب المشتركين في الكورس عند بدء البث المباشر
                try {
                    const meeting = updateResult.rows[0];
                    const courseInfo = await pool_1.default.query(`SELECT id, title FROM courses WHERE id = $1`, [meeting.course_id]);
                    if (courseInfo.rowCount && courseInfo.rowCount > 0) {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        const { NotificationService } = await import('../services/notifications');
                        await NotificationService.notifyLiveStreamStarted(meeting.course_id, meeting.title, courseInfo.rows[0].title, true, meeting.id);
                    }
                }
                catch (notifError) {
                    console.error('Error sending live stream notification:', notifError);
                }
            }
            // تسجيل البث (egress) للكورس العادي ومجموعات الكورس العام
            const egressToken = await (0, meetings_room_services_1.generateParticipantToken)({
                roomName: name,
                identity: `recorder_${Date.now()}`,
                name: 'egress',
                role: 'egress',
                ttl: '8760h',
            });
            const outputFile = new livekit_server_sdk_1.EncodedFileOutput({
                filepath: `/recordings/${name}.mp4`,
            });
            const egressOpt = {
                customBaseUrl: `https://lk-recording.next-edu.online?token=${egressToken}&url=${LIVEKIT_SERVER_URL}`,
                layout: 'grid',
            };
            await egressClient.startRoomCompositeEgress(name, outputFile, egressOpt);
        }
        else if (event.event === 'room_finished') {
            const sid = event.room.sid;
            const meetingUpdated = await pool_1.default.query(`UPDATE meeting SET status = 'ended' WHERE room_sid = $1 RETURNING id`, [sid]);
            if (meetingUpdated.rowCount === 0) {
                const groupUpdated = await pool_1.default.query(`UPDATE general_course_group_meeting SET status = 'ended' WHERE room_sid = $1 RETURNING id`, [sid]);
                if (groupUpdated.rowCount && groupUpdated.rowCount > 0) {
                    try {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-ignore
                        const { NotificationService } = await import('../services/notifications');
                        await NotificationService.removeLiveStreamNotificationsByMeetingId(groupUpdated.rows[0].id);
                    }
                    catch (notifError) {
                        console.error('Error removing ended group live notifications:', notifError);
                    }
                }
            }
            else {
                try {
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const { NotificationService } = await import('../services/notifications');
                    await NotificationService.removeLiveStreamNotificationsByMeetingId(meetingUpdated.rows[0].id);
                }
                catch (notifError) {
                    console.error('Error removing ended live notifications:', notifError);
                }
            }
        }
        else if (event.event === 'egress_ended') {
            const roomName = event.egressInfo?.roomName;
            if (!roomName) {
                console.warn('Room name not available in egress_ended event', event);
                return res.status(400).send('Room name missing');
            }
            const recordingFilePath = `/recordings/${roomName}.mp4`;
            let meetingTitle = null;
            let table = 'meeting';
            const meetingResult = await pool_1.default.query(`SELECT title FROM meeting WHERE id = $1 LIMIT 1`, [roomName]);
            if (meetingResult.rowCount && meetingResult.rowCount > 0) {
                meetingTitle = meetingResult.rows[0].title;
            }
            else {
                const groupResult = await pool_1.default.query(`SELECT title FROM general_course_group_meeting WHERE id = $1 LIMIT 1`, [roomName]);
                if (groupResult.rowCount && groupResult.rowCount > 0) {
                    meetingTitle = groupResult.rows[0].title;
                    table = 'general_course_group_meeting';
                }
            }
            if (!meetingTitle) {
                console.warn('Meeting not found for room:', roomName);
                return res.status(404).send('Meeting not found');
            }
            const ytResponse = await (0, uploadToYoutube_1.uploadToYouTube)({
                filePath: recordingFilePath,
                title: meetingTitle,
                privacyStatus: 'unlisted',
            });
            const youtubeLink = `https://www.youtube.com/watch?v=${ytResponse.id}`;
            if (table === 'meeting') {
                await pool_1.default.query(`UPDATE meeting SET egress_url = $1 WHERE id = $2`, [youtubeLink, roomName]);
            }
            else {
                await pool_1.default.query(`UPDATE general_course_group_meeting SET egress_url = $1 WHERE id = $2`, [youtubeLink, roomName]);
            }
        }
        res.status(200).send('OK');
    }
    catch (err) {
        console.error('Webhook error:', err);
        res.status(500).send('Error handling webhook');
    }
});
