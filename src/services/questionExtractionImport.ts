import pool from '../db/pool';
import type { QuestionV2 } from '../db/types/questionBankV2';
import type {
  MistralExtractedQuestion,
  MistralQuestionExtractionResult,
  MistralQuestionImage,
} from '../types/mistralQuestionExtraction';
import {
  isValidMistralOptionCount,
  MAX_MCQ_OPTIONS,
  MIN_MCQ_OPTIONS,
} from '../types/mistralQuestionExtraction';
import { expandMultiPartQuestions } from '../utils/expandMultiPartQuestions';
import { QuestionBankV2Service } from './questionBankV2';

type ImportResult = {
  passages: Array<{ temp_passage_id: string; db_passage: unknown }>;
  questions: QuestionV2[];
  /** Original extraction rows aligned with `questions` (skipped items omitted). */
  originalQuestions: MistralExtractedQuestion[];
  skipped: Array<{ index: number; reason: string; source_number?: string }>;
};

type ImportKind = 'text_mcq' | 'image_choices' | 'open_answer';

const ARABIC_OPTION_LABELS = ['أ', 'ب', 'ج', 'د', 'هـ'];
const ENGLISH_OPTION_LABELS = ['a', 'b', 'c', 'd', 'e'];

function optionLabelFor(question: MistralExtractedQuestion, index: number): string {
  const fromSource = question.options[index]?.label?.trim();
  if (fromSource) return fromSource;
  const englishHits = question.options.filter((o) =>
    /^[a-e]$/i.test((o.label ?? '').trim()),
  ).length;
  const pool = englishHits > 0 ? ENGLISH_OPTION_LABELS : ARABIC_OPTION_LABELS;
  return pool[index] ?? String(index + 1);
}

function imageUrls(question: MistralExtractedQuestion): string[] {
  return (question.question_images || [])
    .map((image) => image.image_url)
    .filter((url): url is string => Boolean(url));
}

function classifyImportKind(question: MistralExtractedQuestion): ImportKind {
  if (
    question.options.length >= MIN_MCQ_OPTIONS &&
    question.options.length <= MAX_MCQ_OPTIONS
  ) {
    return 'text_mcq';
  }
  const urls = imageUrls(question);
  if (question.options.length === 0 && urls.length >= 4) return 'image_choices';
  return 'open_answer';
}

function normalizeCorrectAnswerIndex(question: MistralExtractedQuestion): number {
  const index = question.correct_answer_index;
  const max = Math.max(0, question.options.length - 1);
  if (typeof index === 'number' && index >= 0 && index <= max) return index;
  return 0;
}

function normalizeDifficulty(value?: string): 'easy' | 'medium' | 'hard' {
  if (value === 'easy' || value === 'hard') return value;
  return 'medium';
}

function optionText(question: MistralExtractedQuestion, index: number): string {
  return question.options[index]?.text?.trim() || optionLabelFor(question, index);
}

function placeholderOptions(correctAnswer?: string | null): string[] {
  if (correctAnswer?.trim()) {
    return [correctAnswer.trim(), '—', '—', '—'];
  }
  return [...ARABIC_OPTION_LABELS];
}

function mediaTypeFromImage(image?: MistralQuestionImage): 'image' | 'diagram' | 'chart' {
  if (image?.image_type === 'chart' || image?.image_type === 'diagram') {
    return image.image_type;
  }
  return 'image';
}

/** Map saved question back to extract-questions shape for the frontend */
export function mapImportedQuestionToExtractionShape(
  original: MistralExtractedQuestion | undefined,
  saved: QuestionV2,
  index: number,
) {
  const textOptions =
    saved.options?.filter((o) => o.option_type === 'text' && o.text_content?.trim()) ?? [];
  const imageOptions =
    saved.options?.filter((o) => o.option_type === 'image' && o.image_url) ?? [];

  let questionImages: MistralQuestionImage[] = original?.question_images ?? [];

  if (saved.question_type === 'image_choices' && imageOptions.length > 0) {
    questionImages = imageOptions.map((opt, i) => {
      const source = original?.question_images?.[i];
      return {
        image_id: source?.image_id ?? `imported-opt-${opt.option_index}`,
        page_index: source?.page_index ?? 0,
        image_type: source?.image_type ?? 'diagram',
        short_description: source?.short_description,
        summary: source?.summary,
        educational_relevance: source?.educational_relevance,
        image_url: opt.image_url!,
      };
    });
  } else if (saved.media?.media_url) {
    const first = original?.question_images?.find((img) => img.image_url) ?? original?.question_images?.[0];
    questionImages = [
      {
        image_id: first?.image_id ?? 'question-media',
        page_index: first?.page_index ?? 0,
        image_type: first?.image_type ?? saved.media.media_type,
        short_description: first?.short_description ?? saved.media.media_name ?? undefined,
        summary: first?.summary,
        educational_relevance: first?.educational_relevance,
        image_url: saved.media.media_url,
      },
    ];
  }

  const options =
    saved.question_type === 'image_choices'
      ? []
      : textOptions.length > 0
        ? textOptions.map((opt, i) => ({
            label:
              original?.options[i]?.label ??
              (original ? optionLabelFor(original, i) : ARABIC_OPTION_LABELS[i] ?? String(i + 1)),
            text: opt.text_content ?? '',
          }))
        : (original?.options ?? []);

  return {
    number: original?.number ?? index + 1,
    source_number: original?.source_number ?? String(index + 1),
    question_text: saved.question_text,
    passage_id: original?.passage_id ?? null,
    options,
    question_images: questionImages,
    correct_answer: saved.explanation ?? original?.correct_answer ?? null,
    correct_answer_index:
      saved.correct_answer_index ?? original?.correct_answer_index ?? null,
    correct_answer_inferred: original?.correct_answer_inferred ?? false,
    db_id: saved.id,
    question_type: saved.question_type,
    status: saved.status,
  };
}

