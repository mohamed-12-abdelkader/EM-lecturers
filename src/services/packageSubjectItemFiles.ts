import pool from '../db/pool';

export interface SubjectFileData {
  name: string;
  file_url: string;
  file_size?: number;
  file_type?: string;
  order_index?: number;
}

export interface SubjectFile {
  id: number;
  subject_id: number;
  name: string;
  file_url: string;
  file_size: number | null;
  file_type: string | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export class PackageSubjectItemFilesService {
  static async getFilesBySubject(subjectId: number): Promise<SubjectFile[]> {
    const res = await pool.query<SubjectFile>(
      `SELECT * FROM package_subject_item_files
       WHERE subject_id = $1
       ORDER BY order_index ASC, created_at ASC`,
      [subjectId]
    );
    return res.rows;
  }

  static async getFileById(fileId: number): Promise<SubjectFile | null> {
    const res = await pool.query<SubjectFile>(
      `SELECT * FROM package_subject_item_files WHERE id = $1`,
      [fileId]
    );
    return res.rows[0] || null;
  }

  static async createFile(subjectId: number, data: SubjectFileData): Promise<SubjectFile> {
    const res = await pool.query<SubjectFile>(
      `INSERT INTO package_subject_item_files (subject_id, name, file_url, file_size, file_type, order_index)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        subjectId,
        data.name,
        data.file_url,
        data.file_size || null,
        data.file_type || null,
        data.order_index ?? 0
      ]
    );
    return res.rows[0];
  }

  static async updateFile(fileId: number, data: Partial<SubjectFileData>): Promise<SubjectFile | null> {
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${i++}`);
      values.push(data.name);
    }
    if (data.file_url !== undefined) {
      updates.push(`file_url = $${i++}`);
      values.push(data.file_url);
    }
    if (data.file_size !== undefined) {
      updates.push(`file_size = $${i++}`);
      values.push(data.file_size);
    }
    if (data.file_type !== undefined) {
      updates.push(`file_type = $${i++}`);
      values.push(data.file_type);
    }
    if (data.order_index !== undefined) {
      updates.push(`order_index = $${i++}`);
      values.push(data.order_index);
    }

    if (!updates.length) return await this.getFileById(fileId);

    updates.push(`updated_at = NOW()`);
    values.push(fileId);

    const res = await pool.query<SubjectFile>(
      `UPDATE package_subject_item_files
       SET ${updates.join(', ')}
       WHERE id = $${i}
       RETURNING *`,
      values
    );
    return res.rows[0] || null;
  }

  static async deleteFile(fileId: number): Promise<SubjectFile | null> {
    const res = await pool.query<SubjectFile>(
      `DELETE FROM package_subject_item_files WHERE id = $1 RETURNING *`,
      [fileId]
    );
    return res.rows[0] || null;
  }
}
