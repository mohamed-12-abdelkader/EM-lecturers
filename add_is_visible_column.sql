-- إضافة عمود is_visible إلى جدول courses
ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;

-- تحديث جميع الكورسات الموجودة لتكون مرئية افتراضياً
UPDATE courses SET is_visible = TRUE WHERE is_visible IS NULL;

-- التحقق من إضافة العمود
SELECT column_name, data_type, column_default, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'courses' AND column_name = 'is_visible';
