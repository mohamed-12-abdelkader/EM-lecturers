import type { Pool } from 'pg';
import pool from '../db/pool';

export type CourseExamPointsAttemptMode = 'first' | 'last' | 'highest' | 'second';

export type CourseExamPointsAttemptRow = {
  id: number;
  attempt_number: number;
  obtained_grade: number | null;
  total_grade: number | null;
  submitted_at: Date | string | null;
};

/** Resolve pg Pool across CJS/ESM default-export interop shapes. */
function resolvePgPool(modOrPool: unknown): Pool {
  const candidates = [
    modOrPool,
    (modOrPool as { default?: unknown })?.default,
    (modOrPool as { default?: { default?: unknown } })?.default?.default,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof (candidate as { query?: unknown }).query === 'function') {
      return candidate as Pool;
    }
  }
  throw new Error('pool.query is not a function (invalid pg pool export)');
}

const db = resolvePgPool(pool);

const MODES = new Set<CourseExamPointsAttemptMode>([
  'first',
  'last',
  'highest',
  'second',
]);

/** Default matches historical live award (first successful score insert). */
export function normalizeCourseExamPointsAttemptMode(
  value: unknown,
): CourseExamPointsAttemptMode {
  const raw = String(value ?? 'first')
    .trim()
    .toLowerCase();
  if (MODES.has(raw as CourseExamPointsAttemptMode)) {
    return raw as CourseExamPointsAttemptMode;
  }
  return 'first';
}

export function isCourseExamPointsEnabled(exam: {
  points_enabled?: unknown;
}): boolean {
  // Missing column / undefined → treat as enabled (legacy exams).
  if (exam?.points_enabled === false || exam?.points_enabled === 'false') {
    return false;
  }
  return true;
}

/**
 * Pick the submitted attempt that should feed EXAM_SCORE for this student.
 * If the target attempt does not exist (e.g. mode=second with only 1 attempt),
 * fall back to the last available submitted attempt.
 */
export function selectCourseExamPointsAttempt(
  attempts: CourseExamPointsAttemptRow[],
  mode: CourseExamPointsAttemptMode,
): CourseExamPointsAttemptRow | null {
  if (!attempts.length) return null;
  const ordered = [...attempts].sort(
    (a, b) =>
      Number(a.attempt_number) - Number(b.attempt_number) ||
      Number(a.id) - Number(b.id),
  );
  const last = ordered[ordered.length - 1]!;

  switch (mode) {
    case 'first':
      return ordered[0]!;
    case 'last':
      return last;
    case 'second':
      return ordered[1] ?? last;
    case 'highest': {
      return ordered.reduce((best, cur) => {
        const bestScore = Math.max(0, Number(best.obtained_grade) || 0);
        const curScore = Math.max(0, Number(cur.obtained_grade) || 0);
        if (curScore > bestScore) return cur;
        if (curScore < bestScore) return best;
        // Tie: prefer later attempt.
        if (Number(cur.attempt_number) > Number(best.attempt_number)) return cur;
        if (Number(cur.id) > Number(best.id)) return cur;
        return best;
      });
    }
    default:
      return ordered[0]!;
  }
}

export async function resolveCourseExamPointsAttempt(opts: {
  examId: number;
  studentId: number;
  mode?: unknown;
}): Promise<CourseExamPointsAttemptRow | null> {
  const mode = normalizeCourseExamPointsAttemptMode(opts.mode);
  const res = await db.query<CourseExamPointsAttemptRow>(
    `SELECT id, attempt_number, obtained_grade, total_grade, submitted_at
     FROM course_level_exam_attempts
     WHERE exam_id = $1
       AND student_id = $2
       AND status = 'submitted'
     ORDER BY attempt_number ASC, id ASC`,
    [opts.examId, opts.studentId],
  );
  return selectCourseExamPointsAttempt(res.rows, mode);
}
