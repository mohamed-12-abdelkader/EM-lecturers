/**
 * Pure helpers for recalculating attempt/submission scores after a question is removed.
 * Obtained score is always recomputed from remaining answers — never by subtracting a fixed delta.
 */

import { parseSelectedQuestionIds } from './examAccessPolicy';

export type CourseAttemptRegradeInput = {
  deletedQuestionId: number;
  selectedQuestionIds: unknown;
  remainingExamQuestionIds: number[];
  /** Remaining answer rows after CASCADE delete */
  remainingAnswers: Array<{ questionId: number; isCorrect: boolean }>;
};

export type CourseAttemptRegradeResult = {
  obtained: number;
  total: number;
  nextSelectedIds: number[] | null;
  /** True when the deleted question was part of this attempt's question set */
  affected: boolean;
};

export function recomputeCourseAttemptAfterQuestionDelete(
  input: CourseAttemptRegradeInput,
): CourseAttemptRegradeResult {
  const remainingSet = new Set(input.remainingExamQuestionIds);
  const selected = parseSelectedQuestionIds(input.selectedQuestionIds);

  let nextSelectedIds: number[] | null = null;
  let affected = false;

  if (selected) {
    affected = selected.includes(input.deletedQuestionId);
    nextSelectedIds = selected.filter(
      (id) => id !== input.deletedQuestionId && remainingSet.has(id),
    );
  } else {
    // Full-exam attempt: every question removal changes the exam max total
    affected = true;
  }

  const scopedAnswers = nextSelectedIds
    ? input.remainingAnswers.filter((a) => nextSelectedIds!.includes(a.questionId))
    : input.remainingAnswers.filter((a) => remainingSet.has(a.questionId));

  const obtained = scopedAnswers.reduce((sum, a) => sum + (a.isCorrect ? 1 : 0), 0);
  const total = nextSelectedIds ? nextSelectedIds.length : remainingSet.size;

  return {
    obtained,
    total: Math.max(0, total),
    nextSelectedIds,
    affected,
  };
}

/**
 * Full recalculation from questions that still exist (for legacy exams where
 * questions were deleted before delete-time regrade existed).
 */
export function recomputeCourseAttemptFromRemainingQuestions(input: {
  selectedQuestionIds: unknown;
  remainingExamQuestionIds: number[];
  remainingAnswers: Array<{ questionId: number; isCorrect: boolean }>;
}): Omit<CourseAttemptRegradeResult, 'affected'> {
  const remainingSet = new Set(input.remainingExamQuestionIds);
  const selected = parseSelectedQuestionIds(input.selectedQuestionIds);
  const nextSelectedIds = selected
    ? selected.filter((id) => remainingSet.has(id))
    : null;

  const scopedAnswers = nextSelectedIds
    ? input.remainingAnswers.filter((a) => nextSelectedIds.includes(a.questionId))
    : input.remainingAnswers.filter((a) => remainingSet.has(a.questionId));

  const obtained = scopedAnswers.reduce((sum, a) => sum + (a.isCorrect ? 1 : 0), 0);
  const total = nextSelectedIds ? nextSelectedIds.length : remainingSet.size;

  return {
    obtained,
    total: Math.max(0, total),
    nextSelectedIds,
  };
}

export function recomputeLectureSubmissionFromRemainingQuestions(input: {
  selectedQuestionIds: unknown;
  remainingQuestions: Array<{ id: number; grade: number }>;
  remainingAnswers: Array<{ questionId: number; isCorrect: boolean; grade: number }>;
}): Omit<LectureSubmissionRegradeResult, 'affected'> {
  const remainingById = new Map(input.remainingQuestions.map((q) => [q.id, q.grade]));
  const selected = parseSelectedQuestionIds(input.selectedQuestionIds);
  const nextSelectedIds = selected
    ? selected.filter((id) => remainingById.has(id))
    : null;

  const questionIdsForMax = nextSelectedIds ?? [...remainingById.keys()];
  const maxGrade = questionIdsForMax.reduce(
    (sum, id) => sum + (remainingById.get(id) ?? 0),
    0,
  );

  const scopedAnswers = input.remainingAnswers.filter((a) =>
    questionIdsForMax.includes(a.questionId),
  );
  const obtained = scopedAnswers.reduce((sum, a) => {
    if (!a.isCorrect) return sum;
    const g = Number(a.grade);
    if (Number.isFinite(g) && g > 0) return sum + g;
    return sum + (remainingById.get(a.questionId) ?? 1);
  }, 0);

  const passed = maxGrade > 0 ? obtained >= Math.ceil(maxGrade / 2) : false;

  return {
    obtained,
    maxGrade: Math.max(0, maxGrade),
    passed,
    nextSelectedIds,
  };
}

