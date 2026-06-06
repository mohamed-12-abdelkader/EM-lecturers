-- Up Migration
CREATE TABLE IF NOT EXISTS course_level_exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('TEXT', 'IMAGE')),
    question_text TEXT,
    question_image TEXT,
    option_a VARCHAR(500) NOT NULL DEFAULT 'A',
    option_b VARCHAR(500) NOT NULL DEFAULT 'B',
    option_c VARCHAR(500) NOT NULL DEFAULT 'C',
    option_d VARCHAR(500) NOT NULL DEFAULT 'D',
    correct_answer CHAR(1) CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Validation constraints
    CONSTRAINT text_question_requires_text CHECK (
        (type = 'TEXT' AND question_text IS NOT NULL) OR 
        (type = 'IMAGE' AND question_image IS NOT NULL)
    ),
    CONSTRAINT text_question_requires_options CHECK (
        (type = 'TEXT' AND option_a IS NOT NULL AND option_b IS NOT NULL AND option_c IS NOT NULL AND option_d IS NOT NULL) OR
        (type = 'IMAGE')
    )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_exam_id ON course_level_exam_questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_created_by ON course_level_exam_questions(created_by);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_questions_type ON course_level_exam_questions(type);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_course_level_exam_questions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_course_level_exam_questions_updated_at
    BEFORE UPDATE ON course_level_exam_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_course_level_exam_questions_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS trigger_update_course_level_exam_questions_updated_at ON course_level_exam_questions;
DROP FUNCTION IF EXISTS update_course_level_exam_questions_updated_at();
DROP TABLE IF EXISTS course_level_exam_questions;

