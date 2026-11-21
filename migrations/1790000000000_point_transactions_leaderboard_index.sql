-- Speed up eligible-points SUM used by teacher ranking / student ledger.
CREATE INDEX IF NOT EXISTS idx_point_transactions_teacher_grade_student
  ON point_transactions (teacher_id, grade_id, student_id);
