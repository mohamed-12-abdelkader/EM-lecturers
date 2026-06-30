"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSubjectBooksWithChaptersAndLessons = getSubjectBooksWithChaptersAndLessons;
exports.getBookWithChaptersAndLessons = getBookWithChaptersAndLessons;
exports.countSubjectContent = countSubjectContent;
const pool_1 = __importDefault(require("../db/pool"));
const chapters_1 = require("./chapters");
const lessonsAdmin_1 = require("./lessonsAdmin");
const subjectBooks_1 = require("./subjectBooks");
async function getSubjectBooksWithChaptersAndLessons(subjectId) {
    const books = await subjectBooks_1.SubjectBookService.getBySubjectId(subjectId);
    return Promise.all(books.map(async (book) => {
        const chapters = await chapters_1.ChapterService.getByBookId(book.id);
        const chaptersWithLessons = await Promise.all(chapters.map(async (chapter) => {
            try {
                const lessons = await lessonsAdmin_1.AdminLessonService.getByChapterId(chapter.id);
                return { ...chapter, lessons };
            }
            catch {
                return { ...chapter, lessons: [] };
            }
        }));
        return { ...book, chapters: chaptersWithLessons };
    }));
}
async function getBookWithChaptersAndLessons(bookId) {
    const book = await subjectBooks_1.SubjectBookService.getById(bookId);
    if (!book)
        return null;
    const chapters = await chapters_1.ChapterService.getByBookId(bookId);
    const chaptersWithLessons = await Promise.all(chapters.map(async (chapter) => {
        const lessons = await lessonsAdmin_1.AdminLessonService.getByChapterId(chapter.id);
        return { ...chapter, lessons };
    }));
    return { ...book, chapters: chaptersWithLessons };
}
async function countSubjectContent(subjectId) {
    const result = await pool_1.default.query(`SELECT
       (SELECT COUNT(*)::int FROM subject_books WHERE subject_id = $1) AS books_count,
       (SELECT COUNT(*)::int FROM chapters WHERE subject_id = $1) AS chapters_count,
       (SELECT COUNT(*)::int FROM lessons l JOIN chapters c ON l.chapter_id = c.id WHERE c.subject_id = $1) AS lessons_count,
       (SELECT COUNT(*)::int FROM questions q JOIN lessons l ON q.lesson_id = l.id JOIN chapters c ON l.chapter_id = c.id WHERE c.subject_id = $1) AS questions_count`, [subjectId]);
    return result.rows[0];
}
