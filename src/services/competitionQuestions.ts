import pool from '../db/pool';
import {
  CompetitionQuestion,
  CompetitionQuestionCreate,
  CompetitionQuestionUpdate,
  BulkQuestionsCreate,
} from '../db/types';

export class CompetitionQuestionsService {
  // إنشاء سؤال واحد
  static async create(
    question: CompetitionQuestionCreate,
    createdBy: number,
  ): Promise<CompetitionQuestion> {
    const {
      competition_id,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer,
      points,
      question_order,
      is_active,
    } = question;

    const query = `
      INSERT INTO competition_questions (
        competition_id, question_text, option_a, option_b, option_c, option_d, 
        correct_answer, points, question_order, is_active, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `;

    const values = [
      competition_id,
      question_text,
      option_a,
      option_b,
      option_c,
      option_d,
      correct_answer,
      points,
      question_order,
      is_active,
      createdBy,
    ];

    const result = await pool.query<CompetitionQuestion>(query, values);
    return result.rows[0];
  }

  // إنشاء مجموعة أسئلة دفعة واحدة
  static async createBulk(
    bulkData: BulkQuestionsCreate,
    createdBy: number,
  ): Promise<CompetitionQuestion[]> {
    const { competition_id, questions } = bulkData;

    // بدء المعاملة
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const createdQuestions: CompetitionQuestion[] = [];

      for (let i = 0; i < questions.length; i++) {
        const question = questions[i];
        const query = `
          INSERT INTO competition_questions (
            competition_id, question_text, option_a, option_b, option_c, option_d, 
            correct_answer, points, question_order, is_active, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `;

        const values = [
          competition_id,
          question.question_text,
          question.option_a,
          question.option_b,
          question.option_c,
          question.option_d,
          question.correct_answer,
          question.points || 1,
          question.question_order || i,
          question.is_active !== false,
          createdBy,
        ];

        const result = await client.query<CompetitionQuestion>(query, values);
        createdQuestions.push(result.rows[0]);
      }

      await client.query('COMMIT');
      return createdQuestions;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // إنشاء أسئلة من نص بسيط
  static async createFromText(
    competitionId: number,
    questionsText: string,
    createdBy: number,
  ): Promise<{
    questions: CompetitionQuestion[];
    parsedCount: number;
    errors: string[];
  }> {
    const lines = questionsText
      .trim()
      .split('\n')
      .filter((line) => line.trim());
    const questions: CompetitionQuestion[] = [];
    const errors: string[] = [];
    let currentQuestion: any = null;
    let questionIndex = 0;

    // بدء المعاملة
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // إذا كان السطر فارغ، تخطى
        if (!line) continue;

        // إذا كان السطر يحتوي على نقطة في النهاية، فهو سؤال جديد
        if (line.endsWith('.') || line.endsWith('؟') || line.endsWith('!')) {
          // حفظ السؤال السابق إذا وجد
          if (
            currentQuestion &&
            currentQuestion.question_text &&
            currentQuestion.option_a &&
            currentQuestion.option_b &&
            currentQuestion.option_c &&
            currentQuestion.option_d
          ) {
            // إدراج السؤال في قاعدة البيانات
            const query = `
              INSERT INTO competition_questions (
                competition_id, question_text, option_a, option_b, option_c, option_d, 
                correct_answer, points, question_order, is_active, created_by
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              RETURNING *
            `;

            const values = [
              competitionId,
              currentQuestion.question_text,
              currentQuestion.option_a,
              currentQuestion.option_b,
              currentQuestion.option_c,
              currentQuestion.option_d,
              null, // لا توجد إجابة صحيحة محددة بعد
              1, // نقاط افتراضية
              questionIndex,
              true,
              createdBy,
            ];

            const result = await client.query<CompetitionQuestion>(query, values);
            questions.push(result.rows[0]);
            questionIndex++;
          }

          // بدء سؤال جديد
          currentQuestion = {
            question_text: line,
            option_a: '',
            option_b: '',
            option_c: '',
            option_d: '',
          };
        }
        // إذا كان السطر يبدأ بحرف + رقم + ) فهو خيار
        else if (/^[A-D]\)/.test(line)) {
          if (currentQuestion) {
            const option = line.substring(2).trim();
            const optionLetter = line.charAt(0);

            switch (optionLetter) {
              case 'A':
                currentQuestion.option_a = option;
                break;
              case 'B':
                currentQuestion.option_b = option;
                break;
              case 'C':
                currentQuestion.option_c = option;
                break;
              case 'D':
                currentQuestion.option_d = option;
                break;
            }
          }
        }
      }

      // حفظ السؤال الأخير إذا وجد
      if (
        currentQuestion &&
        currentQuestion.question_text &&
        currentQuestion.option_a &&
        currentQuestion.option_b &&
        currentQuestion.option_c &&
        currentQuestion.option_d
      ) {
        const query = `
          INSERT INTO competition_questions (
            competition_id, question_text, option_a, option_b, option_c, option_d, 
            correct_answer, points, question_order, is_active, created_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          RETURNING *
        `;

        const values = [
          competitionId,
          currentQuestion.question_text,
          currentQuestion.option_a,
          currentQuestion.option_b,
          currentQuestion.option_c,
          currentQuestion.option_d,
          null, // لا توجد إجابة صحيحة محددة بعد
          1, // نقاط افتراضية
          questionIndex,
          true,
          createdBy,
        ];

        const result = await client.query<CompetitionQuestion>(query, values);
        questions.push(result.rows[0]);
        questionIndex++;
      }

