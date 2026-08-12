import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CourseAccessControl,
  COURSE_CONTENT_ROLES,
} from '../services/courseAccessControl';
import { CourseGroupAccessService } from '../services/courseGroupAccess';

export const router = Router();

const SettingsSchema = z.object({
  course_group_access_enabled: z.boolean(),
});

const GroupSchema = z.object({
  grade_id: z.coerce.number().int().positive(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
});

const UpdateGroupSchema = z.object({
  grade_id: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  status: z.enum(['active', 'inactive']).optional(),
});

const AssignStudentSchema = z.object({
  student_id: z.coerce.number().int().positive(),
});

const StudentSelfGroupSchema = z.object({
  course_group_id: z.coerce.number().int().positive(),
  grade_id: z.coerce.number().int().positive().optional(),
});

function teacherOnly(user: { role: string }) {
  if (!['teacher', 'academy', 'academy_teacher', 'admin'].includes(user.role)) {
    throw new HttpError(403, 'غير مصرح');
  }
}

function resolveTeacherId(user: { id: number; role: string }): number {
  if (user.role === 'admin') {
    throw new HttpError(400, 'حدد teacher_id كـ admin عبر مسار المدرس');
  }
  return user.id;
}

// ─── Teacher settings ───────────────────────────────────────

router.get(
  '/settings',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    const settings = await CourseGroupAccessService.getTeacherSettings(teacherId);
    res.json({ success: true, ...settings });
  }),
);

router.patch(
  '/settings',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }
    const teacherId = resolveTeacherId(req.user!);
    const settings = await CourseGroupAccessService.updateTeacherSettings(
      teacherId,
      parsed.data,
    );
    res.json({ success: true, ...settings });
  }),
);

// ─── Groups CRUD ────────────────────────────────────────────

router.get(
  '/',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    const gradeId = req.query.grade_id ? Number(req.query.grade_id) : undefined;
    const includeInactive = req.query.include_inactive === 'true';
    const groups = await CourseGroupAccessService.listGroups(teacherId, {
      grade_id: gradeId,
      include_inactive: includeInactive,
    });
    res.json({ success: true, groups });
  }),
);

router.post(
  '/',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const parsed = GroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }
    const teacherId = resolveTeacherId(req.user!);
    const enabled = await CourseGroupAccessService.isGroupAccessEnabledForTeacher(teacherId);
    if (!enabled) {
      return res.status(400).json({
        message: 'فعّل نظام مجموعات الكورسات من الإعدادات أولاً',
        course_group_access_enabled: false,
      });
    }
    const group = await CourseGroupAccessService.createGroup({
      teacher_id: teacherId,
      ...parsed.data,
    });
    res.status(201).json({ success: true, group });
  }),
);

router.get(
  '/:groupId',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    const groupId = Number(req.params.groupId);
    const group = await CourseGroupAccessService.getGroupById(groupId, teacherId);
    if (!group) return res.status(404).json({ message: 'المجموعة غير موجودة' });
    res.json({ success: true, group });
  }),
);

router.patch(
  '/:groupId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const parsed = UpdateGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }
    const teacherId = resolveTeacherId(req.user!);
    const group = await CourseGroupAccessService.updateGroup(
      Number(req.params.groupId),
      teacherId,
      parsed.data,
    );
    res.json({ success: true, group });
  }),
);

router.delete(
  '/:groupId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    const group = await CourseGroupAccessService.deactivateGroup(
      Number(req.params.groupId),
      teacherId,
    );
    res.json({ success: true, message: 'تم تعطيل المجموعة', group });
  }),
);

// ─── Group students ─────────────────────────────────────────

router.get(
  '/:groupId/students',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    const students = await CourseGroupAccessService.listGroupStudents(
      Number(req.params.groupId),
      teacherId,
    );
    res.json({ success: true, students });
  }),
);

router.post(
  '/:groupId/students',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const parsed = AssignStudentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }
    const teacherId = resolveTeacherId(req.user!);
    const membership = await CourseGroupAccessService.assignStudentToGroup(
      parsed.data.student_id,
      Number(req.params.groupId),
      teacherId,
    );
    res.status(201).json({ success: true, membership });
  }),
);

