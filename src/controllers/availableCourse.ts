import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/authentication';
import { asyncWrapper, HttpError } from '../utils';
import pool from '../db/pool';
import {
  CourseAccessControl,
  COURSE_CONTENT_ROLES,
  COURSE_CREATE_ROLES,
} from '../services/courseAccessControl';
import { LectureAccessService } from '../services/lectureAccess';
import { LectureActivationService } from '../services/lectureActivation';
import { LectureExamService } from '../services/lectureExam';
import { CourseAccessService } from '../services/courseAccess';
import { CourseGroupAccessService } from '../services/courseGroupAccess';

export const router = Router();

const AccessSettingsSchema = z.object({
  /** أُلغي — الوصول يُحدد لكل محاضرة عبر access_mode */
  lecture_access_mode: z
    .enum(['always_open', 'time_limited', 'activation_code', 'per_lecture'])
    .optional(),
  assignment_mode: z.enum(['lecture_based', 'course_based']).optional(),
});

const CreateCodeSchema = z.object({
  code: z.string().min(3).max(64).optional().nullable(),
  duration_hours: z.coerce.number().positive(),
  max_uses: z.coerce.number().int().min(0).optional().default(0),
});

const ActivateLectureSchema = z.object({
  code: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
});

const UpdateLectureSchema = z
  .object({
    title: z.string().min(2).optional(),
    description: z.string().optional().nullable(),
    position: z.coerce.number().optional(),
    expires_at: z.union([z.string(), z.null()]).optional(),
    is_visible: z.boolean().optional(),
    access_mode: z.enum(['open', 'activation_code', 'groups']).optional(),
    access_type: z.enum(['all', 'groups']).optional(),
    group_ids: z.array(z.coerce.number().int().positive()).optional(),
  })
  .superRefine((data, ctx) => {
    const mode =
      data.access_mode ||
      (data.access_type === 'groups' ? 'groups' : undefined);
    if (mode === 'groups' && data.group_ids !== undefined && data.group_ids.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'group_ids لا يمكن أن تكون فارغة مع access_mode=groups',
        path: ['group_ids'],
      });
    }
  });

const CourseAssignmentSchema = z.object({
  title: z.string().min(1).optional(),
  total_grade: z.coerce.number().positive().optional(),
  totalGrade: z.coerce.number().positive().optional(),
  duration: z.coerce.number().optional().nullable(),
  is_visible: z.union([z.boolean(), z.string()]).optional(),
  isVisible: z.boolean().optional(),
  show_at: z.string().optional().nullable(),
  hide_at: z.string().optional().nullable(),
  lock_next_lectures: z.union([z.boolean(), z.string()]).optional(),
  show_answers_immediately: z.union([z.boolean(), z.string()]).optional(),
  show_answers_after_hours: z.coerce.number().optional(),
  type: z.string().optional(),
  exam_type: z.string().optional(),
  questions_count: z.coerce.number().positive().optional(),
  questionsCount: z.coerce.number().positive().optional(),
  question_display_mode: z.string().optional(),
  questionDisplayMode: z.string().optional(),
  answers_release_mode: z.string().optional(),
  answersReleaseMode: z.string().optional(),
  answers_release_date: z.string().optional().nullable(),
});

async function assertManagesCourse(user: any, courseId: number) {
  await CourseAccessControl.assertCanManageCourse(user, courseId);
}

async function assertManagesLecture(user: any, lectureId: number) {
  const lecture = await LectureAccessService.getLectureContext(lectureId);
  if (!lecture) throw new HttpError(404, 'المحاضرة غير موجودة');
  await CourseAccessControl.assertCanManageCourse(user, lecture.course_id);
  return lecture;
}

// ─── Course access / assignment settings ───────────────────

router.get(
  '/:courseId/access-settings',
  authMiddleware([...COURSE_CONTENT_ROLES, 'student']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    const course = await pool.query(`SELECT id FROM courses WHERE id = $1`, [courseId]);
    if (!course.rowCount) return res.status(404).json({ message: 'الكورس غير موجود' });

    if (req.user!.role === 'student') {
      // students can read modes (needed for UI)
    } else if (req.user!.role !== 'admin') {
      await assertManagesCourse(req.user, courseId);
    }

    const modes = await LectureAccessService.getCourseModes(courseId);
    res.json({ success: true, course_id: courseId, ...modes });
  }),
);

