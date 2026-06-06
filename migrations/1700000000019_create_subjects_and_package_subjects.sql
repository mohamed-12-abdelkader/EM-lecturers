-- Up Migration
-- إنشاء جدول المواد
CREATE TABLE IF NOT EXISTS subjects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    image TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء جدول ربط الباقات بالمواد
CREATE TABLE IF NOT EXISTS package_subjects (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(package_id, subject_id)
);


-- Down Migration
DROP TABLE IF EXISTS package_subjects;
DROP TABLE IF EXISTS subjects; 