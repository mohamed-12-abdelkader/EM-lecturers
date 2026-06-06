-- Up Migration
-- إضافة حقل نوع الكورس المختار للطالب
-- ملاحظة: يجب تطبيق migration 1700000000700_create_general_courses.sql أولاً لإنشاء نوع course_category

ALTER TABLE users ADD COLUMN IF NOT EXISTS course_category course_category;

-- Down Migration
ALTER TABLE users DROP COLUMN IF EXISTS course_category;

