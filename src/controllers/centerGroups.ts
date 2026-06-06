import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { CenterGroupsService } from '../services/centerGroups';
import pool from '../db/pool';

const router = Router();

/**
 * Add student to center group
 * POST /api/center-groups/:groupId/students
 * Body: { name } required; { phone, parent_phone } optional
 */
router.post(
  '/:groupId/students',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const { name, phone, parent_phone } = req.body;

    // الاسم مطلوب فقط — رقم التليفون وولي الأمر اختياري
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ message: 'name is required' });
    }

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership (teacher must own the group, admin can access any)
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({ message: 'You do not have permission to add students to this group' });
    }

    // Add student to group
    const result = await CenterGroupsService.addStudentToGroup(
      groupId,
      name.trim(),
      phone?.trim() || null,
      parent_phone?.trim() || null,
    );

    res.status(201).json({
      message: 'تم إضافة الطالب للمجموعة بنجاح',
      student: result,
    });
  }),
);

/**
 * Add multiple students to center group (names only)
 * POST /api/center-groups/:groupId/students/bulk
 * Body: { names: string[] }
 */
router.post(
  '/:groupId/students/bulk',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const { names } = req.body;

    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({
        message: 'names is required and must be a non-empty array of student names',
      });
    }

    if (names.some((n) => typeof n !== 'string')) {
      return res.status(400).json({
        message: 'all names must be strings',
      });
    }

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership (teacher must own the group, admin can access any)
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({ message: 'You do not have permission to add students to this group' });
    }

    const result = await CenterGroupsService.addStudentsByNamesToGroup(groupId, names);

    return res.status(201).json({
      message: `تمت إضافة ${result.added.length} طالب بنجاح`,
      added_count: result.added.length,
      failed_count: result.failed,
      added_students: result.added,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  }),
);

/**
 * Get students in center group
 * GET /api/center-groups/:groupId/students
 */
router.get(
  '/:groupId/students',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership (teacher must own the group, admin can access any)
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({ message: 'You do not have permission to view students in this group' });
    }

    // Get students and add QR payload + image for each
    const students = await CenterGroupsService.getGroupStudents(groupId);
    const studentsWithQr = await Promise.all(
      students.map(async (s) => {
        const qrPayload = CenterGroupsService.generateAttendanceQrPayload(groupId, s.student_id);
        const qrCodeDataUrl = await CenterGroupsService.generateQrDataUrl(qrPayload);
        return { ...s, qrPayload, qrCodeDataUrl };
      }),
    );

    res.json({
      group: {
        id: group.id,
        name: group.name,
      },
      students: studentsWithQr,
      count: studentsWithQr.length,
    });
  }),
);

/**
 * Get detailed student information in group with attendance
 * GET /api/center-groups/:groupId/students/:studentId
 */
router.get(
  '/:groupId/students/:studentId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const studentId = Number(req.params.studentId);

    if (Number.isNaN(groupId) || Number.isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid group id or student id' });
    }

    const { start_date, end_date, include_attendance } = req.query;

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({
        message: 'You do not have permission to view student details in this group',
      });
    }

    // Verify student is in group
    const membershipRes = await pool.query(
      `SELECT gs.id, gs.joined_at
       FROM group_students gs
       WHERE gs.group_id = $1 AND gs.student_id = $2`,
      [groupId, studentId],
    );

    if (!membershipRes.rowCount) {
      return res.status(404).json({ message: 'Student is not a member of this group' });
    }

    const membership = membershipRes.rows[0];

    // Get student details
    const studentRes = await pool.query(
      `SELECT id, name, phone, parent_phone, email, avatar, created_at
       FROM users WHERE id = $1`,
      [studentId],
    );

    if (!studentRes.rowCount) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const student = studentRes.rows[0];

    // Get attendance if requested
    let attendance = null;
    let attendanceStatistics = null;

    if (include_attendance !== 'false') {
      attendance = await CenterGroupsService.getStudentAttendance(
        groupId,
        studentId,
        start_date as string | undefined,
        end_date as string | undefined,
      );

      // Calculate statistics
      const totalDays = attendance.length;
      const presentDays = attendance.filter((a) => a.status === 'present').length;
      const absentDays = attendance.filter((a) => a.status === 'absent').length;
      const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

      // Get present and absent dates
      const presentDates = attendance
        .filter((a) => a.status === 'present')
        .map((a) => ({
          date: a.date,
          created_at: a.created_at,
        }));

      const absentDates = attendance
        .filter((a) => a.status === 'absent')
        .map((a) => ({
          date: a.date,
          created_at: a.created_at,
        }));

      attendanceStatistics = {
        total_days: totalDays,
        present_days: presentDays,
        absent_days: absentDays,
        attendance_rate: attendanceRate,
        present_dates: presentDates,
        absent_dates: absentDates,
      };
    }

    const qrPayload = CenterGroupsService.generateAttendanceQrPayload(groupId, studentId);
    const qrCodeDataUrl = await CenterGroupsService.generateQrDataUrl(qrPayload);

    res.json({
      group: {
        id: group.id,
        name: group.name,
      },
      student: {
        id: student.id,
        name: student.name,
        phone: student.phone,
        parent_phone: student.parent_phone,
        email: student.email,
        avatar: student.avatar,
        created_at: student.created_at,
        qrPayload,
        qrCodeDataUrl,
      },
      membership: {
        id: membership.id,
        joined_at: membership.joined_at,
      },
      attendance: attendance || undefined,
      statistics: attendanceStatistics,
      date_range: start_date && end_date ? { start_date, end_date } : null,
    });
  }),
);

