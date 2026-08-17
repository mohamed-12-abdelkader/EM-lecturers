-- Teacher Center: group exams + per-student scores (ملف الطالب)

BEGIN;

CREATE TABLE IF NOT EXISTS tc_group_exams (
  id            SERIAL PRIMARY KEY,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id      INTEGER NOT NULL REFERENCES tc_groups(id) ON DELETE CASCADE,
  title         VARCHAR(200) NOT NULL,
  total_grade   NUMERIC(8, 2) NOT NULL CHECK (total_grade > 0),
  exam_date     DATE,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tc_group_exams_group
  ON tc_group_exams(group_id, exam_date DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tc_group_exams_teacher
  ON tc_group_exams(teacher_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS tc_group_exam_grades (
  id            SERIAL PRIMARY KEY,
  teacher_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  exam_id       INTEGER NOT NULL REFERENCES tc_group_exams(id) ON DELETE CASCADE,
  student_id    INTEGER NOT NULL REFERENCES tc_students(id) ON DELETE CASCADE,
  score         NUMERIC(8, 2) CHECK (score IS NULL OR score >= 0),
  is_absent     BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT,
  recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_tc_group_exam_grades_student
  ON tc_group_exam_grades(student_id, exam_id);

CREATE INDEX IF NOT EXISTS idx_tc_group_exam_grades_exam
  ON tc_group_exam_grades(exam_id);

COMMIT;
