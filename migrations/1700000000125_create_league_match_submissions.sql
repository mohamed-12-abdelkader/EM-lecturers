-- Submissions and answers for league matches
CREATE TABLE IF NOT EXISTS league_match_submissions (
  id SERIAL PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES league_matches(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_questions INTEGER NOT NULL,
  correct_answers INTEGER NOT NULL,
  wrong_answers INTEGER NOT NULL,
  score INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, student_id)
);

CREATE TABLE IF NOT EXISTS league_match_answers (
  id SERIAL PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES league_match_submissions(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES league_match_questions(id) ON DELETE CASCADE,
  selected_answer CHAR(1) CHECK (selected_answer IN ('A','B','C','D')),
  is_correct BOOLEAN NOT NULL,
  points INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lms_match_student ON league_match_submissions(match_id, student_id);
CREATE INDEX IF NOT EXISTS idx_lma_submission ON league_match_answers(submission_id);


