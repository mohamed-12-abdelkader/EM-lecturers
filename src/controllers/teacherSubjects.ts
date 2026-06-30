import { Request, Response, Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import pool from '../db/pool';
import { ChapterService } from '../services/chapters';
import { getSubjectBooksWithChaptersAndLessons } from '../services/questionBankHierarchy';
import { PackageSubjectGroupsService } from '../services/packageSubjectGroups';

const router = Router();
// Apply teacher auth only for /teacher/* routes to avoid intercepting other routes
router.use('/teacher', authMiddleware(['teacher']));

// ===== Package Subjects Groups (Preparatory Student Package) =====
// GET /api/teacher/package-subjects/groups
// يرجع مواد الباقة التي لدى المدرس مجموعات فيها (بدلاً من صلاحية على المادة بالكامل)
router.get('/teacher/package-subjects/groups', async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id as number;
    const subjects = await PackageSubjectGroupsService.listTeacherSubjectsWithGroups(teacherId);
    return res.status(200).json({ success: true, total: subjects.length, subjects });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'خطأ في جلب مواد الباقة الخاصة بمجموعات المدرس',
      error: error.message,
    });
  }
});

// GET /api/teacher/package-subjects
// يرجع مواد الباقة التي لدى المدرس صلاحية عليها
router.get('/teacher/package-subjects', async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id as number;
    // استخدام الخدمة الجديدة لجلب المواد المصرح بها
    // Note: We need to import PackageSubjectPermissionsService but it is not imported yet. 
    // Wait, let's fix import first, or just use full path if possible (not possible easily).
    // I will add import at the top.

    // Actually, I can use require inside or add import. adding import at top is cleaner but multi_replace requires separate chunk.
    // Let's use require for minimal intrusion or add import chunk too.
    const { PackageSubjectPermissionsService } = require('../services/packageSubjectPermissions');

    const subjects = await PackageSubjectPermissionsService.getTeacherSubjects(teacherId);
    return res.status(200).json({ success: true, count: subjects.length, subjects });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'خطأ في جلب مواد الباقة المصرح بها',
      error: error.message,
    });
  }
});

// GET /api/teacher/subjects
router.get('/teacher/subjects', async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id as number;
    // جلب المواد الخاصة بالمدرس مع معلومات الصف من بنك الأسئلة
    const result = await pool.query(
      `SELECT 
         s.*,
         qb.id as question_bank_id,
         qb.name as question_bank_name,
         g.id as grade_id,
         g.name as grade_name,
         g.level as grade_level
       FROM teacher_subjects ts
       JOIN subjects s ON s.id = ts.subject_id
       LEFT JOIN question_banks qb ON s.question_bank_id = qb.id
       LEFT JOIN grades g ON qb.grade_id = g.id
       WHERE ts.teacher_id = $1
       ORDER BY s.id`,
      [teacherId],
    );

    const subjects = result.rows;

    // جلب الكتب والفصول والدروس لكل مادة
    const subjectsWithBooks = await Promise.all(
      subjects.map(async (subject: any) => {
        try {
          const books = await getSubjectBooksWithChaptersAndLessons(subject.id);
          return {
            ...subject,
            books,
            chapters: books.flatMap((b) => b.chapters),
          };
        } catch (error) {
          console.error(`Error fetching books for subject ${subject.id}:`, error);
          return {
            ...subject,
            books: [],
            chapters: [],
          };
        }
      }),
    );

    return res.status(200).json({
      success: true,
      data: subjectsWithBooks,
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      message: 'خطأ في جلب المواد',
      error: error.message
    });
  }
});

// GET /api/teacher/subjects/:id/content
router.get('/teacher/subjects/:id/content', async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id as number;
    const subjectId = Number(req.params.id);
    if (Number.isNaN(subjectId))
      return res.status(400).json({ success: false, message: 'معرف المادة غير صحيح' });

    // ensure assignment exists
    const assigned = await pool.query(
      `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2`,
      [teacherId, subjectId],
    );
    if (!assigned.rowCount)
      return res.status(403).json({ success: false, message: 'غير مصرح لك بهذه المادة' });

    // fetch hierarchy: classes, lessons, questions (approved only)
    const classesRes = await pool.query(
      `SELECT c.*, sb.name AS book_name, sb.id AS book_id
       FROM chapters c
       LEFT JOIN subject_books sb ON sb.id = c.book_id
       WHERE c.subject_id = $1
       ORDER BY sb.order_num ASC, c.order_num ASC`,
      [subjectId],
    );
    const chapters = classesRes.rows;
    const booksRes = await pool.query(
      `SELECT * FROM subject_books WHERE subject_id = $1 ORDER BY order_num ASC, id ASC`,
      [subjectId],
    );
    const books = booksRes.rows;
    const lessonsRes = await pool.query(
      `SELECT l.* FROM lessons l JOIN chapters c ON l.chapter_id = c.id WHERE c.subject_id = $1 ORDER BY l.order_num`,
      [subjectId],
    );
    const lessons = lessonsRes.rows;
    const questionsRes = await pool.query(
      `SELECT q.* FROM questions q
       JOIN lessons l ON q.lesson_id = l.id
       JOIN chapters c ON l.chapter_id = c.id
       WHERE c.subject_id = $1 AND q.status = 'approved'`,
      [subjectId],
    );
    const questions = questionsRes.rows;

    return res.status(200).json({ success: true, data: { books, chapters, lessons, questions } });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في جلب المحتوى', error: error.message });
  }
});

// POST /api/teacher/lessons/:id/questions (create pending question)
router.post('/teacher/lessons/:id/questions', async (req: Request, res: Response) => {
  try {
    const teacherId = req.user!.id as number;
    const lessonId = Number(req.params.id);
    const { question_text, options } = req.body as { question_text: string; options: string[] };
    if (Number.isNaN(lessonId))
      return res.status(400).json({ success: false, message: 'معرف الدرس غير صحيح' });
    if (!question_text || !Array.isArray(options) || options.length !== 4) {
      return res.status(400).json({ success: false, message: 'نص السؤال و 4 اختيارات مطلوبة' });
    }

    // find subject for this lesson
    const subRes = await pool.query(
      `SELECT c.subject_id FROM lessons l JOIN chapters c ON l.chapter_id = c.id WHERE l.id = $1`,
      [lessonId],
    );
    if (!subRes.rowCount)
      return res.status(404).json({ success: false, message: 'الدرس غير موجود' });
    const subjectId = subRes.rows[0].subject_id as number;

    // ensure teacher assigned to subject
    const assigned = await pool.query(
      `SELECT 1 FROM teacher_subjects WHERE teacher_id = $1 AND subject_id = $2`,
      [teacherId, subjectId],
    );
    if (!assigned.rowCount)
      return res
        .status(403)
        .json({ success: false, message: 'غير مصرح لك بإضافة أسئلة لهذه المادة' });

    const result = await pool.query(
      `INSERT INTO questions(question_text, question_type, options, correct_answer, lesson_id, teacher_id, status)
    VALUES($1, 'multiple_choice', $2:: jsonb, NULL, $3, $4, 'pending') RETURNING * `,
      [
        question_text,
        JSON.stringify({ A: options[0], B: options[1], C: options[2], D: options[3] }),
        lessonId,
        teacherId,
      ],
    );

    return res
      .status(201)
      .json({ success: true, message: 'تم إضافة السؤال للمراجعة', data: result.rows[0] });
  } catch (error: any) {
    return res
      .status(500)
      .json({ success: false, message: 'خطأ في إضافة السؤال', error: error.message });
  }
});

export { router };
