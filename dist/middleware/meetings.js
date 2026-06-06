"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEnrolledInMeetingCourse = exports.isMeetingOwnerOrAdmin = exports.checkKickedStatus = exports.singleActiveMeetingLimit = exports.getActiveMeeting = exports.haveActiveMeeting = exports.checkMeetingAccess = exports.isMeetingOwnerOrAdminOrGroupManager = exports.checkMeetingManagementAccess = exports.getMeetingForManagement = void 0;
const pool_1 = __importDefault(require("../db/pool"));
const authentication_1 = require("./authentication");
/**
 * Middleware to check if the current user is the meeting owner or an admin.
 */
const checkMeetingOwnerOrAdmin = async (req, res, next) => {
    const user = req.user;
    const meetingId = req.params.id;
    try {
        const { rows, rowCount } = await pool_1.default.query(`SELECT * 
       FROM meeting 
       WHERE id = $1 
       LIMIT 1`, [meetingId]);
        if (rowCount === 0) {
            return res.status(404).json({ message: 'Meeting not found' });
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        req.meeting = rows[0];
        const ownerId = rows[0].created_by;
        if (user.role === 'admin' || user.id === ownerId) {
            return next();
        }
        return res.status(403).json({ message: 'You are not authorized to manage this meeting' });
    }
    catch (err) {
        console.error('Error in checkMeetingOwnerOrAdmin:', err);
        return res
            .status(500)
            .json({ message: 'Internal server error while checking meeting ownership' });
    }
};
/**
 * يحمّل الجلسة من جدول الكورس العادي أو من جدول مجموعة الكورس العام (لإدارة: close, put, delete, participant, kick).
 */
const getMeetingForManagement = async (req, res, next) => {
    const meetingId = req.params.id;
    try {
        let result = await pool_1.default.query(`SELECT * FROM meeting WHERE id = $1 LIMIT 1`, [meetingId]);
        if (result.rowCount && result.rowCount > 0) {
            req.meeting = result.rows[0];
            req.meetingSource = 'course';
            return next();
        }
        result = await pool_1.default.query(`SELECT * FROM general_course_group_meeting WHERE id = $1 LIMIT 1`, [meetingId]);
        if (result.rowCount && result.rowCount > 0) {
            req.meeting = result.rows[0];
            req.meetingSource = 'general_course_group';
            return next();
        }
        return res.status(404).json({ message: 'Meeting not found' });
    }
    catch (err) {
        console.error('Error in getMeetingForManagement:', err);
        return res.status(500).json({ message: 'Error fetching meeting' });
    }
};
exports.getMeetingForManagement = getMeetingForManagement;
/**
 * يتحقق من صلاحية إدارة الجلسة: أدمن، أو صاحب الجلسة، أو (للمجموعة) مدرس المجموعة.
 */
const checkMeetingManagementAccess = async (req, res, next) => {
    const user = req.user;
    const meeting = req.meeting;
    const meetingSource = req.meetingSource;
    if (user.role === 'admin' || meeting.created_by === user.id) {
        return next();
    }
    if (meetingSource === 'general_course_group' && meeting.group_id && user.role === 'teacher') {
        const r = await pool_1.default.query('SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2 LIMIT 1', [meeting.group_id, user.id]);
        if (r.rowCount && r.rowCount > 0)
            return next();
    }
    return res.status(403).json({ message: 'You are not authorized to manage this meeting' });
};
exports.checkMeetingManagementAccess = checkMeetingManagementAccess;
/** مصفوفة middleware موحّدة: تحميل الجلسة (كورس أو مجموعة) + التحقق من صلاحية الإدارة */
exports.isMeetingOwnerOrAdminOrGroupManager = [
    (0, authentication_1.authMiddleware)(['teacher', 'admin']),
    exports.getMeetingForManagement,
    exports.checkMeetingManagementAccess,
];
/**
 * قائمة اجتماعات كورس: أدمن، أو مدرّس صاحب الكورس، أو طالب مشترك في الكورس.
 */
const checkMeetingCourseMeetingsListAccess = async (req, res, next) => {
    const user = req.user;
    const { courseId } = req.params;
    try {
        const { rows, rowCount } = await pool_1.default.query(`SELECT id, teacher_id FROM courses WHERE id = $1 LIMIT 1`, [courseId]);
        if (!rowCount) {
            return res.status(404).json({ message: 'Course not found' });
        }
        const course = rows[0];
        if (user.role === 'admin') {
            return next();
        }
        if (user.role === 'teacher' && course.teacher_id === user.id) {
            return next();
        }
        if (user.role === 'student') {
            const { rowCount: enrollmentCount } = await pool_1.default.query(`SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2 LIMIT 1`, [user.id, courseId]);
            if (enrollmentCount && enrollmentCount > 0) {
                return next();
            }
            return res.status(403).json({ message: 'You are not enrolled in this course' });
        }
        return res.status(403).json({ message: 'You are not authorized to view meetings for this course' });
    }
    catch (err) {
        console.error('Error in checkMeetingCourseMeetingsListAccess:', err);
        return res.status(500).json({ message: 'Internal server error while checking course access' });
    }
};
const checkMeetingAccess = async (req, res, next) => {
    const user = req.user;
    const meeting = req.meeting;
    const meetingId = req.params.id;
    const meetingSource = req.meetingSource;
    try {
        // ✅ 1. Admin check
        if (user.role === 'admin') {
            return next();
        }
        // ✅ 2. Owner check
        if (meeting.created_by === user.id) {
            return next();
        }
        // ✅ 3a. جلسة مجموعة كورس عام: طالب مسجل في المجموعة أو مدرس المجموعة
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        if (meetingSource === 'general_course_group' && meeting.group_id) {
            const groupCheck = await pool_1.default.query(`SELECT 1 FROM general_course_enrollments WHERE group_id = $1 AND student_id = $2
         UNION ALL
         SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2
         LIMIT 1`, 
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-ignore
            [meeting.group_id, user.id]);
            if (groupCheck.rowCount && groupCheck.rowCount > 0) {
                return next();
            }
            return res.status(403).json({
                message: 'You are not authorized to access this meeting',
            });
        }
        // ✅ 3b. كورس عادي: التحقق من الاشتراك
        const { rowCount } = await pool_1.default.query(`SELECT 1 
       FROM enrollments e
       JOIN courses c ON c.id = e.course_id
       JOIN meeting m ON m.course_id = c.id
       WHERE e.user_id = $1 AND m.id = $2
       LIMIT 1`, [user.id, meetingId]);
        if (rowCount && rowCount > 0) {
            return next();
        }
        return res.status(403).json({
            message: 'You are not authorized to access this meeting',
        });
    }
    catch (err) {
        console.error('Error in checkMeetingAccess middleware:', err);
        return res.status(500).json({ message: 'Internal server error while checking access' });
    }
};
exports.checkMeetingAccess = checkMeetingAccess;
const haveActiveMeeting = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const result = await pool_1.default.query(`SELECT id, title
       FROM meeting
       WHERE created_by = $1 AND status = 'started'
       LIMIT 1`, [userId]);
        if (result.rowCount && result.rowCount === 0) {
            return res.status(404).json({ error: 'No active meeting found.' });
        }
        return next();
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error checking active meeting' });
    }
};
exports.haveActiveMeeting = haveActiveMeeting;
const getActiveMeeting = async (req, res, next) => {
    try {
        const meetingId = req.params.id;
        let result = await pool_1.default.query(`SELECT *
       FROM meeting
       WHERE id = $1 AND status IN ('started', 'idle')
       LIMIT 1`, [meetingId]);
        if (result.rowCount && result.rowCount > 0) {
            req.meeting = result.rows[0];
            req.meetingSource = 'course';
            return next();
        }
        result = await pool_1.default.query(`SELECT *
       FROM general_course_group_meeting
       WHERE id = $1 AND status IN ('started', 'idle')
       LIMIT 1`, [meetingId]);
        if (result.rowCount && result.rowCount > 0) {
            req.meeting = result.rows[0];
            req.meetingSource = 'general_course_group';
            return next();
        }
        return res.status(404).json({ message: 'Active meeting not found' });
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error fetching active meeting' });
    }
};
exports.getActiveMeeting = getActiveMeeting;
const singleActiveMeetingLimit = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const result = await pool_1.default.query(`SELECT 1
       FROM meeting
       WHERE created_by = $1 AND status IN ('started', 'idle')
       LIMIT 1`, [userId]);
        if (result.rowCount && result.rowCount > 0) {
            return res.status(400).json({
                message: 'You already have an active meeting. Close it before creating a new one.',
            });
        }
        return next();
    }
    catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Error checking meeting creation limit' });
    }
};
exports.singleActiveMeetingLimit = singleActiveMeetingLimit;
/**
 * Middleware: Checks if the current student is already kicked from this meeting.
 */
