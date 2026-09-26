-- Up Migration: optional second correct answer for course-level exam questions
ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS correct_answer_2 CHAR(1)
    CHECK (correct_answer_2 IS NULL OR correct_answer_2 IN ('A', 'B', 'C', 'D'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'course_level_exam_questions_distinct_correct_answers'
  ) THEN
    ALTER TABLE course_level_exam_questions
      ADD CONSTRAINT course_level_exam_questions_distinct_correct_answers
      CHECK (
        correct_answer_2 IS NULL
        OR correct_answer IS NULL
        OR correct_answer_2 <> correct_answer
      );
  END IF;
END $$;

-- Down Migration
ALTER TABLE course_level_exam_questions
  DROP CONSTRAINT IF EXISTS course_level_exam_questions_distinct_correct_answers;
ALTER TABLE course_level_exam_questions
  DROP COLUMN IF EXISTS correct_answer_2;
