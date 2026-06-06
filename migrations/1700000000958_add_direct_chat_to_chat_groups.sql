-- Up Migration
-- دعم شات 1:1 بين الطالب والمدرس باستخدام نفس جداول الشات الحالية

ALTER TABLE chat_groups
ADD COLUMN IF NOT EXISTS direct_student_id INTEGER;

ALTER TABLE chat_groups
ADD COLUMN IF NOT EXISTS direct_teacher_id INTEGER;

-- Foreign keys (conditional)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_groups_direct_student') THEN
    ALTER TABLE chat_groups
      ADD CONSTRAINT fk_chat_groups_direct_student
      FOREIGN KEY (direct_student_id)
      REFERENCES users(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_groups_direct_teacher') THEN
    ALTER TABLE chat_groups
      ADD CONSTRAINT fk_chat_groups_direct_teacher
      FOREIGN KEY (direct_teacher_id)
      REFERENCES users(id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- Unique pair for direct chats (NULLs allowed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_groups_direct_student_teacher_unique') THEN
    ALTER TABLE chat_groups
      ADD CONSTRAINT chat_groups_direct_student_teacher_unique
      UNIQUE (direct_student_id, direct_teacher_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_chat_groups_direct_student ON chat_groups(direct_student_id);
CREATE INDEX IF NOT EXISTS idx_chat_groups_direct_teacher ON chat_groups(direct_teacher_id);

-- Down Migration (best-effort)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_groups_direct_student') THEN
    ALTER TABLE chat_groups DROP CONSTRAINT fk_chat_groups_direct_student;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_chat_groups_direct_teacher') THEN
    ALTER TABLE chat_groups DROP CONSTRAINT fk_chat_groups_direct_teacher;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_groups_direct_student_teacher_unique') THEN
    ALTER TABLE chat_groups DROP CONSTRAINT chat_groups_direct_student_teacher_unique;
  END IF;
END $$;

DROP INDEX IF EXISTS idx_chat_groups_direct_student;
DROP INDEX IF EXISTS idx_chat_groups_direct_teacher;

ALTER TABLE chat_groups DROP COLUMN IF EXISTS direct_student_id;
ALTER TABLE chat_groups DROP COLUMN IF EXISTS direct_teacher_id;







