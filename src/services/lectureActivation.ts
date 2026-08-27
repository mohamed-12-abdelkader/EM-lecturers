import pool from '../db/pool';
import { HttpError } from '../utils';
import { CourseAccessService } from './courseAccess';
import { LectureAccessService } from './lectureAccess';

export type CreateLectureCodeInput = {
  code?: string | null;
  duration_hours: number;
  max_uses?: number; // 0 = unlimited
};

function generateCode(length = 8): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export class LectureActivationService {
  static async assertActivationMode(lectureId: number) {
    const lecture = await LectureAccessService.getLectureContext(lectureId);
    if (!lecture) throw new HttpError(404, 'المحاضرة غير موجودة');
    // كود التفعيل مطلوب لـ activation_code، ولـ groups (لطلاب خارج المجموعات المحددة)
    if (lecture.access_mode !== 'activation_code' && lecture.access_mode !== 'groups') {
      throw new HttpError(
        400,
        'أكواد التفعيل متاحة فقط للمحاضرات ذات access_mode = activation_code أو groups',
        { code: 'WRONG_ACCESS_MODE' },
      );
    }
    return lecture;
  }

  static async createCode(lectureId: number, teacherId: number, input: CreateLectureCodeInput) {
    const lecture = await this.assertActivationMode(lectureId);

    const duration = Number(input.duration_hours);
    if (!duration || duration <= 0) {
      throw new HttpError(400, 'duration_hours يجب أن يكون أكبر من صفر');
    }

    const maxUses =
      input.max_uses === undefined || input.max_uses === null ? 0 : Number(input.max_uses);
    if (Number.isNaN(maxUses) || maxUses < 0) {
      throw new HttpError(400, 'max_uses غير صالح (0 = غير محدود)');
    }

    let code = (input.code || '').trim().toUpperCase();
    if (!code) {
      for (let i = 0; i < 8; i++) {
        code = generateCode(8);
        const exists = await pool.query(`SELECT 1 FROM lecture_activation_codes WHERE code = $1`, [
          code,
        ]);
        if (!exists.rowCount) break;
      }
    } else {
      const exists = await pool.query(`SELECT 1 FROM lecture_activation_codes WHERE code = $1`, [
        code,
      ]);
      if (exists.rowCount) throw new HttpError(409, 'الكود مستخدم بالفعل', { code: 'CODE_TAKEN' });
    }

    const result = await pool.query(
      `INSERT INTO lecture_activation_codes
         (lecture_id, course_id, code, duration_hours, max_uses, uses, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5, 0, TRUE, $6)
       RETURNING *`,
      [lectureId, lecture.course_id, code, duration, maxUses, teacherId],
    );
    return result.rows[0];
  }

  static async listCodes(lectureId: number) {
    const result = await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM lecture_activations a WHERE a.code_id = c.id) AS activations_count
       FROM lecture_activation_codes c
       WHERE c.lecture_id = $1
       ORDER BY c.created_at DESC`,
      [lectureId],
    );
    return result.rows;
  }

  static async listActivations(lectureId: number) {
    const result = await pool.query(
      `SELECT a.id, a.lecture_id, a.user_id, a.code_id, a.activated_at, a.expires_at,
              u.name AS student_name, u.email AS student_email, u.phone AS student_phone,
              c.code AS activation_code,
              CASE WHEN a.expires_at > NOW() THEN true ELSE false END AS is_active
       FROM lecture_activations a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN lecture_activation_codes c ON c.id = a.code_id
       WHERE a.lecture_id = $1
       ORDER BY a.activated_at DESC`,
      [lectureId],
    );
    return result.rows;
  }

  static async deactivateCode(codeId: number, lectureId: number) {
    const result = await pool.query(
      `UPDATE lecture_activation_codes
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND lecture_id = $2
       RETURNING *`,
      [codeId, lectureId],
    );
    if (!result.rowCount) throw new HttpError(404, 'الكود غير موجود');
    return result.rows[0];
  }

  /** طالب يفعّل محاضرة بكود — المدة من لحظة الاستخدام */
  static async activateByCode(studentId: number, codeRaw: string) {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!code) throw new HttpError(400, 'كود التفعيل مطلوب');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const codeRes = await client.query(
        `SELECT lac.*, l.title AS lecture_title,
                COALESCE(l.access_mode, 'open') AS lecture_access_mode
         FROM lecture_activation_codes lac
         JOIN lectures l ON l.id = lac.lecture_id
         WHERE lac.code = $1
         FOR UPDATE OF lac`,
        [code],
      );

      if (!codeRes.rowCount) {
        throw new HttpError(404, 'كود التفعيل غير صحيح');
      }

      const row = codeRes.rows[0];
      if (row.lecture_access_mode !== 'activation_code' && row.lecture_access_mode !== 'groups') {
        throw new HttpError(400, 'هذه المحاضرة لا تستخدم نظام أكواد التفعيل');
      }
      if (!row.is_active) {
        throw new HttpError(400, 'هذا الكود غير مفعّل');
      }
      if (Number(row.max_uses) > 0 && Number(row.uses) >= Number(row.max_uses)) {
        throw new HttpError(400, 'تم استنفاد عدد استخدامات هذا الكود');
      }

      const courseAccess = await CourseAccessService.checkStudentAccess(studentId, row.course_id);
      if (!courseAccess.hasAccess) {
        throw new HttpError(403, courseAccess.message || 'يجب الاشتراك في الكورس أولاً');
      }

      const existing = await client.query(
        `SELECT * FROM lecture_activations WHERE lecture_id = $1 AND user_id = $2 FOR UPDATE`,
        [row.lecture_id, studentId],
      );

      const now = new Date();
      if (existing.rowCount) {
        const prev = existing.rows[0];
        if (new Date(prev.expires_at).getTime() > now.getTime()) {
          throw new HttpError(400, 'لديك تفعيل ساري لهذه المحاضرة بالفعل', {
            code: 'ALREADY_ACTIVE',
            activation: {
              activated_at: prev.activated_at,
              expires_at: prev.expires_at,
            },
          });
        }
      }

      const durationHours = Number(row.duration_hours);
      const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

      const upsert = await client.query(
        `INSERT INTO lecture_activations
           (lecture_id, course_id, user_id, code_id, activated_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (lecture_id, user_id) DO UPDATE SET
           code_id = EXCLUDED.code_id,
           activated_at = EXCLUDED.activated_at,
           expires_at = EXCLUDED.expires_at
         RETURNING *`,
        [row.lecture_id, row.course_id, studentId, row.id, now, expiresAt],
      );

      await client.query(
        `UPDATE lecture_activation_codes SET uses = uses + 1, updated_at = NOW() WHERE id = $1`,
        [row.id],
      );

      await client.query('COMMIT');

      return {
        success: true,
        message: 'تم تفعيل المحاضرة بنجاح',
        lecture: {
          id: row.lecture_id,
          title: row.lecture_title,
          course_id: row.course_id,
        },
        activation: {
          activated_at: upsert.rows[0].activated_at,
          expires_at: upsert.rows[0].expires_at,
          duration_hours: durationHours,
          remaining_seconds: Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
        },
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
