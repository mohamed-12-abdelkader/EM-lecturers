import { Router } from 'express';
import { authMiddleware } from '../middleware/authentication';
import pool from '../db/pool';
import { asyncWrapper, HttpError } from '../utils';
import { TeacherActivityLogService } from '../services/teacherActivityLog';

export const router = Router();

function parseNullableNumber(value: unknown, fieldName: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new HttpError(400, `${fieldName} غير صحيح`);
  }
  return n;
}

async function verifyGradeOwnership(gradeId: number, teacherId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM teacher_question_grades WHERE id = $1 AND teacher_id = $2`,
    [gradeId, teacherId],
  );
  return Boolean(result.rowCount);
}

async function verifyLessonOwnership(lessonId: number, teacherId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT id FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2`,
    [lessonId, teacherId],
  );
  return Boolean(result.rowCount);
}

async function resolvePlatformGrade(
  platformGradeId: number | null,
): Promise<{ id: number; name: string } | null> {
  if (platformGradeId == null) return null;
  const result = await pool.query<{ id: number; name: string }>(
    `SELECT id, name FROM grades WHERE id = $1`,
    [platformGradeId],
  );
  return result.rows[0] ?? null;
}

async function verifyPassageOwnership(
  passageId: number,
  teacherId: number,
): Promise<{ id: number; lesson_id: number } | null> {
  const result = await pool.query(
    `SELECT p.id, p.lesson_id
     FROM teacher_question_passages p
     JOIN teacher_question_lessons l ON l.id = p.lesson_id
     WHERE p.id = $1 AND l.teacher_id = $2`,
    [passageId, teacherId],
  );
  return result.rows[0] ?? null;
}

// ========== الصفوف الدراسية (Grades) — أعلى مستوى في مكتبة المدرّس ==========

