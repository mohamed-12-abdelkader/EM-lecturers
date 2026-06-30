import pool from '../db/pool';
import { Subject, CreateSubject, UpdateSubject } from '../db/types/questionBank';

export class SubjectService {
  // Create new subject
  static async create(
    questionBankId: number,
    data: CreateSubject,
    createdBy?: number,
  ): Promise<Subject> {
    const { name, description, image_url, color, is_active } = data;

    // Verify question bank exists
    const bankQuery = `SELECT id FROM question_banks WHERE id = $1 AND is_active = true`;
    const bankResult = await pool.query(bankQuery, [questionBankId]);

    if (bankResult.rows.length === 0) {
      throw new Error('بنك الأسئلة غير موجود');
    }

    // Uniqueness per question bank
    const existsQuery = `SELECT 1 FROM subjects WHERE question_bank_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`;
    const existsResult = await pool.query(existsQuery, [questionBankId, name]);
    if (existsResult.rowCount) {
      const err = new Error('مادة بنفس الاسم موجودة بالفعل في هذا البنك');
      (err as any).code = '23505';
      throw err;
    }

    const query = `
      INSERT INTO subjects (name, description, image_url, color, question_bank_id, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const values = [
      name,
      description ?? null,
      image_url ?? null,
      color ?? null,
      questionBankId,
      is_active ?? true,
      createdBy ?? null,
    ];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('فشل في إنشاء المادة');
    }

    const subject = result.rows[0];

    return {
      ...subject,
      question_bank_id: questionBankId,
      created_at: new Date(subject.created_at),
      updated_at: new Date(subject.updated_at),
    };
  }

  // Get all subjects for a question bank
  static async getByQuestionBank(questionBankId: number, is_active?: boolean): Promise<Subject[]> {
    const whereConditions = [`question_bank_id = $1`];
    const values: any[] = [questionBankId];
    let valueIndex = 2;

    if (is_active !== undefined) {
      whereConditions.push(`is_active = $${valueIndex}`);
      values.push(is_active);
      valueIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    const query = `
      SELECT * FROM subjects 
      WHERE ${whereClause}
      ORDER BY name ASC
    `;

    const result = await pool.query(query, values);

    return result.rows.map((subject: any) => ({
      ...subject,
      created_at: new Date(subject.created_at),
      updated_at: new Date(subject.updated_at),
    }));
  }

  // Get subject by ID
  static async getById(id: number): Promise<Subject | null> {
    const query = `
      SELECT 
        s.*,
        qb.name as question_bank_name,
        g.name as grade_name
      FROM subjects s
      LEFT JOIN question_banks qb ON s.question_bank_id = qb.id
      LEFT JOIN grades g ON qb.grade_id = g.id
      WHERE s.id = $1
    `;

    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const subject = result.rows[0];

    return {
      ...subject,
      created_at: new Date(subject.created_at),
      updated_at: new Date(subject.updated_at),
    };
  }

  // Update subject
  static async update(
    questionBankId: number,
    subjectId: number,
    data: UpdateSubject,
  ): Promise<Subject> {
    const { name, description, image_url, color, is_active } = data;
    // Ensure uniqueness if name changes
    if (name !== undefined) {
      const dupQuery = `SELECT 1 FROM subjects WHERE question_bank_id = $1 AND LOWER(name) = LOWER($2) AND id <> $3 LIMIT 1`;
      const dupResult = await pool.query(dupQuery, [questionBankId, name, subjectId]);
      if (dupResult.rowCount) {
        const err = new Error('مادة بنفس الاسم موجودة بالفعل في هذا البنك');
        (err as any).code = '23505';
        throw err;
      }
    }

    // Verify subject exists and belongs to the question bank
    const verifyQuery = `
      SELECT id FROM subjects 
      WHERE id = $1 AND question_bank_id = $2
    `;
    const verifyResult = await pool.query(verifyQuery, [subjectId, questionBankId]);

    if (verifyResult.rows.length === 0) {
      throw new Error('المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة');
    }

    // Build update query dynamically
    const updateFields = [];
    const values: any[] = [];
    let valueIndex = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${valueIndex}`);
      values.push(name);
      valueIndex++;
    }

    if (description !== undefined) {
      updateFields.push(`description = $${valueIndex}`);
      values.push(description);
      valueIndex++;
    }

    if (image_url !== undefined) {
      updateFields.push(`image_url = $${valueIndex}`);
      values.push(image_url);
      valueIndex++;
    }

    if (color !== undefined) {
      updateFields.push(`color = $${valueIndex}`);
      values.push(color);
      valueIndex++;
    }

    if (is_active !== undefined) {
      updateFields.push(`is_active = $${valueIndex}`);
      values.push(is_active);
      valueIndex++;
    }

    if (updateFields.length === 0) {
      throw new Error('لا توجد بيانات للتحديث');
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(subjectId, questionBankId);

    const query = `
      UPDATE subjects 
      SET ${updateFields.join(', ')}
      WHERE id = $${valueIndex} AND question_bank_id = $${valueIndex + 1}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      throw new Error('فشل في تحديث المادة');
    }

    const subject = result.rows[0];

    return {
      ...subject,
      created_at: new Date(subject.created_at),
      updated_at: new Date(subject.updated_at),
    };
  }

  // Delete subject
  static async delete(questionBankId: number, subjectId: number): Promise<void> {
    // Verify subject exists and belongs to the question bank
    const verifyQuery = `
      SELECT id FROM subjects 
      WHERE id = $1 AND question_bank_id = $2
    `;
    const verifyResult = await pool.query(verifyQuery, [subjectId, questionBankId]);

    if (verifyResult.rows.length === 0) {
      throw new Error('المادة غير موجودة أو لا تنتمي لهذا بنك الأسئلة');
    }

    // Check if there are any chapters, lessons, or questions (use joins to avoid missing columns)
    const checkQuery = `
      SELECT 
        (SELECT COUNT(*) FROM subject_books WHERE subject_id = $1) AS books_count,
        (SELECT COUNT(*) FROM chapters c WHERE c.subject_id = $1) AS chapters_count,
        (SELECT COUNT(*) 
           FROM lessons l 
           JOIN chapters c ON l.chapter_id = c.id 
          WHERE c.subject_id = $1) AS lessons_count,
        (SELECT COUNT(*) 
           FROM questions q 
           JOIN lessons l ON q.lesson_id = l.id 
           JOIN chapters c ON l.chapter_id = c.id 
          WHERE c.subject_id = $1) AS questions_count
    `;

    const checkResult = await pool.query(checkQuery, [subjectId]);
    const counts = checkResult.rows[0];

    if (counts.books_count > 0 || counts.chapters_count > 0 || counts.lessons_count > 0 || counts.questions_count > 0) {
      throw new Error('لا يمكن حذف المادة لوجود كتب أو فصول أو دروس أو أسئلة مرتبطة بها');
    }

    // Cascade delete related data safely in a transaction
    await pool.query('BEGIN');
    try {
      // Delete questions under this subject
      await pool.query(
        `DELETE FROM questions q
         USING lessons l, chapters c
         WHERE q.lesson_id = l.id AND l.chapter_id = c.id AND c.subject_id = $1`,
        [subjectId],
      );
      // Delete lessons under this subject
      await pool.query(
        `DELETE FROM lessons l
         USING chapters c
         WHERE l.chapter_id = c.id AND c.subject_id = $1`,
        [subjectId],
      );
      // Delete chapters under this subject (books cascade via FK)
      await pool.query(`DELETE FROM subject_books WHERE subject_id = $1`, [subjectId]);
      await pool.query(`DELETE FROM chapters WHERE subject_id = $1`, [subjectId]);
      // Delete teacher_subjects assignments
      await pool.query(`DELETE FROM teacher_subjects WHERE subject_id = $1`, [subjectId]);
      // Finally delete the subject
      const result = await pool.query(
        `DELETE FROM subjects WHERE id = $1 AND question_bank_id = $2`,
        [subjectId, questionBankId],
      );
      if (result.rowCount === 0) throw new Error('فشل في حذف المادة');
      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }

  // Get subjects accessible to teacher
  static async getTeacherSubjects(teacherId: number): Promise<Subject[]> {
    const query = `
      SELECT DISTINCT
        s.*,
        qb.name as question_bank_name,
        g.name as grade_name
      FROM subjects s
      LEFT JOIN question_banks qb ON s.question_bank_id = qb.id
      LEFT JOIN grades g ON qb.grade_id = g.id
      INNER JOIN teacher_permissions tp ON s.id = tp.subject_id AND s.question_bank_id = tp.question_bank_id
      WHERE tp.teacher_id = $1 
        AND tp.is_active = true 
        AND s.is_active = true
      ORDER BY s.name ASC
    `;

    const result = await pool.query(query, [teacherId]);

    return result.rows.map((subject: any) => ({
      ...subject,
      created_at: new Date(subject.created_at),
      updated_at: new Date(subject.updated_at),
    }));
  }
}
