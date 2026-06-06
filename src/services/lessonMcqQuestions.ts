import pool from '../db/pool';

export type McqQuestionRow = {
  id: number;
  lesson_id: number;
  text: string;
  options: string[];
  correct_answer: string | null;
  image: string | null;
  created_at: string | Date;
  updated_at: string | Date;
};

export class LessonMcqQuestionsService {
  static validateOptions(options: unknown) {
    if (!Array.isArray(options) || options.length !== 4) {
      throw new Error('options must be an array of exactly 4 strings');
    }
    const invalid = options.some((o) => typeof o !== 'string' || o.trim() === '');
    if (invalid) throw new Error('each option must be a non-empty string');
  }

  static async bulkCreate(lessonId: number, questions: { text: string; options: string[] }[]) {
    if (!Number.isInteger(lessonId)) throw new Error('lessonId must be an integer');
    if (!Array.isArray(questions) || questions.length === 0)
      throw new Error('questions must be a non-empty array');

    // Validate lesson exists
    const lessonRes = await pool.query('SELECT id FROM lessons WHERE id = $1', [lessonId]);
    if (!lessonRes.rowCount) throw new Error('lesson not found');

    // Validate all questions
    questions.forEach((q, idx) => {
      if (!q || typeof q.text !== 'string' || q.text.trim() === '') {
        throw new Error(`question at index ${idx} missing valid text`);
      }
      this.validateOptions(q.options);
    });

    // Build bulk insert
    const values: any[] = [];
    const rowsSql: string[] = [];
    let i = 1;
    for (const q of questions) {
      rowsSql.push(`($${i++}, $${i++}, $${i++})`);
      values.push(lessonId, q.text.trim(), q.options);
    }

    const sql = `
      INSERT INTO lesson_mcq_questions (lesson_id, text, options)
      VALUES ${rowsSql.join(', ')}
      RETURNING *
    `;

    const res = await pool.query(sql, values);
    return res.rows as McqQuestionRow[];
  }

  static parseBulkText(bulkText: string): { text: string; options: string[] }[] {
    if (typeof bulkText !== 'string' || bulkText.trim() === '') {
      throw new Error('questions must be a non-empty string');
    }
    const blocks = bulkText
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    const questions: { text: string; options: string[] }[] = [];
    const invalid: number[] = [];
    blocks.forEach((block, idx) => {
      const lines = block
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length < 5) {
        invalid.push(idx + 1);
        return;
      }
      const questionText = lines[0];
      const options: string[] = [];
      for (let i = 1; i < lines.length && options.length < 4; i++) {
        const line = lines[i];
        const match = line.match(/^[A-D][).:,-]?\s*(.+)$/i);
        if (match) {
          options.push(match[1].trim());
        } else {
          options.push(line);
        }
      }
      if (questionText && options.length === 4) {
        questions.push({ text: questionText, options });
      } else {
        invalid.push(idx + 1);
      }
    });
    if (invalid.length) {
      throw new Error(
        `Invalid question blocks: ${invalid.join(', ')}. Ensure each has a question and 4 options.`,
      );
    }
    return questions;
  }

  static async bulkCreateFromText(lessonId: number, bulkText: string) {
    const questions = this.parseBulkText(bulkText);
    return this.bulkCreate(lessonId, questions);
  }

  static async setCorrectAnswer(id: number, correctAnswer: string) {
    if (!Number.isInteger(id)) throw new Error('invalid id');
    if (typeof correctAnswer !== 'string' || correctAnswer.trim() === '')
      throw new Error('correctAnswer is required');
    // Ensure the provided answer equals one of existing options
    const q = await pool.query('SELECT options FROM lesson_mcq_questions WHERE id = $1', [id]);
    if (!q.rowCount) throw new Error('question not found');
    const opts: string[] = q.rows[0].options;
    if (!opts.includes(correctAnswer)) throw new Error('correctAnswer must be one of the options');

    const res = await pool.query(
      'UPDATE lesson_mcq_questions SET correct_answer = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [correctAnswer, id],
    );
    return res.rows[0] as McqQuestionRow;
  }

  static async setImage(id: number, imageUrl: string) {
    if (!Number.isInteger(id)) throw new Error('invalid id');
    if (typeof imageUrl !== 'string' || imageUrl.trim() === '')
      throw new Error('image is required');
    const res = await pool.query(
      'UPDATE lesson_mcq_questions SET image = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [imageUrl, id],
    );
    if (!res.rowCount) throw new Error('question not found');
    return res.rows[0] as McqQuestionRow;
  }

  static async getByLesson(lessonId: number) {
    if (!Number.isInteger(lessonId)) throw new Error('lessonId must be an integer');
    const res = await pool.query(
      'SELECT * FROM lesson_mcq_questions WHERE lesson_id = $1 ORDER BY id ASC',
      [lessonId],
    );
    return res.rows as McqQuestionRow[];
  }

  static async updateQuestion(id: number, data: { text?: string; options?: string[] }) {
    if (!Number.isInteger(id)) throw new Error('invalid id');
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;
    if (data.text !== undefined) {
      if (typeof data.text !== 'string' || data.text.trim() === '')
        throw new Error('text must be a non-empty string');
      fields.push(`text = $${i++}`);
      values.push(data.text.trim());
    }
    if (data.options !== undefined) {
      this.validateOptions(data.options);
      fields.push(`options = $${i++}`);
      values.push(data.options);
      // When options change, ensure correct_answer stays valid; if not, null it
      fields.push(
        `correct_answer = CASE WHEN correct_answer IS NULL OR correct_answer = ANY($${i - 1}) THEN correct_answer ELSE NULL END`,
      );
    }
    if (fields.length === 0) throw new Error('no fields to update');
    fields.push('updated_at = NOW()');
    values.push(id);
    const res = await pool.query(
      `UPDATE lesson_mcq_questions SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    if (!res.rowCount) throw new Error('question not found');
    return res.rows[0] as McqQuestionRow;
  }

  static async delete(id: number) {
    if (!Number.isInteger(id)) throw new Error('invalid id');
    const res = await pool.query('DELETE FROM lesson_mcq_questions WHERE id = $1', [id]);
    if (!res.rowCount) throw new Error('question not found');
  }
}
