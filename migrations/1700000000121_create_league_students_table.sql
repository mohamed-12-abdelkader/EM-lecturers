-- Create league_students subscription table
CREATE TABLE IF NOT EXISTS league_students (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_league_students_league ON league_students(league_id);
CREATE INDEX IF NOT EXISTS idx_league_students_student ON league_students(student_id);




