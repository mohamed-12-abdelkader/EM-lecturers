import pool from '../db/pool';
import { SubjectBookStructureService } from './subjectBookStructure';

export interface SubjectBook {
  id: number;
  subject_id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  order_num: number;
  is_active: boolean;
  created_by?: number | null;
  created_at: Date;
  updated_at: Date;
}

export class SubjectBookService {
  static async ensureSubjectExists(subjectId: number): Promise<void> {
    const r = await pool.query(`SELECT id FROM subjects WHERE id = $1`, [subjectId]);
    if (!r.rowCount) throw new Error('المادة غير موجودة');
  }

  static async create(
    subjectId: number,
    data: { name: string; description?: string; image_url?: string; order_num?: number },
    createdBy?: number,
  ): Promise<SubjectBook> {
    await this.ensureSubjectExists(subjectId);

    const dup = await pool.query(
      `SELECT 1 FROM subject_books WHERE subject_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [subjectId, data.name],
    );
    if (dup.rowCount) {
      const e = new Error('كتاب بنفس الاسم موجود بالفعل في هذه المادة');
      (e as any).code = '23505';
      throw e;
    }

    const r = await pool.query(
      `INSERT INTO subject_books (subject_id, name, description, image_url, order_num, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        subjectId,
        data.name,
        data.description ?? null,
        data.image_url ?? null,
        data.order_num ?? 1,
        createdBy ?? null,
      ],
    );
    const row = r.rows[0];

    await SubjectBookStructureService.syncNewBookStructure(subjectId, row.id, createdBy);

    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async getById(id: number): Promise<SubjectBook | null> {
    const r = await pool.query(`SELECT * FROM subject_books WHERE id = $1`, [id]);
    if (!r.rowCount) return null;
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async getBySubjectId(subjectId: number, activeOnly = false): Promise<SubjectBook[]> {
    await this.ensureSubjectExists(subjectId);
    const r = await pool.query(
      `SELECT * FROM subject_books
       WHERE subject_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''}
       ORDER BY order_num ASC, name ASC, id ASC`,
      [subjectId],
    );
    return r.rows.map((row: SubjectBook) => ({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  }

  static async update(
    id: number,
    data: { name?: string; description?: string; image_url?: string; order_num?: number; is_active?: boolean },
  ): Promise<SubjectBook> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الكتاب غير موجود');

    if (data.name !== undefined) {
      const dup = await pool.query(
        `SELECT 1 FROM subject_books WHERE subject_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`,
        [existing.subject_id, data.name, id],
      );
      if (dup.rowCount) {
        const e = new Error('كتاب بنفس الاسم موجود بالفعل في هذه المادة');
        (e as any).code = '23505';
        throw e;
      }
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }
    if (fields.length === 0) throw new Error('لا توجد بيانات للتحديث');

    fields.push('updated_at = NOW()');
    values.push(id);

    const r = await pool.query(
      `UPDATE subject_books SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async delete(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الكتاب غير موجود');
    await pool.query(`DELETE FROM subject_books WHERE id = $1`, [id]);
  }
}
