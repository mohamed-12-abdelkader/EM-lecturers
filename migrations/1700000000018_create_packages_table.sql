-- Up Migration
-- إنشاء جدول الباقات الدراسية
CREATE TABLE IF NOT EXISTS packages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    image TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS packages; 