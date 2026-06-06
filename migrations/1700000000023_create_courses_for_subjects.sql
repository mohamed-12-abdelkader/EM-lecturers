-- Up Migration
-- إنشاء جدول الكورسات للمواد
CREATE TABLE IF NOT EXISTS subject_courses (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    image TEXT,
    price NUMERIC(10, 2) DEFAULT 0.00, -- 0.00 يعني مجاني
    duration_hours INTEGER DEFAULT 0,
    level VARCHAR(50) DEFAULT 'مبتدئ', -- مبتدئ، متوسط، متقدم
    status VARCHAR(20) DEFAULT 'draft', -- draft, published, archived
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS subject_courses; 