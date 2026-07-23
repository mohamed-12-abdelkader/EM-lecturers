import { Request, Response, NextFunction } from 'express';
import pool from '../db/pool';
import { authMiddleware } from './authentication';
import { CourseAccessService } from '../services/courseAccess';

/**
 * Middleware to check if the current user is the meeting owner or an admin.
 */
const checkMeetingOwnerOrAdmin = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user!;
  const meetingId = req.params.id;

  try {
    const { rows, rowCount } = await pool.query<{ created_by: number }>(
      `SELECT * 
       FROM meeting 
       WHERE id = $1 
       LIMIT 1`,
      [meetingId],
    );

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
  } catch (err) {
    console.error('Error in checkMeetingOwnerOrAdmin:', err);
    return res
      .status(500)
      .json({ message: 'Internal server error while checking meeting ownership' });
  }
};

/**
 * يحمّل الجلسة من جدول الكورس العادي أو من جدول مجموعة الكورس العام (لإدارة: close, put, delete, participant, kick).
 */
export const getMeetingForManagement = async (req: Request, res: Response, next: NextFunction) => {
  const meetingId = req.params.id;
  try {
    let result = await pool.query(`SELECT * FROM meeting WHERE id = $1 LIMIT 1`, [meetingId]);
    if (result.rowCount && result.rowCount > 0) {
      (req as any).meeting = result.rows[0];
      (req as any).meetingSource = 'course' as MeetingSource;
      return next();
    }
    result = await pool.query(
      `SELECT * FROM general_course_group_meeting WHERE id = $1 LIMIT 1`,
      [meetingId],
    );
    if (result.rowCount && result.rowCount > 0) {
      (req as any).meeting = result.rows[0];
      (req as any).meetingSource = 'general_course_group' as MeetingSource;
      return next();
    }
    return res.status(404).json({ message: 'Meeting not found' });
  } catch (err) {
    console.error('Error in getMeetingForManagement:', err);
    return res.status(500).json({ message: 'Error fetching meeting' });
  }
};

/**
 * يتحقق من صلاحية إدارة الجلسة: أدمن، أو صاحب الجلسة، أو (للمجموعة) مدرس المجموعة.
 */
export const checkMeetingManagementAccess = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user!;
  const meeting = (req as any).meeting;
  const meetingSource = (req as any).meetingSource as MeetingSource | undefined;

  if (user.role === 'admin' || meeting.created_by === user.id) {
    return next();
  }
  if (meetingSource === 'general_course_group' && meeting.group_id && user.role === 'teacher') {
    const r = await pool.query(
      'SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2 LIMIT 1',
      [meeting.group_id, user.id],
    );
    if (r.rowCount && r.rowCount > 0) return next();
  }
  return res.status(403).json({ message: 'You are not authorized to manage this meeting' });
};

/** مصفوفة middleware موحّدة: تحميل الجلسة (كورس أو مجموعة) + التحقق من صلاحية الإدارة */
export const isMeetingOwnerOrAdminOrGroupManager = [
  authMiddleware(['teacher', 'admin']),
  getMeetingForManagement,
  checkMeetingManagementAccess,
];

/**
 * قائمة اجتماعات كورس: أدمن، أو مدرّس صاحب الكورس، أو طالب مشترك / كورس مجاني.
 */
const checkMeetingCourseMeetingsListAccess = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user!;
  const { courseId } = req.params;

  try {
    const { rows, rowCount } = await pool.query<{
      id: number;
      teacher_id: number;
      is_free: boolean;
    }>(
      `SELECT id, teacher_id, COALESCE(is_free, FALSE) AS is_free
       FROM courses
       WHERE id = $1
       LIMIT 1`,
      [courseId],
    );

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
      if (course.is_free === true) {
        return next();
      }

      const access = await CourseAccessService.checkStudentAccess(user.id, Number(courseId));
      if (access.hasAccess) {
        return next();
      }
      return res.status(403).json({ message: 'You are not enrolled in this course' });
    }

    return res.status(403).json({ message: 'You are not authorized to view meetings for this course' });
  } catch (err) {
    console.error('Error in checkMeetingCourseMeetingsListAccess:', err);
    return res.status(500).json({ message: 'Internal server error while checking course access' });
  }
};

