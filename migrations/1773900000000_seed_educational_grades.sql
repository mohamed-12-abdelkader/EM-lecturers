-- Up Migration
-- الصفوف الدراسية الكاملة: ابتدائي → إعدادي → ثانوي → جامعي + كورسات أخرى

ALTER TABLE grades DROP CONSTRAINT IF EXISTS grades_stage_check;

ALTER TABLE grades
ADD CONSTRAINT grades_stage_check
CHECK (stage IN ('primary', 'prep', 'secondary', 'university', 'general'));

UPDATE grades
SET slug = 'primary-4', stage = 'primary', status = 'active', is_active = TRUE, level = 4, updated_at = NOW()
WHERE name = 'الصف الرابع الابتدائي' AND slug IS DISTINCT FROM 'primary-4';

UPDATE grades
SET slug = 'primary-5', stage = 'primary', status = 'active', is_active = TRUE, level = 5, updated_at = NOW()
WHERE name = 'الصف الخامس الابتدائي' AND slug IS DISTINCT FROM 'primary-5';

UPDATE grades
SET slug = 'primary-6', stage = 'primary', status = 'active', is_active = TRUE, level = 6, updated_at = NOW()
WHERE name = 'الصف السادس الابتدائي' AND slug IS DISTINCT FROM 'primary-6';

INSERT INTO grades (name, slug, stage, status, is_active, level)
VALUES
  ('الصف الرابع الابتدائي', 'primary-4', 'primary', 'active', TRUE, 4),
  ('الصف الخامس الابتدائي', 'primary-5', 'primary', 'active', TRUE, 5),
  ('الصف السادس الابتدائي', 'primary-6', 'primary', 'active', TRUE, 6),
  ('الصف الأول الإعدادي', 'prep-1', 'prep', 'active', TRUE, 7),
  ('الصف الثاني الإعدادي', 'prep-2', 'prep', 'active', TRUE, 8),
  ('الصف الثالث الإعدادي', 'prep-3', 'prep', 'active', TRUE, 9),
  ('الصف الأول الثانوي', 'secondary-1', 'secondary', 'active', TRUE, 10),
  ('الصف الثاني الثانوي', 'secondary-2', 'secondary', 'active', TRUE, 11),
  ('الصف الثالث الثانوي', 'secondary-3', 'secondary', 'active', TRUE, 12),
  ('الصف الأول الجامعي', 'university-1', 'university', 'active', TRUE, 13),
  ('الصف الثاني الجامعي', 'university-2', 'university', 'active', TRUE, 14),
  ('الصف الثالث الجامعي', 'university-3', 'university', 'active', TRUE, 15),
  ('الصف الرابع الجامعي', 'university-4', 'university', 'active', TRUE, 16),
  ('كورسات أخرى', 'other-courses', 'general', 'active', TRUE, 99)
ON CONFLICT (slug)
DO UPDATE SET
  name = EXCLUDED.name,
  stage = EXCLUDED.stage,
  status = EXCLUDED.status,
  is_active = EXCLUDED.is_active,
  level = EXCLUDED.level,
  updated_at = NOW();

INSERT INTO grades (name, slug, stage, status, is_active, level)
VALUES ('كورسات عامة', 'general-courses', 'general', 'active', TRUE, 98)
ON CONFLICT (slug)
DO UPDATE SET status = 'active', is_active = TRUE, updated_at = NOW();

UPDATE grades
SET
  name = CASE slug
    WHEN 'legacy-university-1' THEN 'الصف الأول الجامعي'
    WHEN 'legacy-university-2' THEN 'الصف الثاني الجامعي'
    WHEN 'legacy-university-3' THEN 'الصف الثالث الجامعي'
    WHEN 'legacy-university-4' THEN 'الصف الرابع الجامعي'
    ELSE name
  END,
  stage = 'university',
  status = 'active',
  is_active = TRUE,
  updated_at = NOW()
WHERE slug IN (
  'legacy-university-1',
  'legacy-university-2',
  'legacy-university-3',
  'legacy-university-4'
);

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
