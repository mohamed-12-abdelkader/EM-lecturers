-- Seed Teacher Exam Builder WhatsApp service (disabled until sessions assigned)
INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'teacher_exam_builder_bot',
  'مساعد الامتحانات',
  'روبوت مساعد إنشاء الامتحانات للمدرسين عبر واتساب (اقتراح/تعديل/اعتماد قائمة الأسئلة؛ الإنشاء من الموقع)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"language":"ar"}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key = 'teacher_exam_builder_bot';