router.patch(
  '/:courseId/access-settings',
  authMiddleware(COURSE_CREATE_ROLES),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    const parsed = AccessSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }
    if (!parsed.data.lecture_access_mode && !parsed.data.assignment_mode) {
      return res.status(400).json({
        message:
          'أرسل assignment_mode فقط. وصول المحاضرات أصبح لكل محاضرة عبر access_mode عند الإضافة/التعديل',
      });
    }

    await assertManagesCourse(req.user, courseId);
    const modes = await LectureAccessService.updateCourseModes(courseId, parsed.data);
    res.json({
      success: true,
      message: 'تم تحديث إعدادات الوصول',
      course_id: courseId,
      ...modes,
    });
  }),
);

// ─── Student: activate lecture by code ─────────────────────
// يجب أن يكون قبل /lecture/:lectureId لتجنب التداخل

router.post(
  '/lecture/activate-by-code',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const parsed = ActivateLectureSchema.safeParse({
      code: req.body?.code ?? req.body?.activation_code,
    });
    if (!parsed.success || !parsed.data.code) {
      return res.status(400).json({ message: 'كود التفعيل مطلوب' });
    }
    const data = await LectureActivationService.activateByCode(req.user!.id, parsed.data.code);
    res.json(data);
  }),
);

// ─── Update lecture (expires_at etc.) ──────────────────────

