-- Up Migration
ALTER TABLE lectures ALTER COLUMN is_visible SET DEFAULT FALSE;
UPDATE lectures SET is_visible = FALSE WHERE is_visible IS NULL OR is_visible = TRUE;

-- Down Migration
ALTER TABLE lectures ALTER COLUMN is_visible SET DEFAULT TRUE; 