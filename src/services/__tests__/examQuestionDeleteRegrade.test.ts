import { describe, expect, it } from 'vitest';

import {
  recomputeAssignmentSubmissionAfterQuestionDelete,
  recomputeCourseAttemptAfterQuestionDelete,
  recomputeCourseAttemptFromRemainingQuestions,
  recomputeLectureSubmissionAfterQuestionDelete,
  recomputeLectureSubmissionFromRemainingQuestions,
  sumRemainingQuestionGrades,
} from '../examQuestionDeleteRegrade';

describe('recomputeCourseAttemptAfterQuestionDelete', () => {
  const remainingIds = Array.from({ length: 18 }, (_, i) => i + 1);

  it('drops points when deleted questions were answered correctly (16/20 → 14/18)', () => {
    // Student had 16/20; deleted Q19+Q20 were both correct → remaining 14 correct of 18
    const remainingAnswers = Array.from({ length: 18 }, (_, i) => ({
      questionId: i + 1,
      isCorrect: i < 14,
    }));
    const result = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 19,
      selectedQuestionIds: Array.from({ length: 20 }, (_, i) => i + 1),
      remainingExamQuestionIds: remainingIds,
      remainingAnswers,
    });
    expect(result.obtained).toBe(14);
    expect(result.total).toBe(18);
    expect(result.affected).toBe(true);
    expect(result.nextSelectedIds).toHaveLength(18);
  });

  it('does not subtract extra when deleted answers were wrong (18/20 with 1/2 correct → 17/18)', () => {
    // After removing Q19 (correct) and we only delete one here: start from remaining answers
    // Simulate after deleting Q20 (wrong): 18 correct remain among 19 then delete Q19...
    // Direct case: remaining 17 correct of 18 after deleting two (one correct one wrong)
    const remainingAnswers = Array.from({ length: 18 }, (_, i) => ({
      questionId: i + 1,
      isCorrect: i < 17,
    }));
    const result = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 20,
      selectedQuestionIds: Array.from({ length: 20 }, (_, i) => i + 1),
      remainingExamQuestionIds: remainingIds,
      remainingAnswers,
    });
    expect(result.obtained).toBe(17);
    expect(result.total).toBe(18);
  });

  it('only shrinks max when deleted answers were all wrong', () => {
    const remainingAnswers = Array.from({ length: 18 }, (_, i) => ({
      questionId: i + 1,
      isCorrect: i < 16,
    }));
    const result = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 19,
      selectedQuestionIds: null, // full exam
      remainingExamQuestionIds: remainingIds,
      remainingAnswers,
    });
    expect(result.obtained).toBe(16);
    expect(result.total).toBe(18);
  });

  it('does not change score when deleted question was outside selected set', () => {
    const selected = [1, 2, 3, 4, 5];
    const remainingAnswers = selected.map((id) => ({ questionId: id, isCorrect: true }));
    const result = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 99,
      selectedQuestionIds: selected,
      remainingExamQuestionIds: [...selected, 6, 7, 8],
      remainingAnswers,
    });
    expect(result.affected).toBe(false);
    expect(result.obtained).toBe(5);
    expect(result.total).toBe(5);
  });

  it('is idempotent when deleted id already absent from remaining data', () => {
    const remainingAnswers = remainingIds.map((id) => ({
      questionId: id,
      isCorrect: id <= 10,
    }));
    const first = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 19,
      selectedQuestionIds: remainingIds,
      remainingExamQuestionIds: remainingIds,
      remainingAnswers,
    });
    const second = recomputeCourseAttemptAfterQuestionDelete({
      deletedQuestionId: 19,
      selectedQuestionIds: first.nextSelectedIds,
      remainingExamQuestionIds: remainingIds,
      remainingAnswers,
    });
    expect(second.obtained).toBe(first.obtained);
    expect(second.total).toBe(first.total);
  });
});

describe('recomputeLectureSubmissionAfterQuestionDelete', () => {
  it('recomputes obtained and max from remaining weighted grades', () => {
    const remainingQuestions = [
      { id: 1, grade: 2 },
      { id: 2, grade: 2 },
      { id: 3, grade: 1 },
    ];
    const result = recomputeLectureSubmissionAfterQuestionDelete({
      deletedQuestionId: 4,
      deletedQuestionGrade: 1,
      selectedQuestionIds: [1, 2, 3, 4],
      remainingQuestions,
      remainingAnswers: [
        { questionId: 1, isCorrect: true, grade: 2 },
        { questionId: 2, isCorrect: false, grade: 0 },
        { questionId: 3, isCorrect: true, grade: 1 },
      ],
    });
    expect(result.obtained).toBe(3);
    expect(result.maxGrade).toBe(5);
    expect(result.passed).toBe(true); // 3 >= ceil(5/2)=3
  });
});

describe('recomputeAssignmentSubmissionAfterQuestionDelete', () => {
  it('updates percentage from remaining answers', () => {
    const result = recomputeAssignmentSubmissionAfterQuestionDelete({
      remainingQuestionCount: 18,
      remainingAnswers: Array.from({ length: 18 }, (_, i) => ({ isCorrect: i < 14 })),
    });
    expect(result.totalQuestions).toBe(18);
    expect(result.correctAnswers).toBe(14);
    expect(result.wrongAnswers).toBe(4);
    expect(result.score).toBeCloseTo((14 / 18) * 100, 2);
  });
});

describe('sumRemainingQuestionGrades', () => {
  it('sums grades and defaults missing to 1', () => {
    expect(sumRemainingQuestionGrades([{ grade: 1 }, { grade: 1 }, { grade: null }])).toBe(3);
  });
});

describe('recompute*FromRemainingQuestions (legacy backfill)', () => {
  it('fixes stale 20-max attempt down to 18 remaining questions', () => {
    const remainingIds = Array.from({ length: 18 }, (_, i) => i + 1);
    const result = recomputeCourseAttemptFromRemainingQuestions({
      selectedQuestionIds: Array.from({ length: 20 }, (_, i) => i + 1),
      remainingExamQuestionIds: remainingIds,
      remainingAnswers: remainingIds.map((id) => ({
        questionId: id,
        isCorrect: id <= 14,
      })),
    });
    expect(result.total).toBe(18);
    expect(result.obtained).toBe(14);
    expect(result.nextSelectedIds).toEqual(remainingIds);
  });

  it('recomputes lecture obtained/max from remaining questions only', () => {
    const result = recomputeLectureSubmissionFromRemainingQuestions({
      selectedQuestionIds: [1, 2, 3],
      remainingQuestions: [
        { id: 1, grade: 1 },
        { id: 2, grade: 1 },
      ],
      remainingAnswers: [
        { questionId: 1, isCorrect: true, grade: 1 },
        { questionId: 2, isCorrect: true, grade: 1 },
      ],
    });
    expect(result.maxGrade).toBe(2);
    expect(result.obtained).toBe(2);
    expect(result.nextSelectedIds).toEqual([1, 2]);
  });
});
