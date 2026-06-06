-- Migration: إضافة حقول التحكم في الوصول للمحتوى في جدول enrollments
-- هذا يسمح للمعلمين بحظر/إلغاء حظر محتوى المقرر الدراسي للطلاب

-- إضافة حقول جديدة لجدول enrollments
ALTER TABLE enrollments 
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) DEFAULT 'active' 
  CHECK (subscription_status IN ('active', 'expired', 'suspended')),
ADD COLUMN IF NOT EXISTS is_blocked_by_teacher BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS blocked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

-- إنشاء فهرس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_enrollments_subscription_status ON enrollments(subscription_status);
CREATE INDEX IF NOT EXISTS idx_enrollments_is_blocked ON enrollments(is_blocked_by_teacher);
CREATE INDEX IF NOT EXISTS idx_enrollments_course_status ON enrollments(course_id, subscription_status, is_blocked_by_teacher);

-- إضافة تعليقات
COMMENT ON COLUMN enrollments.subscription_status IS 'حالة الاشتراك: active (نشط), expired (منتهي), suspended (معلق)';
COMMENT ON COLUMN enrollments.is_blocked_by_teacher IS 'هل تم حظر المحتوى بواسطة المعلم';
COMMENT ON COLUMN enrollments.blocked_at IS 'تاريخ حظر المحتوى';
COMMENT ON COLUMN enrollments.blocked_by IS 'معرف المعلم الذي قام بالحظر';
COMMENT ON COLUMN enrollments.expires_at IS 'تاريخ انتهاء الاشتراك';

