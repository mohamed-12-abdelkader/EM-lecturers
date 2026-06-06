-- Up Migration
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- Down Migration
ALTER TABLE lectures DROP COLUMN IF EXISTS is_visible; 