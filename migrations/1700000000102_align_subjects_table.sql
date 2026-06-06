-- Align subjects table to required schema

-- Ensure base columns exist
ALTER TABLE subjects
  ADD COLUMN IF NOT EXISTS question_bank_id INTEGER,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS created_by INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS color TEXT;

-- Backfill question_bank_id if missing by joining legacy relations if any (noop here)

-- Add FKs and constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'subjects'
      AND tc.constraint_name = 'fk_subjects_question_bank'
  ) THEN
    ALTER TABLE subjects
      ADD CONSTRAINT fk_subjects_question_bank
      FOREIGN KEY (question_bank_id)
      REFERENCES question_banks(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints tc
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_name = 'subjects'
      AND tc.constraint_name = 'fk_subjects_created_by'
  ) THEN
    ALTER TABLE subjects
      ADD CONSTRAINT fk_subjects_created_by
      FOREIGN KEY (created_by)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Unique per bank: (question_bank_id, name)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_subjects_bank_name'
  ) THEN
    CREATE UNIQUE INDEX uniq_subjects_bank_name ON subjects (question_bank_id, LOWER(name));
  END IF;
END $$;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION trg_set_subjects_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'subjects' AND trigger_name = 'set_subjects_updated_at'
  ) THEN
    CREATE TRIGGER set_subjects_updated_at BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION trg_set_subjects_updated_at();
  END IF;
END $$;


