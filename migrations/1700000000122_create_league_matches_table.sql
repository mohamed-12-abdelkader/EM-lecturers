-- Create league_matches table
CREATE TABLE IF NOT EXISTS league_matches (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  is_visible BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_league_matches_league ON league_matches(league_id);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at_league_matches()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_updated_at_league_matches ON league_matches;
CREATE TRIGGER trg_set_updated_at_league_matches
BEFORE UPDATE ON league_matches
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at_league_matches();




