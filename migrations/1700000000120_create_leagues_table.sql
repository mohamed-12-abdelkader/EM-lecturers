-- Create leagues table
CREATE TABLE IF NOT EXISTS leagues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE RESTRICT,
  image_url TEXT,
  matches_count INTEGER NOT NULL CHECK (matches_count > 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  description TEXT,
  price NUMERIC(12,2),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  CONSTRAINT leagues_date_check CHECK (end_date > start_date)
);

-- Useful indexes
CREATE INDEX IF NOT EXISTS idx_leagues_grade ON leagues(grade_id);
CREATE INDEX IF NOT EXISTS idx_leagues_dates ON leagues(start_date, end_date);

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_leagues_updated_at ON leagues;
CREATE TRIGGER set_leagues_updated_at
BEFORE UPDATE ON leagues
FOR EACH ROW
EXECUTE PROCEDURE set_updated_at();




