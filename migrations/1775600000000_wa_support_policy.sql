-- Up Migration
-- Platform-wide technical-support policy pack + admin customization chatbot

CREATE TABLE IF NOT EXISTS wa_support_policy_pack (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  style JSONB NOT NULL DEFAULT '{"mode":"normal"}'::jsonb,
  rewrite_prompt TEXT,
  rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_phone TEXT
);

INSERT INTO wa_support_policy_pack (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'support_policy_bot',
  'تخصيص دعم فني',
  'شات بوت للإدارة لتخصيص ردود الدعم الفني للطلاب (قواعد، أسلوب، إعادة صياغة)',
  'chatbot',
  'platform',
  FALSE,
  '{"human_mute_minutes":60,"allowed_roles":["admin"]}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DELETE FROM wa_services WHERE key = 'support_policy_bot';
DROP TABLE IF EXISTS wa_support_policy_pack;
