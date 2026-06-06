import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper } from '../utils';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';
import { PackageSubjectLessonService } from '../services/packageSubjectLessons';
import { PackageActivationCodeService } from '../services/packageActivationCodes';
import pool from '../db/pool';
import { PackageSubjectVideosService } from '../services/packageSubjectVideos';
import { PackageSubjectAssignmentsService } from '../services/packageSubjectAssignments';
import { PackageSubjectLessonFilesService } from '../services/packageSubjectLessonFiles';
import { PackageSubjectLessonExamsService } from '../services/packageSubjectLessonExams';

export const router = Router();

const CreateGroupSchema = z.object({
  name: z.string().min(1),
  teacher_id: z.number().int().positive().optional().nullable(),
  schedule_days: z.array(z.string().min(1)).optional().nullable(),
  schedule_time: z.string().min(1).optional().nullable(),
});

const AddStudentsSchema = z.object({
  student_ids: z.array(z.number().int().positive()).min(1),
});

const UpdateGroupSchema = z
  .object({
    name: z.string().min(1).optional(),
    teacher_id: z.number().int().positive().optional().nullable(),
    schedule_days: z.array(z.string().min(1)).optional().nullable(),
    schedule_time: z.string().min(1).optional().nullable(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.teacher_id !== undefined ||
      v.schedule_days !== undefined ||
      v.schedule_time !== undefined,
    { message: 'يجب إرسال حقل واحد على الأقل للتعديل' }
  );

// Admin: create group inside subject
router.post(
  '/:subjectId(\\d+)/groups',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const subjectExists = await PackageSubjectLessonService.subjectExists(subjectId);
    if (!subjectExists) return res.status(404).json({ error: 'المادة غير موجودة' });

    const parse = CreateGroupSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }

    const user = req.user!;
    const group = await PackageSubjectGroupsService.createGroup(subjectId, parse.data, user.id);

    return res.status(201).json({ success: true, group });
  })
);

// Admin: update group (name/teacher/schedule)
router.put(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const parse = UpdateGroupSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }

    const updated = await PackageSubjectGroupsService.updateGroup(groupId, parse.data);
    return res.json({ success: true, group: updated });
  })
);

// Admin: delete group
router.delete(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const ok = await PackageSubjectGroupsService.deleteGroup(groupId);
    return res.json({ success: true, deleted: ok });
  })
);

