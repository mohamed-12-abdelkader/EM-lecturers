-- Essay questions inside course/public exams and lecture exams/assignments.

ALTER TABLE course_level_exam_questions
  ADD COLUMN IF NOT EXISTS model_answer TEXT,
  ADD COLUMN IF NOT EXISTS model_answer_image TEXT,
  ADD COLUMN IF NOT EXISTS points NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS rubric TEXT;

ALTER TABLE course_level_exam_questions DROP CONSTRAINT IF EXISTS course_level_exam_questions_type_check;
ALTER TABLE course_level_exam_questions DROP CONSTRAINT IF EXISTS text_question_requires_text;
ALTER TABLE course_level_exam_questions DROP CONSTRAINT IF EXISTS text_question_requires_options;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'course_level_exam_questions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%IMAGE%'
      AND pg_get_constraintdef(con.oid) ILIKE '%TEXT%'
  LOOP
    EXECUTE format('ALTER TABLE course_level_exam_questions DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE course_level_exam_questions
  ADD CONSTRAINT course_level_exam_questions_type_check
  CHECK (type IN ('TEXT', 'IMAGE', 'ESSAY'));

ALTER TABLE course_level_exam_questions
  ADD CONSTRAINT text_question_requires_text CHECK (
    (type = 'TEXT' AND question_text IS NOT NULL) OR
    (type = 'IMAGE' AND question_image IS NOT NULL) OR
    (type = 'ESSAY' AND (question_text IS NOT NULL OR question_image IS NOT NULL))
  );

ALTER TABLE course_level_exam_questions
  ADD CONSTRAINT text_question_requires_options CHECK (
    (type = 'TEXT' AND option_a IS NOT NULL AND option_b IS NOT NULL AND option_c IS NOT NULL AND option_d IS NOT NULL) OR
    (type IN ('IMAGE', 'ESSAY'))
  );

ALTER TABLE course_level_exam_answers
  ADD COLUMN IF NOT EXISTS answer_text TEXT,
  ADD COLUMN IF NOT EXISTS answer_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS grading_status TEXT NOT NULL DEFAULT 'objective',
  ADD COLUMN IF NOT EXISTS awarded_score NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS ai_result JSONB,
  ADD COLUMN IF NOT EXISTS teacher_score NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS teacher_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC(8,2);

ALTER TABLE course_level_exam_attempts
  ALTER COLUMN total_grade TYPE NUMERIC(8,2) USING total_grade::numeric,
  ALTER COLUMN obtained_grade TYPE NUMERIC(8,2) USING obtained_grade::numeric;

ALTER TABLE exam_questions
  ADD COLUMN IF NOT EXISTS question_kind TEXT NOT NULL DEFAULT 'mcq',
  ADD COLUMN IF NOT EXISTS model_answer TEXT,
  ADD COLUMN IF NOT EXISTS model_answer_image TEXT,
  ADD COLUMN IF NOT EXISTS rubric TEXT;

ALTER TABLE exam_answers
  ADD COLUMN IF NOT EXISTS answer_images JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS grading_status TEXT NOT NULL DEFAULT 'objective',
  ADD COLUMN IF NOT EXISTS awarded_score NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS ai_result JSONB,
  ADD COLUMN IF NOT EXISTS teacher_note TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_score NUMERIC(8,2);

ALTER TABLE exam_answers
  ALTER COLUMN grade TYPE NUMERIC(8,2) USING grade::numeric;

ALTER TABLE exam_submissions
  ALTER COLUMN total_grade TYPE NUMERIC(8,2) USING total_grade::numeric;

CREATE TABLE IF NOT EXISTS essay_grade_log (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('course', 'lecture')),
  answer_id INTEGER NOT NULL,
  actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  previous_score NUMERIC(8,2),
  new_score NUMERIC(8,2),
  status TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_essay_answers_status
  ON course_level_exam_answers (grading_status);
CREATE INDEX IF NOT EXISTS idx_lecture_essay_answers_status
  ON exam_answers (grading_status);
CREATE INDEX IF NOT EXISTS idx_essay_grade_log_answer
  ON essay_grade_log (source, answer_id);
