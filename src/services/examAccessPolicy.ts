export type QuestionDisplayMode = 'ordered' | 'random';
export type AnswersReleaseMode = 'immediate' | 'after_end' | 'after_hours' | 'scheduled';
export type StudentExamAvailability = 'hidden' | 'incomplete' | 'upcoming' | 'open' | 'expired';

type NullableDate = string | Date | null | undefined;

const DISPLAY_MODES = new Set<QuestionDisplayMode>(['ordered', 'random']);
const RELEASE_MODES = new Set<AnswersReleaseMode>([
  'immediate',
  'after_end',
  'after_hours',
  'scheduled',
]);

const toDate = (value: NullableDate): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export function normalizeQuestionDisplayMode(
  value: unknown,
  fallback: QuestionDisplayMode = 'ordered',
): QuestionDisplayMode {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return DISPLAY_MODES.has(raw as QuestionDisplayMode)
    ? (raw as QuestionDisplayMode)
    : fallback;
}

export function normalizeAnswersReleaseMode(
  value: unknown,
  fallback: AnswersReleaseMode = 'immediate',
): AnswersReleaseMode {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  return RELEASE_MODES.has(raw as AnswersReleaseMode)
    ? (raw as AnswersReleaseMode)
    : fallback;
}

export function inferAnswersReleaseMode(flags: {
  showAnswersImmediately?: boolean;
  showAnswersLater?: boolean;
  answersReleaseDate?: NullableDate;
  answersVisibleAt?: NullableDate;
  showAnswersAfterHours?: number | null;
  answersReleaseMode?: unknown;
}): AnswersReleaseMode {
  if (flags.answersReleaseMode) {
    return normalizeAnswersReleaseMode(flags.answersReleaseMode);
  }
  if (flags.showAnswersImmediately) return 'immediate';
  if (flags.showAnswersLater && flags.answersReleaseDate) return 'scheduled';
  if (flags.answersVisibleAt) return 'scheduled';
  if ((flags.showAnswersAfterHours ?? 0) > 0) return 'after_hours';
  return 'immediate';
}

export function flagsFromAnswersReleaseMode(
  mode: AnswersReleaseMode,
  extras: { afterHours?: number | null; scheduledDate?: NullableDate } = {},
): {
  showAnswersImmediately: boolean;
  showAnswersLater: boolean;
  showAnswersAfterHours: number;
  answersReleaseDate: Date | null;
} {
  const scheduled = toDate(extras.scheduledDate);
  switch (mode) {
    case 'after_end':
      return {
        showAnswersImmediately: false,
        showAnswersLater: false,
        showAnswersAfterHours: 0,
        answersReleaseDate: null,
      };
    case 'after_hours':
      return {
        showAnswersImmediately: false,
        showAnswersLater: false,
        showAnswersAfterHours: Number(extras.afterHours) > 0 ? Number(extras.afterHours) : 24,
        answersReleaseDate: null,
      };
    case 'scheduled':
      return {
        showAnswersImmediately: false,
        showAnswersLater: true,
        showAnswersAfterHours: 0,
        answersReleaseDate: scheduled,
      };
    case 'immediate':
    default:
      return {
        showAnswersImmediately: true,
        showAnswersLater: false,
        showAnswersAfterHours: 0,
        answersReleaseDate: null,
      };
  }
}

export interface StudentExamAvailabilityInput {
  isVisible?: boolean | null;
  isActive?: boolean | null;
  showAt?: NullableDate;
  expireAt?: NullableDate;
  questionsCount?: number | null;
  actualQuestionsCount?: number | null;
}

export function getStudentExamAvailability(
  input: StudentExamAvailabilityInput,
  now: Date = new Date(),
): StudentExamAvailability {
  if (input.isVisible === false || input.isActive === false) {
    return 'hidden';
  }

  const required = Number(input.questionsCount);
  const actual = Number(input.actualQuestionsCount ?? 0);
  if (Number.isFinite(required) && required > 0 && actual < required) {
    return 'incomplete';
  }

  const showAt = toDate(input.showAt);
  if (showAt && now.getTime() < showAt.getTime()) {
    return 'upcoming';
  }

  const expireAt = toDate(input.expireAt);
  if (expireAt && now.getTime() >= expireAt.getTime()) {
    return 'expired';
  }

  return 'open';
}

export function shouldListExamForStudent(
  input: StudentExamAvailabilityInput,
  now: Date = new Date(),
): boolean {
  const status = getStudentExamAvailability(input, now);
  return status === 'open' || status === 'expired';
}

export function canStudentStartExam(
  input: StudentExamAvailabilityInput,
  now: Date = new Date(),
  options: { hasInProgressAttempt?: boolean } = {},
): boolean {
  if (options.hasInProgressAttempt) return true;
  return getStudentExamAvailability(input, now) === 'open';
}

export function lectureExamAvailabilityInput(row: Record<string, any>): StudentExamAvailabilityInput {
  return {
    isVisible: row.is_visible ?? row.isVisible,
    showAt: row.show_at ?? row.showAt,
    expireAt: row.hide_at ?? row.hideAt,
    questionsCount: row.questions_count ?? row.questionsCount,
    actualQuestionsCount: row.actual_questions_count ?? row.actualQuestionsCount,
  };
}

export function courseLevelExamAvailabilityInput(
  row: Record<string, any>,
): StudentExamAvailabilityInput {
  return {
    isVisible: row.is_visible_to_students ?? row.isVisibleToStudents,
    isActive: row.is_active ?? row.isActive,
    showAt: row.available_from ?? row.availableFrom,
    expireAt: row.visibility_end_date ?? row.visibilityEndDate,
    questionsCount: row.questions_count ?? row.questionsCount ?? row.configuredQuestionsCount,
    actualQuestionsCount: row.actual_questions_count ?? row.actualQuestionsCount,
  };
}

export function parseSelectedQuestionIds(value: unknown): number[] | null {
  if (value == null || value === '') return null;
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.replace(/[{}]/g, '').split(',').filter(Boolean)
      : [];
  const ids = raw.map((item) => Number(item)).filter((id) => Number.isInteger(id) && id > 0);
  return ids.length ? ids : null;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffledCopy<T>(items: T[], seed: string): T[] {
  const copy = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function selectAttemptQuestions(
  questionIds: number[],
  count: number | null | undefined,
  mode: QuestionDisplayMode | string = 'ordered',
  seed = 'attempt',
): number[] {
  const unique = [...new Set(questionIds.filter((id) => Number.isInteger(id) && id > 0))];
  const limit = Number(count);
  const take = Number.isFinite(limit) && limit > 0 ? Math.min(limit, unique.length) : unique.length;
  const displayMode = normalizeQuestionDisplayMode(mode);
  const pool = displayMode === 'random' ? shuffledCopy(unique, seed) : unique;
  return pool.slice(0, take);
}

export function orderItemsByIds<T extends { id: number }>(items: T[], ids: number[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is T => Boolean(item));
}

export function attemptQuestionSeed(
  examId: number,
  studentId: number,
  attemptNumber: number,
): string {
  return `${examId}:${studentId}:${attemptNumber}`;
}
