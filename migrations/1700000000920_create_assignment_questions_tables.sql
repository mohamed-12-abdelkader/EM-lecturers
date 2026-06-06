-- Up Migration
-- إنشاء جداول أسئلة الواجبات

-- جدول أسئلة الواجبات
CREATE TABLE IF NOT EXISTS assignment_questions (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES package_subject_item_lesson_assignments(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'image')),
    question_text TEXT, -- nullable if question_type is 'image'
    correct_answer TEXT NOT NULL CHECK (correct_answer IN ('a', 'b', 'c', 'd')),
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول صور أسئلة الواجبات (للدعم حتى 10 صور لكل سؤال)
CREATE TABLE IF NOT EXISTS assignment_question_images (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء indexes لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_assignment_questions_assignment ON assignment_questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_assignment_questions_type ON assignment_questions(question_type);
CREATE INDEX IF NOT EXISTS idx_assignment_question_images_question ON assignment_question_images(question_id);
CREATE INDEX IF NOT EXISTS idx_assignment_question_images_order ON assignment_question_images(question_id, order_index);

-- Down Migration
DROP INDEX IF EXISTS idx_assignment_question_images_order;
DROP INDEX IF EXISTS idx_assignment_question_images_question;
DROP INDEX IF EXISTS idx_assignment_questions_type;
DROP INDEX IF EXISTS idx_assignment_questions_assignment;
DROP TABLE IF EXISTS assignment_question_images;
DROP TABLE IF EXISTS assignment_questions;