      await client.query('COMMIT');

      return {
        questions,
        parsedCount: questions.length,
        errors,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // الحصول على جميع أسئلة مسابقة معينة
  static async getByCompetition(competitionId: number): Promise<CompetitionQuestion[]> {
    const query = `
      SELECT * FROM competition_questions 
      WHERE competition_id = $1 AND is_active = true
      ORDER BY question_order ASC, created_at ASC
    `;

    const result = await pool.query<CompetitionQuestion>(query, [competitionId]);
    return result.rows;
  }

  // الحصول على سؤال بواسطة المعرف
  static async getById(id: number): Promise<CompetitionQuestion | null> {
    const query = 'SELECT * FROM competition_questions WHERE id = $1';
    const result = await pool.query<CompetitionQuestion>(query, [id]);
    return result.rows[0] || null;
  }

  // تحديث سؤال
  static async update(
    id: number,
    question: CompetitionQuestionUpdate,
  ): Promise<CompetitionQuestion | null> {
    const fields = Object.keys(question).filter(
      (key) => question[key as keyof CompetitionQuestionUpdate] !== undefined,
    );

    if (fields.length === 0) {
      return this.getById(id);
    }

    const setClause = fields.map((field, index) => `${field} = $${index + 2}`).join(', ');
    const query = `
      UPDATE competition_questions 
      SET ${setClause}
      WHERE id = $1
      RETURNING *
    `;

    const values = [
      id,
      ...fields.map((field) => question[field as keyof CompetitionQuestionUpdate]),
    ];

    const result = await pool.query<CompetitionQuestion>(query, values);
    return result.rows[0] || null;
  }

  // حذف سؤال
  static async delete(id: number): Promise<boolean> {
    const query = 'DELETE FROM competition_questions WHERE id = $1';
    const result = await pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // تغيير حالة النشاط
  static async toggleActive(id: number): Promise<CompetitionQuestion | null> {
    const query = `
      UPDATE competition_questions 
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING *
    `;

    const result = await pool.query<CompetitionQuestion>(query, [id]);
    return result.rows[0] || null;
  }

  // تغيير ترتيب الأسئلة
  static async reorderQuestions(
    competitionId: number,
    questionOrders: { id: number; order: number }[],
  ): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      for (const item of questionOrders) {
        const query =
          'UPDATE competition_questions SET question_order = $1 WHERE id = $2 AND competition_id = $3';
        await client.query(query, [item.order, item.id, competitionId]);
      }

      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // الحصول على إحصائيات الأسئلة لمسابقة معينة
  static async getCompetitionStats(competitionId: number): Promise<{
    total_questions: number;
    active_questions: number;
    total_points: number;
  }> {
    const query = `
      SELECT 
        COUNT(*) as total_questions,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_questions,
        COALESCE(SUM(CASE WHEN is_active = true THEN points ELSE 0 END), 0) as total_points
      FROM competition_questions 
      WHERE competition_id = $1
    `;

    const result = await pool.query(query, [competitionId]);
    return result.rows[0];
  }

  // التحقق من وجود سؤال
  static async exists(id: number): Promise<boolean> {
    const query = 'SELECT 1 FROM competition_questions WHERE id = $1';
    const result = await pool.query(query, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  // التحقق من أن السؤال ينتمي لمسابقة معينة
  static async belongsToCompetition(questionId: number, competitionId: number): Promise<boolean> {
    const query = 'SELECT 1 FROM competition_questions WHERE id = $1 AND competition_id = $2';
    const result = await pool.query(query, [questionId, competitionId]);
    return (result.rowCount ?? 0) > 0;
  }

  // الحصول على أسئلة مسابقة معينة مع معلومات إضافية
  static async getByCompetitionWithDetails(competitionId: number): Promise<
    (CompetitionQuestion & {
      competition_title: string;
      creator_name: string;
    })[]
  > {
    const query = `
      SELECT 
        q.*,
        c.title as competition_title,
        u.name as creator_name
      FROM competition_questions q
      LEFT JOIN competitions c ON q.competition_id = c.id
      LEFT JOIN users u ON q.created_by = u.id
      WHERE q.competition_id = $1 AND q.is_active = true
      ORDER BY q.question_order ASC, q.created_at ASC
    `;

    const result = await pool.query(query, [competitionId]);
    return result.rows;
  }

  // تحديث الإجابة الصحيحة فقط
  static async updateCorrectAnswer(
    id: number,
    correctAnswer: 'A' | 'B' | 'C' | 'D',
  ): Promise<CompetitionQuestion | null> {
    const query = `
      UPDATE competition_questions 
      SET correct_answer = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `;

    const result = await pool.query<CompetitionQuestion>(query, [correctAnswer, id]);
    return result.rows[0] || null;
  }
}
