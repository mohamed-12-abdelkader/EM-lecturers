-- Create competition questions table
CREATE TABLE IF NOT EXISTS competition_questions (
    id SERIAL PRIMARY KEY,
    competition_id INTEGER NOT NULL,
    question_text TEXT NOT NULL,
    option_a VARCHAR(500) NOT NULL,
    option_b VARCHAR(500) NOT NULL,
    option_c VARCHAR(500) NOT NULL,
    option_d VARCHAR(500) NOT NULL,
    correct_answer CHAR(1) NOT NULL CHECK (correct_answer IN ('A', 'B', 'C', 'D')),
    points INTEGER DEFAULT 1,
    question_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL,
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_competition_questions_competition_id ON competition_questions(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_questions_is_active ON competition_questions(is_active);
CREATE INDEX IF NOT EXISTS idx_competition_questions_order ON competition_questions(question_order);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_competition_questions_updated_at 
    BEFORE UPDATE ON competition_questions 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add questions_count column to competitions table
ALTER TABLE competitions ADD COLUMN IF NOT EXISTS questions_count INTEGER DEFAULT 0;

-- Create function to update questions count
CREATE OR REPLACE FUNCTION update_competition_questions_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE competitions 
        SET questions_count = questions_count + 1 
        WHERE id = NEW.competition_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE competitions 
        SET questions_count = questions_count - 1 
        WHERE id = OLD.competition_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update questions count
CREATE TRIGGER trigger_update_competition_questions_count
    AFTER INSERT OR DELETE ON competition_questions
    FOR EACH ROW
    EXECUTE FUNCTION update_competition_questions_count();


