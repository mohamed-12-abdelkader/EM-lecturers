-- Course-level files (PDFs, docs, etc.) attached to a course — not lecture-specific

BEGIN;

CREATE TABLE IF NOT EXISTS course_files (
  id           SERIAL PRIMARY KEY,
  course_id    INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  file_url     TEXT NOT NULL,
  file_size    INTEGER,
  file_type    VARCHAR(150),
  uploaded_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_course_files_course_id ON course_files(course_id);
CREATE INDEX IF NOT EXISTS idx_course_files_created_at ON course_files(course_id, created_at DESC);

COMMENT ON TABLE course_files IS 'ملفات مرفقة على مستوى الكورس (للمدرس يرفعها والطالب يشاهدها)';

COMMIT;
