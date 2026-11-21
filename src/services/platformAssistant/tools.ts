import pool from '../../db/pool';
import { CourseLevelExamsService } from '../courseLevelExams';
import { StudentDailyReportService } from '../studentDailyReport';
import { TeacherPointsService } from '../teacherPoints';
import { ScientificChatbotService } from '../scientificChatbot';
import {
  getStudentCourseWatchPercentage,
  getStudentLectureWatchPercentage,
} from '../watchProgress';
import { isCourseExamPointsEnabled, normalizeCourseExamPointsAttemptMode } from '../courseExamPointsPolicy';
import type { PlatformAssistantContext, PlatformToolResult } from './types';

async function assertStudentEnrolled(studentId: number, courseId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1
       AND e.course_id = $2
       AND c.is_visible = true
       AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
       AND (e.expires_at IS NULL OR e.expires_at > NOW())
       AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)
     LIMIT 1`,
    [studentId, courseId],
  );
  return Boolean(res.rowCount);
}

async function listEnrolledCourses(studentId: number, teacherId?: number | null) {
  const params: unknown[] = [studentId];
  let teacherFilter = '';
  if (teacherId) {
    params.push(teacherId);
    teacherFilter = ` AND c.teacher_id = $${params.length}`;
  }
  const res = await pool.query(
    `SELECT c.id, c.title, c.description, c.teacher_id, u.name AS teacher_name,
            e.expires_at, e.subscription_status
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = c.teacher_id
     WHERE e.user_id = $1
       AND c.is_visible = true
       AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
       AND (e.expires_at IS NULL OR e.expires_at > NOW())
       AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)
       ${teacherFilter}
     ORDER BY c.title ASC`,
    params,
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    description: row.description,
    teacherId: Number(row.teacher_id),
    teacherName: row.teacher_name,
    expiresAt: row.expires_at,
    subscriptionStatus: row.subscription_status,
  }));
}

async function resolveScopedCourseId(
  ctx: PlatformAssistantContext,
  requestedCourseId?: number | null,
): Promise<number | null> {
  const courseId = requestedCourseId ?? ctx.courseId ?? null;
  if (!courseId) return null;
  const ok = await assertStudentEnrolled(ctx.studentId, Number(courseId));
  if (!ok) return null;
  if (ctx.teacherId) {
    const t = await pool.query(`SELECT teacher_id FROM courses WHERE id = $1`, [courseId]);
    if (!t.rowCount || Number(t.rows[0].teacher_id) !== Number(ctx.teacherId)) return null;
  }
  return Number(courseId);
}

export const PLATFORM_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_student_profile',
      description: 'جلب بيانات الطالب الحالي الأساسية (الاسم والكود والصف).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_courses',
      description: 'قائمة كورسات الطالب المسجّل فيها حاليًا.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_course_details',
      description: 'تفاصيل كورس واحد مع ملخص المحاضرات والامتحانات المرئية للطالب.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer', description: 'معرف الكورس' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_course_lectures',
      description: 'محاضرات كورس معيّن مع نسبة مشاهدة الطالب لكل محاضرة.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_pending',
      description:
        'المتراكم على الطالب: محاضرات ناقصة وامتحانات لسه مدخلهاش أو محتاج يكملها. مهم لأسئلة زي فاضلي إيه / متراكم عليا إيه.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_course_exams',
      description:
        'امتحانات كورس مرئية للطالب مع حالة التوفر وعدد المحاولات وهل يقدر يبدأ دلوقتي.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_exam_details',
      description:
        'تفاصيل امتحان شامل: الوقت، عدد الأسئلة، المحاولات، إعدادات النقاط، وحالة محاولة الطالب.',
      parameters: {
        type: 'object',
        properties: {
          exam_id: { type: 'integer' },
          course_id: { type: 'integer', description: 'اختياري لتسريع التحقق' },
        },
        required: ['exam_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_exam_attempts',
      description: 'محاولات الطالب في امتحان معيّن مع الدرجات وحالة كل محاولة.',
      parameters: {
        type: 'object',
        properties: {
          exam_id: { type: 'integer' },
        },
        required: ['exam_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_points',
      description: 'ملخص نقاط الطالب الحالية وترتيبه في الصف.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_student_points_history',
      description: 'سجل احتساب النقاط: مصدر كل نقطة وتاريخها وتفاصيلها.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'عدد العمليات (افتراضي 30، أقصى 100)' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'diagnose_exam_points',
      description:
        'تشخيص ليه امتحان معيّن حسب أو محسبش نقاط للطالب (إعدادات الامتحان + المحاولة + سجل النقاط).',
      parameters: {
        type: 'object',
        properties: {
          exam_id: { type: 'integer' },
        },
        required: ['exam_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'diagnose_exam_access',
      description:
        'تشخيص مشاكل فتح/بدء/تسليم الامتحان: التوفر، الوقت، المحاولات، المحاولة الجارية.',
      parameters: {
        type: 'object',
        properties: {
          exam_id: { type: 'integer' },
        },
        required: ['exam_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_live_meetings',
      description: 'المحاضرات المباشرة لكورس الطالب (مباشر / مجدولة / منتهية) مع موعد البداية إن وجد.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
        },
        required: ['course_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_study_content',
      description:
        'بحث في المحتوى العلمي/مذكرات الكورس أو المدرس للإجابة على أسئلة المنهج. استخدمه للأسئلة العلمية.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'نص السؤال العلمي' },
          course_id: { type: 'integer', description: 'اختياري لتضييق البحث على كورس' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_study_plan_suggestion',
      description:
        'يبني ملخص سريع لخطة مذاكرة من المتراكم الحالي (محاضرات + امتحانات) للطالب.',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer', description: 'اختياري لتركيز الخطة على كورس واحد' },
        },
      },
    },
  },
];

function ok(data: unknown): PlatformToolResult {
  return { ok: true, data };
}

function fail(error: string): PlatformToolResult {
  return { ok: false, error };
}

export async function executePlatformTool(
  name: string,
  args: Record<string, unknown>,
  ctx: PlatformAssistantContext,
): Promise<PlatformToolResult> {
  const studentId = ctx.studentId;
  try {
    switch (name) {
      case 'get_student_profile': {
        const res = await pool.query(
          `SELECT u.id, u.name, u.student_code, u.email, u.phone, g.name AS grade_name
           FROM users u
           LEFT JOIN grades g ON g.id = u.grade_id
           WHERE u.id = $1
           LIMIT 1`,
          [studentId],
        );
        if (!res.rowCount) return fail('student_not_found');
        const row = res.rows[0];
        return ok({
          id: Number(row.id),
          name: row.name,
          studentCode: row.student_code,
          email: row.email,
          phone: row.phone,
          gradeName: row.grade_name,
        });
      }

      case 'get_student_courses': {
        const courses = await listEnrolledCourses(studentId, ctx.teacherId);
        return ok({ count: courses.length, courses });
      }

      case 'get_course_details': {
        const courseId = await resolveScopedCourseId(ctx, Number(args.course_id));
        if (!courseId) return fail('course_not_accessible');
        const courseRes = await pool.query(
          `SELECT c.id, c.title, c.description, c.teacher_id, u.name AS teacher_name
           FROM courses c
           JOIN users u ON u.id = c.teacher_id
           WHERE c.id = $1`,
          [courseId],
        );
        const lecturesCount = await pool.query(
          `SELECT COUNT(*)::int AS cnt FROM lectures WHERE course_id = $1`,
          [courseId],
        );
        const watch = await getStudentCourseWatchPercentage(studentId, courseId);
        return ok({
          ...courseRes.rows[0],
          lecturesCount: Number(lecturesCount.rows[0]?.cnt || 0),
          watchPercentage: watch,
        });
      }

      case 'get_course_lectures': {
        const courseId = await resolveScopedCourseId(ctx, Number(args.course_id));
        if (!courseId) return fail('course_not_accessible');
        const lecturesRes = await pool.query(
          `SELECT id, title, position, created_at
           FROM lectures
           WHERE course_id = $1
           ORDER BY position ASC, id ASC`,
          [courseId],
        );
        const lectures = [];
        for (const row of lecturesRes.rows) {
          const lectureId = Number(row.id);
          const pct = await getStudentLectureWatchPercentage(studentId, lectureId);
          lectures.push({
            id: lectureId,
            title: row.title,
            position: Number(row.position) || 0,
            watchPercentage: pct,
            completed: pct >= 90,
          });
        }
        return ok({
          courseId,
          count: lectures.length,
          completedCount: lectures.filter((l) => l.completed).length,
          lectures,
        });
      }

      case 'get_student_pending': {
        const report = await StudentDailyReportService.getReport(studentId);
        let pendingLectures = report.pending_lectures;
        let pendingExams = report.pending_exams;
        if (ctx.courseId) {
          pendingLectures = pendingLectures.filter((l) => l.course_id === Number(ctx.courseId));
          pendingExams = pendingExams.filter((e) => e.course_id === Number(ctx.courseId));
        }
        if (ctx.teacherId) {
          const courses = await listEnrolledCourses(studentId, ctx.teacherId);
          const ids = new Set(courses.map((c) => c.id));
          pendingLectures = pendingLectures.filter((l) => ids.has(l.course_id));
          pendingExams = pendingExams.filter((e) => ids.has(e.course_id));
        }
        return ok({
          summary: {
            pendingLecturesCount: pendingLectures.length,
            pendingExamsCount: pendingExams.length,
            totalCourses: report.summary.total_courses,
          },
          pendingLectures,
          pendingExams,
          generatedAt: report.generated_at,
        });
      }

      case 'get_course_exams': {
        const courseId = await resolveScopedCourseId(ctx, Number(args.course_id));
        if (!courseId) return fail('course_not_accessible');
        const exams = await CourseLevelExamsService.getVisibleExamsForStudent(courseId, studentId);
        const slim = (Array.isArray(exams) ? exams : []).map((exam: any) => ({
          id: Number(exam.id),
          title: exam.title,
          availabilityStatus: exam.availability_status,
          canStart: Boolean(exam.can_start || exam.canStart),
          attemptsCount: Number(exam.attempts_count || 0),
          attemptLimit: exam.attempt_limit ?? null,
          durationMinutes: exam.duration_minutes ?? null,
          questionsCount: exam.actual_questions_count ?? exam.questions_count ?? null,
          pointsEnabled: exam.points_enabled !== false,
          pointsAttemptMode: normalizeCourseExamPointsAttemptMode(exam.points_attempt_mode),
          availableFrom: exam.available_from,
          visibilityEndDate: exam.visibility_end_date,
          hasInProgressAttempt: Boolean(exam.has_in_progress_attempt),
        }));
        return ok({ courseId, count: slim.length, exams: slim });
      }

      case 'get_exam_details':
      case 'diagnose_exam_access': {
        const examId = Number(args.exam_id);
        if (!Number.isInteger(examId) || examId <= 0) return fail('invalid_exam_id');
        const examRes = await pool.query(
          `SELECT e.*, c.title AS course_title, c.teacher_id
           FROM course_level_exams e
           JOIN courses c ON c.id = e.course_id
           WHERE e.id = $1
           LIMIT 1`,
          [examId],
        );
        if (!examRes.rowCount) return fail('exam_not_found');
        const exam = examRes.rows[0];
        const enrolled = await assertStudentEnrolled(studentId, Number(exam.course_id));
        if (!enrolled) return fail('course_not_accessible');

        const exams = await CourseLevelExamsService.getVisibleExamsForStudent(
          Number(exam.course_id),
          studentId,
        );
        const visible = (Array.isArray(exams) ? exams : []).find(
          (item: any) => Number(item.id) === examId,
        );
        const attemptsRes = await pool.query(
          `SELECT id, attempt_number, status, obtained_grade, total_grade, started_at, submitted_at, attempt_expire_at
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2
           ORDER BY attempt_number ASC, id ASC`,
          [examId, studentId],
        );

        const diagnosis: string[] = [];
        if (!visible) {
          diagnosis.push('الامتحان غير ظاهر لك حاليًا (مخفي أو خارج مجموعة الظهور أو غير نشط).');
        } else {
          const status = visible.availability_status || visible.availabilityStatus;
          if (status === 'upcoming') diagnosis.push('الامتحان لسه ما فتحش (موعد البداية مستقبل).');
          if (status === 'expired') diagnosis.push('الامتحان انتهى وقت إتاحته.');
          if (status === 'closed') diagnosis.push('الامتحان مغلق حاليًا.');
          if (visible.has_in_progress_attempt) {
            diagnosis.push('عندك محاولة جارية — غالبًا لازم تكمّلها أو تسلّمها من نفس الشاشة.');
          }
          if (
            visible.attempt_limit != null &&
            Number(visible.attempts_count || 0) >= Number(visible.attempt_limit) &&
            !visible.has_in_progress_attempt
          ) {
            diagnosis.push('خلصت عدد المحاولات المتاحة.');
          }
          if (!diagnosis.length && (visible.can_start || visible.canStart)) {
            diagnosis.push('الامتحان متاح للبدء حسب الإعدادات الحالية.');
          }
        }

        return ok({
          exam: {
            id: examId,
            title: exam.title,
            courseId: Number(exam.course_id),
            courseTitle: exam.course_title,
            durationMinutes: exam.duration_minutes,
            questionsCount: exam.questions_count,
            attemptLimit: exam.attempt_limit,
            availableFrom: exam.available_from,
            visibilityEndDate: exam.visibility_end_date,
            pointsEnabled: isCourseExamPointsEnabled(exam),
            pointsAttemptMode: normalizeCourseExamPointsAttemptMode(exam.points_attempt_mode),
            isActive: exam.is_active,
            isVisibleToStudents: exam.is_visible_to_students,
          },
          studentView: visible
            ? {
                availabilityStatus: visible.availability_status,
                canStart: Boolean(visible.can_start || visible.canStart),
                attemptsCount: Number(visible.attempts_count || 0),
                hasInProgressAttempt: Boolean(visible.has_in_progress_attempt),
              }
            : null,
          attempts: attemptsRes.rows,
          diagnosis,
        });
      }

      case 'get_student_exam_attempts': {
        const examId = Number(args.exam_id);
        if (!Number.isInteger(examId) || examId <= 0) return fail('invalid_exam_id');
        const examRes = await pool.query(
          `SELECT e.id, e.course_id, e.title, e.points_enabled, e.points_attempt_mode
           FROM course_level_exams e
           WHERE e.id = $1`,
          [examId],
        );
        if (!examRes.rowCount) return fail('exam_not_found');
        const exam = examRes.rows[0];
        if (!(await assertStudentEnrolled(studentId, Number(exam.course_id)))) {
          return fail('course_not_accessible');
        }
        const attemptsRes = await pool.query(
          `SELECT id, attempt_number, status, obtained_grade, total_grade, started_at, submitted_at
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2
           ORDER BY attempt_number ASC, id ASC`,
          [examId, studentId],
        );
        return ok({
          examId,
          title: exam.title,
          pointsEnabled: isCourseExamPointsEnabled(exam),
          pointsAttemptMode: normalizeCourseExamPointsAttemptMode(exam.points_attempt_mode),
          attempts: attemptsRes.rows,
        });
      }

      case 'get_student_points': {
        const pointsCtx = await TeacherPointsService.resolveStudentPointsContext(studentId);
        if (!pointsCtx) return fail('points_context_unavailable');
        const summary = await TeacherPointsService.getStudentRankSummary({
          studentId,
          teacherId: pointsCtx.teacherId,
          gradeId: pointsCtx.gradeId,
        });
        return ok(summary);
      }

      case 'get_student_points_history': {
        const pointsCtx = await TeacherPointsService.resolveStudentPointsContext(studentId);
        if (!pointsCtx) return fail('points_context_unavailable');
        const limitRaw = Number(args.limit ?? 30);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 100) : 30;
        const pointsHistory = await TeacherPointsService.listStudentTransactions({
          teacherId: pointsCtx.teacherId,
          studentId,
          gradeId: pointsCtx.gradeId,
          limit,
        });
        return ok({
          count: pointsHistory.transactions.length,
          totalPoints: pointsHistory.totalPoints,
          transactions: pointsHistory.transactions,
        });
      }

      case 'diagnose_exam_points': {
        const examId = Number(args.exam_id);
        if (!Number.isInteger(examId) || examId <= 0) return fail('invalid_exam_id');
        const examRes = await pool.query(
          `SELECT e.*, c.teacher_id, c.title AS course_title
           FROM course_level_exams e
           JOIN courses c ON c.id = e.course_id
           WHERE e.id = $1`,
          [examId],
        );
        if (!examRes.rowCount) return fail('exam_not_found');
        const exam = examRes.rows[0];
        if (!(await assertStudentEnrolled(studentId, Number(exam.course_id)))) {
          return fail('course_not_accessible');
        }

        const pointsEnabled = isCourseExamPointsEnabled(exam);
        const mode = normalizeCourseExamPointsAttemptMode(exam.points_attempt_mode);
        const attemptsRes = await pool.query(
          `SELECT id, attempt_number, status, obtained_grade, total_grade, submitted_at
           FROM course_level_exam_attempts
           WHERE exam_id = $1 AND student_id = $2
           ORDER BY attempt_number ASC, id ASC`,
          [examId, studentId],
        );
        const submitted = attemptsRes.rows.filter((a) => a.status === 'submitted');
        const pointsCtx = await TeacherPointsService.resolveStudentPointsContext(studentId);
        let relatedTx: any[] = [];
        if (pointsCtx) {
          const pointsHistory = await TeacherPointsService.listStudentTransactions({
            teacherId: pointsCtx.teacherId,
            studentId,
            gradeId: pointsCtx.gradeId,
            limit: 100,
          });
          relatedTx = pointsHistory.transactions.filter((tx) => {
            const meta =
              tx.metadata && typeof tx.metadata === 'object'
                ? (tx.metadata as Record<string, unknown>)
                : {};
            return (
              tx.eventType === 'EXAM_SCORE' &&
              (Number(tx.referenceId) === examId || Number(meta.examId) === examId)
            );
          });
        }

        const reasons: string[] = [];
        if (!pointsEnabled) reasons.push('احتساب نقاط هذا الامتحان معطّل من إعدادات الامتحان.');
        if (!submitted.length) reasons.push('مفيش محاولة مسلّمة لهذا الامتحان.');
        if (pointsEnabled && submitted.length && !relatedTx.length) {
          reasons.push(
            'فيه محاولات مسلّمة لكن مفيش معاملة EXAM_SCORE في السجل — ممكن الامتحان خارج نافذة النقاط أو إعدادات النقاط العامة معطّلة أو لسه متعملش sync.',
          );
        }
        if (relatedTx.length) {
          reasons.push(
            `اتسجلت نقاط للامتحان: ${relatedTx
              .map((tx) => `${tx.points} نقطة`)
              .join('، ')} حسب وضع الاحتساب (${mode}).`,
          );
        }

        return ok({
          examId,
          title: exam.title,
          pointsEnabled,
          pointsAttemptMode: mode,
          submittedAttempts: submitted,
          pointsTransactions: relatedTx,
          reasons,
        });
      }

      case 'get_live_meetings': {
        const courseId = await resolveScopedCourseId(ctx, Number(args.course_id));
        if (!courseId) return fail('course_not_accessible');
        const res = await pool.query(
          `SELECT id, title, status, scheduled_start_at, created_at, egress_url
           FROM meeting
           WHERE course_id = $1
           ORDER BY COALESCE(scheduled_start_at, created_at) DESC
           LIMIT 20`,
          [courseId],
        );
        return ok({
          courseId,
          meetings: res.rows.map((row) => ({
            id: row.id,
            title: row.title,
            status: row.status,
            scheduledStartAt: row.scheduled_start_at,
            createdAt: row.created_at,
            hasRecording: Boolean(row.egress_url),
          })),
        });
      }

      case 'search_study_content': {
        const question = String(args.question || '').trim();
        if (!question) return fail('question_required');
        const courseId = await resolveScopedCourseId(
          ctx,
          args.course_id != null ? Number(args.course_id) : ctx.courseId,
        );

        if (courseId) {
          const courseResult = await pool.query(`SELECT teacher_id FROM courses WHERE id = $1`, [
            courseId,
          ]);
          if (!courseResult.rowCount) return fail('course_not_found');
          const teacherId = Number(courseResult.rows[0].teacher_id);
          const chunks = await ScientificChatbotService.retrieveCourseChunks(
            question,
            teacherId,
            courseId,
          );
          return ok({
            scope: 'course',
            courseId,
            chunks: (chunks || []).slice(0, 3).map((c: any, i: number) => ({
              index: i + 1,
              text: String(c.chunk_text || '').slice(0, 1200),
            })),
          });
        }

        const teacherId =
          ctx.teacherId ||
          (
            await pool.query(
              `SELECT c.teacher_id
               FROM enrollments e
               JOIN courses c ON c.id = e.course_id
               WHERE e.user_id = $1
               ORDER BY e.id DESC
               LIMIT 1`,
              [studentId],
            )
          ).rows[0]?.teacher_id;

        if (!teacherId) return fail('teacher_scope_unavailable');
        const chunks = await ScientificChatbotService.retrieveTeacherChunks(
          question,
          Number(teacherId),
        );
        return ok({
          scope: 'teacher',
          teacherId: Number(teacherId),
          chunks: (chunks || []).slice(0, 3).map((c: any, i: number) => ({
            index: i + 1,
            text: String(c.chunk_text || '').slice(0, 1200),
          })),
        });
      }

      case 'get_study_plan_suggestion': {
        const report = await StudentDailyReportService.getReport(studentId);
        let lectures = report.pending_lectures;
        let exams = report.pending_exams;
        const focusCourseId =
          args.course_id != null
            ? await resolveScopedCourseId(ctx, Number(args.course_id))
            : ctx.courseId
              ? await resolveScopedCourseId(ctx, Number(ctx.courseId))
              : null;
        if (focusCourseId) {
          lectures = lectures.filter((l) => l.course_id === focusCourseId);
          exams = exams.filter((e) => e.course_id === focusCourseId);
        }
        const steps = [
          ...lectures.slice(0, 5).map((l, idx) => ({
            order: idx + 1,
            type: 'lecture',
            title: l.title,
            courseTitle: l.course_title,
            watchPercentage: l.watch_percentage,
            hint: 'كمّل مشاهدة المحاضرة',
          })),
          ...exams.slice(0, 5).map((e, idx) => ({
            order: lectures.slice(0, 5).length + idx + 1,
            type: 'exam',
            title: e.title,
            courseTitle: e.course_title,
            hint: 'ادخل الامتحان بعد مراجعة المحاضرات المرتبطة',
          })),
        ];
        return ok({
          focusCourseId,
          pendingLecturesCount: lectures.length,
          pendingExamsCount: exams.length,
          suggestedSteps: steps,
        });
      }

      default:
        return fail(`unknown_tool:${name}`);
    }
  } catch (error: any) {
    return fail(error?.message || 'tool_execution_failed');
  }
}
