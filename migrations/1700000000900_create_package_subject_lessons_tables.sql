-- Up Migration
-- إنشاء جداول الدروس والفيديوهات والواجبات للمواد في الباقات

-- جدول الدروس للمواد في الباقات
CREATE TABLE IF NOT EXISTS package_subject_item_lessons (
    id SERIAL PRIMARY KEY,
    package_subject_item_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    order_index INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الفيديوهات للدروس
CREATE TABLE IF NOT EXISTS package_subject_item_lesson_videos (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES package_subject_item_lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    video_url TEXT NOT NULL,
    duration_minutes INTEGER,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الواجبات للدروس
CREATE TABLE IF NOT EXISTS package_subject_item_lesson_assignments (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES package_subject_item_lessons(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    questions_count INTEGER DEFAULT 0,
    duration_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_package_subject_lessons_subject ON package_subject_item_lessons(package_subject_item_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_lessons_created_by ON package_subject_item_lessons(created_by);
CREATE INDEX IF NOT EXISTS idx_package_subject_videos_lesson ON package_subject_item_lesson_videos(lesson_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_assignments_lesson ON package_subject_item_lesson_assignments(lesson_id);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_lesson_assignments;
DROP TABLE IF EXISTS package_subject_item_lesson_videos;
DROP TABLE IF EXISTS package_subject_item_lessons;
