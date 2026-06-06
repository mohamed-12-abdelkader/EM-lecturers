-- Up Migration
-- إضافة ملفات PDF + Exams عامة على مستوى المجموعة داخل مادة الباقة (package_subject_item_groups)

CREATE TABLE IF NOT EXISTS package_subject_item_group_files (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES package_subject_item_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    file_url TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psigf_group ON package_subject_item_group_files(group_id);

CREATE TABLE IF NOT EXISTS package_subject_item_group_exams (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES package_subject_item_groups(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    duration_minutes INTEGER DEFAULT 0,
    total_marks INTEGER DEFAULT 0,
    is_visible BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_psige_group ON package_subject_item_group_exams(group_id);
CREATE INDEX IF NOT EXISTS idx_psige_visibility ON package_subject_item_group_exams(is_visible);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_group_exams;
DROP TABLE IF EXISTS package_subject_item_group_files;







