-- Enhance course_files for secure course-level PDF management
-- Additive: keeps existing columns (name, file_url, file_type, uploaded_by) for backward compatibility

BEGIN;

ALTER TABLE course_files
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS original_name TEXT,
  ADD COLUMN IF NOT EXISTS file_key TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(40) NOT NULL DEFAULT 'cloudinary',
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(150),
  ADD COLUMN IF NOT EXISTS upload_status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
  ADD COLUMN IF NOT EXISTS delivery_type VARCHAR(40) NOT NULL DEFAULT 'upload',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS storage_deleted_at TIMESTAMPTZ;

UPDATE course_files
SET
  teacher_id = COALESCE(teacher_id, uploaded_by),
  title = COALESCE(NULLIF(title, ''), name),
  original_name = COALESCE(NULLIF(original_name, ''), name),
  mime_type = COALESCE(mime_type, file_type, 'application/pdf')
WHERE title IS NULL
   OR original_name IS NULL
   OR teacher_id IS NULL
   OR mime_type IS NULL;

UPDATE course_files
SET title = COALESCE(NULLIF(title, ''), name, 'ملف')
WHERE title IS NULL OR title = '';

ALTER TABLE course_files
  ALTER COLUMN title SET DEFAULT 'ملف';

ALTER TABLE course_files
  ALTER COLUMN title SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_course_files_teacher_id
  ON course_files (teacher_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_course_files_course_active
  ON course_files (course_id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN course_files.file_key IS 'Cloudinary public_id / S3 key / local relative path — never returned to clients';
COMMENT ON COLUMN course_files.file_url IS 'Internal storage locator — never returned to clients';
COMMENT ON COLUMN course_files.delivery_type IS 'Cloudinary delivery type: upload | authenticated | private';

COMMIT;