router.patch(
  '/lecture/:lectureId',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (!lectureId) return res.status(400).json({ message: 'معرف المحاضرة غير صحيح' });

    const lecture = await assertManagesLecture(req.user, lectureId);
    const parsed = UpdateLectureSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }

    const data = parsed.data;
    if (data.expires_at !== undefined && data.expires_at !== null) {
      const d = new Date(data.expires_at);
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ message: 'expires_at غير صالح (ISO date)' });
      }
    }

    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    const add = (col: string, v: unknown) => {
      fields.push(`${col} = $${i++}`);
      vals.push(v);
    };

    if (data.title !== undefined) add('title', data.title);
    if (data.description !== undefined) add('description', data.description);
    if (data.position !== undefined) add('position', data.position);
    if (data.is_visible !== undefined) add('is_visible', data.is_visible);
    if (data.expires_at !== undefined) {
      add('expires_at', data.expires_at === null ? null : new Date(data.expires_at));
    }

    const nextMode =
      data.access_mode ||
      (data.access_type === 'groups'
        ? 'groups'
        : data.access_type === 'all'
          ? 'open'
          : undefined);

    if (nextMode) {
      add('access_mode', nextMode);
      add('access_type', nextMode === 'groups' ? 'groups' : 'all');
    } else if (data.access_type !== undefined) {
      add('access_type', data.access_type);
    }

    if (
      !fields.length &&
      data.group_ids === undefined &&
      data.access_type === undefined &&
      data.access_mode === undefined
    ) {
      const cur = await pool.query(`SELECT * FROM lectures WHERE id = $1`, [lectureId]);
      return res.json({ success: true, lecture: cur.rows[0] });
    }

    if (fields.length) {
      vals.push(lectureId);
      await pool.query(
        `UPDATE lectures SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
        vals,
      );
    }

    const effectiveMode =
      nextMode ||
      (await LectureAccessService.getLectureContext(lectureId))?.access_mode ||
      'open';

    if (effectiveMode === 'groups' || data.group_ids !== undefined || data.access_type === 'groups') {
      const teacherId = (await CourseGroupAccessService.resolveCourseTeacherId(lecture.course_id))!;
      const groupIds =
        data.group_ids ?? (await CourseGroupAccessService.getLectureGroupIds(lectureId));
      if (effectiveMode === 'groups') {
        await CourseGroupAccessService.setLectureAccess(lectureId, teacherId, 'groups', groupIds);
      } else if (data.access_type === 'all' || nextMode === 'open' || nextMode === 'activation_code') {
        await CourseGroupAccessService.setLectureAccess(lectureId, teacherId, 'all', []);
      }
    }

    const cur = await pool.query(`SELECT * FROM lectures WHERE id = $1`, [lectureId]);
    const meta = await CourseGroupAccessService.getLectureAccessMeta(lectureId);
    res.json({
      success: true,
      lecture: {
        ...cur.rows[0],
        group_ids: meta?.group_ids ?? [],
      },
    });
  }),
);

// ─── Lecture activation codes (teacher) ────────────────────

router.post(
  '/lecture/:lectureId/activation-codes',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const lecture = await assertManagesLecture(req.user, lectureId);

    const parsed = CreateCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }

    const created = await LectureActivationService.createCode(lectureId, req.user!.id, parsed.data);
    res.status(201).json({
      success: true,
      code: created,
      access_mode: lecture.access_mode,
      note:
        lecture.access_mode === 'groups'
          ? 'هذا الكود لطلاب خارج المجموعات المحددة — أعضاء المجموعة يدخلون بدون كود'
          : 'هذا الكود مطلوب لكل الطلاب لفتح المحاضرة',
    });
  }),
);

router.get(
  '/lecture/:lectureId/activation-codes',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    await assertManagesLecture(req.user, lectureId);
    const codes = await LectureActivationService.listCodes(lectureId);
    res.json({ success: true, codes });
  }),
);

router.get(
  '/lecture/:lectureId/activations',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    await assertManagesLecture(req.user, lectureId);
    const activations = await LectureActivationService.listActivations(lectureId);
    res.json({ success: true, activations });
  }),
);

router.patch(
  '/lecture/:lectureId/activation-codes/:codeId/deactivate',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    const codeId = Number(req.params.codeId);
    await assertManagesLecture(req.user, lectureId);
    const code = await LectureActivationService.deactivateCode(codeId, lectureId);
    res.json({ success: true, code });
  }),
);

// ─── Course-based assignments (نفس إعدادات/شكل واجب المحاضرة — بدون lecture_id) ───

function parseVisibility(value: unknown, defaultValue = true): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return !!value;
}

async function createCourseLevelExam(params: {
  courseId: number;
  userId: number;
  body: z.infer<typeof CourseAssignmentSchema>;
}) {
  const { courseId, userId, body } = params;
  const modes = await LectureAccessService.getCourseModes(courseId);
  if (modes.assignment_mode !== 'course_based') {
    throw new HttpError(
      400,
      'وضع الواجبات للكورس هو lecture_based — أنشئ الواجب عبر محاضرة أو غيّر assignment_mode إلى course_based',
      { assignment_mode: modes.assignment_mode },
    );
  }

  const examTypeRaw =
    typeof body.type === 'string'
      ? body.type
      : typeof body.exam_type === 'string'
        ? body.exam_type
        : 'assignment';
  const examType =
    examTypeRaw.trim().toLowerCase() === 'exam' ? 'exam' : 'assignment';

  // واجب/امتحان على مستوى الكورس لا يقفل محاضرات
  const lockNextLectures = false;
  const examTotalGrade = body.total_grade ?? body.totalGrade ?? 100;
  const examDuration = body.duration != null ? Number(body.duration) : null;
  const visibility = parseVisibility(body.is_visible ?? body.isVisible, true);
  const showAt = body.show_at ? new Date(body.show_at) : null;
  const hideAt = body.hide_at ? new Date(body.hide_at) : null;
  const showAnswersImmediately =
    body.show_answers_immediately !== false && body.show_answers_immediately !== 'false';
  const showAnswersAfterHours = body.show_answers_after_hours
    ? Number(body.show_answers_after_hours)
    : 0;
  const examTitle =
    body.title || (examType === 'assignment' ? 'واجب الكورس' : 'امتحان الكورس');
  const questionsCount = body.questions_count ?? body.questionsCount ?? null;
  const questionDisplayMode =
    String(body.question_display_mode ?? body.questionDisplayMode ?? 'ordered').toLowerCase() ===
    'random'
      ? 'random'
      : 'ordered';
  const answersReleaseMode = String(
    body.answers_release_mode ?? body.answersReleaseMode ?? (showAnswersImmediately ? 'immediate' : 'after_hours'),
  ).toLowerCase();

  const result = await pool.query(
    `INSERT INTO exams (
       lecture_id, course_id, type, total_grade, created_by, title, duration, is_visible,
       show_at, hide_at, lock_next_lectures,
       show_answers_immediately, show_answers_after_hours,
       questions_count, question_display_mode, answers_release_mode
     ) VALUES (
       NULL, $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10,
       $11, $12,
       $13, $14, $15
     ) RETURNING *`,
    [
      courseId,
      examType,
      examTotalGrade,
      userId,
      examTitle,
      examDuration,
      visibility,
      showAt,
      hideAt,
      lockNextLectures,
      showAnswersImmediately,
      showAnswersAfterHours,
      questionsCount,
      questionDisplayMode,
      answersReleaseMode,
    ],
  );

  return result.rows[0];
}

async function listCourseLevelExams(params: {
  courseId: number;
  isStudent: boolean;
  typeParam: string;
}) {
  const { courseId, isStudent, typeParam } = params;
  const typeFilterSql =
    typeParam === 'exam'
      ? `AND type = 'exam'`
      : typeParam === 'assignment'
        ? `AND type = 'assignment'`
        : '';

  return pool.query(
    `SELECT e.*
     FROM exams e
     WHERE e.course_id = $1
       AND e.lecture_id IS NULL
       ${typeFilterSql}
       ${
         isStudent
           ? `AND e.is_visible = TRUE
              AND (e.show_at IS NULL OR e.show_at <= NOW())
              AND (
                e.questions_count IS NULL OR e.questions_count <= 0
                OR (SELECT COUNT(*) FROM exam_questions eq WHERE eq.exam_id = e.id) >= e.questions_count
              )`
           : ''
       }
     ORDER BY e.created_at DESC`,
    [courseId],
  );
}

/** نفس شكل POST /lecture/:lectureId/exam لكن على مستوى الكورس */
router.post(
  '/:courseId/exam',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    await assertManagesCourse(req.user, courseId);
    const parsed = CourseAssignmentSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }

    const exam = await createCourseLevelExam({
      courseId,
      userId: req.user!.id,
      body: parsed.data,
    });

    res.status(201).json({ exam });
  }),
);

/** Alias أوضح للواجهات: نفس إنشاء الواجب */
router.post(
  '/:courseId/assignments',
  authMiddleware(COURSE_CONTENT_ROLES),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    await assertManagesCourse(req.user, courseId);
    const body = { ...(req.body ?? {}), type: 'assignment' };
    const parsed = CourseAssignmentSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'بيانات غير صالحة', errors: parsed.error.errors });
    }

    const exam = await createCourseLevelExam({
      courseId,
      userId: req.user!.id,
      body: parsed.data,
    });

    // نفس شكل واجب المحاضرة + alias assignment للتوافق
    res.status(201).json({ exam, assignment: exam });
  }),
);

router.get(
  '/:courseId/exam',
  authMiddleware(['student', 'teacher', 'academy', 'academy_teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    const modes = await LectureAccessService.getCourseModes(courseId);
    const typeParam = String(req.query.type || 'all').trim().toLowerCase();

    if (req.user!.role === 'student') {
      const access = await CourseAccessService.checkStudentAccess(req.user!.id, courseId);
      if (!access.hasAccess) {
        return res.status(403).json({ message: access.message || 'غير مصرح' });
      }
    } else if (req.user!.role !== 'admin') {
      await assertManagesCourse(req.user, courseId);
    }

    const result = await listCourseLevelExams({
      courseId,
      isStudent: req.user!.role === 'student',
      typeParam,
    });

    const exams = result.rows.filter((r) => r.type === 'exam');
    const assignments = result.rows.filter((r) => r.type === 'assignment');

    res.json({
      success: true,
      assignment_mode: modes.assignment_mode,
      exams,
      assignments,
      exam: exams[0] || null,
    });
  }),
);

router.get(
  '/:courseId/assignments',
  authMiddleware(['student', 'teacher', 'academy', 'academy_teacher', 'admin']),
  asyncWrapper(async (req, res) => {
    const courseId = Number(req.params.courseId);
    if (!courseId) return res.status(400).json({ message: 'معرف الكورس غير صحيح' });

    const modes = await LectureAccessService.getCourseModes(courseId);

    if (req.user!.role === 'student') {
      const access = await CourseAccessService.checkStudentAccess(req.user!.id, courseId);
      if (!access.hasAccess) {
        return res.status(403).json({ message: access.message || 'غير مصرح' });
      }
    } else if (req.user!.role !== 'admin') {
      await assertManagesCourse(req.user, courseId);
    }

    const result = await listCourseLevelExams({
      courseId,
      isStudent: req.user!.role === 'student',
      typeParam: 'assignment',
    });

    res.json({
      success: true,
      assignment_mode: modes.assignment_mode,
      assignments: result.rows,
      exams: result.rows, // توافق مع شكل قائمة امتحان المحاضرة عند type=assignment
    });
  }),
);

// Enhanced student access-check (also used as alias with richer payload)
router.get(
  '/lecture/:lectureId/availability',
  authMiddleware(['student']),
  asyncWrapper(async (req, res) => {
    const lectureId = Number(req.params.lectureId);
    if (!lectureId) return res.status(400).json({ message: 'معرف المحاضرة غير صحيح' });

    const access = await LectureAccessService.checkStudentLectureAccess(lectureId, req.user!.id);
    let assignment_locked = false;
    let blocking_exams: unknown[] = [];

    if (access.can_access) {
      const ok = await LectureExamService.canStudentAccessLecture(lectureId, req.user!.id);
      if (!ok) {
        assignment_locked = true;
        blocking_exams = await LectureExamService.getBlockingExamsForLecture(
          lectureId,
          req.user!.id,
        );
      }
    }

    const canAccessFinal = access.can_access && !assignment_locked;
    res.json({
      success: true,
      can_access: canAccessFinal,
      status: assignment_locked ? 'locked' : access.status,
      message: assignment_locked
        ? 'لا يمكن الوصول للمحاضرة — يجب إكمال الواجبات المطلوبة أولاً'
        : access.message,
      lecture_access_mode: access.lecture_access_mode,
      expires_at: access.expires_at ?? null,
      activation: access.activation ?? null,
      assignment_locked,
      blocking_exams,
    });
  }),
);