/**
 * Record attendance by scanning student QR code
 * POST /api/center-groups/:groupId/attendance/scan
 * Body: { qr_payload: "<JWT from QR code>" }
 * Records presence for today. Teacher/admin must own the group.
 */
router.post(
  '/:groupId/attendance/scan',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const qrPayload = req.body.qr_payload ?? req.body.qrPayload;
    if (!qrPayload || typeof qrPayload !== 'string') {
      return res.status(400).json({
        message: 'qr_payload is required (string from scanned QR code)',
      });
    }

    let decoded: { groupId: number; studentId: number };
    try {
      decoded = CenterGroupsService.verifyAttendanceQrPayload(qrPayload.trim());
    } catch {
      return res.status(400).json({ message: 'رمز QR غير صالح أو منتهي الصلاحية' });
    }

    if (decoded.groupId !== groupId) {
      return res.status(400).json({
        message: 'رمز QR لا ينتمي لهذه المجموعة',
      });
    }

    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );
    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }
    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({
        message: 'You do not have permission to record attendance for this group',
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const attendance = await CenterGroupsService.recordAttendance(
      groupId,
      decoded.studentId,
      today,
      'present',
    );

    res.status(201).json({
      message: 'تم تسجيل الحضور بنجاح',
      attendance,
    });
  }),
);

/**
 * Record attendance for a student
 * POST /api/center-groups/:groupId/attendance
 */
router.post(
  '/:groupId/attendance',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const { student_id, date, status } = req.body;

    // Validate required fields
    if (!student_id || !date || !status) {
      return res.status(400).json({
        message: 'student_id, date, and status are required',
      });
    }

    // Validate status
    if (!['present', 'absent'].includes(status)) {
      return res.status(400).json({
        message: "status must be 'present' or 'absent'",
      });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        message: 'Invalid date format. Use YYYY-MM-DD',
      });
    }

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({
        message: 'You do not have permission to record attendance for this group',
      });
    }

    // Record attendance
    const attendance = await CenterGroupsService.recordAttendance(
      groupId,
      Number(student_id),
      date,
      status,
    );

    res.status(201).json({
      message: 'تم تسجيل الحضور بنجاح',
      attendance,
    });
  }),
);

/**
 * Record attendance for multiple students (bulk)
 * POST /api/center-groups/:groupId/attendance/bulk
 */
router.post(
  '/:groupId/attendance/bulk',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const { date, attendance } = req.body;

    // Validate required fields
    if (!date || !attendance || !Array.isArray(attendance)) {
      return res.status(400).json({
        message: 'date and attendance array are required',
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        message: 'Invalid date format. Use YYYY-MM-DD',
      });
    }

    // Validate attendance array
    if (attendance.length === 0) {
      return res.status(400).json({
        message: 'attendance array cannot be empty',
      });
    }

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({
        message: 'You do not have permission to record attendance for this group',
      });
    }

    // Record bulk attendance
    const result = await CenterGroupsService.recordBulkAttendance(groupId, date, attendance);

    res.status(201).json({
      message: `تم تسجيل الحضور لـ ${result.recorded} طالب بنجاح`,
      recorded: result.recorded,
      failed: result.failed,
      errors: result.errors.length > 0 ? result.errors : undefined,
    });
  }),
);

/**
 * Get attendance for a specific date
 * GET /api/center-groups/:groupId/attendance
 */
