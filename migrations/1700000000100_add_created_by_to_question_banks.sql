-- Add created_by column to question_banks and FK to users
ALTER TABLE question_banks
ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id) ON DELETE SET NULL;


