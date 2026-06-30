import pool from '../db/pool';
import { randomUUID } from 'crypto';
import { SubjectBookStructureService } from './subjectBookStructure';

export interface AdminLesson {
  id: number;
  chapter_id: number;
  name: string;
  description?: string | null;
  image_url?: string | null;
  created_by?: number | null;
  created_at: Date;
  updated_at: Date;
}

export class AdminLessonService {
  static async ensureChapterExists(chapterId: number): Promise<void> {
    const r = await pool.query(`SELECT id FROM chapters WHERE id = $1`, [chapterId]);
    if (r.rowCount === 0) throw new Error('الفصل غير موجود');
  }

  static async create(
    chapterId: number,
    data: { name: string; description?: string; image_url?: string },
    createdBy?: number,
  ): Promise<AdminLesson> {
    await this.ensureChapterExists(chapterId);

    const dup = await pool.query(
      `SELECT 1 FROM lessons WHERE chapter_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
      [chapterId, data.name],
    );
    if (dup.rowCount) {
      const e = new Error('درس بنفس الاسم موجود بالفعل في هذا الفصل');
      (e as any).code = '23505';
      throw e;
    }

    const q = `
      INSERT INTO lessons (chapter_id, name, description, image_url, created_by, mirror_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    const v = [
      chapterId,
      data.name,
      data.description ?? null,
      data.image_url ?? null,
      createdBy ?? null,
      randomUUID(),
    ];
    const r = await pool.query(q, v);
    const row = r.rows[0];

    await SubjectBookStructureService.mirrorLessonToOtherBooks(row.id, createdBy);

    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async getById(id: number): Promise<AdminLesson | null> {
    const r = await pool.query(`SELECT * FROM lessons WHERE id = $1`, [id]);
    if (r.rowCount === 0) return null;
    const row = r.rows[0];
    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async update(
    id: number,
    data: { name?: string; description?: string; image_url?: string },
  ): Promise<AdminLesson> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الدرس غير موجود');

    if (data.name !== undefined) {
      const dup = await pool.query(
        `SELECT 1 FROM lessons WHERE chapter_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`,
        [existing.chapter_id, data.name, id],
      );
      if (dup.rowCount) {
        const e = new Error('درس بنفس الاسم موجود بالفعل في هذا الفصل');
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

    const q = `UPDATE lessons SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const r = await pool.query(q, values);
    const row = r.rows[0];

    await SubjectBookStructureService.syncLessonMirrors(id, data);

    return { ...row, created_at: new Date(row.created_at), updated_at: new Date(row.updated_at) };
  }

  static async delete(id: number): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('الدرس غير موجود');
    await SubjectBookStructureService.deleteLessonMirrors(id);
  }

  static async getByChapterId(chapterId: number): Promise<AdminLesson[]> {
    await this.ensureChapterExists(chapterId);
    const r = await pool.query(
      `SELECT * FROM lessons WHERE chapter_id = $1 ORDER BY name ASC, id ASC`,
      [chapterId],
    );
    return r.rows.map((row: any) => ({
      ...row,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    }));
  }
}