router.post(
  '/grade',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const platformGradeId = parseNullableNumber(req.body.platform_grade_id, 'platform_grade_id');
    const platformGrade = await resolvePlatformGrade(platformGradeId);
    if (platformGradeId != null && !platformGrade) {
      throw new HttpError(404, 'الصف الدراسي غير موجود');
    }

    const title = String(req.body.title ?? platformGrade?.name ?? '').trim();
    if (!title) throw new HttpError(400, 'العنوان مطلوب');

    try {
      const result = await pool.query(
        `INSERT INTO teacher_question_grades (teacher_id, title, platform_grade_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [teacher_id, title, platformGradeId],
      );
      await TeacherActivityLogService.log({
        teacher_id,
        action: 'add_grade',
        entity_type: 'grade',
        entity_id: result.rows[0].id,
        description: `أضاف صف دراسي: ${title}`,
      });
      res.status(201).json({
        grade: {
          ...result.rows[0],
          platform_grade_name: platformGrade?.name ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new HttpError(400, 'يوجد صف بنفس الاسم أو مرتبط بنفس الصف الدراسي');
      }
      throw err;
    }
  }),
);

router.put(
  '/grade/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const gradeIdNum = Number(req.params.id);
    if (!Number.isInteger(gradeIdNum) || gradeIdNum <= 0) {
      throw new HttpError(400, 'id غير صحيح');
    }

    const existing = await pool.query(
      `SELECT * FROM teacher_question_grades WHERE id = $1 AND teacher_id = $2`,
      [gradeIdNum, teacher_id],
    );
    if (!existing.rowCount) throw new HttpError(404, 'الصف الدراسي غير موجود');

    const current = existing.rows[0];
    const hasTitle = req.body.title !== undefined;
    const hasPlatform = req.body.platform_grade_id !== undefined;
    if (!hasTitle && !hasPlatform) throw new HttpError(400, 'لا توجد بيانات للتعديل');

    const platformGradeId = hasPlatform
      ? parseNullableNumber(req.body.platform_grade_id, 'platform_grade_id')
      : current.platform_grade_id;
    const platformGrade = await resolvePlatformGrade(platformGradeId);
    if (platformGradeId != null && !platformGrade) {
      throw new HttpError(404, 'الصف الدراسي غير موجود');
    }

    const title = hasTitle
      ? String(req.body.title ?? '').trim()
      : String(current.title ?? '').trim();
    if (!title) throw new HttpError(400, 'العنوان مطلوب');

    try {
      const result = await pool.query(
        `UPDATE teacher_question_grades
         SET title = $1, platform_grade_id = $2
         WHERE id = $3 AND teacher_id = $4
         RETURNING *`,
        [title, platformGradeId, gradeIdNum, teacher_id],
      );
      await TeacherActivityLogService.log({
        teacher_id,
        action: 'edit_grade',
        entity_type: 'grade',
        entity_id: gradeIdNum,
        description: `تعديل صف دراسي: ${title}`,
      });
      res.json({
        grade: {
          ...result.rows[0],
          platform_grade_name: platformGrade?.name ?? null,
        },
      });
    } catch (err: any) {
      if (err?.code === '23505') {
        throw new HttpError(400, 'يوجد صف بنفس الاسم أو مرتبط بنفس الصف الدراسي');
      }
      throw err;
    }
  }),
);

router.delete(
  '/grade/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const gradeIdNum = Number(req.params.id);
    if (!Number.isInteger(gradeIdNum) || gradeIdNum <= 0) {
      throw new HttpError(400, 'id غير صحيح');
    }
    const result = await pool.query(
      'DELETE FROM teacher_question_grades WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [gradeIdNum, teacher_id],
    );
    if (!result.rowCount) throw new HttpError(404, 'الصف الدراسي غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_grade',
      entity_type: 'grade',
      entity_id: gradeIdNum,
      description: `حذف صف دراسي: ${gradeIdNum}`,
    });
    res.json({ success: true });
  }),
);

router.get(
  '/grades',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const result = await pool.query(
      `SELECT g.*,
              pg.name AS platform_grade_name,
              COUNT(DISTINCT l.id)::int AS lessons_count,
              COUNT(q.id)::int AS questions_count
       FROM teacher_question_grades g
       LEFT JOIN grades pg ON pg.id = g.platform_grade_id
       LEFT JOIN teacher_question_lessons l ON l.grade_id = g.id
       LEFT JOIN teacher_questions q ON q.lesson_id = l.id
       WHERE g.teacher_id = $1
       GROUP BY g.id, pg.name
       ORDER BY g.id`,
      [teacher_id],
    );
    res.json({ grades: result.rows });
  }),
);

// ========== الدروس (Lessons) — داخل صف دراسي ==========

router.post(
  '/lesson',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { title } = req.body;
    const teacher_id = req.user!.id;
    const gradeIdNum = parseNullableNumber(req.body.grade_id, 'grade_id');
    if (!gradeIdNum) throw new HttpError(400, 'grade_id مطلوب');
    if (!title?.trim()) throw new HttpError(400, 'العنوان مطلوب');
    if (!(await verifyGradeOwnership(gradeIdNum, teacher_id))) {
      throw new HttpError(404, 'الصف الدراسي غير موجود');
    }
    const result = await pool.query(
      `INSERT INTO teacher_question_lessons (teacher_id, grade_id, title)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [teacher_id, gradeIdNum, title.trim()],
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

router.put(
  '/lesson/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(req.params.id);
    const existing = await pool.query(
      `SELECT * FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2`,
      [lessonIdNum, teacher_id],
    );
    if (!existing.rowCount) throw new HttpError(404, 'الدرس غير موجود');

    const current = existing.rows[0];
    const hasTitle = req.body.title !== undefined;
    const hasGrade = req.body.grade_id !== undefined;
    if (!hasTitle && !hasGrade) throw new HttpError(400, 'لا توجد بيانات للتعديل');

    const title = hasTitle ? String(req.body.title ?? '').trim() : String(current.title ?? '').trim();
    if (!title) throw new HttpError(400, 'العنوان مطلوب');

    const gradeIdNum = hasGrade
      ? parseNullableNumber(req.body.grade_id, 'grade_id')
      : Number(current.grade_id);
    if (!gradeIdNum) throw new HttpError(400, 'grade_id مطلوب');
    if (hasGrade && !(await verifyGradeOwnership(gradeIdNum, teacher_id))) {
      throw new HttpError(404, 'الصف الدراسي غير موجود');
    }

    const result = await pool.query(
      `UPDATE teacher_question_lessons
       SET title = $1, grade_id = $2
       WHERE id = $3 AND teacher_id = $4
       RETURNING *`,
      [title, gradeIdNum, lessonIdNum, teacher_id],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_lesson',
      entity_type: 'lesson',
      entity_id: lessonIdNum,
      description: `تعديل درس: ${title}`,
    });
    res.json({ lesson: result.rows[0] });
  }),
);

