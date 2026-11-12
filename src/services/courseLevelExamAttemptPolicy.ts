export type CourseExamLetter = 'A' | 'B' | 'C' | 'D';

export type CourseExamAnswer = {
  questionId: number;
  selectedAnswer?: CourseExamLetter | null;
  essay?: boolean;
  answerText?: string | null;
  answerImages?: string[];
  ocrText?: string | null;
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

export type CourseExamTimingMode = 'relative' | 'fixed' | null | undefined;

/**
 * Server deadline for an attempt.
 * - fixed: always the shared schedule end (visibilityEndDate).
 * - relative: startedAt + duration only (window gates start, not remaining time).
 * - legacy/null: earlier of duration end and visibilityEndDate (existing behavior).
 */
export function computeAttemptExpireAt(input: {
  startedAt: Date | string;
  durationMinutes?: number | null;
  visibilityEndDate?: Date | string | null;
  timingMode?: CourseExamTimingMode;
}): Date | null {
  const mode = input.timingMode === 'fixed' || input.timingMode === 'relative' ? input.timingMode : null;
  const windowEnd = toDate(input.visibilityEndDate);

  if (mode === 'fixed') {
    return windowEnd;
  }

  const startedAt = toDate(input.startedAt);
  const duration = normalizeDurationMinutes(input.durationMinutes);

  if (mode === 'relative') {
    if (!startedAt || duration == null) return null;
    return new Date(startedAt.getTime() + duration * 60_000);
  }

  // Legacy: keep previous min(duration, visibility_end) behavior for old exams.
  if (!startedAt) return windowEnd;
  const candidates: Date[] = [];
  if (duration != null) {
    candidates.push(new Date(startedAt.getTime() + duration * 60_000));
  }
  if (windowEnd) candidates.push(windowEnd);
  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

export function normalizeTimingMode(value: unknown): 'relative' | 'fixed' | null {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase();
  if (raw === 'fixed') return 'fixed';
  if (raw === 'relative') return 'relative';
  return null;
}

export function validateFixedExamSchedule(input: {
  timingMode?: CourseExamTimingMode;
  availableFrom?: Date | string | null;
  visibilityEndDate?: Date | string | null;
}): { ok: true } | { ok: false; message: string } {
  const mode =
    input.timingMode === 'fixed' || input.timingMode === 'relative' ? input.timingMode : null;
  if (mode !== 'fixed') return { ok: true };

  const start = toDate(input.availableFrom);
  const end = toDate(input.visibilityEndDate);
  if (!start) {
    return { ok: false, message: 'موعد بداية الامتحان مطلوب عند اختيار الموعد الثابت' };
  }
  if (!end) {
    return { ok: false, message: 'موعد نهاية الامتحان مطلوب عند اختيار الموعد الثابت' };
  }
  if (end.getTime() <= start.getTime()) {
    return { ok: false, message: 'موعد نهاية الامتحان يجب أن يكون بعد موعد البداية' };
  }
  return { ok: true };
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

  const imageValues = answer.answerImages ?? answer.answer_images;
  const answerImages = Array.isArray(imageValues)
    ? imageValues.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const answerTextRaw = answer.answerText ?? answer.answer_text;
  const ocrTextRaw = answer.ocrText ?? answer.ocr_text;
  if (answer.essay === true || answer.essay === 'true') {
    return {
      questionId,
      essay: true,
      selectedAnswer: null,
      answerText: answerTextRaw == null ? null : String(answerTextRaw),
      answerImages,
      ocrText: ocrTextRaw == null ? null : String(ocrTextRaw),
    };
  }

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

/** Normalize one or two correct letters into a unique A–D list (order preserved). */
export function normalizeCorrectAnswers(
  primary: string | string[] | null | undefined,
  secondary?: string | null | undefined,
): CourseExamLetter[] {
  const rawValues: unknown[] = Array.isArray(primary)
    ? primary
    : [primary, secondary];
  const letters: CourseExamLetter[] = [];
  for (const raw of rawValues) {
    const letter = parseCourseExamSelectedAnswer(raw);
    if (letter && !letters.includes(letter)) letters.push(letter);
  }
  return letters;
}

export function isSelectedAnswerCorrect(
  selected: CourseExamLetter | string | null | undefined,
  correctAnswers: CourseExamLetter[] | string | string[] | null | undefined,
): boolean {
  const selectedLetter = parseCourseExamSelectedAnswer(selected);
  if (!selectedLetter) return false;
  const set = Array.isArray(correctAnswers)
    ? normalizeCorrectAnswers(correctAnswers)
    : normalizeCorrectAnswers(correctAnswers);
  return set.includes(selectedLetter);
}

export type CourseCorrectByQuestionId = Record<
  number,
  string | string[] | null | undefined
>;

export function gradeCourseAttemptAnswers(input: {
  questionIds: number[];
  correctByQuestionId: CourseCorrectByQuestionId;
  answers: CourseExamAnswer[];
}): {
  obtained: number;
  maxGrade: number;
  correctCount: number;
  results: Array<{
    questionId: number;
    selectedAnswer: CourseExamLetter | null;
    /** Primary correct letter (first), for backward-compatible clients. */
    correctAnswer: string | null;
    /** All accepted correct letters (1 or 2). */
    correctAnswers: CourseExamLetter[];
    isCorrect: boolean;
  }>;
} {
  const selected = new Map(input.answers.map((a) => [a.questionId, a.selectedAnswer]));
  const results = input.questionIds.map((questionId) => {
    const correctAnswers = normalizeCorrectAnswers(input.correctByQuestionId[questionId]);
    const selectedAnswer = selected.get(questionId) ?? null;
    const isCorrect = isSelectedAnswerCorrect(selectedAnswer, correctAnswers);
    return {
      questionId,
      selectedAnswer,
      correctAnswer: correctAnswers[0] ?? null,
      correctAnswers,
      isCorrect,
    };
  });
  const correctCount = results.filter((r) => r.isCorrect).length;
  return {
    obtained: correctCount,
    maxGrade: input.questionIds.length,
    correctCount,
    results,
  };
}
