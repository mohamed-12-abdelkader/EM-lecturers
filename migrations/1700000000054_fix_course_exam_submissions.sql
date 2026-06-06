-- Up Migration
-- إضافة العمود المفقود obtained_grade إذا لم يكن موجوداً

-- التحقق من وجود العمود وإضافته إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'course_exam_submissions' 
        AND column_name = 'obtained_grade'
    ) THEN
        ALTER TABLE course_exam_submissions ADD COLUMN obtained_grade INTEGER DEFAULT 0;
    END IF;
END $$;

-- تحديث البيانات الموجودة لتعيين obtained_grade = total_grade إذا كان obtained_grade = 0
UPDATE course_exam_submissions 
SET obtained_grade = total_grade 
WHERE obtained_grade = 0 AND total_grade IS NOT NULL;

-- Down Migration
-- لا نحذف العمود لأنه قد يحتوي على بيانات مهمة
-- ALTER TABLE course_exam_submissions DROP COLUMN IF EXISTS obtained_grade;

