import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import pool from '../db/pool';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherActivityLogService } from '../services/teacherActivityLog';

export const router = Router();

// ========== الفصول (Chapters) ==========
// إضافة فصل جديد
router.post(
  '/chapter',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user!.id;
    if (!title) throw new HttpError(400, 'العنوان مطلوب');
    const result = await pool.query(
      'INSERT INTO teacher_question_chapters (teacher_id, title) VALUES ($1, $2) RETURNING *',
      [teacher_id, title],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'add_chapter',
      entity_type: 'chapter',
      entity_id: result.rows[0].id,
      description: `أضاف فصل: ${title}`,
    });
    res.status(201).json({ chapter: result.rows[0] });
  }),
);

// تعديل فصل
router.put(
  '/chapter/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const chapterIdNum = Number(id);
    const result = await pool.query(
      'UPDATE teacher_question_chapters SET title = $1 WHERE id = $2 AND teacher_id = $3 RETURNING *',
      [title, chapterIdNum, teacher_id],
    );
    if (!result.rowCount) throw new HttpError(404, 'الفصل غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_chapter',
      entity_type: 'chapter',
      entity_id: chapterIdNum,
      description: `تعديل فصل: ${title}`,
    });
    res.json({ chapter: result.rows[0] });
  }),
);

// حذف فصل
router.delete(
  '/chapter/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const chapterIdNum = Number(id);
    const result = await pool.query(
      'DELETE FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [chapterIdNum, teacher_id],
    );
    if (!result.rowCount) throw new HttpError(404, 'الفصل غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_chapter',
      entity_type: 'chapter',
      entity_id: chapterIdNum,
      description: `حذف فصل: ${id}`,
    });
    res.json({ success: true });
  }),
);

// جلب كل الفصول للمدرس
router.get(
  '/chapters',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const result = await pool.query(
      'SELECT * FROM teacher_question_chapters WHERE teacher_id = $1 ORDER BY id',
      [teacher_id],
    );
    res.json({ chapters: result.rows });
  }),
);

// ========== الدروس (Lessons) ==========
// إضافة درس
router.post(
  '/lesson',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { chapter_id, title } = req.body;
    const teacher_id = req.user!.id;
    const chapterIdNum = Number(chapter_id);
    // تحقق أن الفصل يخص المدرس
    const check = await pool.query(
      'SELECT id FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2',
      [chapterIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الفصل غير موجود');
    const result = await pool.query(
      'INSERT INTO teacher_question_lessons (chapter_id, title) VALUES ($1, $2) RETURNING *',
      [chapterIdNum, title],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'add_lesson',
      entity_type: 'lesson',
      entity_id: result.rows[0].id,
      description: `أضاف درس: ${title}`,
    });
    res.status(201).json({ lesson: result.rows[0] });
  }),
);

// تعديل درس
router.put(
  '/lesson/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user!.id;
    const { id } = req.params;
    // تحقق أن الدرس يخص المدرس
    const check = await pool.query(
      'SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2',
      [id, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الدرس غير موجود');
    const result = await pool.query(
      'UPDATE teacher_question_lessons SET title = $1 WHERE id = $2 RETURNING *',
      [title, id],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_lesson',
      entity_type: 'lesson',
      entity_id: id,
      description: `تعديل درس: ${title}`,
    });
    res.json({ lesson: result.rows[0] });
  }),
);

// حذف درس
router.delete(
  '/lesson/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const lessonIdNum = Number(id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool.query(
      'SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2',
      [lessonIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الدرس غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_lesson',
      entity_type: 'lesson',
      entity_id: lessonIdNum,
      description: `حذف درس: ${id}`,
    });
    await pool.query('DELETE FROM teacher_question_lessons WHERE id = $1', [lessonIdNum]);
    res.json({ success: true });
  }),
);

// جلب الدروس لفصل معين
router.get(
  '/lessons/:chapter_id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { chapter_id } = req.params;
    const chapterIdNum = Number(chapter_id);
    // تحقق أن الفصل يخص المدرس
    const check = await pool.query(
      'SELECT id FROM teacher_question_chapters WHERE id = $1 AND teacher_id = $2',
      [chapterIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الفصل غير موجود');
    const result = await pool.query(
      'SELECT * FROM teacher_question_lessons WHERE chapter_id = $1 ORDER BY id',
      [chapterIdNum],
    );
    res.json({ lessons: result.rows });
  }),
);

// ========== الأجزاء (Parts) ==========
// إضافة جزء
router.post(
  '/part',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { lesson_id, title } = req.body;
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(lesson_id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool.query(
      'SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2',
      [lessonIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الدرس غير موجود');
    const result = await pool.query(
      'INSERT INTO teacher_question_parts (lesson_id, title) VALUES ($1, $2) RETURNING *',
      [lessonIdNum, title],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'add_part',
      entity_type: 'part',
      entity_id: result.rows[0].id,
      description: `أضاف جزء: ${title}`,
    });
    res.status(201).json({ part: result.rows[0] });
  }),
);

