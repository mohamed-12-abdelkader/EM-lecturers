-- Up Migration
-- تحديث جدول course_lectures لدعم الكورسات في المواد الدراسية (package_subject_item_courses)
-- والكورسات العادية (courses) أيضاً

-- إزالة constraint القديم إذا كان موجوداً
ALTER TABLE course_lectures 
  DROP CONSTRAINT IF EXISTS course_lectures_course_id_fkey;

-- ملاحظة: course_id الآن يمكن أن يشير إلى:
-- 1. subject_courses(id) - الكورسات في المواد
-- 2. package_subject_item_courses(id) - الكورسات في المواد الدراسية للباقات
-- 3. courses(id) - الكورسات العادية (إذا تم استخدام course_lectures لها لاحقاً)
-- التحقق من صحة الكورس يتم في الكود وليس في قاعدة البيانات

-- Down Migration
-- إعادة constraint القديم (فقط إذا كان موجوداً في البداية)
-- ALTER TABLE course_lectures 
--   ADD CONSTRAINT course_lectures_course_id_fkey 
--   FOREIGN KEY (course_id) REFERENCES subject_courses(id) ON DELETE CASCADE;