// Admin/Teacher(owner): group details + stats
router.get(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const user = (req as any).user;
    if (user.role === 'teacher') {
      const ok = await PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const statsRes = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM package_subject_item_group_students WHERE group_id = $1) AS students,
         (SELECT COUNT(*)::int FROM package_subject_item_lessons WHERE group_id = $1) AS lessons`,
      [groupId]
    );

    return res.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        teacher_id: group.teacher_id,
        schedule_days: group.schedule_days ?? null,
        schedule_time: group.schedule_time ?? null,
      },
      stats: statsRes.rows[0] ?? { students: 0, lessons: 0 },
    });
  })
);

// Admin/Teacher(owner): create lesson inside a group
router.post(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/lessons',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const user = (req as any).user;
    if (user.role === 'teacher') {
      const ok = await PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

    const parsed = z
      .object({
        title: z.string().min(1),
        description: z.string().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Validation failed', errors: parsed.error.errors });

    const lesson = await PackageSubjectLessonService.createLesson(
      subjectId,
      { ...parsed.data, group_id: groupId },
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
      user.id
    );

    return res.status(201).json({ success: true, lesson });
  })
);

// Admin/Teacher(owner): get full group content (lessons + videos + files + exams + assignments)
router.get(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/content',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const user = (req as any).user;
    if (user.role === 'teacher') {
      const ok = await PackageSubjectGroupsService.teacherOwnsGroup(groupId, user.id);
      if (!ok) return res.status(403).json({ error: 'Forbidden' });
    }

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const lessons = await PackageSubjectLessonService.getLessonsBySubject(subjectId, false, groupId);
    const lessonsWithContent = await Promise.all(
      lessons.map(async (lesson: any) => {
        const videos = await PackageSubjectVideosService.getVideosByLesson(lesson.id);
        const files = await PackageSubjectLessonFilesService.getFilesByLesson(lesson.id);
        const exams = await PackageSubjectLessonExamsService.getExamsByLesson(lesson.id, false);
        const assignments = await PackageSubjectAssignmentsService.getAssignmentsByLesson(lesson.id, false);
        return { ...lesson, videos, files, exams, assignments };
      })
    );

    return res.json({
      success: true,
      group: {
        id: group.id,
        name: group.name,
        teacher_id: group.teacher_id,
        schedule_days: group.schedule_days ?? null,
        schedule_time: group.schedule_time ?? null,
      },
      lessons: lessonsWithContent,
      total: lessonsWithContent.length,
    });
  })
);

// Admin: list all groups for subject
router.get(
  '/:subjectId(\\d+)/groups',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });
    const groups = await PackageSubjectGroupsService.listGroupsForSubject(subjectId);
    return res.json({ success: true, subject_id: subjectId, groups, total: groups.length });
  })
);

// Teacher: list my groups inside a subject
router.get(
  '/:subjectId(\\d+)/groups/mine',
  authMiddleware(['teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });
    const groups = await PackageSubjectGroupsService.listTeacherGroupsForSubject(subjectId, req.user!.id);
    return res.json({ success: true, subject_id: subjectId, groups, total: groups.length });
  })
);

// Admin: list "waiting list" students for subject (activated package but not assigned to any group in this subject)
router.get(
  '/:subjectId(\\d+)/waiting-students',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });

    const subjectRes = await pool.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectRes.rowCount) return res.status(404).json({ error: 'المادة غير موجودة' });

    const packageId = subjectRes.rows[0].package_id as number;

    const waitingRes = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.avatar, pa.activated_at
       FROM package_activations pa
       JOIN users u ON u.id = pa.student_id
       WHERE pa.package_id = $1
         AND pa.is_active = TRUE
         AND pa.activation_code_id IS NOT NULL
         AND u.role = 'student'
         AND NOT EXISTS (
           SELECT 1
           FROM package_subject_item_group_students gs
           WHERE gs.package_subject_item_id = $2
             AND gs.student_id = pa.student_id
         )
       ORDER BY pa.activated_at DESC`,
      [packageId, subjectId]
    );

    return res.json({
      success: true,
      subject_id: subjectId,
      package_id: packageId,
      students: waitingRes.rows,
      total: waitingRes.rows.length,
    });
  })
);

// Admin: add students to group
router.post(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/students',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const parse = AddStudentsSchema.safeParse(req.body);
    if (!parse.success) {
      return res.status(400).json({ error: 'Validation failed', errors: parse.error.errors });
    }

    const requestedStudentIds = parse.data.student_ids;

    // hard validation: all provided student_ids must exist and be role=student
    const existingStudentsRes = await pool.query(
      `SELECT id
       FROM users
       WHERE id = ANY($1::int[])
         AND role = 'student'`,
      [requestedStudentIds]
    );
    const existingStudentIds = new Set<number>(existingStudentsRes.rows.map((r: any) => r.id));
    const missing_student_ids = requestedStudentIds.filter((sid) => !existingStudentIds.has(sid));
    if (missing_student_ids.length > 0) {
      return res.status(404).json({
        success: false,
        message: 'لا يمكن إضافة بعض الطلاب لأنهم غير موجودين',
        missing_student_ids,
      });
    }

    // enforce: student must be subscribed/activated to the package (code-based) before being added to any group
    const subjectRes = await pool.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectRes.rowCount) return res.status(404).json({ error: 'المادة غير موجودة' });
    const packageId = subjectRes.rows[0].package_id as number;

    const activatedRes = await pool.query(
      `SELECT student_id
       FROM package_activations
       WHERE package_id = $1
         AND student_id = ANY($2::int[])
         AND is_active = TRUE
         AND activation_code_id IS NOT NULL`,
      [packageId, requestedStudentIds]
    );
    const activatedSet = new Set<number>(activatedRes.rows.map((r: any) => r.student_id));
    const not_subscribed_student_ids = requestedStudentIds.filter((sid) => !activatedSet.has(sid));
    const eligibleStudentIds = requestedStudentIds.filter((sid) => activatedSet.has(sid));

    const result = await PackageSubjectGroupsService.addStudentsToGroup(groupId, eligibleStudentIds, req.user!.id);
    return res.json({
      success: true,
      group_id: groupId,
      not_subscribed_student_ids,
      ...result,
      message:
        (not_subscribed_student_ids.length > 0 ? 'تم تخطي طلاب غير مشتركين في الباقة. ' : '') +
        (result.skipped_already_in_other_group && result.skipped_already_in_other_group > 0
          ? 'تم تخطي من هم موجودون بالفعل في مجموعة أخرى لنفس المادة. '
          : '') +
        'تمت العملية بنجاح',
    });
  })
);

