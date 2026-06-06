-- Up Migration
CREATE TABLE IF NOT EXISTS competitions (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    image_url VARCHAR(500),
    duration INTEGER NOT NULL CHECK (duration > 0),
    grade_id INTEGER NOT NULL,
    is_visible BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    questions_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER NOT NULL,
    
    -- Foreign key constraints
    CONSTRAINT fk_competitions_grade 
        FOREIGN KEY (grade_id) 
        REFERENCES grades(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_competitions_created_by 
        FOREIGN KEY (created_by) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT valid_duration CHECK (duration > 0),
    CONSTRAINT valid_questions_count CHECK (questions_count >= 0)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_competitions_grade_id ON competitions(grade_id);

-- Function to auto-update updated_at column
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Down Migration
DROP TABLE IF EXISTS competitions;
