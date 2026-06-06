-- Create lesson_mcq_questions table for MCQ questions per lesson
-- Ensures exactly 4 options and correct_answer is one of them (or NULL)

CREATE TABLE IF NOT EXISTS lesson_mcq_questions (
  id SERIAL PRIMARY KEY,
  lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  options TEXT[] NOT NULL,
  correct_answer TEXT NULL,
  image TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT lesson_mcq_questions_options_length CHECK (cardinality(options) = 4),
  CONSTRAINT lesson_mcq_questions_correct_in_options CHECK (
    correct_answer IS NULL OR correct_answer = ANY(options)
  )
);

CREATE INDEX IF NOT EXISTS idx_lmq_lesson_id ON lesson_mcq_questions(lesson_id);

-- Reuse the generic updated_at trigger if present; otherwise, create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'update_updated_at_column'
  ) THEN
    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $upd$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $upd$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_lesson_mcq_questions_updated_at ON lesson_mcq_questions;
CREATE TRIGGER trg_lesson_mcq_questions_updated_at
BEFORE UPDATE ON lesson_mcq_questions
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


