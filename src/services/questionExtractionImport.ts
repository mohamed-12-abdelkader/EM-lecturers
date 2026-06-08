import pool from '../db/pool';
import type {
  MistralExtractedQuestion,
  MistralQuestionExtractionResult,
} from '../types/mistralQuestionExtraction';
import { QuestionBankV2Service } from './questionBankV2';

type ImportResult = {
  passages: Array<{ temp_passage_id: string; db_passage: any }>;
  questions: any[];
  skipped: Array<{ index: number; reason: string }>;
};

function normalizeCorrectAnswerIndex(question: MistralExtractedQuestion): number {
  const index = question.correct_answer_index;
  if (typeof index === 'number' && index >= 0 && index <= 3) return index;
  return 0;
}

function normalizeDifficulty(value?: string): 'easy' | 'medium' | 'hard' {
  if (value === 'easy' || value === 'hard') return value;
  return 'medium';
}

function optionText(question: MistralExtractedQuestion, index: number): string {
  return question.options[index]?.text?.trim() || ['أ', 'ب', 'ج', 'د'][index];
}

async function verifyLessonAccess(
  lessonId: number,
  userId: number,
  userRole?: string,
): Promise<void> {
  // Reuse existing service access check through a zero-row bulk shape by checking lesson through public method side effect is not available.
  // Keep the same broad role policy used by question-bank-v2 controller: teacher/admin/employee.
  if (userRole === 'admin' || userRole === 'employee') {
    const exists = await pool.query('SELECT id FROM lessons WHERE id = $1 LIMIT 1', [lessonId]);
    if (!exists.rowCount) throw new Error('الدرس غير موجود');
    return;
  }

  const result = await pool.query(
    `SELECT l.id
     FROM lessons l
     JOIN chapters c ON c.id = l.chapter_id
     JOIN subjects s ON s.id = c.subject_id
     JOIN question_banks qb ON qb.id = s.question_bank_id
     WHERE l.id = $1 AND qb.created_by = $2
     LIMIT 1`,
    [lessonId, userId],
  );
  if (!result.rowCount) throw new Error('ليس لديك صلاحية لإضافة أسئلة لهذا الدرس');
}

export class QuestionExtractionImportService {
  static async importToQuestionBankV2(input: {
    lessonId: number;
    teacherId: number;
    userRole?: string;
    extraction: Pick<MistralQuestionExtractionResult, 'passages' | 'questions'>;
  }): Promise<ImportResult> {
    const { lessonId, teacherId, userRole, extraction } = input;
    await verifyLessonAccess(lessonId, teacherId, userRole);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const passageMap = new Map<string, number>();
      const importedPassages: ImportResult['passages'] = [];
      for (const passage of extraction.passages || []) {
        const result = await client.query(
          `INSERT INTO question_passages (lesson_id, title, content, order_index)
           VALUES ($1, $2, $3, 0)
           RETURNING *`,
          [lessonId, passage.title || null, passage.content],
        );
        passageMap.set(passage.passage_id, result.rows[0].id);
        importedPassages.push({
          temp_passage_id: passage.passage_id,
          db_passage: result.rows[0],
        });
      }

      const importedQuestions: any[] = [];
      const skipped: ImportResult['skipped'] = [];

      for (let index = 0; index < extraction.questions.length; index++) {
        const question = extraction.questions[index];
        const hasOptions = question.options.length === 4;
        if (!question.question_text.trim() && question.question_images.length === 0) {
          skipped.push({ index, reason: 'Question has no text or image' });
          continue;
        }

        const passageId = question.passage_id ? passageMap.get(question.passage_id) : null;
        const questionType = question.question_images.length > 0 ? 'text_with_image' : 'text_only';
        const questionResult = await client.query(
          `INSERT INTO questions_v2 (
             question_text, question_type, lesson_id, teacher_id, passage_id,
             correct_answer_index, explanation, difficulty_level, points, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'pending')
           RETURNING *`,
          [
            question.question_text.trim(),
            questionType,
            lessonId,
            teacherId,
            passageId || null,
            normalizeCorrectAnswerIndex(question),
            question.correct_answer || null,
            normalizeDifficulty(),
          ],
        );

        const questionId = questionResult.rows[0].id;
        for (let optionIndex = 0; optionIndex < 4; optionIndex++) {
          await client.query(
            `INSERT INTO question_options (question_id, option_index, option_type, text_content)
             VALUES ($1, $2, 'text', $3)`,
            [
              questionId,
              optionIndex,
              hasOptions ? optionText(question, optionIndex) : ['أ', 'ب', 'ج', 'د'][optionIndex],
            ],
          );
        }

        const firstImage = question.question_images.find((image) => image.image_url);
        if (firstImage?.image_url) {
          await client.query(
            `INSERT INTO question_media (question_id, media_type, media_url, media_name, uploaded_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (question_id) DO UPDATE SET
               media_type = EXCLUDED.media_type,
               media_url = EXCLUDED.media_url,
               media_name = EXCLUDED.media_name,
               uploaded_by = EXCLUDED.uploaded_by`,
            [
              questionId,
              firstImage.image_type === 'chart' || firstImage.image_type === 'diagram'
                ? firstImage.image_type
                : 'image',
              firstImage.image_url,
              firstImage.short_description || firstImage.image_id,
              teacherId,
            ],
          );
        }

        importedQuestions.push(questionResult.rows[0]);
      }

      await client.query('COMMIT');

      const hydratedQuestions = [];
      for (const question of importedQuestions) {
        const hydrated = await QuestionBankV2Service.getQuestionById(question.id);
        if (hydrated) hydratedQuestions.push(hydrated);
      }

      return {
        passages: importedPassages,
        questions: hydratedQuestions,
        skipped,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
