-- Optional lecture scope for course PDF files (NULL = course-wide file)

BEGIN;

ALTER TABLE course_files
  ADD COLUMN IF NOT EXISTS lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_course_files_lecture_id
  ON course_files (lecture_id)
  WHERE deleted_at IS NULL AND lecture_id IS NOT NULL;

COMMENT ON COLUMN course_files.lecture_id IS 'When set, PDF belongs to a specific lecture; NULL = course-wide file';

COMMIT;
