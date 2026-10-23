-- Up Migration: optional second correct answer for assignments + lecture exams

-- ===== Assignments =====
ALTER TABLE assignment_questions
  ADD COLUMN IF NOT EXISTS correct_answer_2 TEXT
    CHECK (correct_answer_2 IS NULL OR correct_answer_2 IN ('a', 'b', 'c', 'd'));

ALTER TABLE assignment_questions
  ADD COLUMN IF NOT EXISTS correct_option_id_2 INTEGER
    REFERENCES assignment_question_options(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assignment_questions_distinct_correct_answers'
  ) THEN
    ALTER TABLE assignment_questions
      ADD CONSTRAINT assignment_questions_distinct_correct_answers
      CHECK (
        correct_answer_2 IS NULL
        OR correct_answer IS NULL
        OR correct_answer_2 <> correct_answer
      );
  END IF;
END $$;

-- ===== Lecture exams (exam_questions override) =====
ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS correct_answer_index_override_2 INTEGER NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_correct_answer_override_2_check'
  ) THEN
    ALTER TABLE exam_questions
      ADD CONSTRAINT exam_questions_correct_answer_override_2_check
      CHECK (
        correct_answer_index_override_2 IS NULL
        OR (
          correct_answer_index_override_2 >= 0
          AND correct_answer_index_override_2 <= 3
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_questions_distinct_correct_overrides'
  ) THEN
    ALTER TABLE exam_questions
      ADD CONSTRAINT exam_questions_distinct_correct_overrides
      CHECK (
        correct_answer_index_override_2 IS NULL
        OR correct_answer_index_override IS NULL
        OR correct_answer_index_override_2 <> correct_answer_index_override
      );
  END IF;
END $$;

COMMENT ON COLUMN exam_questions.correct_answer_index_override_2 IS
  'Optional second correct answer for this lecture exam only (0=أ, 1=ب, 2=ج, 3=د)';

-- Down Migration
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_distinct_correct_overrides;
ALTER TABLE exam_questions DROP CONSTRAINT IF EXISTS exam_questions_correct_answer_override_2_check;
ALTER TABLE exam_questions DROP COLUMN IF EXISTS correct_answer_index_override_2;

ALTER TABLE assignment_questions DROP CONSTRAINT IF EXISTS assignment_questions_distinct_correct_answers;
ALTER TABLE assignment_questions DROP COLUMN IF EXISTS correct_option_id_2;
ALTER TABLE assignment_questions DROP COLUMN IF EXISTS correct_answer_2;
