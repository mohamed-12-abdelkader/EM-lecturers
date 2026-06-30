-- Allow exam analysis reports in data analyst chatbot history
-- Up
ALTER TABLE teacher_data_analyst_messages
  DROP CONSTRAINT IF EXISTS teacher_data_analyst_messages_report_type_check;

ALTER TABLE teacher_data_analyst_messages
  ADD CONSTRAINT teacher_data_analyst_messages_report_type_check
  CHECK (report_type IN ('student', 'course', 'general', 'exam', 'other'));

-- Down
ALTER TABLE teacher_data_analyst_messages
  DROP CONSTRAINT IF EXISTS teacher_data_analyst_messages_report_type_check;

ALTER TABLE teacher_data_analyst_messages
  ADD CONSTRAINT teacher_data_analyst_messages_report_type_check
  CHECK (report_type IN ('student', 'course', 'general', 'other'));
