-- Up Migration
-- عدد الأسئلة المعروضة + ترتيب/عشوائية لكل طالب

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS question_display_mode TEXT NOT NULL DEFAULT 'ordered';

ALTER TABLE exams
  ADD COLUMN IF NOT EXISTS questions_count INTEGER,
  ADD COLUMN IF NOT EXISTS question_display_mode TEXT NOT NULL DEFAULT 'ordered';

ALTER TABLE course_level_exam_attempts
  ADD COLUMN IF NOT EXISTS question_order JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE exam_submissions
  ADD COLUMN IF NOT EXISTS question_order JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'course_level_exams_question_display_mode_check'
  ) THEN
    ALTER TABLE course_level_exams
      ADD CONSTRAINT course_level_exams_question_display_mode_check
      CHECK (question_display_mode IN ('ordered', 'random'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exams_question_display_mode_check'
  ) THEN
    ALTER TABLE exams
      ADD CONSTRAINT exams_question_display_mode_check
      CHECK (question_display_mode IN ('ordered', 'random'));
  END IF;
END $$;

COMMENT ON COLUMN course_level_exams.question_display_mode IS 'ordered = أول N أسئلة | random = N أسئلة عشوائية لكل طالب';
COMMENT ON COLUMN exams.questions_count IS 'عدد الأسئلة المعروضة للطالب من بنك الأسئلة (NULL = الكل)';
COMMENT ON COLUMN exams.question_display_mode IS 'ordered | random لكل طالب';
COMMENT ON COLUMN course_level_exam_attempts.question_order IS 'معرّفات أسئلة المحاولة بالترتيب المعروض';
COMMENT ON COLUMN exam_submissions.question_order IS 'معرّفات أسئلة المحاولة بالترتيب المعروض';

-- Down Migration
ALTER TABLE exam_submissions DROP COLUMN IF EXISTS question_order;
ALTER TABLE course_level_exam_attempts DROP COLUMN IF EXISTS question_order;

ALTER TABLE exams DROP CONSTRAINT IF EXISTS exams_question_display_mode_check;
ALTER TABLE exams DROP COLUMN IF EXISTS question_display_mode;
ALTER TABLE exams DROP COLUMN IF EXISTS questions_count;

ALTER TABLE course_level_exams DROP CONSTRAINT IF EXISTS course_level_exams_question_display_mode_check;
ALTER TABLE course_level_exams DROP COLUMN IF EXISTS question_display_mode;
