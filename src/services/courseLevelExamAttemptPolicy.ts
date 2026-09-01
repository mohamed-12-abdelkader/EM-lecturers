export type CourseExamLetter = 'A' | 'B' | 'C' | 'D';

export type CourseExamAnswer = {
  questionId: number;
  selectedAnswer: CourseExamLetter;
};

const LETTERS: CourseExamLetter[] = ['A', 'B', 'C', 'D'];

export function isDurationUnlimited(durationMinutes: number | null | undefined): boolean {
  if (durationMinutes == null) return true;
  const n = Number(durationMinutes);
  return !Number.isFinite(n) || n <= 0;
}

export function normalizeDurationMinutes(
  durationMinutes: number | null | undefined,
): number | null {
  if (isDurationUnlimited(durationMinutes)) return null;
  const n = Math.trunc(Number(durationMinutes));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function computeAttemptExpireAt(input: {
  startedAt: Date | string;
  durationMinutes?: number | null;
  visibilityEndDate?: Date | string | null;
}): Date | null {
  const startedAt = toDate(input.startedAt);
  if (!startedAt) return toDate(input.visibilityEndDate);

  const candidates: Date[] = [];
  const duration = normalizeDurationMinutes(input.durationMinutes);
  if (duration != null) {
    candidates.push(new Date(startedAt.getTime() + duration * 60_000));
  }
  const windowEnd = toDate(input.visibilityEndDate);
  if (windowEnd) candidates.push(windowEnd);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

export function remainingSeconds(
  expireAt: Date | string | null | undefined,
  now: Date = new Date(),
): number | null {
  const expire = toDate(expireAt);
  if (!expire) return null;
  return Math.max(0, Math.floor((expire.getTime() - now.getTime()) / 1000));
}

export function isAttemptExpired(
  expireAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  const expire = toDate(expireAt);
  if (!expire) return false;
  return now.getTime() >= expire.getTime();
}

export function canResumeCourseAttempt(
  expireAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  return !isAttemptExpired(expireAt, now);
}

export function parseCourseExamSelectedAnswer(value: unknown): CourseExamLetter | null {
  if (value == null) return null;
  if (typeof value === 'number' && value >= 0 && value <= 3) {
    return LETTERS[value] ?? null;
  }
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  if ((LETTERS as string[]).includes(raw)) return raw as CourseExamLetter;
  if (raw.startsWith('OPTION') && (LETTERS as string[]).includes(raw.slice(-1))) {
    return raw.slice(-1) as CourseExamLetter;
  }
  return null;
}

export function parseCourseExamAnswerItem(raw: unknown): CourseExamAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;
  const questionId = Number(answer.questionId ?? answer.question_id ?? answer.id);
  if (!Number.isInteger(questionId) || questionId <= 0) return null;

  let selected: unknown =
    answer.selectedAnswer ??
    answer.selected_answer ??
    answer.answer ??
    answer.choice ??
    answer.option ??
    answer.selectedOption ??
    answer.response ??
    answer.value ??
    answer.selected ??
    answer.selectedIndex;

  if (answer.optionA) selected = 'A';
  else if (answer.optionB) selected = 'B';
  else if (answer.optionC) selected = 'C';
  else if (answer.optionD) selected = 'D';

  const letter = parseCourseExamSelectedAnswer(selected);
  if (!letter) return null;
  return { questionId, selectedAnswer: letter };
}

export function collectCourseExamAnswersFromBody(body: unknown): {
  hasPayload: boolean;
  answers: unknown[];
} {
  if (!body || typeof body !== 'object') return { hasPayload: false, answers: [] };
  const req = body as Record<string, unknown>;
  if (Array.isArray(req.answers)) {
    return { hasPayload: true, answers: req.answers.filter((a) => a != null) };
  }
  if (
    Array.isArray(req.questionIds) &&
    Array.isArray(req.selectedAnswers) &&
    req.questionIds.length === req.selectedAnswers.length
  ) {
    const selectedAnswers = req.selectedAnswers as unknown[];
    return {
      hasPayload: true,
      answers: req.questionIds.map((qId, i) => ({
        questionId: qId,
        selectedAnswer: selectedAnswers[i],
      })),
    };
  }
  if (req.answers && typeof req.answers === 'object' && !Array.isArray(req.answers)) {
    return {
      hasPayload: true,
      answers: Object.entries(req.answers as Record<string, unknown>).map(([qId, choice]) => ({
        questionId: Number(qId),
        selectedAnswer: choice,
      })),
    };
  }
  return { hasPayload: false, answers: [] };
}

export function mergeSavedAndSubmittedAnswers(
  saved: CourseExamAnswer[],
  submitted: CourseExamAnswer[],
): CourseExamAnswer[] {
  const byId = new Map<number, CourseExamLetter>();
  for (const row of saved) {
    if (row.questionId > 0 && row.selectedAnswer) {
      byId.set(row.questionId, row.selectedAnswer);
    }
  }
  for (const row of submitted) {
    if (row.questionId > 0 && row.selectedAnswer) {
      byId.set(row.questionId, row.selectedAnswer);
    }
  }
  return [...byId.entries()].map(([questionId, selectedAnswer]) => ({
    questionId,
    selectedAnswer,
  }));
}

export function gradeCourseAttemptAnswers(input: {
  questionIds: number[];
  correctByQuestionId: Record<number, string | null | undefined>;
  answers: CourseExamAnswer[];
}): {
  obtained: number;
  maxGrade: number;
  correctCount: number;
  results: Array<{
    questionId: number;
    selectedAnswer: CourseExamLetter | null;
    correctAnswer: string | null;
    isCorrect: boolean;
  }>;
} {
  const selected = new Map(input.answers.map((a) => [a.questionId, a.selectedAnswer]));
  const results = input.questionIds.map((questionId) => {
    const correctAnswer = input.correctByQuestionId[questionId]
      ? String(input.correctByQuestionId[questionId]).trim().toUpperCase()
      : null;
    const selectedAnswer = selected.get(questionId) ?? null;
    const isCorrect = !!correctAnswer && selectedAnswer === correctAnswer;
    return { questionId, selectedAnswer, correctAnswer, isCorrect };
  });
  const correctCount = results.filter((r) => r.isCorrect).length;
  return {
    obtained: correctCount,
    maxGrade: input.questionIds.length,
    correctCount,
    results,
  };
}
