import { describe, expect, it } from 'vitest';

import {
  canStudentStartExam,
  getStudentExamAvailability,
  selectAttemptQuestions,
  shouldListExamForStudent,
} from '../examAccessPolicy';

const now = new Date('2026-08-30T12:00:00Z');

describe('getStudentExamAvailability', () => {
  it('hides teacher-hidden exams', () => {
    expect(getStudentExamAvailability({ isVisible: false }, now)).toBe('hidden');
  });

  it('hides incomplete exams until the configured question count is met', () => {
    expect(
      getStudentExamAvailability(
        { isVisible: true, questionsCount: 10, actualQuestionsCount: 7 },
        now,
      ),
    ).toBe('incomplete');
  });

  it('becomes listable when the actual count meets or exceeds the requirement', () => {
    expect(
      getStudentExamAvailability(
        { isVisible: true, questionsCount: 10, actualQuestionsCount: 10 },
        now,
      ),
    ).toBe('open');
    expect(
      getStudentExamAvailability(
        { isVisible: true, questionsCount: 10, actualQuestionsCount: 12 },
        now,
      ),
    ).toBe('open');
  });

  it('is upcoming before the show date', () => {
    expect(
      getStudentExamAvailability(
        { isVisible: true, showAt: '2026-08-30T18:00:00Z', questionsCount: 5, actualQuestionsCount: 5 },
        now,
      ),
    ).toBe('upcoming');
  });

  it('is expired after the expire date and still listed but not startable', () => {
    const input = {
      isVisible: true,
      showAt: '2026-08-01T00:00:00Z',
      expireAt: '2026-08-30T10:00:00Z',
      questionsCount: 5,
      actualQuestionsCount: 5,
    };
    expect(getStudentExamAvailability(input, now)).toBe('expired');
    expect(shouldListExamForStudent(input, now)).toBe(true);
    expect(canStudentStartExam(input, now)).toBe(false);
  });

  it('stays open when there is no expire date', () => {
    expect(
      getStudentExamAvailability(
        { isVisible: true, showAt: '2026-08-01T00:00:00Z', questionsCount: 3, actualQuestionsCount: 3 },
        now,
      ),
    ).toBe('open');
  });

  it('allows the helper to resume an in-progress attempt after the window (lecture exams)', () => {
    const input = {
      isVisible: true,
      expireAt: '2026-08-30T10:00:00Z',
      questionsCount: 2,
      actualQuestionsCount: 2,
    };
    expect(canStudentStartExam(input, now, { hasInProgressAttempt: true })).toBe(true);
    expect(canStudentStartExam(input, now)).toBe(false);
  });

  it('does not list upcoming or incomplete exams', () => {
    expect(
      shouldListExamForStudent(
        { isVisible: true, showAt: '2026-09-01T00:00:00Z', questionsCount: 4, actualQuestionsCount: 4 },
        now,
      ),
    ).toBe(false);
    expect(
      shouldListExamForStudent(
        { isVisible: true, questionsCount: 8, actualQuestionsCount: 2 },
        now,
      ),
    ).toBe(false);
  });
});

describe('selectAttemptQuestions', () => {
  const ids = [11, 12, 13, 14, 15];

  it('returns the first N ids in ordered mode', () => {
    expect(selectAttemptQuestions(ids, 3, 'ordered')).toEqual([11, 12, 13]);
  });

  it('returns N random ids deterministically for the same seed', () => {
    const a = selectAttemptQuestions(ids, 3, 'random', 'exam:1:1');
    const b = selectAttemptQuestions(ids, 3, 'random', 'exam:1:1');
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it('shuffles the full list for a random seed instead of keeping insertion order', () => {
    const shuffled = selectAttemptQuestions(ids, ids.length, 'random', 'seed-a');
    expect(shuffled).toHaveLength(ids.length);
    expect([...shuffled].sort((x, y) => x - y)).toEqual(ids);
    expect(shuffled).not.toEqual(ids);
  });

  it('reuses stored ids for resume by returning them unchanged when already selected', () => {
    const stored = [15, 11, 13];
    expect(selectAttemptQuestions(stored, stored.length, 'ordered')).toEqual(stored);
  });
});
