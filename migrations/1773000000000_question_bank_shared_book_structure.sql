-- Up Migration
-- فصول ودروس مشتركة بين كتب نفس المادة (الأسئلة فقط تختلف لكل كتاب)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE chapters ADD COLUMN IF NOT EXISTS mirror_key UUID;
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS mirror_key UUID;

CREATE INDEX IF NOT EXISTS idx_chapters_mirror_key ON chapters(mirror_key);
CREATE INDEX IF NOT EXISTS idx_lessons_mirror_key ON lessons(mirror_key);

-- ربط الفصول المتطابقة بالاسم داخل المادة
WITH chapter_groups AS (
  SELECT subject_id, LOWER(name) AS name_key, gen_random_uuid() AS mk
  FROM chapters
  GROUP BY subject_id, LOWER(name)
)
UPDATE chapters c
SET mirror_key = g.mk
FROM chapter_groups g
WHERE c.subject_id = g.subject_id
  AND LOWER(c.name) = g.name_key
  AND c.mirror_key IS NULL;

-- ربط الدروس المتطابقة داخل نفس مجموعة الفصل
WITH lesson_groups AS (
  SELECT c.mirror_key AS chapter_mk, LOWER(l.name) AS name_key, gen_random_uuid() AS mk
  FROM lessons l
  JOIN chapters c ON c.id = l.chapter_id
  WHERE c.mirror_key IS NOT NULL
  GROUP BY c.mirror_key, LOWER(l.name)
)
UPDATE lessons l
SET mirror_key = g.mk
FROM chapters c, lesson_groups g
WHERE l.chapter_id = c.id
  AND c.mirror_key = g.chapter_mk
  AND LOWER(l.name) = g.name_key
  AND l.mirror_key IS NULL;

-- أي صف بدون mirror_key
UPDATE chapters SET mirror_key = gen_random_uuid() WHERE mirror_key IS NULL;
UPDATE lessons SET mirror_key = gen_random_uuid() WHERE mirror_key IS NULL;

-- Down Migration
DROP INDEX IF EXISTS idx_lessons_mirror_key;
DROP INDEX IF EXISTS idx_chapters_mirror_key;
ALTER TABLE lessons DROP COLUMN IF EXISTS mirror_key;
ALTER TABLE chapters DROP COLUMN IF EXISTS mirror_key;
