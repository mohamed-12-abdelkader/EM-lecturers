-- Migration: Question Passages (قطعة + أسئلة MCQ)
-- Description: قطعة نصية وعليها عدة أسئلة اختيار من متعدد، عند جلب السؤال يُرجع معه القطعة

-- 1. جدول القطع (question_passages)
CREATE TABLE IF NOT EXISTS question_passages (
    id SERIAL PRIMARY KEY,
    lesson_id INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
    title VARCHAR(500),
    content TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_question_passages_lesson_id ON question_passages(lesson_id);

-- 2. إضافة عمود passage_id لجدول questions_v2 (سؤال مرتبط بقطعة)
ALTER TABLE questions_v2
    ADD COLUMN IF NOT EXISTS passage_id INTEGER REFERENCES question_passages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_questions_v2_passage_id ON questions_v2(passage_id);

-- 3. Trigger لتحديث updated_at
CREATE OR REPLACE FUNCTION update_question_passages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_question_passages_updated_at ON question_passages;
CREATE TRIGGER trigger_question_passages_updated_at
    BEFORE UPDATE ON question_passages
    FOR EACH ROW
    EXECUTE FUNCTION update_question_passages_updated_at();