router.delete(
  '/:groupId/students/:studentId',
  authMiddleware(['teacher', 'academy', 'admin']),
  asyncWrapper(async (req, res) => {
    teacherOnly(req.user!);
    const teacherId = resolveTeacherId(req.user!);
    await CourseGroupAccessService.removeStudentFromGroup(
      Number(req.params.studentId),
      Number(req.params.groupId),
      teacherId,
    );
    res.json({ success: true, message: 'تم إزالة الطالب من المجموعة' });
  }),
);

// ─── Student self-service (registration / profile) ──────────

router.get(
  '/me/membership',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const tenantId = (req as any).tenant?.id;
    if (!tenantId) return res.status(400).json({ message: 'Tenant context required' });

    const teacherId = await CourseGroupAccessService.resolveTenantOwnerTeacherId(tenantId);
    if (!teacherId) {
      return res.json({ success: true, course_group_access_enabled: false, membership: null });
    }

    const settings = await CourseGroupAccessService.getTeacherSettings(teacherId);
    const membership = settings.course_group_access_enabled
      ? await CourseGroupAccessService.getStudentMembershipForTeacher(req.user!.id, teacherId)
      : null;

    res.json({
      success: true,
      course_group_access_enabled: settings.course_group_access_enabled,
      membership,
    });
  }),
);

router.post(
  '/me/membership',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const parsed = StudentSelfGroupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }

    const tenantId = (req as any).tenant?.id;
    if (!tenantId) return res.status(400).json({ message: 'Tenant context required' });

    const teacherId = await CourseGroupAccessService.resolveTenantOwnerTeacherId(tenantId);
    if (!teacherId) {
      return res.status(400).json({ message: 'لا يمكن تحديد المدرس لهذه المنصة' });
    }

    const settings = await CourseGroupAccessService.getTeacherSettings(teacherId);
    if (!settings.course_group_access_enabled) {
      return res.status(400).json({
        message: 'نظام مجموعات الكورسات غير مفعّل على هذه المنصة',
        course_group_access_enabled: false,
      });
    }

    if (parsed.data.grade_id) {
      await pool.query(
        `INSERT INTO user_grades (user_id, grade_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [req.user!.id, parsed.data.grade_id],
      );
    }

    const membership = await CourseGroupAccessService.assignStudentToGroup(
      req.user!.id,
      parsed.data.course_group_id,
      teacherId,
    );

    res.json({ success: true, membership });
  }),
);

// ─── Lecture group targeting (teacher) ──────────────────────

router.get(
  '/lectures/:lectureId/groups',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const meta = await CourseGroupAccessService.getLectureAccessMeta(lectureId);
    if (!meta) return res.status(404).json({ message: 'المحاضرة غير موجودة' });

    if (req.user!.role !== 'admin') {
      await CourseAccessControl.assertCanManageCourse(req.user!, meta.course_id);
    }

    const groups = meta.group_ids.length
      ? await Promise.all(
          meta.group_ids.map((id) => CourseGroupAccessService.getGroupById(id, meta.teacher_id)),
        )
      : [];

    res.json({
      success: true,
      access_type: meta.access_type,
      group_ids: meta.group_ids,
      groups: groups.filter(Boolean),
    });
  }),
);

router.put(
  '/lectures/:lectureId/groups',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const accessType = String(req.body.access_type || 'all').trim() as 'all' | 'groups';
    if (!['all', 'groups'].includes(accessType)) {
      return res.status(400).json({ message: 'access_type يجب أن يكون all أو groups' });
    }

    const meta = await CourseGroupAccessService.getLectureAccessMeta(lectureId);
    if (!meta) return res.status(404).json({ message: 'المحاضرة غير موجودة' });

    if (req.user!.role !== 'admin') {
      await CourseAccessControl.assertCanManageCourse(req.user!, meta.course_id);
    }

    const groupIds = Array.isArray(req.body.group_ids)
      ? req.body.group_ids.map(Number)
      : Array.isArray(req.body.groupIds)
        ? req.body.groupIds.map(Number)
        : [];

    const updated = await CourseGroupAccessService.setLectureAccess(
      lectureId,
      meta.teacher_id,
      accessType,
      groupIds,
    );

    res.json({ success: true, ...updated });
  }),
);
