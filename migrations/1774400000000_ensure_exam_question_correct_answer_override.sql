-- Up Migration
-- Ensure exam_questions.correct_answer_index_override exists
-- (older migration 1700000007003 may have been skipped on some DBs)

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS correct_answer_index_override INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_correct_answer_index_override_check'
  ) THEN
    ALTER TABLE exam_questions
      ADD CONSTRAINT exam_questions_correct_answer_index_override_check
      CHECK (
        correct_answer_index_override IS NULL
        OR (correct_answer_index_override >= 0 AND correct_answer_index_override <= 3)
      );
  END IF;
END $$;

COMMENT ON COLUMN exam_questions.correct_answer_index_override IS
  '0=أ, 1=ب, 2=ج, 3=د - إن وُجد يُستخدم بدل قيمة البنك في هذا الامتحان فقط';

-- Down Migration
ALTER TABLE exam_questions DROP COLUMN IF EXISTS correct_answer_index_override;
