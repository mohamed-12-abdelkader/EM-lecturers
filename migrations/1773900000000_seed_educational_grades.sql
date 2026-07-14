-- Up Migration
-- الصفوف الدراسية الكاملة: ابتدائي → إعدادي → ثانوي → جامعي + كورسات أخرى
-- آمن مع البيانات القديمة (أسماء/سلاجز مكررة — الفرقة الجامعية vs الصف الجامعي)

ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_stage_check;

ALTER TABLE grades
ADD CONSTRAINT grades_stage_check
CHECK (stage IN ('primary', 'prep', 'secondary', 'university', 'general'));

-- 0) تحرير slug إن كان محجوزاً بصف اسمه مختلف (تجنب تعارض unique على slug)
WITH seed(name, slug) AS (
  VALUES
    ('الصف الرابع الابتدائي', 'primary-4'),
    ('الصف الخامس الابتدائي', 'primary-5'),
    ('الصف السادس الابتدائي', 'primary-6'),
    ('الصف الأول الإعدادي', 'prep-1'),
    ('الصف الثاني الإعدادي', 'prep-2'),
    ('الصف الثالث الإعدادي', 'prep-3'),
    ('الصف الأول الثانوي', 'secondary-1'),
    ('الصف الثاني الثانوي', 'secondary-2'),
    ('الصف الثالث الثانوي', 'secondary-3'),
    ('الصف الأول الجامعي', 'university-1'),
    ('الصف الثاني الجامعي', 'university-2'),
    ('الصف الثالث الجامعي', 'university-3'),
    ('الصف الرابع الجامعي', 'university-4'),
    ('كورسات أخرى', 'other-courses'),
    ('كورسات عامة', 'general-courses')
)
UPDATE grades g
SET slug = CONCAT('grade-', g.id), updated_at = NOW()
FROM seed s
WHERE g.slug = s.slug
  AND g.name IS DISTINCT FROM s.name;

-- 1) تحديث الصفوف الموجودة بالاسم
WITH seed(name, slug, stage, lvl) AS (
  VALUES
    ('الصف الرابع الابتدائي', 'primary-4', 'primary', 4),
    ('الصف الخامس الابتدائي', 'primary-5', 'primary', 5),
    ('الصف السادس الابتدائي', 'primary-6', 'primary', 6),
    ('الصف الأول الإعدادي', 'prep-1', 'prep', 7),
    ('الصف الثاني الإعدادي', 'prep-2', 'prep', 8),
    ('الصف الثالث الإعدادي', 'prep-3', 'prep', 9),
    ('الصف الأول الثانوي', 'secondary-1', 'secondary', 10),
    ('الصف الثاني الثانوي', 'secondary-2', 'secondary', 11),
    ('الصف الثالث الثانوي', 'secondary-3', 'secondary', 12),
    ('الصف الأول الجامعي', 'university-1', 'university', 13),
    ('الصف الثاني الجامعي', 'university-2', 'university', 14),
    ('الصف الثالث الجامعي', 'university-3', 'university', 15),
    ('الصف الرابع الجامعي', 'university-4', 'university', 16),
    ('كورسات أخرى', 'other-courses', 'general', 99),
    ('كورسات عامة', 'general-courses', 'general', 98)
)
UPDATE grades g
SET
  slug = s.slug,
  stage = s.stage,
  status = 'active',
  is_active = TRUE,
  level = s.lvl,
  updated_at = NOW()
FROM seed s
WHERE g.name = s.name;

