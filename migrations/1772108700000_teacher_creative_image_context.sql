-- Teacher creative image context and edit tracking

ALTER TABLE teacher_creative_generations
  ADD COLUMN IF NOT EXISTS language_mode TEXT,
  ADD COLUMN IF NOT EXISTS edited_generation_id INTEGER;

UPDATE teacher_creative_generations
SET language_mode = 'arabic'
WHERE request_type = 'image'
  AND language_mode IS NULL;

ALTER TABLE teacher_creative_generations
DROP CONSTRAINT IF EXISTS teacher_creative_generations_language_mode_check;

ALTER TABLE teacher_creative_generations
ADD CONSTRAINT teacher_creative_generations_language_mode_check
CHECK (
  language_mode IS NULL
  OR language_mode IN ('arabic', 'english', 'mixed')
);

DO $$
BEGIN
  ALTER TABLE teacher_creative_generations
  ADD CONSTRAINT teacher_creative_generations_edited_generation_fk
  FOREIGN KEY (edited_generation_id)
  REFERENCES teacher_creative_generations(id)
  ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_teacher_creative_generations_edited_generation
  ON teacher_creative_generations(edited_generation_id);
