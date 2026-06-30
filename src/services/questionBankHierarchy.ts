import pool from '../db/pool';
import { ChapterService } from './chapters';
import { AdminLessonService } from './lessonsAdmin';
import { SubjectBookService } from './subjectBooks';

export async function getSubjectBooksWithChaptersAndLessons(subjectId: number) {
  const books = await SubjectBookService.getBySubjectId(subjectId);
  return Promise.all(
    books.map(async (book) => {
      const chapters = await ChapterService.getByBookId(book.id);
      const chaptersWithLessons = await Promise.all(
        chapters.map(async (chapter) => {
          try {
            const lessons = await AdminLessonService.getByChapterId(chapter.id);
            return { ...chapter, lessons };
          } catch {
            return { ...chapter, lessons: [] };
          }
        }),
      );
      return { ...book, chapters: chaptersWithLessons };
    }),
  );
}

export async function getBookWithChaptersAndLessons(bookId: number) {
  const book = await SubjectBookService.getById(bookId);
  if (!book) return null;
  const chapters = await ChapterService.getByBookId(bookId);
  const chaptersWithLessons = await Promise.all(
    chapters.map(async (chapter) => {
      const lessons = await AdminLessonService.getByChapterId(chapter.id);
      return { ...chapter, lessons };
    }),
  );
  return { ...book, chapters: chaptersWithLessons };
}

export async function countSubjectContent(subjectId: number) {
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM subject_books WHERE subject_id = $1) AS books_count,
       (SELECT COUNT(*)::int FROM chapters WHERE subject_id = $1) AS chapters_count,
       (SELECT COUNT(*)::int FROM lessons l JOIN chapters c ON l.chapter_id = c.id WHERE c.subject_id = $1) AS lessons_count,
       (SELECT COUNT(*)::int FROM questions q JOIN lessons l ON q.lesson_id = l.id JOIN chapters c ON l.chapter_id = c.id WHERE c.subject_id = $1) AS questions_count`,
    [subjectId],
  );
  return result.rows[0];
}
