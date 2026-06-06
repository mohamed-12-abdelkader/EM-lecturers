-- Up Migration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS duration INTEGER;

-- Down Migration
ALTER TABLE exams DROP COLUMN IF EXISTS duration; 