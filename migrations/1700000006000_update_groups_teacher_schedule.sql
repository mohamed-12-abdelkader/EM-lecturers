-- Migration: Add Teacher and Schedule to General Course Groups
-- إضافة حقل المدرس وجدولة المواعيد لمجموعات الكورس العام

-- 1. إضافة حقل المدرس (teacher_id) لجدول المجموعات
ALTER TABLE general_course_groups
ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_general_course_groups_teacher ON general_course_groups(teacher_id);

-- 2. تحديث جدول الجلسات ليكون هو "الجدول" (Schedules)
-- سيتم استخدامه لتحديد مواعيد المحاضرات (أيام وساعات) للمجموعة
-- سنقوم بتعديل الجدول الحالي `general_course_group_sessions` ليتناسب مع المتطلبات الجديدة أو إنشاء جدول جديد
-- الأفضل استخدام جدول `general_course_group_sessions` للجلسات الفعلية، وجدول جديد للمواعيد الثابتة (أيام الأسبوع)
-- ولكن بناءً على طلب المستخدم "جدول ليهم"، سننشئ جدول "المواعيد الأسبوعية"

CREATE TABLE IF NOT EXISTS general_course_group_schedules (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES general_course_groups(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday, 1=Monday, ...
    start_time TIME NOT NULL, -- وقت البدء (مثلاً 14:30)
    duration_minutes INTEGER DEFAULT 60,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_schedules_group ON general_course_group_schedules(group_id);

-- إضافة تعليقات
COMMENT ON COLUMN general_course_groups.teacher_id IS 'المدرس المسؤول عن المجموعة';
COMMENT ON COLUMN general_course_group_schedules.day_of_week IS 'يوم الأسبوع: 0=الأحد، 1=الاثنين، ...، 6=السبت';

-- Down Migration
-- DROP TABLE general_course_group_schedules;
-- ALTER TABLE general_course_groups DROP COLUMN teacher_id;
