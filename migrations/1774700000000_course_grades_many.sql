-- Up Migration
-- Multi-grade courses: course can belong to many grades

CREATE TABLE IF NOT EXISTS course_grades (
  id SERIAL PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_course_grades_course ON course_grades(course_id);
CREATE INDEX IF NOT EXISTS idx_course_grades_grade ON course_grades(grade_id);

-- Backfill from existing single grade_id
INSERT INTO course_grades (course_id, grade_id)
SELECT id, grade_id
FROM courses
WHERE grade_id IS NOT NULL
ON CONFLICT (course_id, grade_id) DO NOTHING;

COMMENT ON TABLE course_grades IS 'ربط الكورس بصف أو أكثر — يظهر الكورس لكل الصفوف المختارة';

-- Down Migration
DROP INDEX IF EXISTS idx_course_grades_grade;
DROP INDEX IF EXISTS idx_course_grades_course;
DROP TABLE IF EXISTS course_grades;
