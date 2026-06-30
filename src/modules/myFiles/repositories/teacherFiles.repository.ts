import pool from '../../../db/pool';
import type { FileStatistics, ListFilesQuery, TeacherFileListItem, TeacherFileRow } from '../types';

const SORT_COLUMNS: Record<ListFilesQuery['sortBy'], string> = {
  created_at: 'f.created_at',
  name: 'f.name',
  file_size: 'f.file_size',
  downloads_count: 'f.downloads_count',
};

export class TeacherFilesRepository {
  static async create(input: {
    teacherId: number;
    name: string;
    description?: string | null;
    fileUrl: string;
    fileKey: string;
    fileSize: number;
    fileExtension: string;
    mimeType: string;
    categoryId?: number | null;
  }): Promise<TeacherFileRow> {
    const result = await pool.query<TeacherFileRow>(
      `INSERT INTO teacher_files (
         teacher_id, name, description, file_url, file_key,
         file_size, file_extension, mime_type, category_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.teacherId,
        input.name,
        input.description ?? null,
        input.fileUrl,
        input.fileKey,
        input.fileSize,
        input.fileExtension,
        input.mimeType,
        input.categoryId ?? null,
      ],
    );
    return result.rows[0];
  }

  static async findById(id: number, teacherId: number): Promise<TeacherFileListItem | null> {
    const result = await pool.query<TeacherFileListItem>(
      `SELECT f.*, c.name AS category_name
       FROM teacher_files f
       LEFT JOIN file_categories c ON c.id = f.category_id
       WHERE f.id = $1 AND f.teacher_id = $2 AND f.deleted_at IS NULL`,
      [id, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async list(query: ListFilesQuery): Promise<{ items: TeacherFileListItem[]; total: number }> {
    const params: unknown[] = [query.teacherId];
    const where: string[] = ['f.teacher_id = $1', 'f.deleted_at IS NULL'];

    if (query.search?.trim()) {
      params.push(`%${query.search.trim()}%`);
      where.push(`(f.name ILIKE $${params.length} OR f.description ILIKE $${params.length})`);
    }

    if (query.categoryId) {
      params.push(query.categoryId);
      where.push(`f.category_id = $${params.length}`);
    }

    if (query.fileType?.trim()) {
      const type = query.fileType.trim().toLowerCase();
      if (type === 'images' || type === 'image') {
        where.push(`f.file_extension IN ('jpg', 'jpeg', 'png', 'webp')`);
      } else {
        params.push(type.replace(/^\./, ''));
        where.push(`f.file_extension = $${params.length}`);
      }
    }

    const whereSql = where.join(' AND ');
    const sortCol = SORT_COLUMNS[query.sortBy] ?? SORT_COLUMNS.created_at;
    const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM teacher_files f WHERE ${whereSql}`,
      params,
    );
    const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

    const offset = (query.page - 1) * query.limit;
    params.push(query.limit, offset);

    const listResult = await pool.query<TeacherFileListItem>(
      `SELECT f.*, c.name AS category_name
       FROM teacher_files f
       LEFT JOIN file_categories c ON c.id = f.category_id
       WHERE ${whereSql}
       ORDER BY ${sortCol} ${sortOrder}
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: listResult.rows, total };
  }

  static async update(
    id: number,
    teacherId: number,
    fields: { name?: string; description?: string | null; categoryId?: number | null },
  ): Promise<TeacherFileListItem | null> {
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [id, teacherId];

    if (fields.name !== undefined) {
      params.push(fields.name);
      sets.push(`name = $${params.length}`);
    }
    if (fields.description !== undefined) {
      params.push(fields.description);
      sets.push(`description = $${params.length}`);
    }
    if (fields.categoryId !== undefined) {
      params.push(fields.categoryId);
      sets.push(`category_id = $${params.length}`);
    }

    const result = await pool.query<TeacherFileListItem>(
      `UPDATE teacher_files f
       SET ${sets.join(', ')}
       WHERE f.id = $1 AND f.teacher_id = $2 AND f.deleted_at IS NULL
       RETURNING f.*, (
         SELECT c.name FROM file_categories c WHERE c.id = f.category_id
       ) AS category_name`,
      params,
    );
    return result.rows[0] ?? null;
  }

  static async softDelete(id: number, teacherId: number): Promise<boolean> {
    const result = await pool.query(
      `UPDATE teacher_files
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL`,
      [id, teacherId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  static async bulkSoftDelete(ids: number[], teacherId: number): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await pool.query(
      `UPDATE teacher_files
       SET deleted_at = NOW(), updated_at = NOW()
       WHERE teacher_id = $1 AND id = ANY($2::int[]) AND deleted_at IS NULL`,
      [teacherId, ids],
    );
    return result.rowCount ?? 0;
  }

  static async incrementDownloads(id: number, teacherId: number): Promise<TeacherFileRow | null> {
    const result = await pool.query<TeacherFileRow>(
      `UPDATE teacher_files
       SET downloads_count = downloads_count + 1, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND deleted_at IS NULL
       RETURNING *`,
      [id, teacherId],
    );
    return result.rows[0] ?? null;
  }

  static async getStatistics(teacherId: number): Promise<FileStatistics> {
    const totals = await pool.query<{
      total_files: string;
      total_bytes: string;
      total_downloads: string;
    }>(
      `SELECT
         COUNT(*)::text AS total_files,
         COALESCE(SUM(file_size), 0)::text AS total_bytes,
         COALESCE(SUM(downloads_count), 0)::text AS total_downloads
       FROM teacher_files
       WHERE teacher_id = $1 AND deleted_at IS NULL`,
      [teacherId],
    );

    const byType = await pool.query<{ bucket: string; count: string }>(
      `SELECT
         CASE
           WHEN file_extension IN ('jpg', 'jpeg', 'png', 'webp') THEN 'images'
           ELSE file_extension
         END AS bucket,
         COUNT(*)::text AS count
       FROM teacher_files
       WHERE teacher_id = $1 AND deleted_at IS NULL
       GROUP BY 1`,
      [teacherId],
    );

    const totalBytes = parseInt(totals.rows[0]?.total_bytes ?? '0', 10);
    const filesByType: Record<string, number> = {};
    for (const row of byType.rows) {
      filesByType[row.bucket] = parseInt(row.count, 10);
    }

    return {
      totalFiles: parseInt(totals.rows[0]?.total_files ?? '0', 10),
      totalStorageUsedBytes: totalBytes,
      totalStorageUsed: formatBytes(totalBytes),
      totalDownloads: parseInt(totals.rows[0]?.total_downloads ?? '0', 10),
      filesByType,
    };
  }

  static async findManyByIds(ids: number[], teacherId: number): Promise<TeacherFileRow[]> {
    if (ids.length === 0) return [];
    const result = await pool.query<TeacherFileRow>(
      `SELECT * FROM teacher_files
       WHERE teacher_id = $1 AND id = ANY($2::int[]) AND deleted_at IS NULL`,
      [teacherId, ids],
    );
    return result.rows;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** i;
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
