-- Create league_match_questions table
CREATE TABLE IF NOT EXISTS league_match_questions (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES league_matches(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  correct_answer CHAR(1) CHECK (correct_answer IN ('A','B','C','D')),
  image_url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lmq_match ON league_match_questions(match_id);

CREATE OR REPLACE FUNCTION set_updated_at_lmq()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at_lmq ON league_match_questions;
CREATE TRIGGER trg_set_updated_at_lmq
BEFORE UPDATE ON league_match_questions
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_lmq();


