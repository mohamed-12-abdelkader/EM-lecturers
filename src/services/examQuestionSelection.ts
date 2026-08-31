export type QuestionDisplayMode = 'ordered' | 'random';

export function normalizeQuestionDisplayMode(value: unknown): QuestionDisplayMode {
  if (value === 'random') return 'random';
  return 'ordered';
}

/** بذرة ثابتة لكل محاولة — نفس الطالب يحصل على نفس الترتيب عند استئناف المحاولة */
export function computeSelectionSeed(
  examId: number,
  studentId: number,
  attemptNumber: number,
): number {
  return (examId * 1_000_003 + studentId * 997 + attemptNumber * 17) >>> 0;
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  let state = seed || 1;
  for (let i = arr.length - 1; i > 0; i--) {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    const j = state % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * يختار معرّفات الأسئلة المعروضة للطالب.
 * - ordered: أول N حسب ترتيب الإضافة
 * - random: N عشوائية (ثابتة لكل محاولة عبر seed)
 */
export function pickQuestionIds(
  orderedIds: number[],
  questionsCount: number | null | undefined,
  mode: QuestionDisplayMode,
  seed: number,
): number[] {
  if (!orderedIds.length) return [];

  const targetCount =
    questionsCount && questionsCount > 0
      ? Math.min(questionsCount, orderedIds.length)
      : orderedIds.length;

  if (mode === 'random' && orderedIds.length > 1) {
    return shuffleWithSeed(orderedIds, seed).slice(0, targetCount);
  }

  return orderedIds.slice(0, targetCount);
}

/** هل يجب بدء المحاولة قبل عرض الأسئلة؟ */
export function needsAttemptBeforeQuestions(
  bankSize: number,
  questionsCount: number | null | undefined,
  mode: QuestionDisplayMode,
): boolean {
  if (bankSize <= 0) return false;
  const target =
    questionsCount && questionsCount > 0 ? Math.min(questionsCount, bankSize) : bankSize;
  return mode === 'random' || bankSize > target;
}

export function sortByIdOrder<T extends { id: number }>(items: T[], order: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return order.map((id) => byId.get(id)).filter((item): item is T => !!item);
}

export function parseQuestionOrder(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
}
