-- Up Migration
-- إضافة عمود updated_at لجدول questions إذا لم يكن موجوداً

-- التحقق من وجود العمود وإضافته إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'questions' 
        AND column_name = 'updated_at'
    ) THEN
        ALTER TABLE questions ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- Down Migration
-- حذف عمود updated_at من جدول questions
-- ALTER TABLE questions DROP COLUMN IF EXISTS updated_at;
