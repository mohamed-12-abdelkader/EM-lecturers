import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { validate } from '../middleware/validateReq';
import { asyncWrapper, upload, uploadToCloudinary } from '../utils';
import { AcademyService } from '../services/academy/service';

export const router = Router();

const CreateTeacherBody = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional().nullable(),
  subject: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  avatar: z.string().optional().nullable(),
  grade_ids: z.array(z.coerce.number().int().positive()).optional(),
  whatsapp_number: z.string().optional().nullable(),
  facebook_url: z.string().optional().nullable(),
  instagram_url: z.string().optional().nullable(),
  youtube_url: z.string().optional().nullable(),
  tiktok_url: z.string().optional().nullable(),
});

const UpdateTeacherBody = CreateTeacherBody.partial().extend({
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
});

const AssignBody = z.object({
  teacher_user_id: z.coerce.number().int().positive(),
  is_primary: z.boolean().optional().default(true),
});

// ─── Academy owner ─────────────────────────────────────────

router.get(
  '/overview',
  authMiddleware(['academy']),
  asyncWrapper(async (req, res) => {
    const data = await AcademyService.getOverview(req.user!);
    res.json({ success: true, data });
  }),
);

router.get(
  '/teachers',
  authMiddleware(['academy']),
  asyncWrapper(async (req, res) => {
    const data = await AcademyService.listTeachers(req.user!);
    res.json({ success: true, data });
  }),
);

router.post(
  '/teachers',
  authMiddleware(['academy']),
  upload.single('avatar'),
  asyncWrapper(async (req, res) => {
    let body = req.body;
    // multipart may send grade_ids as string
    if (typeof body.grade_ids === 'string') {
      try {
        body = { ...body, grade_ids: JSON.parse(body.grade_ids) };
      } catch {
        body = {
          ...body,
          grade_ids: String(body.grade_ids)
            .split(',')
            .map((x: string) => Number(x.trim()))
            .filter((n: number) => n > 0),
        };
      }
    }
    const parsed = CreateTeacherBody.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.issues,
      });
    }

    let avatar = parsed.data.avatar ?? null;
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.path);
      avatar = uploaded.secure_url;
    }

    const teacher = await AcademyService.createTeacher(req.user!, {
      ...parsed.data,
      avatar,
    });
    res.status(201).json({ success: true, data: teacher });
  }),
);

router.patch(
  '/teachers/:userId',
  authMiddleware(['academy']),
  upload.single('avatar'),
  asyncWrapper(async (req, res) => {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'Invalid user id' });

    let body = { ...req.body };
    if (typeof body.grade_ids === 'string') {
      try {
        body.grade_ids = JSON.parse(body.grade_ids);
      } catch {
        body.grade_ids = String(body.grade_ids)
          .split(',')
          .map((x: string) => Number(x.trim()))
          .filter((n: number) => n > 0);
      }
    }

    const parsed = UpdateTeacherBody.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صالحة',
        errors: parsed.error.issues,
      });
    }

    const patch = { ...parsed.data };
    if (req.file) {
      const uploaded = await uploadToCloudinary(req.file.path);
      patch.avatar = uploaded.secure_url;
    }

    const data = await AcademyService.updateTeacher(req.user!, userId, patch);
    res.json({ success: true, data });
  }),
);

router.delete(
  '/teachers/:userId',
  authMiddleware(['academy']),
  asyncWrapper(async (req, res) => {
    const userId = Number(req.params.userId);
    if (!userId) return res.status(400).json({ message: 'Invalid user id' });
    const data = await AcademyService.deleteTeacher(req.user!, userId);
    res.json({ success: true, data });
  }),
);

router.get(
  '/courses',
  authMiddleware(['academy']),
  asyncWrapper(async (req, res) => {
    const data = await AcademyService.listCourses(req.user!);
    res.json({ success: true, data });
  }),
);

router.post(
  '/courses/:courseId/assign',
  authMiddleware(['academy']),
  validate(AssignBody),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'Invalid course id' });
    const { teacher_user_id, is_primary } = req.body;
    const data = await AcademyService.assignTeacherToCourse(
      req.user!,
      courseId,
      teacher_user_id,
      is_primary !== false,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.delete(
  '/courses/:courseId/assign/:teacherUserId',
  authMiddleware(['academy']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    const teacherUserId = Number(req.params.teacherUserId);
    if (!courseId || !teacherUserId) {
      return res.status(400).json({ message: 'Invalid identifiers' });
    }
    const data = await AcademyService.unassignTeacherFromCourse(
      req.user!,
      courseId,
      teacherUserId,
    );
    res.json({ success: true, data });
  }),
);

// ─── Academy teacher ───────────────────────────────────────

router.get(
  '/me/dashboard',
  authMiddleware(['academy_teacher']),
  asyncWrapper(async (req, res) => {
    const data = await AcademyService.getMyDashboard(req.user!);
    res.json({ success: true, data });
  }),
);

router.get(
  '/me/courses',
  authMiddleware(['academy_teacher']),
  asyncWrapper(async (req, res) => {
    const data = await AcademyService.listMyAssignedCourses(req.user!);
    res.json({ success: true, data });
  }),
);
