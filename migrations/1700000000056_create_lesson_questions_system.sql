-- Up Migration
-- إنشاء نظام أسئلة الدروس بنفس نظام امتحانات المحاضرات

-- جدول أسئلة الدروس (مشابه لجدول exam_questions)
CREATE TABLE IF NOT EXISTS lesson_questions (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    question_text TEXT,
    question_image TEXT, -- رابط صورة السؤال
    grade INTEGER DEFAULT 1,
    question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE, -- ربط بجدول الأسئلة العام
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- فهارس لتحسين الأداء
CREATE INDEX IF NOT EXISTS idx_lesson_questions_lecture ON lesson_questions(lecture_id);
CREATE INDEX IF NOT EXISTS idx_lesson_questions_question ON lesson_questions(question_id);

-- Down Migration
DROP INDEX IF EXISTS idx_lesson_questions_question;
DROP INDEX IF EXISTS idx_lesson_questions_lecture;
DROP TABLE IF EXISTS lesson_questions;

