-- إضافة إعدادات الامتحانات المتقدمة لامتحانات MCQ للمحاضرات
-- إضافة الحقول الجديدة لجدول exams فقط

-- تحديث جدول exams (امتحانات MCQ للمحاضرات)
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_at TIMESTAMP;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS hide_at TIMESTAMP;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS lock_next_lectures BOOLEAN DEFAULT FALSE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers_immediately BOOLEAN DEFAULT TRUE;
ALTER TABLE exams ADD COLUMN IF NOT EXISTS show_answers_after_hours INTEGER DEFAULT 0;

-- إضافة فهارس للأداء
CREATE INDEX IF NOT EXISTS idx_exams_show_at ON exams(show_at);
CREATE INDEX IF NOT EXISTS idx_exams_hide_at ON exams(hide_at);

-- إضافة تعليقات للحقول الجديدة
COMMENT ON COLUMN exams.show_at IS 'موعد ظهور الامتحان للطلاب';
COMMENT ON COLUMN exams.hide_at IS 'موعد إخفاء الامتحان عن الطلاب';
COMMENT ON COLUMN exams.lock_next_lectures IS 'قفل المحاضرات التالية حتى النجاح';
COMMENT ON COLUMN exams.show_answers_immediately IS 'إظهار الإجابات فور انتهاء الامتحان';
COMMENT ON COLUMN exams.show_answers_after_hours IS 'عدد الساعات قبل إظهار الإجابات';
