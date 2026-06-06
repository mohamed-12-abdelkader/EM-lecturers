-- Up Migration
-- إنشاء جدول الكورسات العامة (للادمن فقط)

CREATE TYPE course_category AS ENUM (
  'برمجة',
  'لغات',
  'إدارة وتسويق',
  'بيزنس',
  'مهارات متنوعة'
);

CREATE TABLE IF NOT EXISTS general_courses (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    image TEXT,
    category course_category NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء index للبحث السريع
CREATE INDEX IF NOT EXISTS idx_general_courses_category ON general_courses(category);
CREATE INDEX IF NOT EXISTS idx_general_courses_created_by ON general_courses(created_by);

-- Down Migration
DROP TABLE IF EXISTS general_courses;
DROP TYPE IF EXISTS course_category;

