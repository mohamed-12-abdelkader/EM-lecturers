-- Up Migration
-- إنشاء جدول صلاحيات المدرسين على مواد الباقات
CREATE TABLE IF NOT EXISTS package_subject_item_teacher_permissions (
    id SERIAL PRIMARY KEY,
    package_subject_item_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(package_subject_item_id, teacher_id)
);

-- إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_package_subject_teacher_permissions_subject ON package_subject_item_teacher_permissions(package_subject_item_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_teacher_permissions_teacher ON package_subject_item_teacher_permissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_teacher_permissions_granted_by ON package_subject_item_teacher_permissions(granted_by);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_teacher_permissions;

