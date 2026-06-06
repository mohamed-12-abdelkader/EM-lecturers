-- Up Migration
-- إضافة ملفات PDF للدرس + Exams على مستوى الدرس (داخل مادة الباقة)

CREATE TABLE IF NOT EXISTS package_subject_item_lesson_files (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES package_subject_item_lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psilf_lesson ON package_subject_item_lesson_files(lesson_id);

CREATE TABLE IF NOT EXISTS package_subject_item_lesson_exams (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES package_subject_item_lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 0,
    total_marks INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT false NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psile_lesson ON package_subject_item_lesson_exams(lesson_id);
CREATE INDEX IF NOT EXISTS idx_psile_visibility ON package_subject_item_lesson_exams(is_visible);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_lesson_exams;
DROP TABLE IF EXISTS package_subject_item_lesson_files;












