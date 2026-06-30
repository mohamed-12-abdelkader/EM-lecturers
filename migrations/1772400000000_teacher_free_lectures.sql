-- محاضرات مجانية ينشئها المدرّس (اسم + رابط + صورة تعريفية)

CREATE TABLE IF NOT EXISTS teacher_free_lectures (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  image_url TEXT,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_free_lectures_teacher_id
  ON teacher_free_lectures(teacher_id);

CREATE INDEX IF NOT EXISTS idx_teacher_free_lectures_published
  ON teacher_free_lectures(is_published, created_at DESC);

CREATE OR REPLACE FUNCTION update_teacher_free_lectures_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_free_lectures_updated_at ON teacher_free_lectures;
CREATE TRIGGER trigger_teacher_free_lectures_updated_at
  BEFORE UPDATE ON teacher_free_lectures
  FOR EACH ROW
  EXECUTE FUNCTION update_teacher_free_lectures_updated_at();
