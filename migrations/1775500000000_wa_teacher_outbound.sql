-- Up Migration
-- Teacher-owned WhatsApp sessions + transactional outbound services

ALTER TABLE wa_sessions
  ADD COLUMN IF NOT EXISTS teacher_id INTEGER NULL REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_wa_sessions_teacher_id
  ON wa_sessions(teacher_id)
  WHERE teacher_id IS NOT NULL;

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES
  (
    'teacher_student_notify',
    'إشعارات الطلاب',
    'إرسال إشعارات واتساب من المدرس لطلابه عبر أرقامه الخاصة',
    'transactional',
    'platform',
    FALSE,
    '{"owner":"teacher","human_mute_minutes":60}'::jsonb
  ),
  (
    'teacher_parent_report',
    'تقارير أولياء الأمور',
    'إرسال تقارير تقدم الطلاب لأولياء الأمور عبر واتساب من أرقام المدرس',
    'transactional',
    'platform',
    FALSE,
    '{"owner":"teacher","human_mute_minutes":60}'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key IN ('teacher_student_notify', 'teacher_parent_report');
DROP INDEX IF EXISTS idx_wa_sessions_teacher_id;
ALTER TABLE wa_sessions DROP COLUMN IF EXISTS teacher_id;
