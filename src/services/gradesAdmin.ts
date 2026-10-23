import pool from '../db/pool';
import { HttpError } from '../utils';

export type GradeStage = 'prep' | 'secondary' | 'university' | 'general';
export type GradeStatus = 'active' | 'inactive';

export type GradeRow = {
  id: number;
  name: string;
  slug: string;
  stage: GradeStage;
  status: GradeStatus;
  level: number | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type CreateGradeInput = {
  name: string;
  stage: GradeStage;
  slug?: string;
  level?: number | null;
  status?: GradeStatus;
};

export type UpdateGradeInput = {
  name?: string;
  stage?: GradeStage;
  slug?: string;
  level?: number | null;
  status?: GradeStatus;
};

export type ListGradesFilters = {
  status?: GradeStatus | 'all';
  stage?: GradeStage;
  search?: string;
};

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\u0600-\u06FF-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function slugFromName(name: string): string {
  const base = normalizeSlug(name);
  if (base) return base;
  return `grade-${Date.now()}`;
}

export class GradesAdminService {
  static async list(filters: ListGradesFilters = {}): Promise<GradeRow[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (filters.status && filters.status !== 'all') {
      conditions.push(`status = $${i++}`);
      values.push(filters.status);
    }
    if (filters.stage) {
      conditions.push(`stage = $${i++}`);
      values.push(filters.stage);
    }
    if (filters.search?.trim()) {
      conditions.push(`(name ILIKE $${i} OR slug ILIKE $${i})`);
      values.push(`%${filters.search.trim()}%`);
      i++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query<GradeRow>(
      `SELECT id, name, slug, stage, status, level, is_active, created_at, updated_at
       FROM grades
       ${where}
       ORDER BY
         CASE stage
           WHEN 'prep' THEN 1
           WHEN 'secondary' THEN 2
           WHEN 'university' THEN 3
           ELSE 4
         END,
         level NULLS LAST,
         id ASC`,
      values,
    );
    return result.rows;
  }

  static async getById(id: number): Promise<GradeRow> {
    const result = await pool.query<GradeRow>(
      `SELECT id, name, slug, stage, status, level, is_active, created_at, updated_at
       FROM grades WHERE id = $1`,
      [id],
    );
    if (!result.rowCount) throw new HttpError(404, 'الصف الدراسي غير موجود');
    return result.rows[0];
  }

  static async create(input: CreateGradeInput): Promise<GradeRow> {
    const name = input.name.trim();
    if (!name) throw new HttpError(400, 'name مطلوب');

    const stage = input.stage;
    const status: GradeStatus = input.status ?? 'active';
    const slug = normalizeSlug(input.slug || '') || slugFromName(name);
    const level = input.level == null || Number.isNaN(Number(input.level)) ? null : Number(input.level);
    const isActive = status === 'active';

    try {
      const result = await pool.query<GradeRow>(
        `INSERT INTO grades (name, slug, stage, status, level, is_active, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id, name, slug, stage, status, level, is_active, created_at, updated_at`,
        [name, slug, stage, status, level, isActive],
      );
      return result.rows[0];
    } catch (error: any) {
      if (error?.code === '23505') {
        if (String(error.constraint || error.detail || '').includes('slug')) {
          throw new HttpError(409, 'الـ slug مستخدم بالفعل');
        }
        throw new HttpError(409, 'اسم الصف مستخدم بالفعل');
      }
      if (error?.code === '23514') {
        throw new HttpError(400, 'قيم stage أو status غير صالحة');
      }
      throw error;
    }
  }

  static async update(id: number, input: UpdateGradeInput): Promise<GradeRow> {
    await this.getById(id);

    const fields: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new HttpError(400, 'name لا يمكن أن يكون فارغًا');
      fields.push(`name = $${i++}`);
      values.push(name);
    }
    if (input.slug !== undefined) {
      const slug = normalizeSlug(input.slug);
      if (!slug) throw new HttpError(400, 'slug غير صالح');
      fields.push(`slug = $${i++}`);
      values.push(slug);
    }
    if (input.stage !== undefined) {
      fields.push(`stage = $${i++}`);
      values.push(input.stage);
    }
    if (input.level !== undefined) {
      const level =
        input.level == null || Number.isNaN(Number(input.level)) ? null : Number(input.level);
      fields.push(`level = $${i++}`);
      values.push(level);
    }
    if (input.status !== undefined) {
      fields.push(`status = $${i++}`);
      values.push(input.status);
      fields.push(`is_active = $${i++}`);
      values.push(input.status === 'active');
    }

    if (!fields.length) {
      return this.getById(id);
    }

    fields.push('updated_at = NOW()');
    values.push(id);

    try {
      const result = await pool.query<GradeRow>(
        `UPDATE grades SET ${fields.join(', ')}
         WHERE id = $${i}
         RETURNING id, name, slug, stage, status, level, is_active, created_at, updated_at`,
        values,
      );
      return result.rows[0];
    } catch (error: any) {
      if (error?.code === '23505') {
        if (String(error.constraint || error.detail || '').includes('slug')) {
          throw new HttpError(409, 'الـ slug مستخدم بالفعل');
        }
        throw new HttpError(409, 'اسم الصف مستخدم بالفعل');
      }
      if (error?.code === '23514') {
        throw new HttpError(400, 'قيم stage أو status غير صالحة');
      }
      throw error;
    }
  }

  static async setStatus(id: number, status: GradeStatus): Promise<GradeRow> {
    return this.update(id, { status });
  }

  /** Usage counts that block hard delete (RESTRICT / important relations). */
  static async getUsage(id: number) {
    const queries = await Promise.all([
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM teacher_grades WHERE grade_id = $1`, [id]),
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM user_grades WHERE grade_id = $1`, [id]),
      pool.query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM courses WHERE grade_id = $1`, [id]),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM course_grades WHERE grade_id = $1`,
        [id],
      ).catch(() => ({ rows: [{ c: '0' }] })),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM course_groups WHERE grade_id = $1`,
        [id],
      ).catch(() => ({ rows: [{ c: '0' }] })),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM study_groups WHERE grade_id = $1`,
        [id],
      ).catch(() => ({ rows: [{ c: '0' }] })),
      pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM leagues WHERE grade_id = $1`,
        [id],
      ).catch(() => ({ rows: [{ c: '0' }] })),
    ]);

    const usage = {
      teachers: Number(queries[0].rows[0]?.c ?? 0),
      students: Number(queries[1].rows[0]?.c ?? 0),
      courses: Number(queries[2].rows[0]?.c ?? 0),
      course_grades: Number(queries[3].rows[0]?.c ?? 0),
      course_groups: Number(queries[4].rows[0]?.c ?? 0),
      study_groups: Number(queries[5].rows[0]?.c ?? 0),
      leagues: Number(queries[6].rows[0]?.c ?? 0),
    };
    const total = Object.values(usage).reduce((a, b) => a + b, 0);
    return { ...usage, total };
  }

  /**
   * Hard delete. Fails with 409 if the grade is still referenced.
   * Prefer setStatus('inactive') for soft removal.
   */
  static async remove(id: number): Promise<{ deleted: true; id: number }> {
    await this.getById(id);
    const usage = await this.getUsage(id);
    if (usage.total > 0) {
      throw new HttpError(
        409,
        'لا يمكن حذف الصف لأنه مستخدم حاليًا. عطّله بدلًا من الحذف.',
        { usage },
      );
    }

    try {
      await pool.query(`DELETE FROM grades WHERE id = $1`, [id]);
      return { deleted: true, id };
    } catch (error: any) {
      if (error?.code === '23503') {
        throw new HttpError(
          409,
          'لا يمكن حذف الصف لوجود بيانات مرتبطة به. عطّله بدلًا من الحذف.',
        );
      }
      throw error;
    }
  }
}
