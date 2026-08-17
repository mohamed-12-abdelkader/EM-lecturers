-- Teacher question library: Grades (صفوف دراسية) → Lessons → Questions
-- Existing lessons are moved under a default grade "غير مصنف" per teacher.

BEGIN;

CREATE TABLE IF NOT EXISTS teacher_question_grades (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    platform_grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_question_grades_teacher_id
    ON teacher_question_grades(teacher_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_question_grades_teacher_title
    ON teacher_question_grades(teacher_id, title);

CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_question_grades_teacher_platform
    ON teacher_question_grades(teacher_id, platform_grade_id)
    WHERE platform_grade_id IS NOT NULL;

ALTER TABLE teacher_question_lessons
    ADD COLUMN IF NOT EXISTS grade_id INTEGER REFERENCES teacher_question_grades(id) ON DELETE CASCADE;

INSERT INTO teacher_question_grades (teacher_id, title)
SELECT DISTINCT l.teacher_id, 'غير مصنف'
FROM teacher_question_lessons l
WHERE l.grade_id IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM teacher_question_grades g
      WHERE g.teacher_id = l.teacher_id
        AND g.title = 'غير مصنف'
  );

UPDATE teacher_question_lessons l
SET grade_id = g.id
FROM teacher_question_grades g
WHERE l.teacher_id = g.teacher_id
  AND l.grade_id IS NULL
  AND g.title = 'غير مصنف';

ALTER TABLE teacher_question_lessons
    ALTER COLUMN grade_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_question_lessons_grade_id
    ON teacher_question_lessons(grade_id);

COMMIT;
