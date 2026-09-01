import { describe, expect, it } from 'vitest';

import {
  canResumeCourseAttempt,
  collectCourseExamAnswersFromBody,
  computeAttemptExpireAt,
  gradeCourseAttemptAnswers,
  isAttemptExpired,
  isDurationUnlimited,
  mergeSavedAndSubmittedAnswers,
  normalizeDurationMinutes,
  parseCourseExamSelectedAnswer,
  remainingSeconds,
} from '../courseLevelExamAttemptPolicy';

const startedAt = new Date('2026-09-02T10:00:00Z');
const now = new Date('2026-09-02T10:10:00Z');

describe('duration unlimited', () => {
  it('treats null, undefined, and 0 as unlimited', () => {
    expect(isDurationUnlimited(null)).toBe(true);
    expect(isDurationUnlimited(undefined)).toBe(true);
    expect(isDurationUnlimited(0)).toBe(true);
    expect(isDurationUnlimited(45)).toBe(false);
    expect(normalizeDurationMinutes(0)).toBeNull();
    expect(normalizeDurationMinutes(0.4)).toBeNull();
    expect(normalizeDurationMinutes(60)).toBe(60);
  });
});

describe('computeAttemptExpireAt', () => {
  it('uses started_at + duration when there is no exam end date', () => {
    const expire = computeAttemptExpireAt({ startedAt, durationMinutes: 60 });
    expect(expire?.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  });

  it('uses visibility_end_date when duration is unlimited', () => {
    const expire = computeAttemptExpireAt({
      startedAt,
      durationMinutes: null,
      visibilityEndDate: '2026-09-02T18:00:00Z',
    });
    expect(expire?.toISOString()).toBe('2026-09-02T18:00:00.000Z');
  });

  it('takes the earlier of duration end and exam end date', () => {
    const expire = computeAttemptExpireAt({
      startedAt,
      durationMinutes: 120,
      visibilityEndDate: '2026-09-02T10:30:00Z',
    });
    expect(expire?.toISOString()).toBe('2026-09-02T10:30:00.000Z');
  });

  it('returns null when duration is unlimited and there is no end date', () => {
    expect(
      computeAttemptExpireAt({ startedAt, durationMinutes: 0, visibilityEndDate: null }),
    ).toBeNull();
  });
});

describe('remainingSeconds / expiry', () => {
  it('clamps remaining seconds at 0 after expire', () => {
    expect(remainingSeconds('2026-09-02T10:05:00Z', now)).toBe(0);
    expect(remainingSeconds('2026-09-02T10:10:00Z', now)).toBe(0);
    expect(remainingSeconds('2026-09-02T10:15:00Z', now)).toBe(300);
  });

  it('returns null remaining seconds when there is no expire_at (unlimited)', () => {
    expect(remainingSeconds(null, now)).toBeNull();
    expect(isAttemptExpired(null, now)).toBe(false);
    expect(canResumeCourseAttempt(null, now)).toBe(true);
  });

  it('allows resume only while attempt_expire_at is in the future', () => {
    expect(canResumeCourseAttempt('2026-09-02T10:20:00Z', now)).toBe(true);
    expect(canResumeCourseAttempt('2026-09-02T10:00:00Z', now)).toBe(false);
    expect(isAttemptExpired('2026-09-02T10:10:00Z', now)).toBe(true);
  });
});

describe('answers merge and grading', () => {
  it('parses A-D, a-d, and 0-3 indexes', () => {
    expect(parseCourseExamSelectedAnswer('c')).toBe('C');
    expect(parseCourseExamSelectedAnswer(2)).toBe('C');
    expect(parseCourseExamSelectedAnswer('optionB')).toBe('B');
    expect(parseCourseExamSelectedAnswer('Z')).toBeNull();
  });

  it('lets submitted answers override autosaved ones', () => {
    const merged = mergeSavedAndSubmittedAnswers(
      [
        { questionId: 1, selectedAnswer: 'A' },
        { questionId: 2, selectedAnswer: 'B' },
      ],
      [{ questionId: 2, selectedAnswer: 'D' }],
    );
    expect(merged).toEqual([
      { questionId: 1, selectedAnswer: 'A' },
      { questionId: 2, selectedAnswer: 'D' },
    ]);
  });

  it('grades unanswered questions as wrong', () => {
    const graded = gradeCourseAttemptAnswers({
      questionIds: [1, 2, 3],
      correctByQuestionId: { 1: 'A', 2: 'B', 3: 'C' },
      answers: [{ questionId: 1, selectedAnswer: 'A' }],
    });
    expect(graded.maxGrade).toBe(3);
    expect(graded.obtained).toBe(1);
    expect(graded.correctCount).toBe(1);
    expect(graded.results[1].isCorrect).toBe(false);
    expect(graded.results[1].selectedAnswer).toBeNull();
  });

  it('collects answers from array, parallel arrays, or map payloads', () => {
    expect(
      collectCourseExamAnswersFromBody({
        answers: [{ questionId: 1, selectedAnswer: 'A' }],
      }).hasPayload,
    ).toBe(true);
    expect(
      collectCourseExamAnswersFromBody({
        questionIds: [1],
        selectedAnswers: ['B'],
      }).answers,
    ).toEqual([{ questionId: 1, selectedAnswer: 'B' }]);
    expect(collectCourseExamAnswersFromBody({ answers: { '4': 'D' } }).answers).toEqual([
      { questionId: 4, selectedAnswer: 'D' },
    ]);
    expect(collectCourseExamAnswersFromBody({}).hasPayload).toBe(false);
  });
});
