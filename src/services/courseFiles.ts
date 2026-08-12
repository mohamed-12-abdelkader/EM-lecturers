import pool from '../db/pool';

export type CourseFile = {
  id: number;
  course_id: number;
  name: string;
  file_url: string;
  file_size: number | null;
  file_type: string | null;
  uploaded_by: number | null;
  created_at: string;
  updated_at: string;
};

export type CreateCourseFileInput = {
  name: string;
  file_url: string;
  file_size?: number | null;
  file_type?: string | null;
  uploaded_by?: number | null;
};

export class CourseFilesService {
  static async listByCourse(courseId: number): Promise<CourseFile[]> {
    const result = await pool.query<CourseFile>(
      `SELECT id, course_id, name, file_url, file_size, file_type, uploaded_by, created_at, updated_at
       FROM course_files
       WHERE course_id = $1
       ORDER BY created_at DESC, id DESC`,
      [courseId],
    );
    return result.rows;
  }

  static async getById(fileId: number): Promise<CourseFile | null> {
    const result = await pool.query<CourseFile>(
      `SELECT id, course_id, name, file_url, file_size, file_type, uploaded_by, created_at, updated_at
       FROM course_files WHERE id = $1`,
      [fileId],
    );
    return result.rowCount ? result.rows[0] : null;
  }

  static async create(courseId: number, input: CreateCourseFileInput): Promise<CourseFile> {
    const result = await pool.query<CourseFile>(
      `INSERT INTO course_files (course_id, name, file_url, file_size, file_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, course_id, name, file_url, file_size, file_type, uploaded_by, created_at, updated_at`,
      [
        courseId,
        input.name.trim(),
        input.file_url,
        input.file_size ?? null,
        input.file_type ?? null,
        input.uploaded_by ?? null,
      ],
    );
    return result.rows[0];
  }

  static async delete(fileId: number, courseId: number): Promise<CourseFile | null> {
    const result = await pool.query<CourseFile>(
      `DELETE FROM course_files
       WHERE id = $1 AND course_id = $2
       RETURNING id, course_id, name, file_url, file_size, file_type, uploaded_by, created_at, updated_at`,
      [fileId, courseId],
    );
    return result.rowCount ? result.rows[0] : null;
  }
}
