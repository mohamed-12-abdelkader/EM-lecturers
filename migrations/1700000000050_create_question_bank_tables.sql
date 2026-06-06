-- Migration: Create Question Bank System Tables
-- Date: 2024-01-01
-- Description: Creates all necessary tables for the question bank system

-- 1. Question Banks Table
CREATE TABLE IF NOT EXISTS question_banks (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    grade_id INTEGER NOT NULL REFERENCES grades(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Already exists on 1700000000019_create_subjects_and_package_subjects.sql file.
-- 2. Subjects Table
-- CREATE TABLE IF NOT EXISTS subjects (
--     id SERIAL PRIMARY KEY,
--     name VARCHAR(255) NOT NULL,
--     description TEXT,
--     image_url TEXT,
--     color VARCHAR(7) DEFAULT '#FF6B6B', -- Hex color code
--     question_bank_id INTEGER NOT NULL REFERENCES question_banks(id) ON DELETE CASCADE,
--     is_active BOOLEAN DEFAULT true,
--     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- );

-- Rename old column "image" -> "image_url"
ALTER TABLE subjects
    RENAME COLUMN image TO image_url;

-- Add missing columns
ALTER TABLE subjects
    ADD COLUMN color VARCHAR(7) DEFAULT '#FF6B6B',
    ADD COLUMN question_bank_id INTEGER REFERENCES question_banks(id) ON DELETE CASCADE,
    ADD COLUMN is_active BOOLEAN DEFAULT true,
    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Add NOT NULL constraint on question_bank_id (if you're ready for it)
ALTER TABLE subjects
    ALTER COLUMN question_bank_id SET NOT NULL;


-- ============================= --
-- ============================= --

-- 3. Chapters Table
CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  order_num INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جداول قديمة أُنشئت بدون order_num (ترقية / تشغيل جزئي سابق)
ALTER TABLE chapters ADD COLUMN IF NOT EXISTS order_num INTEGER NOT NULL DEFAULT 1;

-- FKs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'chapters'
      AND constraint_name = 'fk_chapters_subject_id'
  ) THEN
    ALTER TABLE chapters
      ADD CONSTRAINT fk_chapters_subject_id
      FOREIGN KEY (subject_id)
      REFERENCES subjects(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'chapters'
      AND constraint_name = 'fk_chapters_created_by'
  ) THEN
    ALTER TABLE chapters
      ADD CONSTRAINT fk_chapters_created_by
      FOREIGN KEY (created_by)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- Unique per subject: (subject_id, lower(name))
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'uniq_chapters_subject_name'
  ) THEN
    CREATE UNIQUE INDEX uniq_chapters_subject_name ON chapters (subject_id, LOWER(name));
  END IF;
END $$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_set_chapters_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers WHERE event_object_table = 'chapters' AND trigger_name = 'set_chapters_updated_at'
  ) THEN
    CREATE TRIGGER set_chapters_updated_at BEFORE UPDATE ON chapters FOR EACH ROW EXECUTE FUNCTION trg_set_chapters_updated_at();
  END IF;
END $$;


-- ============================= --
-- ============================= --

-- 4. Lessons Table
CREATE TABLE IF NOT EXISTS lessons (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    image_url TEXT,
    content TEXT,
    order_num INTEGER NOT NULL DEFAULT 1,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Teacher Permissions Table
CREATE TABLE IF NOT EXISTS teacher_permissions (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    permissions TEXT[] NOT NULL DEFAULT '{}', -- Array of permissions
    granted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(teacher_id, subject_id)
);

-- 6. Questions Table
CREATE TABLE IF NOT EXISTS questions (
    id SERIAL PRIMARY KEY,
    text TEXT,
    options JSONB, -- For multiple choice questions
    type question_type,
    image	text,
    correct_answer TEXT,
    explanation TEXT,
    difficulty_level VARCHAR(20) DEFAULT 'medium', -- easy, medium, hard
    points INTEGER DEFAULT 1,
    lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
    teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
    approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول questions قد يكون موجوداً مسبقاً (1681229663482) بأعمدة قليلة فقط؛
-- CREATE TABLE IF NOT EXISTS لا يغيّر البنية، لذا نضيف الأعمدة الناقصة قبل الفهارس.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS options JSONB;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_answer TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR(20) DEFAULT 'medium';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 1;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS lesson_id INTEGER REFERENCES lessons (id) ON DELETE CASCADE;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS teacher_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE questions ADD COLUMN IF NOT EXISTS approved_by INTEGER REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- 7. Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_question_banks_grade_id ON question_banks(grade_id);
CREATE INDEX IF NOT EXISTS idx_question_banks_is_active ON question_banks(is_active);
CREATE INDEX IF NOT EXISTS idx_subjects_question_bank_id ON subjects(question_bank_id);
CREATE INDEX IF NOT EXISTS idx_subjects_is_active ON subjects(is_active);
CREATE INDEX IF NOT EXISTS idx_chapters_subject_id ON chapters(subject_id);
CREATE INDEX IF NOT EXISTS idx_chapters_order ON chapters(order_num);
CREATE INDEX IF NOT EXISTS idx_lessons_chapter_id ON lessons(chapter_id);
CREATE INDEX IF NOT EXISTS idx_lessons_order ON lessons(order_num);
CREATE INDEX IF NOT EXISTS idx_teacher_permissions_teacher_id ON teacher_permissions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_permissions_subject_id ON teacher_permissions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_lesson_id ON questions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_questions_teacher_id ON questions(teacher_id);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);

-- 8. Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 9. Create triggers for updated_at
CREATE TRIGGER update_question_banks_updated_at BEFORE UPDATE ON question_banks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subjects_updated_at BEFORE UPDATE ON subjects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_chapters_updated_at BEFORE UPDATE ON chapters FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_lessons_updated_at BEFORE UPDATE ON lessons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_teacher_permissions_updated_at BEFORE UPDATE ON teacher_permissions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
