-- Up Migration
-- إضافة IDs للخيارات في الأسئلة

-- جدول خيارات الأسئلة (كل خيار له ID خاص)
CREATE TABLE IF NOT EXISTS assignment_question_options (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    option_letter TEXT NOT NULL CHECK (option_letter IN ('a', 'b', 'c', 'd')),
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(question_id, option_letter) -- كل سؤال له خيار واحد لكل حرف (a, b, c, d)
);

-- إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_assignment_question_options_question ON assignment_question_options(question_id);
CREATE INDEX IF NOT EXISTS idx_assignment_question_options_letter ON assignment_question_options(question_id, option_letter);

-- تعديل جدول الأسئلة لإزالة الخيارات القديمة (سنحتفظ بها للتوافق)
-- لكن سنستخدم الجدول الجديد للخيارات

-- تعديل جدول الأسئلة لإضافة correct_option_id
ALTER TABLE assignment_questions 
ADD COLUMN IF NOT EXISTS correct_option_id INTEGER REFERENCES assignment_question_options(id) ON DELETE SET NULL;

-- تعديل جدول إجابات الطلاب لإضافة option_ids (مع الحفاظ على student_answer و correct_answer للتوافق)
-- الأعمدة قد تكون موجودة من 0930 كـ INTEGER بدون FK؛ نضيف FK بعد وجود assignment_question_options
ALTER TABLE assignment_submission_answers
ADD COLUMN IF NOT EXISTS student_option_id INTEGER,
ADD COLUMN IF NOT EXISTS correct_option_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submission_answers_student_option_id_fkey'
  ) THEN
    ALTER TABLE assignment_submission_answers
      ADD CONSTRAINT assignment_submission_answers_student_option_id_fkey
      FOREIGN KEY (student_option_id) REFERENCES assignment_question_options (id) ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignment_submission_answers_correct_option_id_fkey'
  ) THEN
    ALTER TABLE assignment_submission_answers
      ADD CONSTRAINT assignment_submission_answers_correct_option_id_fkey
      FOREIGN KEY (correct_option_id) REFERENCES assignment_question_options (id) ON DELETE SET NULL;
  END IF;
END
$$;

-- تعديل student_answer و correct_answer لتكون nullable (للتوافق مع النظام الجديد)
ALTER TABLE assignment_submission_answers 
ALTER COLUMN student_answer DROP NOT NULL,
ALTER COLUMN correct_answer DROP NOT NULL;

-- Down Migration
ALTER TABLE assignment_submission_answers DROP COLUMN IF EXISTS correct_option_id;
ALTER TABLE assignment_submission_answers DROP COLUMN IF EXISTS student_option_id;
ALTER TABLE assignment_questions DROP COLUMN IF EXISTS correct_option_id;
DROP INDEX IF EXISTS idx_assignment_question_options_letter;
DROP INDEX IF EXISTS idx_assignment_question_options_question;
DROP TABLE IF EXISTS assignment_question_options;