router.delete(
  '/lesson/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(req.params.id);
    const result = await pool.query(
      'DELETE FROM teacher_question_lessons WHERE id = $1 AND teacher_id = $2 RETURNING id',
      [lessonIdNum, teacher_id],
    );
    if (!result.rowCount) throw new HttpError(404, 'الدرس غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_lesson',
      entity_type: 'lesson',
      entity_id: lessonIdNum,
      description: `حذف درس: ${lessonIdNum}`,
    });
    res.json({ success: true });
  }),
);

router.get(
  '/lessons',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const rawGradeId = Array.isArray(req.query.grade_id) ? req.query.grade_id[0] : req.query.grade_id;
    const gradeIdFilter = parseNullableNumber(rawGradeId, 'grade_id');
    if (gradeIdFilter && !(await verifyGradeOwnership(gradeIdFilter, teacher_id))) {
      throw new HttpError(404, 'الصف الدراسي غير موجود');
    }

    const result = await pool.query(
      `SELECT l.*,
              g.title AS grade_title,
              COUNT(q.id)::int AS questions_count
       FROM teacher_question_lessons l
       JOIN teacher_question_grades g ON g.id = l.grade_id
       LEFT JOIN teacher_questions q ON q.lesson_id = l.id
       WHERE l.teacher_id = $1
         AND ($2::int IS NULL OR l.grade_id = $2)
       GROUP BY l.id, g.title
       ORDER BY l.id`,
      [teacher_id, gradeIdFilter],
    );
    res.json({ lessons: result.rows });
  }),
);

// ========== القطع (Passages) — مرتبطة بالدرس ==========

router.post(
  '/passage',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lessonIdNum = parseNullableNumber(req.body.lesson_id, 'lesson_id')!;
    const { title, content, questions = [] } = req.body;

    if (!content || !String(content).trim()) throw new HttpError(400, 'نص القطعة مطلوب');
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
      throw new HttpError(404, 'الدرس غير موجود');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const passageResult = await client.query(
        `INSERT INTO teacher_question_passages (lesson_id, title, content, order_index)
         VALUES ($1, $2, $3, 0)
         RETURNING *`,
        [lessonIdNum, title || null, content],
      );
      const passage = passageResult.rows[0];
      const createdQuestions = [];

      for (const q of Array.isArray(questions) ? questions : []) {
        const result = await client.query(
          `INSERT INTO teacher_questions (
             lesson_id, passage_id, question_text, question_type, choices, answer, image_url,
             correct_answer_index, explanation, difficulty_level, points
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           RETURNING *`,
          [
            lessonIdNum,
            passage.id,
            q.question_text,
            q.question_type || (Array.isArray(q.choices) ? 'choice' : 'text'),
            q.choices ? JSON.stringify(q.choices) : null,
            q.answer || null,
            q.image_url || null,
            q.correct_answer_index ?? null,
            q.explanation || null,
            q.difficulty_level || 'medium',
            q.points || 1,
          ],
        );
        createdQuestions.push(result.rows[0]);
      }

      await client.query('COMMIT');
      res.status(201).json({ success: true, passage, questions: createdQuestions });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }),
);

router.get(
  '/passages/:lesson_id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(req.params.lesson_id);
    if (!Number.isInteger(lessonIdNum) || lessonIdNum <= 0) {
      throw new HttpError(400, 'lesson_id غير صحيح');
    }
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
      throw new HttpError(404, 'الدرس غير موجود');
    }

    const passages = (
      await pool.query(
        'SELECT * FROM teacher_question_passages WHERE lesson_id = $1 ORDER BY order_index, id',
        [lessonIdNum],
      )
    ).rows;
    const passageIds = passages.map((p) => p.id);
    const questions = passageIds.length
      ? (
          await pool.query(
            'SELECT * FROM teacher_questions WHERE passage_id = ANY($1::int[]) ORDER BY id',
            [passageIds],
          )
        ).rows
      : [];

    res.json({
      passages: passages.map((passage) => ({
        ...passage,
        questions: questions.filter((q) => q.passage_id === passage.id),
      })),
    });
  }),
);