export type LectureSubmissionRegradeInput = {
  deletedQuestionId: number;
  deletedQuestionGrade: number;
  selectedQuestionIds: unknown;
  /** Remaining exam questions: id + grade */
  remainingQuestions: Array<{ id: number; grade: number }>;
  /** Remaining answers after CASCADE (grade awarded, is_correct) */
  remainingAnswers: Array<{ questionId: number; isCorrect: boolean; grade: number }>;
};

export type LectureSubmissionRegradeResult = {
  obtained: number;
  maxGrade: number;
  passed: boolean;
  nextSelectedIds: number[] | null;
  affected: boolean;
};

export function recomputeLectureSubmissionAfterQuestionDelete(
  input: LectureSubmissionRegradeInput,
): LectureSubmissionRegradeResult {
  const remainingById = new Map(input.remainingQuestions.map((q) => [q.id, q.grade]));
  const selected = parseSelectedQuestionIds(input.selectedQuestionIds);

  let nextSelectedIds: number[] | null = null;
  let affected = false;

  if (selected) {
    affected = selected.includes(input.deletedQuestionId);
    nextSelectedIds = selected.filter(
      (id) => id !== input.deletedQuestionId && remainingById.has(id),
    );
  } else {
    affected = true;
  }

  const questionIdsForMax = nextSelectedIds ?? [...remainingById.keys()];
  const maxGrade = questionIdsForMax.reduce(
    (sum, id) => sum + (remainingById.get(id) ?? 0),
    0,
  );

  const scopedAnswers = input.remainingAnswers.filter((a) =>
    questionIdsForMax.includes(a.questionId),
  );
  const obtained = scopedAnswers.reduce((sum, a) => {
    if (!a.isCorrect) return sum;
    // Prefer stored answer grade; fall back to question grade
    const g = Number(a.grade);
    if (Number.isFinite(g) && g > 0) return sum + g;
    return sum + (remainingById.get(a.questionId) ?? 1);
  }, 0);

  const passed = maxGrade > 0 ? obtained >= Math.ceil(maxGrade / 2) : false;

  return {
    obtained,
    maxGrade: Math.max(0, maxGrade),
    passed,
    nextSelectedIds,
    affected,
  };
}

export type AssignmentSubmissionRegradeInput = {
  remainingQuestionCount: number;
  remainingAnswers: Array<{ isCorrect: boolean }>;
};

export function recomputeAssignmentSubmissionAfterQuestionDelete(
  input: AssignmentSubmissionRegradeInput,
): {
  totalQuestions: number;
  correctAnswers: number;
  wrongAnswers: number;
  score: number;
} {
  const totalQuestions = Math.max(0, Number(input.remainingQuestionCount) || 0);
  const correctAnswers = input.remainingAnswers.reduce(
    (sum, a) => sum + (a.isCorrect ? 1 : 0),
    0,
  );
  const wrongAnswers = Math.max(0, totalQuestions - correctAnswers);
  const score =
    totalQuestions > 0
      ? Math.round((correctAnswers / totalQuestions) * 10000) / 100
      : 0;
  return { totalQuestions, correctAnswers, wrongAnswers, score };
}

/** Exam-level total after delete: sum of remaining question grades. */
export function sumRemainingQuestionGrades(
  remainingQuestions: Array<{ grade: number | null | undefined }>,
): number {
  return remainingQuestions.reduce((sum, q) => {
    const g = Number(q.grade);
    return sum + (Number.isFinite(g) && g > 0 ? g : 1);
  }, 0);
}