// تعديل جزء
router.put(
  '/part/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const partIdNum = Number(id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool.query(
      'SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2',
      [partIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الجزء غير موجود');
    const result = await pool.query(
      'UPDATE teacher_question_parts SET title = $1 WHERE id = $2 RETURNING *',
      [title, partIdNum],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_part',
      entity_type: 'part',
      entity_id: partIdNum,
      description: `تعديل جزء: ${title}`,
    });
    res.json({ part: result.rows[0] });
  }),
);

// حذف جزء
router.delete(
  '/part/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const partIdNum = Number(id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool.query(
      'SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2',
      [partIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الجزء غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_part',
      entity_type: 'part',
      entity_id: partIdNum,
      description: `حذف جزء: ${id}`,
    });
    await pool.query('DELETE FROM teacher_question_parts WHERE id = $1', [partIdNum]);
    res.json({ success: true });
  }),
);

// جلب الأجزاء لدرس معين
router.get(
  '/parts/:lesson_id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { lesson_id } = req.params;
    const lessonIdNum = Number(lesson_id);
    // تحقق أن الدرس يخص المدرس
    const check = await pool.query(
      'SELECT l.id FROM teacher_question_lessons l JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE l.id = $1 AND c.teacher_id = $2',
      [lessonIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الدرس غير موجود');
    const result = await pool.query(
      'SELECT * FROM teacher_question_parts WHERE lesson_id = $1 ORDER BY id',
      [lessonIdNum],
    );
    res.json({ parts: result.rows });
  }),
);

// ========== الأسئلة (Questions) ==========
// إضافة سؤال
router.post(
  '/question',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { part_id, question_text, question_type, choices, answer } = req.body;
    const teacher_id = req.user!.id;
    // تحقق أن الجزء يخص المدرس
    const check = await pool.query(
      'SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2',
      [part_id, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الجزء غير موجود');
    const result = await pool.query(
      'INSERT INTO teacher_questions (part_id, question_text, question_type, choices, answer) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [part_id, question_text, question_type, choices ? JSON.stringify(choices) : null, answer],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'add_question',
      entity_type: 'question',
      entity_id: result.rows[0].id,
      description: `أضاف سؤال: ${question_text}`,
    });
    res.status(201).json({ question: result.rows[0] });
  }),
);

// تعديل سؤال
router.put(
  '/question/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { question_text, question_type, choices, answer } = req.body;
    const teacher_id = req.user!.id;
    const { id } = req.params;
    // تحقق أن السؤال يخص المدرس
    const check = await pool.query(
      'SELECT q.id FROM teacher_questions q JOIN teacher_question_parts p ON q.part_id = p.id JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE q.id = $1 AND c.teacher_id = $2',
      [id, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'السؤال غير موجود');
    const result = await pool.query(
      'UPDATE teacher_questions SET question_text = $1, question_type = $2, choices = $3, answer = $4 WHERE id = $5 RETURNING *',
      [question_text, question_type, choices ? JSON.stringify(choices) : null, answer, id],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_question',
      entity_type: 'question',
      entity_id: id,
      description: `تعديل سؤال: ${question_text}`,
    });
    res.json({ question: result.rows[0] });
  }),
);

// حذف سؤال
router.delete(
  '/question/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { id } = req.params;
    const questionIdNum = Number(id);
    // تحقق أن السؤال يخص المدرس
    const check = await pool.query(
      'SELECT q.id FROM teacher_questions q JOIN teacher_question_parts p ON q.part_id = p.id JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE q.id = $1 AND c.teacher_id = $2',
      [questionIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'السؤال غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_question',
      entity_type: 'question',
      entity_id: questionIdNum,
      description: `حذف سؤال: ${id}`,
    });
    await pool.query('DELETE FROM teacher_questions WHERE id = $1', [questionIdNum]);
    res.json({ success: true });
  }),
);

// جلب الأسئلة لجزء معين
router.get(
  '/questions/:part_id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const { part_id } = req.params;
    const partIdNum = Number(part_id);
    // تحقق أن الجزء يخص المدرس
    const check = await pool.query(
      'SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2',
      [partIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الجزء غير موجود');
    const result = await pool.query(
      'SELECT * FROM teacher_questions WHERE part_id = $1 ORDER BY id',
      [partIdNum],
    );
    res.json({ questions: result.rows });
  }),
);

