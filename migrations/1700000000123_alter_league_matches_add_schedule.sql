-- Add schedule fields to league_matches
ALTER TABLE league_matches
  ADD COLUMN IF NOT EXISTS start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS start_time TIME NOT NULL DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS end_time TIME NOT NULL DEFAULT '10:00',
  ADD CONSTRAINT league_matches_time_check CHECK (end_time > start_time);




