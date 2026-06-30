import pool from '../db/pool';

export async function teacherHasSubjectAccess(
  teacherId: number,
  subjectId: number,
): Promise<boolean> {
  const res = await pool.query(
    'SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2 LIMIT 1',
    [teacherId, subjectId],
  );
  return !!res.rowCount && res.rowCount > 0;
}

export async function getSubjectIdByChapterId(chapterId: number): Promise<number | null> {
  const res = await pool.query(
    `SELECT COALESCE(c.subject_id, sb.subject_id) AS subject_id
     FROM chapters c
     LEFT JOIN subject_books sb ON sb.id = c.book_id
     WHERE c.id = $1`,
    [chapterId],
  );
  if (!res.rowCount) return null;
  return res.rows[0].subject_id as number;
}

export async function getSubjectIdByBookId(bookId: number): Promise<number | null> {
  const res = await pool.query(`SELECT subject_id FROM subject_books WHERE id = $1`, [bookId]);
  if (!res.rowCount) return null;
  return res.rows[0].subject_id as number;
}

export async function getSubjectIdByLessonId(lessonId: number): Promise<number | null> {
  const res = await pool.query(
    `SELECT c.subject_id
     FROM lessons l
     JOIN chapters c ON l.chapter_id = c.id
     WHERE l.id = $1`,
    [lessonId],
  );
  if (!res.rowCount) return null;
  return res.rows[0].subject_id as number;
}