export const checkMeetingAccess = async (req: Request, res: Response, next: NextFunction) => {
  const user = req.user!;
  const meeting = req.meeting!;
  const meetingId = req.params.id;
  const meetingSource = (req as any).meetingSource as MeetingSource | undefined;

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
      const groupCheck = await pool.query(
        `SELECT 1 FROM general_course_enrollments WHERE group_id = $1 AND student_id = $2
         UNION ALL
         SELECT 1 FROM general_course_groups WHERE id = $1 AND teacher_id = $2
         LIMIT 1`,
           // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
        [meeting.group_id, user.id],
      );
      if (groupCheck.rowCount && groupCheck.rowCount > 0) {
        return next();
      }
      return res.status(403).json({
        message: 'You are not authorized to access this meeting',
      });
    }

    // ✅ 3b. كورس عادي: تحقق من الاشتراك أو أن الكورس مجاني
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const courseId = meeting.course_id as number | undefined;
    if (courseId) {
      const access = await CourseAccessService.checkStudentAccess(user.id, courseId);
      if (access.hasAccess) {
        return next();
      }
    }

    return res.status(403).json({
      message: 'You are not authorized to access this meeting',
    });
  } catch (err) {
    console.error('Error in checkMeetingAccess middleware:', err);
    return res.status(500).json({ message: 'Internal server error while checking access' });
  }
};

export const haveActiveMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT id, title
       FROM meeting
       WHERE created_by = $1 AND status = 'started'
       LIMIT 1`,
      [userId],
    );

    if (result.rowCount && result.rowCount === 0) {
      return res.status(404).json({ error: 'No active meeting found.' });
    }

    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error checking active meeting' });
  }
};

/** 'course' = meeting (كورس عادي), 'general_course_group' = جلسة مجموعة كورس عام */
export type MeetingSource = 'course' | 'general_course_group';

export const getActiveMeeting = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const meetingId = req.params.id;

    let result = await pool.query(
      `SELECT *
       FROM meeting
       WHERE id = $1 AND status IN ('started', 'idle')
       LIMIT 1`,
      [meetingId],
    );

    if (result.rowCount && result.rowCount > 0) {
      (req as any).meeting = result.rows[0];
      (req as any).meetingSource = 'course' as MeetingSource;
      return next();
    }

    result = await pool.query(
      `SELECT *
       FROM general_course_group_meeting
       WHERE id = $1 AND status IN ('started', 'idle')
       LIMIT 1`,
      [meetingId],
    );

    if (result.rowCount && result.rowCount > 0) {
      (req as any).meeting = result.rows[0];
      (req as any).meetingSource = 'general_course_group' as MeetingSource;
      return next();
    }

    return res.status(404).json({ message: 'Active meeting not found' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error fetching active meeting' });
  }
};

export const singleActiveMeetingLimit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const result = await pool.query(
      `SELECT 1
       FROM meeting
       WHERE created_by = $1 AND status IN ('started', 'idle')
       LIMIT 1`,
      [userId],
    );

    if (result.rowCount && result.rowCount > 0) {
      return res.status(400).json({
        message: 'You already have an active meeting. Close it before creating a new one.',
      });
    }

    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Error checking meeting creation limit' });
  }
};

/**
 * Middleware: Checks if the current student is already kicked from this meeting.
 */
export const checkKickedStatus = async (req: Request, res: Response, next: NextFunction) => {
  const { id: meetingId } = req.params;
  const userId = req.user!.id;
  const meetingSource = (req as any).meetingSource as MeetingSource | undefined;

  if (meetingSource === 'general_course_group') {
    const result = await pool.query(
      `SELECT 1 FROM general_course_group_meeting_kicked
       WHERE meeting_id = $1 AND user_id = $2`,
      [meetingId, userId],
    );
    if (result.rowCount && result.rowCount > 0) {
      return res.status(403).json({
        message: 'You have been removed from this meeting and cannot rejoin.',
      });
    }
    return next();
  }

  const result = await pool.query(
    `SELECT 1 FROM kicked_participants
     WHERE meeting_id = $1 AND user_id = $2`,
    [meetingId, userId],
  );

  if (result.rowCount && result.rowCount > 0) {
    return res.status(403).json({
      message: 'You have been removed from this meeting and cannot rejoin.',
    });
  }

  return next();
};

export const isMeetingOwnerOrAdmin = [
  authMiddleware(['teacher', 'admin']),
  checkMeetingOwnerOrAdmin,
];

export const isEnrolledInMeetingCourse = [
  authMiddleware(['student', 'teacher', 'admin']),
  checkMeetingCourseMeetingsListAccess,
];