router.get(
  '/passage/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const passageId = Number(req.params.id);
    if (!Number.isInteger(passageId) || passageId <= 0) throw new HttpError(400, 'id غير صحيح');
    const owned = await verifyPassageOwnership(passageId, teacher_id);
    if (!owned) throw new HttpError(404, 'القطعة غير موجودة');

    const passage = (
      await pool.query('SELECT * FROM teacher_question_passages WHERE id = $1', [passageId])
    ).rows[0];
    const questions = (
      await pool.query('SELECT * FROM teacher_questions WHERE passage_id = $1 ORDER BY id', [
        passageId,
      ])
    ).rows;

    res.json({ passage: { ...passage, questions } });
  }),
);

// ========== الأسئلة (Questions) — مباشرة داخل الدرس ==========

router.post(
  '/question',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const {
      lesson_id,
      question_text,
      question_type,
      choices,
      answer,
      image_url,
      correct_answer_index,
      explanation,
      difficulty_level,
      points,
    } = req.body;
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(lesson_id);
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');

    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
      throw new HttpError(404, 'الدرس غير موجود');
    }

    if (passageId != null) {
      const passage = await verifyPassageOwnership(passageId, teacher_id);
      if (!passage || passage.lesson_id !== lessonIdNum) {
        throw new HttpError(404, 'القطعة غير موجودة داخل هذا الدرس');
      }
    }

    const result = await pool.query(
      `INSERT INTO teacher_questions (
         lesson_id, passage_id, question_text, question_type, choices, answer, image_url,
         correct_answer_index, explanation, difficulty_level, points
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        lessonIdNum,
        passageId,
        question_text,
        question_type,
        choices ? JSON.stringify(choices) : null,
        answer,
        image_url || null,
        correct_answer_index ?? null,
        explanation || null,
        difficulty_level || 'medium',
        points || 1,
      ],
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

router.put(
  '/question/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const {
      question_text,
      question_type,
      choices,
      answer,
      image_url,
      correct_answer_index,
      explanation,
      difficulty_level,
      points,
    } = req.body;
    const teacher_id = req.user!.id;
    const questionIdNum = Number(req.params.id);
    const passageId = parseNullableNumber(req.body.passage_id, 'passage_id');

    const check = await pool.query(
      `SELECT q.id, q.lesson_id
       FROM teacher_questions q
       JOIN teacher_question_lessons l ON q.lesson_id = l.id
       WHERE q.id = $1 AND l.teacher_id = $2`,
      [questionIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'السؤال غير موجود');

    if (passageId != null) {
      const passage = await verifyPassageOwnership(passageId, teacher_id);
      if (!passage || passage.lesson_id !== Number(check.rows[0].lesson_id)) {
        throw new HttpError(404, 'القطعة غير موجودة داخل هذا الدرس');
      }
    }

    const result = await pool.query(
      `UPDATE teacher_questions
       SET question_text = $1,
           question_type = $2,
           choices = $3,
           answer = $4,
           passage_id = $5,
           image_url = $6,
           correct_answer_index = $7,
           explanation = $8,
           difficulty_level = $9,
           points = $10
       WHERE id = $11
       RETURNING *`,
      [
        question_text,
        question_type,
        choices ? JSON.stringify(choices) : null,
        answer,
        passageId,
        image_url || null,
        correct_answer_index ?? null,
        explanation || null,
        difficulty_level || 'medium',
        points || 1,
        questionIdNum,
      ],
    );
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'edit_question',
      entity_type: 'question',
      entity_id: questionIdNum,
      description: `تعديل سؤال: ${question_text}`,
    });
    res.json({ question: result.rows[0] });
  }),
);

router.delete(
  '/question/:id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const questionIdNum = Number(req.params.id);
    const check = await pool.query(
      `SELECT q.id
       FROM teacher_questions q
       JOIN teacher_question_lessons l ON q.lesson_id = l.id
       WHERE q.id = $1 AND l.teacher_id = $2`,
      [questionIdNum, teacher_id],
    );
    if (!check.rowCount) throw new HttpError(404, 'السؤال غير موجود');
    await TeacherActivityLogService.log({
      teacher_id,
      action: 'delete_question',
      entity_type: 'question',
      entity_id: questionIdNum,
      description: `حذف سؤال: ${questionIdNum}`,
    });
    await pool.query('DELETE FROM teacher_questions WHERE id = $1', [questionIdNum]);
    res.json({ success: true });
  }),
);

router.get(
  '/questions/:lesson_id',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(req.params.lesson_id);
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
      throw new HttpError(404, 'الدرس غير موجود');
    }
    const result = await pool.query(
      'SELECT * FROM teacher_questions WHERE lesson_id = $1 ORDER BY id',
      [lessonIdNum],
    );
    res.json({ questions: result.rows });
  }),
);

router.post(
  '/bulk',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const { lesson_id, bulk_text } = req.body;
    const teacher_id = req.user!.id;
    const lessonIdNum = Number(lesson_id);
    if (!lessonIdNum || !bulk_text) throw new HttpError(400, 'lesson_id و bulk_text مطلوبان');
    if (!(await verifyLessonOwnership(lessonIdNum, teacher_id))) {
      throw new HttpError(404, 'الدرس غير موجود');
    }

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

    let inserted = 0;
    for (const q of questions) {
      await pool.query(
        'INSERT INTO teacher_questions (lesson_id, question_text, question_type, choices) VALUES ($1, $2, $3, $4)',
        [lessonIdNum, q.question_text, 'choice', JSON.stringify(q.choices)],
      );
      inserted++;
    }

    res.status(201).json({ success: true, inserted });
  }),
);

router.get(
  '/public/questions/:lesson_id',
  asyncWrapper(async (req, res) => {
    const lessonIdNum = Number(req.params.lesson_id);
    const result = await pool.query(
      'SELECT * FROM teacher_questions WHERE lesson_id = $1 ORDER BY id',
      [lessonIdNum],
    );
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

router.get(
  '/tree',
  authMiddleware(['teacher']),
  asyncWrapper(async (req, res) => {
    const teacher_id = req.user!.id;

    const grades = (
      await pool.query(
        `SELECT g.*, pg.name AS platform_grade_name
         FROM teacher_question_grades g
         LEFT JOIN grades pg ON pg.id = g.platform_grade_id
         WHERE g.teacher_id = $1
         ORDER BY g.id`,
        [teacher_id],
      )
    ).rows;

    const lessons = (
      await pool.query(
        'SELECT * FROM teacher_question_lessons WHERE teacher_id = $1 ORDER BY id',
        [teacher_id],
      )
    ).rows;

    const lessonIds = lessons.map((l) => l.id);
    const questions = lessonIds.length
      ? (
          await pool.query(
            'SELECT * FROM teacher_questions WHERE lesson_id = ANY($1::int[]) ORDER BY id',
            [lessonIds],
          )
        ).rows
      : [];

    const passages = lessonIds.length
      ? (
          await pool.query(
            'SELECT * FROM teacher_question_passages WHERE lesson_id = ANY($1::int[]) ORDER BY order_index, id',
            [lessonIds],
          )
        ).rows
      : [];

    const lessonsMap = Object.fromEntries(
      lessons.map((l) => [
        l.id,
        { ...l, questions: [] as typeof questions, passages: [] as typeof passages },
      ]),
    );

    for (const q of questions) {
      lessonsMap[q.lesson_id]?.questions.push(q);
    }
    for (const p of passages) {
      const lesson = lessonsMap[p.lesson_id];
      if (lesson) {
        lesson.passages.push({
          ...p,
          questions: questions.filter((q) => q.passage_id === p.id),
        });
      }
    }

    const nestedLessons = Object.values(lessonsMap) as Array<
      (typeof lessons)[number] & { questions: typeof questions; passages: typeof passages }
    >;
    const gradesMap = Object.fromEntries(
      grades.map((g) => [g.id, { ...g, lessons: [] as typeof nestedLessons }]),
    );
    for (const lesson of nestedLessons) {
      gradesMap[lesson.grade_id]?.lessons.push(lesson);
    }

    res.json({ grades: Object.values(gradesMap) });
  }),
);
