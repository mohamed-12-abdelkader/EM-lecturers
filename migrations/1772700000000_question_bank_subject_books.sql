-- Question bank hierarchy: Subject → Books → Chapters → Lessons

CREATE TABLE IF NOT EXISTS subject_books (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  order_num INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_subject_books_subject_name
  ON subject_books (subject_id, LOWER(name));

CREATE INDEX IF NOT EXISTS idx_subject_books_subject_id
  ON subject_books(subject_id);

ALTER TABLE chapters
  ADD COLUMN IF NOT EXISTS book_id INTEGER REFERENCES subject_books(id) ON DELETE CASCADE;

-- Backfill: one default book per subject that already has chapters
INSERT INTO subject_books (subject_id, name, description, order_num, is_active)
SELECT DISTINCT c.subject_id, 'كتاب عام', 'تم إنشاؤه تلقائياً أثناء ترقية النظام', 1, TRUE
FROM chapters c
WHERE c.subject_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM subject_books sb WHERE sb.subject_id = c.subject_id AND sb.name = 'كتاب عام'
  );

UPDATE chapters c
SET book_id = sb.id
FROM subject_books sb
WHERE c.book_id IS NULL
  AND c.subject_id = sb.subject_id
  AND sb.name = 'كتاب عام';

-- Chapters without subject_id but with book linkage edge case: skip

CREATE OR REPLACE FUNCTION trg_set_subject_books_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_subject_books_updated_at ON subject_books;
CREATE TRIGGER set_subject_books_updated_at
  BEFORE UPDATE ON subject_books
  FOR EACH ROW
  EXECUTE FUNCTION trg_set_subject_books_updated_at();

-- Unique chapter name per book (replace subject-level uniqueness for new inserts)
DROP INDEX IF EXISTS uniq_chapters_subject_name;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_chapters_book_name
  ON chapters (book_id, LOWER(name))
  WHERE book_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
