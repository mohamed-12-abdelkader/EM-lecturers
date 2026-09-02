import {
  canResumeCourseAttempt,
  computeAttemptExpireAt,
  isAttemptExpired,
  isDurationUnlimited,
  normalizeDurationMinutes,
  remainingSeconds,
} from './courseLevelExamAttemptPolicy';

export type LectureExamAnswer = {
  questionId: number;
  choiceId: number;
};

export {
  canResumeCourseAttempt,
  computeAttemptExpireAt,
  isAttemptExpired,
  isDurationUnlimited,
  normalizeDurationMinutes,
  remainingSeconds,
};

const LETTERS = ['A', 'B', 'C', 'D'] as const;

export function lectureExamWindowEnd(exam: {
  hide_at?: Date | string | null;
  hideAt?: Date | string | null;
  end_window?: Date | string | null;
  endWindow?: Date | string | null;
}): Date | string | null {
  return exam.hide_at ?? exam.hideAt ?? exam.end_window ?? exam.endWindow ?? null;
}

export function lectureExamDurationMinutes(exam: {
  duration?: number | null;
  time_limit_minutes?: number | null;
  timeLimitMinutes?: number | null;
}): number | null {
  if (exam.duration !== undefined) return normalizeDurationMinutes(exam.duration);
  return normalizeDurationMinutes(exam.time_limit_minutes ?? exam.timeLimitMinutes);
}

export function computeLectureAttemptExpireAt(input: {
  startedAt: Date | string;
  duration?: number | null;
  durationMinutes?: number | null;
  hideAt?: Date | string | null;
  endWindow?: Date | string | null;
}): Date | null {
  return computeAttemptExpireAt({
    startedAt: input.startedAt,
    durationMinutes: input.durationMinutes ?? input.duration,
    visibilityEndDate: input.hideAt ?? input.endWindow ?? null,
  });
}

/** null / 0 / omitted / "unlimited" = unlimited timer */
export function parseLectureDurationInput(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') {
    const raw = value.trim().toLowerCase();
    if (!raw || raw === 'null' || raw === 'unlimited' || raw === 'none') return null;
  }
  return normalizeDurationMinutes(Number(value));
}

export function lectureDurationDbFields(duration: number | null | undefined): {
  duration: number | null;
  time_limit_enabled: boolean;
  time_limit_minutes: number | null;
} {
  const minutes = normalizeDurationMinutes(duration);
  return {
    duration: minutes,
    time_limit_enabled: minutes != null,
    time_limit_minutes: minutes,
  };
}

export function parseLectureExamChoiceId(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value !== 0) {
    return Math.trunc(value);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  const letterIndex = (LETTERS as readonly string[]).indexOf(upper);
  if (letterIndex >= 0) return -(letterIndex + 1);
  const n = Number(raw);
  if (!Number.isFinite(n) || n === 0) return null;
  return Math.trunc(n);
}

export function parseLectureExamAnswerItem(raw: unknown): LectureExamAnswer | null {
  if (!raw || typeof raw !== 'object') return null;
  const answer = raw as Record<string, unknown>;
  const questionId = Number(answer.questionId ?? answer.question_id ?? answer.id);
  if (!Number.isInteger(questionId) || questionId <= 0) return null;

  const choiceId = parseLectureExamChoiceId(
    answer.choiceId ??
      answer.choice_id ??
      answer.selectedChoiceId ??
      answer.selected_choice_id ??
      answer.selectedAnswer ??
      answer.selected_answer ??
      answer.answer ??
      answer.value,
  );
  if (choiceId == null) return null;
  return { questionId, choiceId };
}

export function collectLectureExamAnswersFromBody(body: unknown): {
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
        choiceId: selectedAnswers[i],
        selectedAnswer: selectedAnswers[i],
      })),
    };
  }
  if (req.answers && typeof req.answers === 'object' && !Array.isArray(req.answers)) {
    return {
      hasPayload: true,
      answers: Object.entries(req.answers as Record<string, unknown>).map(([qId, choice]) => ({
        questionId: Number(qId),
        choiceId: choice,
      })),
    };
  }
  return { hasPayload: false, answers: [] };
}

export function mergeSavedAndSubmittedLectureAnswers(
  saved: LectureExamAnswer[],
  submitted: LectureExamAnswer[],
): LectureExamAnswer[] {
  const byId = new Map<number, number>();
  for (const row of saved) {
    if (row.questionId > 0 && row.choiceId != null && row.choiceId !== 0) {
      byId.set(row.questionId, row.choiceId);
    }
  }
  for (const row of submitted) {
    if (row.questionId > 0 && row.choiceId != null && row.choiceId !== 0) {
      byId.set(row.questionId, row.choiceId);
    }
  }
  return [...byId.entries()].map(([questionId, choiceId]) => ({ questionId, choiceId }));
}

export function choiceIdFromAnswerRow(row: {
  selected_choice_id?: number | null;
  answer_text?: string | null;
}): number | null {
  const fromFk = Number(row.selected_choice_id);
  if (Number.isInteger(fromFk) && fromFk > 0) return fromFk;
  return parseLectureExamChoiceId(row.answer_text);
}

export function selectedChoiceIdForDb(choiceId: number | null | undefined): number | null {
  if (choiceId == null) return null;
  return choiceId > 0 ? choiceId : null;
}
