-- Teacher private question library passages and richer question metadata.

CREATE TABLE IF NOT EXISTS teacher_question_passages (
  id SERIAL PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES teacher_question_parts(id) ON DELETE CASCADE,
  title TEXT,
  content TEXT NOT NULL,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE teacher_questions
  ADD COLUMN IF NOT EXISTS passage_id INTEGER REFERENCES teacher_question_passages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS correct_answer_index INTEGER,
  ADD COLUMN IF NOT EXISTS explanation TEXT,
  ADD COLUMN IF NOT EXISTS difficulty_level TEXT DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_teacher_question_passages_part_id
  ON teacher_question_passages(part_id);

CREATE INDEX IF NOT EXISTS idx_teacher_questions_passage_id
  ON teacher_questions(passage_id);

CREATE OR REPLACE FUNCTION update_teacher_question_passages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_question_passages_updated_at ON teacher_question_passages;
CREATE TRIGGER trigger_teacher_question_passages_updated_at
  BEFORE UPDATE ON teacher_question_passages
  FOR EACH ROW
  EXECUTE FUNCTION update_teacher_question_passages_updated_at();
