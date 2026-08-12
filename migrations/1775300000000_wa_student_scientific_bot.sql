-- Seed Student Scientific Chatbot WhatsApp service (disabled until sessions assigned)
INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'student_scientific_bot',
  'المساعد العلمي',
  'روبوت المساعد العلمي للطلاب عبر واتساب (تعريف برقم الطالب، مواد المدرس)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"language":"ar"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key = 'student_scientific_bot';
