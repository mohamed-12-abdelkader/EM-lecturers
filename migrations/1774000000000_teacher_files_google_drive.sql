-- Up Migration — دعم روابط Google Drive في ملفاتي

ALTER TABLE teacher_files
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(20) NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS drive_url TEXT;

UPDATE teacher_files
SET source_type = 'upload'
WHERE source_type IS NULL OR source_type = '';

ALTER TABLE teacher_files
  DROP CONSTRAINT IF EXISTS teacher_files_source_type_check;

ALTER TABLE teacher_files
  ADD CONSTRAINT teacher_files_source_type_check CHECK (
    source_type IN ('upload', 'drive')
  );

CREATE INDEX IF NOT EXISTS idx_teacher_files_source_type
  ON teacher_files (source_type)
  WHERE deleted_at IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_teacher_files_source_type;
ALTER TABLE teacher_files DROP CONSTRAINT IF EXISTS teacher_files_source_type_check;
ALTER TABLE teacher_files
  DROP COLUMN IF EXISTS drive_url,
  DROP COLUMN IF EXISTS source_type;