router.get(
  '/:groupId/attendance',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    if (Number.isNaN(groupId)) {
      return res.status(400).json({ message: 'Invalid group id' });
    }

    const { date } = req.query;

    // If date is provided, get attendance for that date
    if (date) {
      // Validate date format
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(date as string)) {
        return res.status(400).json({
          message: 'Invalid date format. Use YYYY-MM-DD',
        });
      }

      // Verify group exists
      const groupRes = await pool.query(
        `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
        [groupId],
      );

      if (!groupRes.rowCount) {
        return res.status(404).json({ message: 'Group not found' });
      }

      const group = groupRes.rows[0];
      const requesterId = (req as any).user.id;
      const requesterRole = (req as any).user.role;

      // Verify ownership
      if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
        return res.status(403).json({
          message: 'You do not have permission to view attendance for this group',
        });
      }

      // Get attendance for date
      const attendance = await CenterGroupsService.getAttendanceByDate(groupId, date as string);

      // Get all students in group to show who hasn't been marked
      const allStudents = await CenterGroupsService.getGroupStudents(groupId);
      const markedStudentIds = new Set(attendance.map((a) => a.student_id));
      const unmarkedStudents = allStudents.filter((s) => !markedStudentIds.has(s.student_id));

      res.json({
        group: {
          id: group.id,
          name: group.name,
        },
        date,
        attendance,
        unmarked_students: unmarkedStudents.map((s) => ({
          student_id: s.student_id,
          name: s.name,
          phone: s.phone,
        })),
        summary: {
          total_students: allStudents.length,
          marked: attendance.length,
          present: attendance.filter((a) => a.status === 'present').length,
          absent: attendance.filter((a) => a.status === 'absent').length,
          unmarked: unmarkedStudents.length,
        },
      });
    } else {
      // If no date, return summary for all time or date range
      const { start_date, end_date } = req.query;

      // Verify group exists
      const groupRes = await pool.query(
        `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
        [groupId],
      );

      if (!groupRes.rowCount) {
        return res.status(404).json({ message: 'Group not found' });
      }

      const group = groupRes.rows[0];
      const requesterId = (req as any).user.id;
      const requesterRole = (req as any).user.role;

      // Verify ownership
      if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
        return res.status(403).json({
          message: 'You do not have permission to view attendance for this group',
        });
      }

      // Get attendance summary
      const summary = await CenterGroupsService.getAttendanceSummary(
        groupId,
        start_date as string | undefined,
        end_date as string | undefined,
      );

      res.json({
        group: {
          id: group.id,
          name: group.name,
        },
        date_range: start_date && end_date ? { start_date, end_date } : null,
        summary,
      });
    }
  }),
);

/**
 * Get attendance for a specific student
 * GET /api/center-groups/:groupId/attendance/students/:studentId
 */
router.get(
  '/:groupId/attendance/students/:studentId',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const groupId = Number(req.params.groupId);
    const studentId = Number(req.params.studentId);

    if (Number.isNaN(groupId) || Number.isNaN(studentId)) {
      return res.status(400).json({ message: 'Invalid group id or student id' });
    }

    const { start_date, end_date } = req.query;

    // Verify group exists
    const groupRes = await pool.query(
      `SELECT id, teacher_id, name FROM study_groups WHERE id = $1`,
      [groupId],
    );

    if (!groupRes.rowCount) {
      return res.status(404).json({ message: 'Group not found' });
    }

    const group = groupRes.rows[0];
    const requesterId = (req as any).user.id;
    const requesterRole = (req as any).user.role;

    // Verify ownership
    if (requesterRole === 'teacher' && group.teacher_id !== requesterId) {
      return res.status(403).json({
        message: 'You do not have permission to view attendance for this group',
      });
    }

    // Get student attendance
    const attendance = await CenterGroupsService.getStudentAttendance(
      groupId,
      studentId,
      start_date as string | undefined,
      end_date as string | undefined,
    );

    // Calculate statistics
    const totalDays = attendance.length;
    const presentDays = attendance.filter((a) => a.status === 'present').length;
    const absentDays = attendance.filter((a) => a.status === 'absent').length;
    const attendanceRate = totalDays > 0 ? Math.round((presentDays / totalDays) * 100) : 0;

    // Get student info
    const studentRes = await pool.query(
      `SELECT id, name, phone, parent_phone FROM users WHERE id = $1`,
      [studentId],
    );

    res.json({
      group: {
        id: group.id,
        name: group.name,
      },
      student: studentRes.rows[0] || null,
      attendance,
      statistics: {
        total_days: totalDays,
        present_days: presentDays,
        absent_days: absentDays,
        attendance_rate: attendanceRate,
      },
      date_range: start_date && end_date ? { start_date, end_date } : null,
    });
  }),
);

export { router };
