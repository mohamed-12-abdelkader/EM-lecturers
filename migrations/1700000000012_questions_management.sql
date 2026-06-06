-- Up Migration
CREATE TABLE IF NOT EXISTS questions_management (
    id SERIAL PRIMARY KEY,
    question_text TEXT NOT NULL,
    options JSONB NOT NULL, -- {"A": "option A", "B": "option B", "C": "option C", "D": "option D"}
    correct_option VARCHAR(1) DEFAULT NULL, -- A, B, C, or D
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE IF EXISTS questions_management; 