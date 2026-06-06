-- Up Migration
-- إنشاء جدول مواد الباقات (مواد مخصصة لكل باقة)
CREATE TABLE IF NOT EXISTS package_subject_items (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    image TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS package_subject_items; 