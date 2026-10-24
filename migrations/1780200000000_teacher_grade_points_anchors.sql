-- Per-grade points window: teacher chooses which course exam starts the ranking season.
-- Points count for that exam and every later course exam until the teacher resets and picks a new start.

CREATE TABLE IF NOT EXISTS teacher_grade_points_anchors (
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
  start_exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (teacher_id, grade_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_grade_points_anchors_exam
  ON teacher_grade_points_anchors(start_exam_id);

COMMENT ON TABLE teacher_grade_points_anchors IS
  'امتحان بداية حساب نقاط الترتيب لكل صف عند المدرس — يُحسب هو وكل ما بعده حتى التصفير';
