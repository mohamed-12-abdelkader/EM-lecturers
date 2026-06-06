-- Up Migration
ALTER TABLE exams ADD COLUMN IF NOT EXISTS title TEXT;

-- Down Migration
ALTER TABLE exams DROP COLUMN IF EXISTS title; 