-- Up Migration
-- إنشاء جداول المجموعات الدراسية البسيطة

-- جدول المجموعات الدراسية
CREATE TABLE IF NOT EXISTS study_groups (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_time TIME NOT NULL, -- وقت البداية
    end_time TIME NOT NULL, -- وقت النهاية
    days TEXT NOT NULL, -- أيام المجموعة (مثل: "السبت,الثلاثاء")
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول طلاب المجموعات
CREATE TABLE IF NOT EXISTS group_students (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES study_groups(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(group_id, student_id)
);

-- Down Migration
DROP TABLE IF EXISTS group_students;
DROP TABLE IF EXISTS study_groups; 