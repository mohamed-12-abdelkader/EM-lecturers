import pool from '../db/pool';

export interface Chapter {
  id: number;
  subject_id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  created_by?: number | null;
  created_at: Date;
  updated_at: Date;
  subject_name?: string | null;
}

export class ChapterService {
  static async ensureSubjectExists(subjectId: number): Promise<void> {
    const q = `SELECT id FROM subjects WHERE id = $1`;
    const r = await pool.query(q, [subjectId]);
    if (r.rowCount === 0) throw new Error('المادة غير موجودة');
  }

  static async create(
    subjectId: number,
    data: { name: string; description?: string; image_url?: string },
    createdBy?: number,
  ): Promise<Chapter> {
    await this.ensureSubjectExists(subjectId);

    const dup = await pool.query(
      `SELECT 1 FROM chapters WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [subjectId, data.name],
    );
    if (dup.rowCount) {
      const e = new Error('فصل بنفس الاسم موجود بالفعل في هذه المادة');
      (e as any).code = '23505';
      throw e;
    }

    const q = `
      INSERT INTO chapters (subject_id, name, description, image_url, created_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;
    const v = [
      subjectId,
      data.name,
      data.description ?? null,
      data.image_url ?? null,
      createdBy ?? null,
    ];
    const r = await pool.query(q, v);
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async getById(id: number): Promise<Chapter | null> {
    const r = await pool.query(`SELECT * FROM chapters WHERE id = $1`, [id]);
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async getBySubjectId(subjectId: number): Promise<Chapter[]> {
    await this.ensureSubjectExists(subjectId);
    const r = await pool.query(
      `SELECT * FROM chapters WHERE subject_id = $1 ORDER BY name ASC, id ASC`,
      [subjectId],
    );
    return r.rows.map((row: any) => ({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  }

  static async update(
id: number, subjectId: number, chapterId: number, data: { name?: string; description?: string; image_url?: string; },
  ): Promise<Chapter> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الفصل غير موجود');

    if (data.name !== undefined) {
      const dup = await pool.query(
        `SELECT 1 FROM chapters WHERE subject_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`,
        [existing.subject_id, data.name, id],
      );
      if (dup.rowCount) {
        const e = new Error('فصل بنفس الاسم موجود بالفعل في هذه المادة');
        (e as any).code = '23505';
        throw e;
      }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx}`);
      values.push(data.name);
      idx++;
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx}`);
      values.push(data.description);
      idx++;
    }
    if (data.image_url !== undefined) {
      fields.push(`image_url = $${idx}`);
      values.push(data.image_url);
      idx++;
    }

    if (fields.length === 0) throw new Error('لا توجد بيانات للتحديث');

    fields.push(`updated_at = NOW()`);
    values.push(id);

    const q = `UPDATE chapters SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const r = await pool.query(q, values);
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async delete(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الفصل غير موجود');

    const r = await pool.query(`DELETE FROM chapters WHERE id = $1`, [id]);
    if (r.rowCount === 0) throw new Error('فشل في حذف الفصل');
  }

  // ✅ الجزء اللي كان عامل المشكلة
  static async getBySubjectAndBank(subjectId: number, questionBankId: number): Promise<Chapter[]> {
    const query = `
      SELECT 
        c.*,
        s.name as subject_name
      FROM chapters c
      LEFT JOIN subjects s ON c.subject_id = s.id
      WHERE c.subject_id = $1 AND c.question_bank_id = $2 AND c.is_active = true
      ORDER BY c."order" ASC, c.name ASC
    `;

    const result = await pool.query(query, [subjectId, questionBankId]);

    return result.rows.map((chapter: any) => ({
      ...chapter,
      created_at: new Date(chapter.created_at),
      updated_at: new Date(chapter.updated_at),
    }));
  }
}