const checkKickedStatus = async (req, res, next) => {
    const { id: meetingId } = req.params;
    const userId = req.user.id;
    const meetingSource = req.meetingSource;
    if (meetingSource === 'general_course_group') {
        const result = await pool_1.default.query(`SELECT 1 FROM general_course_group_meeting_kicked
       WHERE meeting_id = $1 AND user_id = $2`, [meetingId, userId]);
        if (result.rowCount && result.rowCount > 0) {
            return res.status(403).json({
                message: 'You have been removed from this meeting and cannot rejoin.',
            });
        }
        return next();
    }
    const result = await pool_1.default.query(`SELECT 1 FROM kicked_participants
     WHERE meeting_id = $1 AND user_id = $2`, [meetingId, userId]);
    if (result.rowCount && result.rowCount > 0) {
        return res.status(403).json({
            message: 'You have been removed from this meeting and cannot rejoin.',
        });
    }
    return next();
};
exports.checkKickedStatus = checkKickedStatus;
exports.isMeetingOwnerOrAdmin = [
    (0, authentication_1.authMiddleware)(['teacher', 'admin']),
    checkMeetingOwnerOrAdmin,
];
exports.isEnrolledInMeetingCourse = [
    (0, authentication_1.authMiddleware)(['student', 'teacher', 'admin']),
    checkMeetingCourseMeetingsListAccess,
];
