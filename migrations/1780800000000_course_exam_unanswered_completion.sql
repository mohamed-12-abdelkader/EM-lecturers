-- Allow students to complete unanswered questions on a submitted attempt after the exam ends.

ALTER TABLE course_level_exams
  ADD COLUMN IF NOT EXISTS allow_unanswered_completion BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN course_level_exams.allow_unanswered_completion IS
  'When true and the exam has ended, students may complete unanswered questions on their latest submitted attempt.';

ALTER TABLE course_level_exam_attempts
  ADD COLUMN IF NOT EXISTS unanswered_completion_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unanswered_completion_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unanswered_completion_question_ids INT[];

COMMENT ON COLUMN course_level_exam_attempts.unanswered_completion_opened_at IS
  'When the student opened the unanswered-completion session for this attempt.';
COMMENT ON COLUMN course_level_exam_attempts.unanswered_completion_submitted_at IS
  'When the unanswered-completion session was submitted.';
COMMENT ON COLUMN course_level_exam_attempts.unanswered_completion_question_ids IS
  'Question IDs allowed during unanswered completion (snapshot at open).';

-- Down
-- ALTER TABLE course_level_exam_attempts
--   DROP COLUMN IF EXISTS unanswered_completion_question_ids,
--   DROP COLUMN IF EXISTS unanswered_completion_submitted_at,
--   DROP COLUMN IF EXISTS unanswered_completion_opened_at;
-- ALTER TABLE course_level_exams DROP COLUMN IF EXISTS allow_unanswered_completion;
