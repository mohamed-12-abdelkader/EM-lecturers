-- Allow guided intake states: ASK_GRADE / ASK_COURSE / ASK_LECTURE

ALTER TABLE wa_exam_assistant_sessions
  DROP CONSTRAINT IF EXISTS wa_exam_assistant_sessions_state_check;

ALTER TABLE wa_exam_assistant_sessions
  ADD CONSTRAINT wa_exam_assistant_sessions_state_check
  CHECK (state IN (
    'IDLE',
    'CHECK_TEACHER_TASK',
    'ASK_GRADE',
    'ASK_COURSE',
    'ASK_LECTURE',
    'ASK_SOURCE',
    'SELECT_LESSON',
    'ASK_EXAM_SETTINGS',
    'WAITING_FOR_FILES',
    'PROCESSING_FILES',
    'EXTRACTING_QUESTIONS',
    'GENERATING_EXAM',
    'EXAM_REVIEW',
    'MODIFYING_EXAM',
    'SELECT_EXAM_TYPE',
    'SELECT_TARGET',
    'READY_TO_PUBLISH',
    'PUBLISHED',
    'FAILED',
    'CANCELLED'
  ));
