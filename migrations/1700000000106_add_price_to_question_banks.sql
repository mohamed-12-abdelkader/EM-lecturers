-- Add price column to question_banks
ALTER TABLE question_banks
  ADD COLUMN IF NOT EXISTS price NUMERIC(12,2) DEFAULT 0;







