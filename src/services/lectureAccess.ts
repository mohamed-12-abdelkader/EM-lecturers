import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessService } from './courseAccess';
import { CourseGroupAccessService } from './courseGroupAccess';

/** وضع وصول المحاضرة نفسها (يحدده المدرس عند الإضافة) */
export type LectureAccessMode = 'open' | 'activation_code' | 'groups';

/** @deprecated وضع الكورس القديم — يُتجاهل لصالح lectures.access_mode */
export type CourseLectureAccessMode = 'always_open' | 'time_limited' | 'activation_code';
export type AssignmentMode = 'lecture_based' | 'course_based';

export type LectureAccessStatus =
  | 'open'
  | 'locked'
  | 'expired'
  | 'requires_activation_code'
  | 'activated'
  | 'activation_expired'
  | 'not_enrolled'
  | 'group_restricted'
  | 'forbidden';

export type LectureAccessResult = {
  can_access: boolean;
  status: LectureAccessStatus;
  message: string;
  /** وضع وصول هذه المحاضرة */
  access_mode: LectureAccessMode;
  /** للتوافق مع الواجهات القديمة */
  lecture_access_mode: LectureAccessMode | CourseLectureAccessMode;
  expires_at?: string | null;
  activation?: {
    activated_at: string;
    expires_at: string;
    remaining_seconds: number;
  } | null;
  group_ids?: number[];
  /** في وضع groups: هل فُتحت لأن الطالب ضمن المجموعة المحددة؟ */
  open_via_group?: boolean;
};

