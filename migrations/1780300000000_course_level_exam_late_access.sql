-- Extra attempt for one student after a course/public exam window ends or the attempt limit is used.

CREATE TABLE IF NOT EXISTS course_level_exam_late_access (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  remaining_attempts INTEGER NOT NULL DEFAULT 1 CHECK (remaining_attempts >= 0),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_course_level_exam_late_access_student
  ON course_level_exam_late_access(student_id);

COMMENT ON TABLE course_level_exam_late_access IS
  'محاولة إضافية لطالب واحد على امتحان شامل بعد انتهاء الوقت أو استنفاد المحاولات';
