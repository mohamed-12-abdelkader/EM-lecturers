-- Up Migration
-- إضافة الصفوف الابتدائية (الرابع والخامس والسادس)

-- إضافة الصف الرابع الابتدائي
INSERT INTO grades (name) VALUES ('الصف الرابع الابتدائي')
ON CONFLICT (name) DO NOTHING;

-- إضافة الصف الخامس الابتدائي
INSERT INTO grades (name) VALUES ('الصف الخامس الابتدائي')
ON CONFLICT (name) DO NOTHING;

-- إضافة الصف السادس الابتدائي
INSERT INTO grades (name) VALUES ('الصف السادس الابتدائي')
ON CONFLICT (name) DO NOTHING;

-- Down Migration
-- حذف الصفوف الابتدائية المضافة
DELETE FROM grades WHERE name IN (
  'الصف الرابع الابتدائي',
  'الصف الخامس الابتدائي',
  'الصف السادس الابتدائي'
);
