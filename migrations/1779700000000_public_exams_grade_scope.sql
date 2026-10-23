-- Public Exams: grade-scoped course_level_exams (exam_scope = 'public')
-- Reuses the same questions / attempts / answers / grading tables.

-- Up
ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS exam_scope TEXT NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS grade_id INTEGER REFERENCES grades(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- Allow public exams without a course
ALTER TABLE course_level_exams
  ALTER COLUMN course_id DROP NOT NULL;

-- Backfill teacher_id for existing course exams
UPDATE course_level_exams e
SET teacher_id = c.teacher_id
FROM courses c
WHERE e.course_id = c.id
  AND e.teacher_id IS NULL;

UPDATE course_level_exams
SET exam_scope = 'course'
WHERE exam_scope IS NULL OR exam_scope = '';

ALTER TABLE course_level_exams
  DROP CONSTRAINT IF EXISTS course_level_exams_exam_scope_check;

ALTER TABLE course_level_exams
  ADD CONSTRAINT course_level_exams_exam_scope_check CHECK (
    exam_scope IN ('course', 'public')
  );

ALTER TABLE course_level_exams
  DROP CONSTRAINT IF EXISTS course_level_exams_scope_shape_check;

ALTER TABLE course_level_exams
  ADD CONSTRAINT course_level_exams_scope_shape_check CHECK (
    (
      exam_scope = 'course'
      AND course_id IS NOT NULL
    )
    OR (
      exam_scope = 'public'
      AND course_id IS NULL
      AND grade_id IS NOT NULL
      AND teacher_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS idx_course_level_exams_exam_scope
  ON course_level_exams(exam_scope);

CREATE INDEX IF NOT EXISTS idx_course_level_exams_grade_id
  ON course_level_exams(grade_id)
  WHERE exam_scope = 'public';

CREATE INDEX IF NOT EXISTS idx_course_level_exams_public_teacher
  ON course_level_exams(teacher_id)
  WHERE exam_scope = 'public';

CREATE UNIQUE INDEX IF NOT EXISTS uq_public_exams_teacher_grade_title
  ON course_level_exams(teacher_id, grade_id, title)
  WHERE exam_scope = 'public';

COMMENT ON COLUMN course_level_exams.exam_scope IS
  'course = course-level comprehensive exam; public = grade-scoped public exam (no course)';
COMMENT ON COLUMN course_level_exams.grade_id IS
  'Required for public exams; student eligibility via user_grades';
COMMENT ON COLUMN course_level_exams.teacher_id IS
  'Owner teacher; required for public exams; backfilled for course exams';
COMMENT ON COLUMN course_level_exams.description IS
  'Optional exam description (used by public exams)';

-- Down
-- DROP INDEX IF EXISTS uq_public_exams_teacher_grade_title;
-- DROP INDEX IF EXISTS idx_course_level_exams_public_teacher;
-- DROP INDEX IF EXISTS idx_course_level_exams_grade_id;
-- DROP INDEX IF EXISTS idx_course_level_exams_exam_scope;
-- ALTER TABLE course_level_exams DROP CONSTRAINT IF EXISTS course_level_exams_scope_shape_check;
-- ALTER TABLE course_level_exams DROP CONSTRAINT IF EXISTS course_level_exams_exam_scope_check;
-- DELETE FROM course_level_exams WHERE exam_scope = 'public';
-- ALTER TABLE course_level_exams ALTER COLUMN course_id SET NOT NULL;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS description;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS teacher_id;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS grade_id;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS exam_scope;
