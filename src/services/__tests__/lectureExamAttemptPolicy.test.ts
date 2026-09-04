import { describe, expect, it } from 'vitest';

import {
  canResumeCourseAttempt,
  computeLectureAttemptExpireAt,
  isAttemptExpired,
  isDurationUnlimited,
  lectureChoiceDisplay,
  lectureDurationDbFields,
  mergeSavedAndSubmittedLectureAnswers,
  normalizeDurationMinutes,
  parseLectureDurationInput,
  parseLectureExamAnswerItem,
  parseLectureExamChoiceId,
  remainingSeconds,
} from '../lectureExamAttemptPolicy';

const startedAt = new Date('2026-09-02T10:00:00Z');
const now = new Date('2026-09-02T10:10:00Z');

describe('lecture duration unlimited', () => {
  it('treats null, 0, unlimited, and empty as unlimited', () => {
    expect(isDurationUnlimited(null)).toBe(true);
    expect(isDurationUnlimited(0)).toBe(true);
    expect(parseLectureDurationInput('unlimited')).toBeNull();
    expect(parseLectureDurationInput('')).toBeNull();
    expect(parseLectureDurationInput(0)).toBeNull();
    expect(parseLectureDurationInput(45)).toBe(45);
    expect(normalizeDurationMinutes(60)).toBe(60);
  });

  it('syncs time_limit_* from duration', () => {
    expect(lectureDurationDbFields(null)).toEqual({
      duration: null,
      time_limit_enabled: false,
      time_limit_minutes: null,
    });
    expect(lectureDurationDbFields(30)).toEqual({
      duration: 30,
      time_limit_enabled: true,
      time_limit_minutes: 30,
    });
  });
});

describe('computeLectureAttemptExpireAt', () => {
  it('uses started_at + duration when there is no exam end date', () => {
    const expire = computeLectureAttemptExpireAt({ startedAt, duration: 60 });
    expect(expire?.toISOString()).toBe('2026-09-02T11:00:00.000Z');
  });

  it('uses hide_at when duration is unlimited', () => {
    const expire = computeLectureAttemptExpireAt({
      startedAt,
      duration: null,
      hideAt: '2026-09-02T18:00:00Z',
    });
    expect(expire?.toISOString()).toBe('2026-09-02T18:00:00.000Z');
  });

  it('takes the earlier of duration end and hide_at', () => {
    const expire = computeLectureAttemptExpireAt({
      startedAt,
      duration: 120,
      hideAt: '2026-09-02T10:30:00Z',
    });
    expect(expire?.toISOString()).toBe('2026-09-02T10:30:00.000Z');
  });

  it('returns null when unlimited and there is no end date', () => {
    expect(computeLectureAttemptExpireAt({ startedAt, duration: 0, hideAt: null })).toBeNull();
  });
});

describe('remainingSeconds / expiry', () => {
  it('allows resume only while attempt_expire_at is in the future', () => {
    expect(remainingSeconds(null, now)).toBeNull();
    expect(isAttemptExpired(null, now)).toBe(false);
    expect(canResumeCourseAttempt(null, now)).toBe(true);
    expect(canResumeCourseAttempt('2026-09-02T10:20:00Z', now)).toBe(true);
    expect(isAttemptExpired('2026-09-02T10:10:00Z', now)).toBe(true);
  });
});

describe('choice answers merge', () => {
  it('parses choice ids including default negative letters', () => {
    expect(parseLectureExamChoiceId(-1)).toBe(-1);
    expect(parseLectureExamChoiceId('B')).toBe(-2);
    expect(parseLectureExamChoiceId(12)).toBe(12);
    expect(parseLectureExamChoiceId(0)).toBeNull();
    expect(parseLectureExamAnswerItem({ questionId: 3, choiceId: -2 })).toEqual({
      questionId: 3,
      choiceId: -2,
    });
  });

  it('maps default negative choice ids to letters', () => {
    expect(lectureChoiceDisplay(-1)).toEqual({ letter: 'A', text: 'أ' });
    expect(lectureChoiceDisplay(-2)).toEqual({ letter: 'B', text: 'ب' });
    expect(lectureChoiceDisplay(null)).toEqual({ letter: null, text: null });
  });

  it('lets submitted answers override autosaved ones', () => {
    const merged = mergeSavedAndSubmittedLectureAnswers(
      [
        { questionId: 1, choiceId: 10 },
        { questionId: 2, choiceId: 20 },
      ],
      [{ questionId: 2, choiceId: 99 }],
    );
    expect(merged).toEqual([
      { questionId: 1, choiceId: 10 },
      { questionId: 2, choiceId: 99 },
    ]);
  });

  it('grades unanswered as missing from the merged set (evaluateAnswers fills wrong)', () => {
    const merged = mergeSavedAndSubmittedLectureAnswers(
      [{ questionId: 1, choiceId: 10 }],
      [],
    );
    expect(merged.map((a) => a.questionId)).toEqual([1]);
  });
});