export function buildImportExtractionResponse(
  meta: Partial<MistralQuestionExtractionResult>,
  result: ImportResult,
) {
  return {
    ...meta,
    question_count: result.questions.length,
    passages: result.passages.map((p) => p.db_passage),
    questions: result.questions.map((saved, index) =>
      mapImportedQuestionToExtractionShape(
        result.originalQuestions[index],
        saved,
        index,
      ),
    ),
    skipped: result.skipped,
  };
}

export class QuestionExtractionImportService {
  static async importToQuestionBankV2(input: {
    lessonId: number;
    teacherId: number;
    userRole?: string;
    extraction: Pick<MistralQuestionExtractionResult, 'passages' | 'questions'>;
  }): Promise<ImportResult> {
    const { lessonId, teacherId, userRole, extraction } = input;
    await QuestionBankV2Service.verifyLessonAccess(lessonId, teacherId, userRole);

    const normalizedExtraction = expandMultiPartQuestions(
      extraction.passages || [],
      extraction.questions,
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const passageMap = new Map<string, number>();
      const importedPassages: ImportResult['passages'] = [];
      for (const passage of normalizedExtraction.passages || []) {
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

      const importedQuestions: QuestionV2[] = [];
      const originalQuestions: MistralExtractedQuestion[] = [];
      const skipped: ImportResult['skipped'] = [];

      for (let index = 0; index < normalizedExtraction.questions.length; index++) {
        const question = normalizedExtraction.questions[index];
        const kind = classifyImportKind(question);
        const urls = imageUrls(question);

        if (!question.question_text.trim() && urls.length === 0) {
          skipped.push({
            index,
            source_number: question.source_number,
            reason: 'Question has no text or image',
          });
          continue;
        }

        if (kind === 'text_mcq' && !isValidMistralOptionCount(question.options.length)) {
          skipped.push({
            index,
            source_number: question.source_number,
            reason: `text_mcq requires ${MIN_MCQ_OPTIONS}–${MAX_MCQ_OPTIONS} options`,
          });
          continue;
        }

        if (kind === 'image_choices' && urls.length < 4) {
          skipped.push({
            index,
            source_number: question.source_number,
            reason: 'image_choices requires at least 4 images',
          });
          continue;
        }

        const passageId = question.passage_id ? passageMap.get(question.passage_id) : null;
        const questionType =
          kind === 'image_choices'
            ? 'image_choices'
            : urls.length > 0
              ? 'text_with_image'
              : 'text_only';

        const explanation = question.correct_answer?.trim() || null;

        const questionResult = await client.query(
          `INSERT INTO questions_v2 (
             question_text, question_type, lesson_id, teacher_id, passage_id,
             correct_answer_index, explanation, difficulty_level, points, status
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'pending')
           RETURNING *`,
          [
            question.question_text.trim() || 'اختر الإجابة الصحيحة من الصور',
            questionType,
            lessonId,
            teacherId,
            passageId || null,
            normalizeCorrectAnswerIndex(question),
            explanation,
            normalizeDifficulty(),
          ],
        );

        const questionId = questionResult.rows[0].id;

        if (kind === 'image_choices') {
          for (let optionIndex = 0; optionIndex < 4; optionIndex++) {
            await client.query(
              `INSERT INTO question_options (question_id, option_index, option_type, image_url)
               VALUES ($1, $2, 'image', $3)`,
              [questionId, optionIndex, urls[optionIndex]],
            );
          }
        } else {
          const optionTexts =
            kind === 'text_mcq'
              ? question.options.map((_, i) => optionText(question, i))
              : placeholderOptions(question.correct_answer);

          for (let optionIndex = 0; optionIndex < optionTexts.length; optionIndex++) {
            await client.query(
              `INSERT INTO question_options (question_id, option_index, option_type, text_content)
               VALUES ($1, $2, 'text', $3)`,
              [questionId, optionIndex, optionTexts[optionIndex]],
            );
          }

          if (urls.length > 0) {
            const firstImage = question.question_images?.find((image) => image.image_url);
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
                  mediaTypeFromImage(firstImage),
                  firstImage.image_url,
                  firstImage.short_description || firstImage.image_id,
                  teacherId,
                ],
              );
            }
          }
        }

        const hydrated = await QuestionBankV2Service.getQuestionById(questionId, client);
        if (hydrated) {
          importedQuestions.push(hydrated);
          originalQuestions.push(question);
        }
      }

      await client.query('COMMIT');
      return { passages: importedPassages, questions: importedQuestions, originalQuestions, skipped };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
