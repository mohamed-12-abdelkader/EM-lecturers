-- Up Migration
-- إضافة عمود الصورة للمواد الموجودة
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS image TEXT;
 
-- Down Migration
ALTER TABLE subjects DROP COLUMN IF EXISTS image; 