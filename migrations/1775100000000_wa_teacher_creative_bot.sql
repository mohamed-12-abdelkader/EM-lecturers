-- Seed Teacher Creative Chatbot WhatsApp service (disabled until sessions assigned)
INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'teacher_creative_bot',
  'مساعد السوشيال',
  'روبوت مساعد السوشيال ميديا للمدرسين عبر واتساب (تعريف بالرقم الشخصي، نص وصور)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"language":"ar"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key = 'teacher_creative_bot';
