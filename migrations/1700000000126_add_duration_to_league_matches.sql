-- Add duration_minutes to league_matches
ALTER TABLE league_matches
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;

-- Update existing matches to have a default duration of 60 minutes if null
UPDATE league_matches
SET duration_minutes = 60
WHERE duration_minutes IS NULL;
































