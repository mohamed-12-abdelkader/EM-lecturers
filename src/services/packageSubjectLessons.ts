import pool from '../db/pool';

export interface Lesson {
  id: number;
  subject_id: number;
  name: string;
  order_index: number;
  created_at: string;
  is_visible: boolean;
  videos?: Video[];
  assignments?: Assignment[];
}

export interface Video {
  id: number;
  lesson_id: number;
  name: string;
  link: string;
  platform: string;
  created_at: string;
}

export interface Assignment {
  id: number;
  lesson_id: number;
  name: string;
  question_count: number;
  total_marks: number;
  created_at: string;
  is_visible: boolean;
}

export class PackageSubjectLessonService {
  // Create Lesson
  static async createLesson(subjectId: number, name: string): Promise<Lesson> {
    const result = await pool.query(
      `INSERT INTO package_subject_lessons (subject_id, name)
       VALUES ($1, $2)
       RETURNING *`,
      [subjectId, name]
    );
    return result.rows[0];
  }

  // Get Lessons with Content
  static async getLessonsBySubject(subjectId: number): Promise<Lesson[]> {
    // 1. Get Lessons
    const lessonsResult = await pool.query(
      'SELECT * FROM package_subject_lessons WHERE subject_id = $1 ORDER BY created_at DESC',
      [subjectId]
    );
    const lessons = lessonsResult.rows;

    if (lessons.length === 0) return [];

    const lessonIds = lessons.map(l => l.id);

    if (lessonIds.length === 0) {
      return lessons.map(lesson => ({
        ...lesson,
        videos: [],
        assignments: []
      }));
    }

    // 2. Get Videos
    const videosResult = await pool.query(
      'SELECT * FROM package_subject_videos WHERE lesson_id = ANY($1)',
      [lessonIds]
    );

    // 3. Get Assignments
    const assignmentsResult = await pool.query(
      'SELECT * FROM package_subject_assignments WHERE lesson_id = ANY($1)',
      [lessonIds]
    );

    // 4. Assemble
    return lessons.map(lesson => ({
      ...lesson,
      videos: videosResult.rows.filter(v => v.lesson_id === lesson.id),
      assignments: assignmentsResult.rows.filter(a => a.lesson_id === lesson.id)
    }));
  }

  // Get Lessons with Content (Filtered for Students: Visible Only)
  static async getVisibleLessonsBySubject(subjectId: number): Promise<Lesson[]> {
    // 1. Get Visible Lessons
    const lessonsResult = await pool.query(
      'SELECT * FROM package_subject_lessons WHERE subject_id = $1 AND is_visible = TRUE ORDER BY created_at DESC',
      [subjectId]
    );
    const lessons = lessonsResult.rows;

    if (lessons.length === 0) return [];

    const lessonIds = lessons.map(l => l.id);

    if (lessonIds.length === 0) {
      return lessons.map(lesson => ({
        ...lesson,
        videos: [],
        assignments: []
      }));
    }

    // 2. Get Videos (No separate visibility for videos yet, assuming if lesson is visible, its videos are too? 
    // Wait, requirement didn't specify video visibility, only lesson and assignment. 
    // IF assignment has visibility, filter it.)

    const videosResult = await pool.query(
      'SELECT * FROM package_subject_videos WHERE lesson_id = ANY($1)',
      [lessonIds]
    );

    // 3. Get Visible Assignments
    const assignmentsResult = await pool.query(
      'SELECT * FROM package_subject_assignments WHERE lesson_id = ANY($1) AND is_visible = TRUE',
      [lessonIds]
    );

    // 4. Assemble
    return lessons.map(lesson => ({
      ...lesson,
      videos: videosResult.rows.filter(v => v.lesson_id === lesson.id),
      assignments: assignmentsResult.rows.filter(a => a.lesson_id === lesson.id)
    }));
  }

  // Check if lesson exists
  static async getLesson(lessonId: number): Promise<Lesson | null> {
    const result = await pool.query('SELECT * FROM package_subject_lessons WHERE id = $1', [lessonId]);
    return result.rows[0] || null;
  }

  // Update Lesson
  static async updateLesson(lessonId: number, name: string): Promise<Lesson | null> {
    const result = await pool.query(
      'UPDATE package_subject_lessons SET name = $1 WHERE id = $2 RETURNING *',
      [name, lessonId]
    );
    return result.rows[0];
  }

  // Delete Lesson
  static async deleteLesson(lessonId: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM package_subject_lessons WHERE id = $1', [lessonId]);
    return (result.rowCount ?? 0) > 0;
  }

  // --- Videos ---

  static async addVideo(lessonId: number, name: string, link: string): Promise<Video> {
    const result = await pool.query(
      `INSERT INTO package_subject_videos (lesson_id, name, link)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [lessonId, name, link]
    );
    return result.rows[0];
  }

  static async deleteVideo(videoId: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM package_subject_videos WHERE id = $1', [videoId]);
    return (result.rowCount ?? 0) > 0;
  }

  // --- Assignments ---

  static async addAssignment(lessonId: number, name: string, questionCount: number, totalMarks: number): Promise<Assignment> {
    const result = await pool.query(
      `INSERT INTO package_subject_assignments (lesson_id, name, question_count, total_marks)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [lessonId, name, questionCount, totalMarks]
    );
    return result.rows[0];
  }

  static async deleteAssignment(assignmentId: number): Promise<boolean> {
    const result = await pool.query('DELETE FROM package_subject_assignments WHERE id = $1', [assignmentId]);
    return (result.rowCount ?? 0) > 0;
  }
  // --- Visibility Toggles ---

  static async toggleLessonVisibility(lessonId: number, isVisible: boolean): Promise<Lesson | null> {
    const result = await pool.query(
      'UPDATE package_subject_lessons SET is_visible = $1 WHERE id = $2 RETURNING *',
      [isVisible, lessonId]
    );
    return result.rows[0];
  }

  static async toggleAssignmentVisibility(assignmentId: number, isVisible: boolean): Promise<Assignment | null> {
    const result = await pool.query(
      'UPDATE package_subject_assignments SET is_visible = $1 WHERE id = $2 RETURNING *',
      [isVisible, assignmentId]
    );
    return result.rows[0];
  }
}
