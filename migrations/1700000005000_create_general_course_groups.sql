-- Migration: Create General Course Groups System
-- نظام المجموعات للكورسات العامة

-- 1. جدول المجموعات
CREATE TABLE IF NOT EXISTS general_course_groups (
    id SERIAL PRIMARY KEY,
    general_course_id INTEGER NOT NULL REFERENCES general_courses(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL, -- اسم المجموعة: A, B, C...
    max_students INTEGER DEFAULT 0, -- 0 means unlimited
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_general_course_groups_course ON general_course_groups(general_course_id);

-- 2. جدول الجلسات المباشرة (تحضيري للمستقبل)
CREATE TABLE IF NOT EXISTS general_course_group_sessions (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES general_course_groups(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    start_time TIMESTAMP NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    meeting_link TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_sessions_group ON general_course_group_sessions(group_id);
CREATE INDEX IF NOT EXISTS idx_group_sessions_start_time ON general_course_group_sessions(start_time);

-- 3. تعديل جدول الاشتراكات لربط الطالب بالمجموعة
-- إذا كان group_id فارغاً، فالطالب في قائمة الانتظار (Waitlist)
-- عند حذف المجموعة، يعود الطلاب لقائمة الانتظار (SET NULL)
ALTER TABLE general_course_enrollments
ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES general_course_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_enrollments_group ON general_course_enrollments(group_id);

-- Down Migration
-- ALTER TABLE general_course_enrollments DROP COLUMN group_id;
-- DROP TABLE general_course_group_sessions;
-- DROP TABLE general_course_groups;
