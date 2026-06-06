-- Allow correct_answer to be NULL in competition_questions table
-- This allows questions to be created without specifying the correct answer initially

-- First, drop the existing CHECK constraint
ALTER TABLE competition_questions DROP CONSTRAINT IF EXISTS competition_questions_correct_answer_check;

-- Modify the column to allow NULL values
ALTER TABLE competition_questions ALTER COLUMN correct_answer DROP NOT NULL;

-- Add a new CHECK constraint that allows NULL or valid values
ALTER TABLE competition_questions ADD CONSTRAINT competition_questions_correct_answer_check 
    CHECK (correct_answer IS NULL OR correct_answer IN ('A', 'B', 'C', 'D'));

-- Add a comment to explain the change
COMMENT ON COLUMN competition_questions.correct_answer IS 'Correct answer (A, B, C, or D). Can be NULL if not yet determined.';


