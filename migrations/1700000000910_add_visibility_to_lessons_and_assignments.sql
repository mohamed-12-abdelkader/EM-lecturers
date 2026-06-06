-- Up Migration
-- إضافة حقل is_visible للدروس والواجبات للتحكم في إظهارها/إخفائها للطلاب

-- إضافة حقل is_visible للدروس (افتراضياً false - مخفي)
ALTER TABLE package_subject_item_lessons 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT false NOT NULL;

-- إضافة حقل is_visible للواجبات (افتراضياً false - مخفي)
ALTER TABLE package_subject_item_lesson_assignments 
ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT false NOT NULL;

-- إنشاء indexes لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_package_subject_lessons_visibility ON package_subject_item_lessons(is_visible);
CREATE INDEX IF NOT EXISTS idx_package_subject_assignments_visibility ON package_subject_item_lesson_assignments(is_visible);

-- Down Migration
DROP INDEX IF EXISTS idx_package_subject_assignments_visibility;
DROP INDEX IF EXISTS idx_package_subject_lessons_visibility;
ALTER TABLE package_subject_item_lesson_assignments DROP COLUMN IF EXISTS is_visible;
ALTER TABLE package_subject_item_lessons DROP COLUMN IF EXISTS is_visible;





