type LectureRow = {
  id: number;
  course_id: number;
  title: string;
  expires_at: Date | string | null;
  access_mode: LectureAccessMode;
  assignment_mode: AssignmentMode;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeAccessMode(raw: unknown): LectureAccessMode {
  const v = String(raw || 'open');
  if (v === 'activation_code') return 'activation_code';
  if (v === 'groups') return 'groups';
  // legacy course modes mapped when reading old data
  if (v === 'always_open' || v === 'time_limited' || v === 'open') return 'open';
  return 'open';
}

export class LectureAccessService {
  /** إعدادات الكورس المتبقية (واجبات فقط) — lecture_access_mode لم يعد يُستخدم */
  static async getCourseModes(courseId: number): Promise<{
    lecture_access_mode: 'per_lecture';
    assignment_mode: AssignmentMode;
    note: string;
  }> {
    const r = await pool.query(
      `SELECT COALESCE(assignment_mode, 'lecture_based') AS assignment_mode
       FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الكورس غير موجود');
    return {
      lecture_access_mode: 'per_lecture',
      assignment_mode: r.rows[0].assignment_mode,
      note: 'يتم تحديد وصول كل محاضرة عند إضافتها: open | activation_code | groups',
    };
  }

  static async updateCourseModes(
    courseId: number,
    patch: { lecture_access_mode?: string; assignment_mode?: AssignmentMode },
  ) {
    if (patch.lecture_access_mode) {
      throw new HttpError(
        400,
        'تم إلغاء إعداد lecture_access_mode على مستوى الكورس. حدّد access_mode عند إضافة/تعديل كل محاضرة (open | activation_code | groups)',
        { code: 'LECTURE_ACCESS_MOVED_TO_LECTURE' },
      );
    }
    if (patch.assignment_mode) {
      await pool.query(`UPDATE courses SET assignment_mode = $1 WHERE id = $2`, [
        patch.assignment_mode,
        courseId,
      ]);
    }
    return this.getCourseModes(courseId);
  }

  static async getLectureContext(lectureId: number): Promise<LectureRow | null> {
    const r = await pool.query(
      `SELECT l.id, l.course_id, l.title, l.expires_at,
              COALESCE(l.access_mode, 'open') AS access_mode,
              COALESCE(c.assignment_mode, 'lecture_based') AS assignment_mode
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1`,
      [lectureId],
    );
    if (!r.rowCount) return null;
    return {
      ...r.rows[0],
      access_mode: normalizeAccessMode(r.rows[0].access_mode),
    };
  }

  /**
   * صلاحية دخول الطالب للمحاضرة حسب access_mode الخاص بالمحاضرة.
   * لا يغطي قفل الواجبات المتسلسل — يُدمج معه من الخارج إن لزم.
   */
  static async checkStudentLectureAccess(
    lectureId: number,
    studentId: number,
    now: Date = new Date(),
  ): Promise<LectureAccessResult> {
    const lecture = await this.getLectureContext(lectureId);
    if (!lecture) {
      return {
        can_access: false,
        status: 'forbidden',
        message: 'المحاضرة غير موجودة',
        access_mode: 'open',
        lecture_access_mode: 'open',
      };
    }

    const mode = lecture.access_mode;

    const courseAccess = await CourseAccessService.checkStudentAccess(studentId, lecture.course_id);
    if (!courseAccess.hasAccess) {
      return {
        can_access: false,
        status: 'not_enrolled',
        message: courseAccess.message || 'غير مشترك في هذا الكورس',
        access_mode: mode,
        lecture_access_mode: mode,
      };
    }

    if (mode === 'open') {
      return {
        can_access: true,
        status: 'open',
        message: 'المحاضرة متاحة للجميع',
        access_mode: mode,
        lecture_access_mode: mode,
        expires_at: null,
        activation: null,
      };
    }

    if (mode === 'groups') {
      const groupAccess = await CourseGroupAccessService.checkStudentLectureGroupAccess(
        lectureId,
        studentId,
        { enforce: true },
      );
      const groupIds = (await CourseGroupAccessService.getLectureGroupIds(lectureId)) ?? [];

      // أعضاء المجموعات المحددة: مفتوحة بدون كود
      if (groupAccess.allowed) {
        return {
          can_access: true,
          status: 'open',
          message: 'المحاضرة متاحة لمجموعتك بدون كود',
          access_mode: mode,
          lecture_access_mode: mode,
          group_ids: groupIds,
          open_via_group: true,
          activation: null,
        };
      }

      // باقي الطلاب: ظاهرة لكن تحتاج كود تفعيل مثل المحاضرات المغلقة
      const byCode = await this.checkActivationWindow(lectureId, studentId, now, mode);
      return {
        ...byCode,
        group_ids: groupIds,
        open_via_group: false,
        message:
          byCode.status === 'requires_activation_code'
            ? 'المحاضرة ظاهرة لك ومقفولة — أدخل كود التفعيل (مفتوحة بدون كود لمجموعات محددة فقط)'
            : byCode.message,
      };
    }

    // activation_code — مقفولة للكل حتى التفعيل
    return this.checkActivationWindow(lectureId, studentId, now, mode);
  }

  /** نافذة تفعيل بالكود (مستخدمة في activation_code وفي groups لغير أعضاء المجموعة) */
  private static async checkActivationWindow(
    lectureId: number,
    studentId: number,
    now: Date,
    mode: LectureAccessMode,
  ): Promise<LectureAccessResult> {
    const act = await pool.query(
      `SELECT activated_at, expires_at
       FROM lecture_activations
       WHERE lecture_id = $1 AND user_id = $2
       LIMIT 1`,
      [lectureId, studentId],
    );

    if (!act.rowCount) {
      return {
        can_access: false,
        status: 'requires_activation_code',
        message: 'المحاضرة مقفولة — يجب إدخال كود تفعيل',
        access_mode: mode,
        lecture_access_mode: mode,
        activation: null,
      };
    }

    const activatedAt = asDate(act.rows[0].activated_at)!;
    const expiresAt = asDate(act.rows[0].expires_at)!;
    const remainingMs = expiresAt.getTime() - now.getTime();

    if (remainingMs <= 0) {
      return {
        can_access: false,
        status: 'activation_expired',
        message: 'انتهت مدة تفعيل المحاضرة الخاصة بك',
        access_mode: mode,
        lecture_access_mode: mode,
        activation: {
          activated_at: activatedAt.toISOString(),
          expires_at: expiresAt.toISOString(),
          remaining_seconds: 0,
        },
      };
    }

    return {
      can_access: true,
      status: 'activated',
      message: 'المحاضرة مفعّلة لديك',
      access_mode: mode,
      lecture_access_mode: mode,
      activation: {
        activated_at: activatedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        remaining_seconds: Math.floor(remainingMs / 1000),
      },
    };
  }

  static async assertStudentCanAccessLecture(lectureId: number, studentId: number): Promise<void> {
    const result = await this.checkStudentLectureAccess(lectureId, studentId);
    if (!result.can_access) {
      throw new HttpError(403, result.message, {
        code: 'LECTURE_ACCESS_DENIED',
        status: result.status,
        access_mode: result.access_mode,
        lecture_access_mode: result.lecture_access_mode,
        expires_at: result.expires_at ?? null,
        activation: result.activation ?? null,
      });
    }
  }
}
