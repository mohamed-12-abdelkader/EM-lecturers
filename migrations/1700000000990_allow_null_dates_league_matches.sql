-- Allow null date and time in league matches
ALTER TABLE league_matches ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE league_matches ALTER COLUMN start_date DROP DEFAULT;

ALTER TABLE league_matches ALTER COLUMN start_time DROP NOT NULL;
ALTER TABLE league_matches ALTER COLUMN start_time DROP DEFAULT;

ALTER TABLE league_matches ALTER COLUMN end_time DROP NOT NULL;
ALTER TABLE league_matches ALTER COLUMN end_time DROP DEFAULT;

-- Update constraint to allow nulls
ALTER TABLE league_matches DROP CONSTRAINT IF EXISTS league_matches_time_check;

ALTER TABLE league_matches ADD CONSTRAINT league_matches_time_check CHECK (
  (start_time IS NULL) OR (end_time IS NULL) OR (end_time > start_time)
);
