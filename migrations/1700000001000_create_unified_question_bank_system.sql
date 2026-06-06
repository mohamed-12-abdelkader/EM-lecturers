-- Migration: Create Unified Question Bank System
-- Date: 2024-01-XX
-- Description: نظام موحد ومرن لإدارة الأسئلة يدعم أنواع متعددة

BEGIN;

-- ============================================
-- 1. جدول الأسئلة الموحد (questions_v2)
-- ============================================
CREATE TABLE IF NOT EXISTS questions_v2 (
    id SERIAL PRIMARY KEY,
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) NOT NULL CHECK (question_type IN ('text_only', 'text_with_image', 'image_choices')),
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    correct_answer_index INTEGER NOT NULL CHECK (correct_answer_index >= 0 AND correct_answer_index <= 3),
    explanation TEXT,
    difficulty_level VARCHAR(20) DEFAULT 'medium' CHECK (difficulty_level IN ('easy', 'medium', 'hard')),
    points INTEGER DEFAULT 1,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- 2. جدول خيارات الأسئلة (question_options)
-- ============================================
-- يدعم خيارات نصية أو صور
CREATE TABLE IF NOT EXISTS question_options (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions_v2(id) ON DELETE CASCADE,
    option_index INTEGER NOT NULL CHECK (option_index >= 0 AND option_index <= 3),
    option_type VARCHAR(20) NOT NULL CHECK (option_type IN ('text', 'image')),
    text_content TEXT, -- للخيارات النصية
    image_url TEXT, -- للخيارات الصورية
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(question_id, option_index)
);

-- ============================================
-- 3. جدول صور الأسئلة (question_media)
-- ============================================
-- لإضافة صورة اختيارية للسؤال نفسه (لاحقًا)
CREATE TABLE IF NOT EXISTS question_media (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions_v2(id) ON DELETE CASCADE,
    media_type VARCHAR(20) NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'diagram', 'chart')),
    media_url TEXT NOT NULL,
    media_name VARCHAR(255),
    media_size INTEGER,
    uploaded_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(question_id) -- سؤال واحد = صورة واحدة فقط
);

-- ============================================
-- 4. الفهارس (Indexes)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_questions_v2_lesson_id ON questions_v2(lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_v2_teacher_id ON questions_v2(teacher_id);
CREATE INDEX IF NOT EXISTS idx_questions_v2_status ON questions_v2(status);
CREATE INDEX IF NOT EXISTS idx_questions_v2_type ON questions_v2(question_type);
CREATE INDEX IF NOT EXISTS idx_questions_v2_created_at ON questions_v2(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_options_question_id ON question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_question_options_index ON question_options(question_id, option_index);

CREATE INDEX IF NOT EXISTS idx_question_media_question_id ON question_media(question_id);

-- ============================================
-- 5. Triggers لتحديث updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_questions_v2_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_questions_v2_updated_at
    BEFORE UPDATE ON questions_v2
    FOR EACH ROW
    EXECUTE FUNCTION update_questions_v2_updated_at();

COMMIT;









