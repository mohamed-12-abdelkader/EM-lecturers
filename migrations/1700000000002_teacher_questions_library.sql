-- Up Migration
-- مكتبة أسئلة خاصة بكل مدرس (فصول - دروس - أجزاء - أسئلة)

CREATE TABLE IF NOT EXISTS teacher_question_chapters (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_question_lessons (
    id SERIAL PRIMARY KEY,
    chapter_id INTEGER NOT NULL REFERENCES teacher_question_chapters(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_question_parts (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES teacher_question_lessons(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_questions (
    id SERIAL PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES teacher_question_parts(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type TEXT NOT NULL, -- 'choice', 'text', ...
    choices JSONB, -- إذا كان اختياري
    answer TEXT, -- إذا كان مقالي أو إجابة صحيحة
    created_at TIMESTAMP DEFAULT NOW()
);

-- Down Migration
DROP TABLE IF EXISTS teacher_questions;
DROP TABLE IF EXISTS teacher_question_parts;
DROP TABLE IF EXISTS teacher_question_lessons;
DROP TABLE IF EXISTS teacher_question_chapters; 