-- Up Migration
ALTER TABLE courses ADD COLUMN IF NOT EXISTS grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL;
 
-- Down Migration
ALTER TABLE courses DROP COLUMN IF EXISTS grade_id; 