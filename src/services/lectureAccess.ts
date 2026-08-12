import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessService } from './courseAccess';
import { CourseGroupAccessService } from './courseGroupAccess';

export type LectureAccessMode = 'always_open' | 'time_limited' | 'activation_code';
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
  lecture_access_mode: LectureAccessMode;
  expires_at?: string | null;
  activation?: {
    activated_at: string;
    expires_at: string;
    remaining_seconds: number;
  } | null;
};

type LectureRow = {
  id: number;
  course_id: number;
  title: string;
  expires_at: Date | string | null;
  lecture_access_mode: LectureAccessMode;
  assignment_mode: AssignmentMode;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export class LectureAccessService {
  static async getCourseModes(courseId: number): Promise<{
    lecture_access_mode: LectureAccessMode;
    assignment_mode: AssignmentMode;
  }> {
    const r = await pool.query(
      `SELECT
         COALESCE(lecture_access_mode, 'always_open') AS lecture_access_mode,
         COALESCE(assignment_mode, 'lecture_based') AS assignment_mode
       FROM courses WHERE id = $1`,
      [courseId],
    );
    if (!r.rowCount) throw new HttpError(404, 'الكورس غير موجود');
    return {
      lecture_access_mode: r.rows[0].lecture_access_mode,
      assignment_mode: r.rows[0].assignment_mode,
    };
  }

  static async updateCourseModes(
    courseId: number,
    patch: { lecture_access_mode?: LectureAccessMode; assignment_mode?: AssignmentMode },
  ) {
    const fields: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (patch.lecture_access_mode) {
      fields.push(`lecture_access_mode = $${i++}`);
      vals.push(patch.lecture_access_mode);
    }
    if (patch.assignment_mode) {
      fields.push(`assignment_mode = $${i++}`);
      vals.push(patch.assignment_mode);
    }
    if (!fields.length) return this.getCourseModes(courseId);
    vals.push(courseId);
    await pool.query(
      `UPDATE courses SET ${fields.join(', ')} WHERE id = $${i}`,
      vals,
    );
    return this.getCourseModes(courseId);
  }

  static async getLectureContext(lectureId: number): Promise<LectureRow | null> {
    const r = await pool.query<LectureRow>(
      `SELECT l.id, l.course_id, l.title, l.expires_at,
              COALESCE(c.lecture_access_mode, 'always_open') AS lecture_access_mode,
              COALESCE(c.assignment_mode, 'lecture_based') AS assignment_mode
       FROM lectures l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = $1`,
      [lectureId],
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * صلاحية دخول الطالب للمحاضرة حسب وضع الكورس.
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
        lecture_access_mode: 'always_open',
      };
    }

    const courseAccess = await CourseAccessService.checkStudentAccess(studentId, lecture.course_id);
    if (!courseAccess.hasAccess) {
      return {
        can_access: false,
        status: 'not_enrolled',
        message: courseAccess.message || 'غير مشترك في هذا الكورس',
        lecture_access_mode: lecture.lecture_access_mode,
      };
    }

    // Course group targeting (independent from centerMgmt)
    const groupAccess = await CourseGroupAccessService.checkStudentLectureGroupAccess(
      lectureId,
      studentId,
    );
    if (!groupAccess.allowed) {
      return {
        can_access: false,
        status: 'group_restricted',
        message: groupAccess.message,
        lecture_access_mode: lecture.lecture_access_mode,
      };
    }

    const mode = lecture.lecture_access_mode;

    if (mode === 'always_open') {
      return {
        can_access: true,
        status: 'open',
        message: 'المحاضرة متاحة',
        lecture_access_mode: mode,
        expires_at: null,
        activation: null,
      };
    }

    if (mode === 'time_limited') {
      const expiresAt = asDate(lecture.expires_at);
      if (!expiresAt) {
        // محاضرة بلا expires_at في وضع time_limited = مفتوحة حتى يُحدَّد الموعد
        return {
          can_access: true,
          status: 'open',
          message: 'المحاضرة متاحة (لم يُحدد موعد إغلاق)',
          lecture_access_mode: mode,
          expires_at: null,
          activation: null,
        };
      }
      if (now.getTime() > expiresAt.getTime()) {
        return {
          can_access: false,
          status: 'expired',
          message: 'انتهت مدة الوصول لهذه المحاضرة',
          lecture_access_mode: mode,
          expires_at: expiresAt.toISOString(),
          activation: null,
        };
      }
      return {
        can_access: true,
        status: 'open',
        message: 'المحاضرة متاحة حتى موعد الإغلاق',
        lecture_access_mode: mode,
        expires_at: expiresAt.toISOString(),
        activation: null,
      };
    }

    // activation_code
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
        message: 'يجب إدخال كود تفعيل لفتح هذه المحاضرة',
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
        lecture_access_mode: result.lecture_access_mode,
        expires_at: result.expires_at ?? null,
        activation: result.activation ?? null,
      });
    }
  }
}
