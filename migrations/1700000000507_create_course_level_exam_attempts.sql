-- Up Migration
-- Create table for student attempts on course-level exams
CREATE TABLE IF NOT EXISTS course_level_exam_attempts (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_level_exams(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
    started_at TIMESTAMP NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMP,
    total_grade INTEGER DEFAULT 0,
    obtained_grade INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(exam_id, student_id, attempt_number)
);

-- Create table for student answers
CREATE TABLE IF NOT EXISTS course_level_exam_answers (
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES course_level_exam_attempts(id) ON DELETE CASCADE,
    question_id INTEGER NOT NULL REFERENCES course_level_exam_questions(id) ON DELETE CASCADE,
    selected_answer CHAR(1) CHECK (selected_answer IN ('A', 'B', 'C', 'D')),
    is_correct BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_course_level_exam_attempts_exam_id ON course_level_exam_attempts(exam_id);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_attempts_student_id ON course_level_exam_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_attempts_status ON course_level_exam_attempts(status);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_answers_attempt_id ON course_level_exam_answers(attempt_id);
CREATE INDEX IF NOT EXISTS idx_course_level_exam_answers_question_id ON course_level_exam_answers(question_id);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_course_level_exam_attempts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_course_level_exam_attempts_updated_at
    BEFORE UPDATE ON course_level_exam_attempts
    FOR EACH ROW
    EXECUTE FUNCTION update_course_level_exam_attempts_updated_at();

-- Down Migration
DROP TRIGGER IF EXISTS trigger_update_course_level_exam_attempts_updated_at ON course_level_exam_attempts;
DROP FUNCTION IF EXISTS update_course_level_exam_attempts_updated_at();
DROP TABLE IF EXISTS course_level_exam_answers;
DROP TABLE IF EXISTS course_level_exam_attempts;

