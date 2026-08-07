-- Seed Teacher Data Analyst WhatsApp service (disabled until sessions assigned)
INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'teacher_data_analyst_bot',
  'محلل البيانات',
  'روبوت محلل البيانات للمدرسين عبر واتساب (تعريف بالرقم الشخصي، تقارير نصية)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"language":"ar"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key = 'teacher_data_analyst_bot';