-- 2) إدراج الصفوف الناقصة فقط
WITH seed(name, slug, stage, lvl) AS (
  VALUES
    ('الصف الرابع الابتدائي', 'primary-4', 'primary', 4),
    ('الصف الخامس الابتدائي', 'primary-5', 'primary', 5),
    ('الصف السادس الابتدائي', 'primary-6', 'primary', 6),
    ('الصف الأول الإعدادي', 'prep-1', 'prep', 7),
    ('الصف الثاني الإعدادي', 'prep-2', 'prep', 8),
    ('الصف الثالث الإعدادي', 'prep-3', 'prep', 9),
    ('الصف الأول الثانوي', 'secondary-1', 'secondary', 10),
    ('الصف الثاني الثانوي', 'secondary-2', 'secondary', 11),
    ('الصف الثالث الثانوي', 'secondary-3', 'secondary', 12),
    ('الصف الأول الجامعي', 'university-1', 'university', 13),
    ('الصف الثاني الجامعي', 'university-2', 'university', 14),
    ('الصف الثالث الجامعي', 'university-3', 'university', 15),
    ('الصف الرابع الجامعي', 'university-4', 'university', 16),
    ('كورسات أخرى', 'other-courses', 'general', 99),
    ('كورسات عامة', 'general-courses', 'general', 98)
)
INSERT INTO grades (name, slug, stage, status, is_active, level)
SELECT s.name, s.slug, s.stage, 'active', TRUE, s.lvl
FROM seed s
WHERE NOT EXISTS (SELECT 1 FROM grades g WHERE g.name = s.name)
  AND NOT EXISTS (SELECT 1 FROM grades g WHERE g.slug = s.slug);

-- 3) دمج الصفوف الجامعية القديمة (الفرقة / legacy-university) — نقل الربط ثم أرشفة المكرر
WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE courses c
SET grade_id = p.canonical_id
FROM pairs p
WHERE c.grade_id = p.legacy_id;

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE packages p
SET grade_id = pairs.canonical_id
FROM pairs
WHERE p.grade_id = pairs.legacy_id;

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE study_groups sg
SET grade_id = pairs.canonical_id
FROM pairs
WHERE sg.grade_id = pairs.legacy_id;

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE user_grades ug
SET grade_id = pairs.canonical_id
FROM pairs
WHERE ug.grade_id = pairs.legacy_id
  AND NOT EXISTS (
    SELECT 1 FROM user_grades x
    WHERE x.user_id = ug.user_id AND x.grade_id = pairs.canonical_id
  );

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
DELETE FROM user_grades ug
USING pairs p
WHERE ug.grade_id = p.legacy_id;

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE teacher_grades tg
SET grade_id = pairs.canonical_id
FROM pairs
WHERE tg.grade_id = pairs.legacy_id
  AND NOT EXISTS (
    SELECT 1 FROM teacher_grades x
    WHERE x.teacher_id = tg.teacher_id AND x.grade_id = pairs.canonical_id
  );

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
DELETE FROM teacher_grades tg
USING pairs p
WHERE tg.grade_id = p.legacy_id;

WITH legacy_map(legacy_slug, legacy_name, canonical_slug) AS (
  VALUES
    ('legacy-university-1', 'الفرقة الأولى', 'university-1'),
    ('legacy-university-2', 'الفرقة الثانية', 'university-2'),
    ('legacy-university-3', 'الفرقة الثالثة', 'university-3'),
    ('legacy-university-4', 'الفرقة الرابعة', 'university-4')
),
pairs AS (
  SELECT l.id AS legacy_id, c.id AS canonical_id
  FROM legacy_map m
  JOIN grades l ON l.slug = m.legacy_slug OR l.name = m.legacy_name
  JOIN grades c ON c.slug = m.canonical_slug
  WHERE l.id <> c.id
)
UPDATE grades g
SET
  slug = CONCAT('archived-grade-', g.id),
  status = 'inactive',
  is_active = FALSE,
  updated_at = NOW()
FROM pairs p
WHERE g.id = p.legacy_id;

-- Down Migration

UPDATE grades
SET status = 'inactive', is_active = FALSE, updated_at = NOW()
WHERE slug IN ('primary-4', 'primary-5', 'primary-6', 'other-courses');

UPDATE grades
SET stage = 'general', updated_at = NOW()
WHERE slug IN ('primary-4', 'primary-5', 'primary-6');

ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_stage_check;

ALTER TABLE grades
ADD CONSTRAINT grades_stage_check
CHECK (stage IN ('prep', 'secondary', 'university', 'general'));
