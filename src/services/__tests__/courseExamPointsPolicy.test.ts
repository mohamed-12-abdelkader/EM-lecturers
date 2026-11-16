import { describe, expect, it } from 'vitest';
import {
  normalizeCourseExamPointsAttemptMode,
  selectCourseExamPointsAttempt,
  type CourseExamPointsAttemptRow,
} from '../courseExamPointsPolicy';

function attempt(
  id: number,
  attempt_number: number,
  obtained_grade: number,
): CourseExamPointsAttemptRow {
  return {
    id,
    attempt_number,
    obtained_grade,
    total_grade: 100,
    submitted_at: null,
  };
}

describe('courseExamPointsPolicy', () => {
  it('normalizes unknown modes to first', () => {
    expect(normalizeCourseExamPointsAttemptMode('weird')).toBe('first');
    expect(normalizeCourseExamPointsAttemptMode('SECOND')).toBe('second');
  });

  it('selects first / last / second with fallback', () => {
    const one = [attempt(1, 1, 40)];
    const two = [attempt(1, 1, 40), attempt(2, 2, 70)];
    const three = [attempt(1, 1, 40), attempt(2, 2, 70), attempt(3, 3, 55)];

    expect(selectCourseExamPointsAttempt(one, 'first')?.id).toBe(1);
    expect(selectCourseExamPointsAttempt(three, 'last')?.id).toBe(3);
    expect(selectCourseExamPointsAttempt(one, 'second')?.id).toBe(1); // fallback
    expect(selectCourseExamPointsAttempt(two, 'second')?.id).toBe(2);
    expect(selectCourseExamPointsAttempt(three, 'second')?.id).toBe(2);
  });

  it('selects highest score and prefers later attempt on ties', () => {
    const rows = [
      attempt(1, 1, 80),
      attempt(2, 2, 90),
      attempt(3, 3, 90),
      attempt(4, 4, 70),
    ];
    expect(selectCourseExamPointsAttempt(rows, 'highest')?.id).toBe(3);
  });
});
