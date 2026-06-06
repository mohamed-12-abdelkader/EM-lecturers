-- Up Migration
-- إنشاء جدول ربط المدرسين بالمواد مع صلاحيات
CREATE TABLE IF NOT EXISTS teacher_subjects (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_create_content BOOLEAN DEFAULT TRUE,
    can_view BOOLEAN DEFAULT TRUE,
    assigned_by INTEGER REFERENCES users(id), -- الأدمن الذي منح الصلاحية
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(teacher_id, subject_id)
);

-- Down Migration
DROP TABLE IF EXISTS teacher_subjects; 