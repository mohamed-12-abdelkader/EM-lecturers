import pool from '../../../db/pool';
import type { FileCategoryRow } from '../types';

export class FileCategoriesRepository {
  static async create(teacherId: number, name: string): Promise<FileCategoryRow> {
    const result = await pool.query<FileCategoryRow>(
      `INSERT INTO file_categories (teacher_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [teacherId, name],
    );
    return result.rows[0];
  }

  static async findById(id: number, teacherId: number): Promise<FileCategoryRow | null> {
    const result = await pool.query<FileCategoryRow>(
      `SELECT * FROM file_categories WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async listByTeacher(teacherId: number): Promise<FileCategoryRow[]> {
    const result = await pool.query<FileCategoryRow>(
      `SELECT * FROM file_categories WHERE teacher_id = $1 ORDER BY name ASC`,
      [teacherId],
    );
    return result.rows;
  }

  static async update(id: number, teacherId: number, name: string): Promise<FileCategoryRow | null> {
    const result = await pool.query<FileCategoryRow>(
      `UPDATE file_categories
       SET name = $3, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`,
      [id, teacherId, name],
    );
    return result.rows[0] ?? null;
  }

  static async delete(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `DELETE FROM file_categories WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async countFilesInCategory(categoryId: number, teacherId: number): Promise<number> {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM teacher_files
       WHERE category_id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [categoryId, teacherId],
    );
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }
}
