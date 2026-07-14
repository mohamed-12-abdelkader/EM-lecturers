import pool from '../db/pool';

/** Parse grade_ids from JSON array, comma string, or single grade_id. */
export function parseGradeIdsInput(raw: unknown): number[] {
  if (raw === undefined || raw === null || raw === '') return [];

  if (Array.isArray(raw)) {
    return [
      ...new Set(
        raw
          .map((x) => Number(x))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  }

  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) {
    return [raw];
  }

  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith('[')) {
      try {
        return parseGradeIdsInput(JSON.parse(s));
      } catch {
        return [];
      }
    }
    return [
      ...new Set(
        s
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    ];
  }

  return [];
}

/** Resolve grade_ids from body: prefer grade_ids, fallback to grade_id. */
export function resolveCourseGradeIds(body: Record<string, unknown>): number[] {
  if (body.grade_ids !== undefined && body.grade_ids !== null && body.grade_ids !== '') {
    return parseGradeIdsInput(body.grade_ids);
  }
  if (body.grade_id !== undefined && body.grade_id !== null && body.grade_id !== '') {
    return parseGradeIdsInput(body.grade_id);
  }
  return [];
}

export async function assertGradesExist(gradeIds: number[]): Promise<void> {
  if (!gradeIds.length) {
    const err: any = new Error('At least one grade is required');
    err.status = 400;
    err.code = 'GRADE_IDS_REQUIRED';
    throw err;
  }
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM grades WHERE id = ANY($1::int[])`,
    [gradeIds],
  );
  if (res.rowCount !== gradeIds.length) {
    const found = new Set(res.rows.map((r) => r.id));
    const missing = gradeIds.filter((id) => !found.has(id));
    const err: any = new Error(`Invalid grade ids: ${missing.join(', ')}`);
    err.status = 400;
    err.code = 'INVALID_GRADE_IDS';
    throw err;
  }
}

export async function syncCourseGrades(courseId: number, gradeIds: number[]): Promise<void> {
  await assertGradesExist(gradeIds);
  await pool.query(`DELETE FROM course_grades WHERE course_id = $1`, [courseId]);
  await pool.query(
    `INSERT INTO course_grades (course_id, grade_id)
     SELECT $1, unnest($2::int[])`,
    [courseId, gradeIds],
  );
  // Keep courses.grade_id as primary (first) for chat / legacy
  await pool.query(`UPDATE courses SET grade_id = $1 WHERE id = $2`, [gradeIds[0], courseId]);
}

export async function getCourseGradeIds(courseId: number): Promise<number[]> {
  const res = await pool.query<{ grade_id: number }>(
    `SELECT grade_id FROM course_grades WHERE course_id = $1 ORDER BY grade_id`,
    [courseId],
  );
  if (res.rowCount) return res.rows.map((r) => r.grade_id);

  const legacy = await pool.query<{ grade_id: number | null }>(
    `SELECT grade_id FROM courses WHERE id = $1`,
    [courseId],
  );
  const g = legacy.rows[0]?.grade_id;
  return g ? [g] : [];
}

export async function getCourseGradesMap(
  courseIds: number[],
): Promise<Map<number, Array<{ id: number; name: string }>>> {
  const map = new Map<number, Array<{ id: number; name: string }>>();
  if (!courseIds.length) return map;

  const res = await pool.query<{ course_id: number; id: number; name: string }>(
    `SELECT cg.course_id, g.id, g.name
     FROM course_grades cg
     JOIN grades g ON g.id = cg.grade_id
     WHERE cg.course_id = ANY($1::int[])
     ORDER BY g.id`,
    [courseIds],
  );

  for (const row of res.rows) {
    if (!map.has(row.course_id)) map.set(row.course_id, []);
    map.get(row.course_id)!.push({ id: row.id, name: row.name });
  }

  // Fallback for courses not yet backfilled
  const missing = courseIds.filter((id) => !map.has(id));
  if (missing.length) {
    const legacy = await pool.query<{ course_id: number; id: number; name: string }>(
      `SELECT c.id AS course_id, g.id, g.name
       FROM courses c
       JOIN grades g ON g.id = c.grade_id
       WHERE c.id = ANY($1::int[])`,
      [missing],
    );
    for (const row of legacy.rows) {
      map.set(row.course_id, [{ id: row.id, name: row.name }]);
    }
  }

  return map;
}

export function withCourseGrades<T extends { id: number; grade_id?: number | null }>(
  course: T,
  gradesMap: Map<number, Array<{ id: number; name: string }>>,
) {
  const grades = gradesMap.get(course.id) ?? [];
  return {
    ...course,
    grade_id: grades[0]?.id ?? course.grade_id ?? null,
    grade_ids: grades.map((g) => g.id),
    grades,
  };
}