// ========== إضافة أسئلة دفعة واحدة (Bulk Insert) ==========
router.post(
  '/bulk',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { part_id, bulk_text } = req.body;
    const teacher_id = req.user!.id;
    const partIdNum = Number(part_id);
    if (!partIdNum || !bulk_text) throw new HttpError(400, 'part_id و bulk_text مطلوبان');
    // تحقق أن الجزء يخص المدرس
    const check = await pool.query(
      'SELECT p.id FROM teacher_question_parts p JOIN teacher_question_lessons l ON p.lesson_id = l.id JOIN teacher_question_chapters c ON l.chapter_id = c.id WHERE p.id = $1 AND c.teacher_id = $2',
      [partIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'الجزء غير موجود');

    // منطق تقسيم مرن لقبول جميع الصيغ
    const questionBlocks = bulk_text
      .split(/\n\s*\n/)
      .map((b: string) => b.trim())
      .filter(Boolean);

    const questions: { question_text: string; choices: string[] }[] = [];
    const invalidBlocks: number[] = [];

    questionBlocks.forEach((block: string, idx: number) => {
      const lines = block
        .split('\n')
        .map((l: string) => l.trim())
        .filter(Boolean);
      if (lines.length < 5) {
        invalidBlocks.push(idx + 1);
        return;
      }
      const question_text = lines[0];
      const choices: string[] = [];
      for (let i = 1; i < lines.length && choices.length < 4; i++) {
        // يقبل أي بادئة A/B/C/D مع أي فاصل أو حتى بدون فاصل
        const match = lines[i].match(/^[A-D][).:,-]?\s*(.+)$/i);
        if (match) {
          choices.push(match[1].trim());
        } else {
          choices.push(lines[i]);
        }
      }
      if (question_text && choices.length === 4) {
        questions.push({ question_text, choices });
      } else {
        invalidBlocks.push(idx + 1);
      }
    });

    if (invalidBlocks.length > 0) {
      return res.status(400).json({
        success: false,
        message: `هناك مشكلة في الأسئلة التالية: ${invalidBlocks.join(', ')}. تأكد أن كل سؤال يحتوي على نص وأربع اختيارات.`,
      });
    }

    // إدخال الأسئلة في قاعدة البيانات
    let inserted = 0;
    for (const q of questions) {
      await pool.query(
        'INSERT INTO teacher_questions (part_id, question_text, question_type, choices) VALUES ($1, $2, $3, $4)',
        [partIdNum, q.question_text, 'choice', JSON.stringify(q.choices)],
      );
      inserted++;
    }

    res.status(201).json({ success: true, inserted });
  }),
);

// ========== عرض الأسئلة لأي مستخدم (بدون تحقق ملكية المدرس) ==========
router.get(
  '/public/questions/:part_id',
  asyncWrapper(async (req, res) => {
    const { part_id } = req.params;
    // جلب الأسئلة لهذا الجزء
    const result = await pool.query(
      'SELECT * FROM teacher_questions WHERE part_id = $1 ORDER BY id',
      [part_id],
    );
    // إذا كانت choices نصية (string) وليست Array، حاول تحويلها
    const questions = result.rows.map((q) => ({
      ...q,
      choices:
        typeof q.choices === 'string'
          ? (() => {
              try {
                return JSON.parse(q.choices);
              } catch {
                return q.choices;
              }
            })()
          : q.choices,
    }));
    res.json({ questions });
  }),
);

// ========== جلب الشجرة الكاملة للمدرس ==========
router.get(
  '/tree',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    // جلب الفصول
    const chapters = (
      await pool.query(
        'SELECT * FROM teacher_question_chapters WHERE teacher_id = $1 ORDER BY id',
        [teacher_id],
      )
    ).rows;
    // جلب الدروس
    const lessons = (
      await pool.query(
        'SELECT * FROM teacher_question_lessons WHERE chapter_id = ANY($1::int[]) ORDER BY id',
        [chapters.map((c) => c.id)],
      )
    ).rows;
    // جلب الأجزاء
    const parts = (
      await pool.query(
        'SELECT * FROM teacher_question_parts WHERE lesson_id = ANY($1::int[]) ORDER BY id',
        [lessons.map((l) => l.id)],
      )
    ).rows;
    // جلب الأسئلة
    const questions = (
      await pool.query(
        'SELECT * FROM teacher_questions WHERE part_id = ANY($1::int[]) ORDER BY id',
        [parts.map((p) => p.id)],
      )
    ).rows;

    // بناء الشجرة
    const partsMap = Object.fromEntries(parts.map((p) => [p.id, { ...p, questions: [] }]));
    for (const q of questions) partsMap[q.part_id]?.questions.push(q);
    const lessonsMap = Object.fromEntries(lessons.map((l) => [l.id, { ...l, parts: [] }]));
    for (const p of parts) lessonsMap[p.lesson_id]?.parts.push(partsMap[p.id]);
    const chaptersMap = Object.fromEntries(chapters.map((c) => [c.id, { ...c, lessons: [] }]));
    for (const l of lessons) chaptersMap[l.chapter_id]?.lessons.push(lessonsMap[l.id]);

    res.json({ chapters: Object.values(chaptersMap) });
  }),
);
