"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubjectBookStructureService = void 0;
const crypto_1 = require("crypto");
const pool_1 = __importDefault(require("../db/pool"));
async function getOtherBooksInSubject(q, subjectId, excludeBookId) {
    const r = await q.query(`SELECT id FROM subject_books
     WHERE subject_id = $1 AND id <> $2
     ORDER BY order_num ASC, id ASC`, [subjectId, excludeBookId]);
    return r.rows;
}
async function getCanonicalBookId(q, subjectId) {
    const r = await q.query(`SELECT id FROM subject_books
     WHERE subject_id = $1
     ORDER BY order_num ASC, id ASC
     LIMIT 1`, [subjectId]);
    return r.rows[0]?.id ?? null;
}
class SubjectBookStructureService {
    /** نسخ الفصول والدروس من كتاب إلى كتاب آخر (بدون نسخ الأسئلة) */
    static async copyStructureFromBook(sourceBookId, targetBookId, createdBy, q = pool_1.default) {
        if (sourceBookId === targetBookId)
            return;
        const sourceChapters = await q.query(`SELECT * FROM chapters WHERE book_id = $1 ORDER BY order_num ASC, id ASC`, [sourceBookId]);
        for (const srcChapter of sourceChapters.rows) {
            let mirrorKey = srcChapter.mirror_key;
            if (!mirrorKey) {
                mirrorKey = (0, crypto_1.randomUUID)();
                await q.query(`UPDATE chapters SET mirror_key = $1 WHERE id = $2`, [
                    mirrorKey,
                    srcChapter.id,
                ]);
            }
            const existingChapter = await q.query(`SELECT id FROM chapters WHERE book_id = $1 AND mirror_key = $2 LIMIT 1`, [targetBookId, mirrorKey]);
            let targetChapterId;
            if (existingChapter.rowCount) {
                targetChapterId = existingChapter.rows[0].id;
            }
            else {
                const ins = await q.query(`INSERT INTO chapters (
             subject_id, book_id, name, description, image_url, order_num, created_by, mirror_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`, [
                    srcChapter.subject_id,
                    targetBookId,
                    srcChapter.name,
                    srcChapter.description,
                    srcChapter.image_url,
                    srcChapter.order_num,
                    createdBy ?? srcChapter.created_by,
                    mirrorKey,
                ]);
                targetChapterId = ins.rows[0].id;
            }
            const sourceLessons = await q.query(`SELECT * FROM lessons WHERE chapter_id = $1 ORDER BY order_num ASC, id ASC`, [srcChapter.id]);
            for (const srcLesson of sourceLessons.rows) {
                let lessonMirrorKey = srcLesson.mirror_key;
                if (!lessonMirrorKey) {
                    lessonMirrorKey = (0, crypto_1.randomUUID)();
                    await q.query(`UPDATE lessons SET mirror_key = $1 WHERE id = $2`, [
                        lessonMirrorKey,
                        srcLesson.id,
                    ]);
                }
                const existingLesson = await q.query(`SELECT id FROM lessons WHERE chapter_id = $1 AND mirror_key = $2 LIMIT 1`, [targetChapterId, lessonMirrorKey]);
                if (existingLesson.rowCount)
                    continue;
                await q.query(`INSERT INTO lessons (
             chapter_id, name, description, image_url, order_num, created_by, mirror_key
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                    targetChapterId,
                    srcLesson.name,
                    srcLesson.description,
                    srcLesson.image_url,
                    srcLesson.order_num,
                    createdBy ?? srcLesson.created_by,
                    lessonMirrorKey,
                ]);
            }
        }
    }
    /** بعد إنشاء كتاب جديد: نسخ هيكل أول كتاب في المادة */
    static async syncNewBookStructure(subjectId, newBookId, createdBy, q = pool_1.default) {
        const sourceBookId = await getCanonicalBookId(q, subjectId);
        if (!sourceBookId || sourceBookId === newBookId)
            return;
        await this.copyStructureFromBook(sourceBookId, newBookId, createdBy, q);
    }
    /** مزامنة كل الكتب في المادة مع الكتاب المرجعي الأول */
    static async syncSubjectBooksStructure(subjectId, createdBy) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const sourceBookId = await getCanonicalBookId(client, subjectId);
            if (!sourceBookId) {
                await client.query('COMMIT');
                return;
            }
            const books = await client.query(`SELECT id FROM subject_books WHERE subject_id = $1 ORDER BY order_num ASC, id ASC`, [subjectId]);
            for (const book of books.rows) {
                if (book.id === sourceBookId)
                    continue;
                await this.copyStructureFromBook(sourceBookId, book.id, createdBy, client);
            }
            await client.query('COMMIT');
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    /** إنشاء نفس الفصل في باقي كتب المادة */
    static async mirrorChapterToOtherBooks(chapterId, createdBy) {
        const chapterRes = await pool_1.default.query(`SELECT c.* FROM chapters c WHERE c.id = $1`, [chapterId]);
        if (!chapterRes.rowCount)
            return;
        const chapter = chapterRes.rows[0];
        let mirrorKey = chapter.mirror_key;
        if (!mirrorKey) {
            mirrorKey = (0, crypto_1.randomUUID)();
            await pool_1.default.query(`UPDATE chapters SET mirror_key = $1 WHERE id = $2`, [
                mirrorKey,
                chapterId,
            ]);
        }
        const otherBooks = await getOtherBooksInSubject(pool_1.default, chapter.subject_id, chapter.book_id);
        for (const book of otherBooks) {
            const exists = await pool_1.default.query(`SELECT id FROM chapters WHERE book_id = $1 AND mirror_key = $2 LIMIT 1`, [book.id, mirrorKey]);
            if (exists.rowCount)
                continue;
            await pool_1.default.query(`INSERT INTO chapters (
           subject_id, book_id, name, description, image_url, order_num, created_by, mirror_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
                chapter.subject_id,
                book.id,
                chapter.name,
                chapter.description,
                chapter.image_url,
                chapter.order_num,
                createdBy ?? chapter.created_by,
                mirrorKey,
            ]);
        }
    }
    /** إنشاء نفس الدرس في الفصول المتوازية بباقي الكتب */
    static async mirrorLessonToOtherBooks(lessonId, createdBy) {
        const lessonRes = await pool_1.default.query(`SELECT l.*, c.mirror_key AS chapter_mirror_key, c.subject_id, c.book_id
       FROM lessons l
       JOIN chapters c ON c.id = l.chapter_id
       WHERE l.id = $1`, [lessonId]);
        if (!lessonRes.rowCount)
            return;
        const lesson = lessonRes.rows[0];
        let lessonMirrorKey = lesson.mirror_key;
        if (!lessonMirrorKey) {
            lessonMirrorKey = (0, crypto_1.randomUUID)();
            await pool_1.default.query(`UPDATE lessons SET mirror_key = $1 WHERE id = $2`, [
                lessonMirrorKey,
                lessonId,
            ]);
        }
        if (!lesson.chapter_mirror_key)
            return;
        const parallelChapters = await pool_1.default.query(`SELECT id FROM chapters
       WHERE subject_id = $1 AND mirror_key = $2 AND id <> $3`, [lesson.subject_id, lesson.chapter_mirror_key, lesson.chapter_id]);
        for (const targetChapter of parallelChapters.rows) {
            const exists = await pool_1.default.query(`SELECT id FROM lessons WHERE chapter_id = $1 AND mirror_key = $2 LIMIT 1`, [targetChapter.id, lessonMirrorKey]);
            if (exists.rowCount)
                continue;
            await pool_1.default.query(`INSERT INTO lessons (
           chapter_id, name, description, image_url, order_num, created_by, mirror_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
                targetChapter.id,
                lesson.name,
                lesson.description,
                lesson.image_url,
                lesson.order_num,
                createdBy ?? lesson.created_by,
                lessonMirrorKey,
            ]);
        }
    }
    /** تحديث كل نسخ الفصل في كتب المادة */
    static async syncChapterMirrors(chapterId, data) {
        const chapterRes = await pool_1.default.query(`SELECT mirror_key FROM chapters WHERE id = $1`, [
            chapterId,
        ]);
        if (!chapterRes.rowCount || !chapterRes.rows[0].mirror_key)
            return;
        const fields = [];
        const values = [];
        let i = 1;
        for (const [key, val] of Object.entries(data)) {
            if (val !== undefined) {
                fields.push(`${key} = $${i++}`);
                values.push(val);
            }
        }
        if (!fields.length)
            return;
        fields.push('updated_at = NOW()');
        values.push(chapterRes.rows[0].mirror_key);
        await pool_1.default.query(`UPDATE chapters SET ${fields.join(', ')} WHERE mirror_key = $${i}`, values);
    }
    /** حذف الفصل من كل الكتب (نفس mirror_key) */
    static async deleteChapterMirrors(chapterId) {
        const chapterRes = await pool_1.default.query(`SELECT mirror_key FROM chapters WHERE id = $1`, [
            chapterId,
        ]);
        if (!chapterRes.rowCount)
            return;
        const mirrorKey = chapterRes.rows[0].mirror_key;
        if (mirrorKey) {
            await pool_1.default.query(`DELETE FROM chapters WHERE mirror_key = $1`, [mirrorKey]);
            return;
        }
        await pool_1.default.query(`DELETE FROM chapters WHERE id = $1`, [chapterId]);
    }
    /** تحديث الدرس في كل الكتب */
    static async syncLessonMirrors(lessonId, data) {
        const lessonRes = await pool_1.default.query(`SELECT mirror_key FROM lessons WHERE id = $1`, [lessonId]);
        if (!lessonRes.rowCount || !lessonRes.rows[0].mirror_key)
            return;
        const fields = [];
        const values = [];
        let i = 1;
        for (const [key, val] of Object.entries(data)) {
            if (val !== undefined) {
                fields.push(`${key} = $${i++}`);
                values.push(val);
            }
        }
        if (!fields.length)
            return;
        fields.push('updated_at = NOW()');
        values.push(lessonRes.rows[0].mirror_key);
        await pool_1.default.query(`UPDATE lessons SET ${fields.join(', ')} WHERE mirror_key = $${i}`, values);
    }
    /** حذف الدرس من كل الكتب */
    static async deleteLessonMirrors(lessonId) {
        const lessonRes = await pool_1.default.query(`SELECT mirror_key FROM lessons WHERE id = $1`, [lessonId]);
        if (!lessonRes.rowCount)
            return;
        const mirrorKey = lessonRes.rows[0].mirror_key;
        if (mirrorKey) {
            await pool_1.default.query(`DELETE FROM lessons WHERE mirror_key = $1`, [mirrorKey]);
            return;
        }
        await pool_1.default.query(`DELETE FROM lessons WHERE id = $1`, [lessonId]);
    }
}
exports.SubjectBookStructureService = SubjectBookStructureService;
