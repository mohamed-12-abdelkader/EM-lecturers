import type {
  MistralExtractedPassage,
  MistralExtractedQuestion,
} from '../types/mistralQuestionExtraction';
import { isValidMistralOptionCount, MIN_MCQ_OPTIONS } from '../types/mistralQuestionExtraction';

function isSubQuestionSourceNumber(sourceNumber?: string | null): boolean {
  if (!sourceNumber?.trim()) return false;
  return /^\d+\s*[-–]\s*\d+/.test(sourceNumber.trim());
}

function combineStemWithPart(stem: string, part: string): string {
  const normalizedStem = stem.trim();
  const normalizedPart = part.trim();
  if (!normalizedPart) return normalizedStem;
  if (!normalizedStem) return normalizedPart;
  if (normalizedPart.includes(normalizedStem)) return normalizedPart;

  if (normalizedStem.endsWith(':') || normalizedStem.endsWith('：')) {
    return `${normalizedStem} ${normalizedPart}`;
  }
  return `${normalizedStem}\n${normalizedPart}`;
}

function looksLikeSharedStemSubQuestions(
  passage: MistralExtractedPassage,
  group: MistralExtractedQuestion[],
): boolean {
  if (group.length < 2) return false;

  const subBySource = group.filter((q) => isSubQuestionSourceNumber(q.source_number));
  if (subBySource.length >= 2) return true;

  const withOptions = group.filter(
    (q) => q.options.length >= MIN_MCQ_OPTIONS && isValidMistralOptionCount(q.options.length),
  );
  if (withOptions.length < 2) return false;

  const stem = passage.content.trim();
  if (!stem) return false;

  const shortFragments = withOptions.filter((q) => {
    const text = q.question_text.trim();
    return text.length > 0 && text.length <= Math.max(120, stem.length * 0.75);
  });

  return shortFragments.length >= 2;
}

/**
 * When one numbered question has multiple MCQ sub-parts (2-1, 2-2, …),
 * merge the shared stem/passage into each sub-question so question_text is complete.
 */
export function expandMultiPartQuestions(
  passages: MistralExtractedPassage[],
  questions: MistralExtractedQuestion[],
): {
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
} {
  const passageById = new Map(passages.map((passage) => [passage.passage_id, passage]));
  const questionsByPassage = new Map<string, MistralExtractedQuestion[]>();

  for (const question of questions) {
    const passageId = question.passage_id?.trim();
    if (!passageId) continue;
    const group = questionsByPassage.get(passageId) ?? [];
    group.push(question);
    questionsByPassage.set(passageId, group);
  }

  const passagesToRemove = new Set<string>();

  for (const [passageId, group] of questionsByPassage) {
    const passage = passageById.get(passageId);
    if (!passage || !looksLikeSharedStemSubQuestions(passage, group)) continue;

    const stem = passage.content.trim();
    for (const question of group) {
      question.question_text = combineStemWithPart(stem, question.question_text);
      question.passage_id = null;
    }
    passagesToRemove.add(passageId);
  }

  return {
    passages: passages.filter((passage) => !passagesToRemove.has(passage.passage_id)),
    questions,
  };
}

/**
 * اقتباس/جملة داخل سؤال واحد وُضعت خطأ في passages[] — ادمجها في نص السؤال.
 * القطعة الحقيقية (قراءة) تبقى إذا تبعها أكثر من سؤال.
 */
export function foldSingletonPassages(
  passages: MistralExtractedPassage[],
  questions: MistralExtractedQuestion[],
): {
  passages: MistralExtractedPassage[];
  questions: MistralExtractedQuestion[];
} {
  const questionsByPassage = new Map<string, MistralExtractedQuestion[]>();
  for (const question of questions) {
    const passageId = question.passage_id?.trim();
    if (!passageId) continue;
    const group = questionsByPassage.get(passageId) ?? [];
    group.push(question);
    questionsByPassage.set(passageId, group);
  }

  const passagesToRemove = new Set<string>();
  const passageById = new Map(passages.map((passage) => [passage.passage_id, passage]));

  for (const [passageId, group] of questionsByPassage) {
    if (group.length !== 1) continue;
    const passage = passageById.get(passageId);
    if (!passage?.content.trim()) continue;
    group[0].question_text = combineStemWithPart(passage.content, group[0].question_text);
    group[0].passage_id = null;
    passagesToRemove.add(passageId);
  }

  return {
    passages: passages.filter((passage) => !passagesToRemove.has(passage.passage_id)),
    questions,
  };
}