// Admin/Teacher (own): list students in group
router.get(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/students',
  authMiddleware(['admin', 'teacher']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    if (req.user!.role === 'teacher') {
      const ok = await PackageSubjectGroupsService.teacherOwnsGroup(groupId, req.user!.id);
      if (!ok) return res.status(403).json({ error: 'Forbidden', message: 'ليس لديك صلاحية' });
    }

    const students = await PackageSubjectGroupsService.listGroupStudents(groupId);
    return res.json({ success: true, group_id: groupId, students, total: students.length });
  })
);

// Admin: unassign (remove) teacher from group
router.delete(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/teacher',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    if (isNaN(subjectId) || isNaN(groupId)) return res.status(400).json({ error: 'Invalid IDs' });

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const updated = await PackageSubjectGroupsService.unassignTeacherFromGroup(groupId);
    return res.json({
      success: true,
      message: 'تم إلغاء تعيين المدرس من المجموعة بنجاح',
      group: updated,
    });
  })
);

// Admin: remove student from group
router.delete(
  '/:subjectId(\\d+)/groups/:groupId(\\d+)/students/:studentId(\\d+)',
  authMiddleware(['admin']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    const groupId = parseInt(req.params.groupId);
    const studentId = parseInt(req.params.studentId);
    if (isNaN(subjectId) || isNaN(groupId) || isNaN(studentId)) {
      return res.status(400).json({ error: 'Invalid IDs' });
    }

    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    if (!group || group.package_subject_item_id !== subjectId) {
      return res.status(404).json({ error: 'المجموعة غير موجودة' });
    }

    const ok = await PackageSubjectGroupsService.removeStudentFromGroup(groupId, studentId);
    if (!ok) {
      return res.status(404).json({ error: 'الطالب غير موجود في هذه المجموعة' });
    }

    return res.json({
      success: true,
      message: 'تم حذف الطالب من المجموعة بنجاح',
      group_id: groupId,
      student_id: studentId,
    });
  })
);

// Student: get my group schedule inside a subject (seamless)
router.get(
  '/:subjectId(\\d+)/my-group',
  authMiddleware(['student']),
  asyncWrapper(async (req: Request, res: Response) => {
    const subjectId = parseInt(req.params.subjectId);
    if (isNaN(subjectId)) return res.status(400).json({ error: 'Invalid subject ID' });

    // verify package activation first (code-based)
    const subjectResult = await pool.query('SELECT package_id FROM package_subject_items WHERE id = $1', [subjectId]);
    if (!subjectResult.rowCount) return res.status(404).json({ error: 'المادة غير موجودة' });
    const packageId = subjectResult.rows[0].package_id;
    const activated = await PackageActivationCodeService.isActivated(packageId, req.user!.id);
    if (!activated) {
      return res.status(403).json({ success: false, message: 'غير مسموح الوصول، فعل الباقة أولاً' });
    }

    const groupId = await PackageSubjectGroupsService.getStudentGroupForSubject(subjectId, req.user!.id);
    if (!groupId) {
      return res.status(403).json({ success: false, message: 'لم يتم إضافتك إلى مجموعة داخل هذه المادة بعد' });
    }
    const group = await PackageSubjectGroupsService.getGroupById(groupId);
    return res.json({
      success: true,
      group,
      schedule: {
        days: group?.schedule_days ?? null,
        time: group?.schedule_time ?? null,
      },
    });
  })
);


