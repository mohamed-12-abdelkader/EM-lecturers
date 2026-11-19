-- Up Migration: Teacher-owned scientific support WhatsApp service

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'teacher_scientific_support',
  'الدعم العلمي',
  'يرد المساعد العلمي على أسئلة الطلاب عبر رقم واتساب المدرس من مواد هذا المدرس فقط',
  'chatbot',
  'platform',
  FALSE,
  '{
    "owner": "teacher",
    "human_mute_minutes": 60,
    "language": "ar",
    "teacher_scoped": true
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
-- DELETE FROM wa_services WHERE key = 'teacher_scientific_support';
