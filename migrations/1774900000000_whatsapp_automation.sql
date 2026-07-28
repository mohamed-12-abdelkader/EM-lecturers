-- Up Migration
-- WhatsApp automation platform: sessions, services, pools, conversations, queues

CREATE TABLE IF NOT EXISTS wa_sessions (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(64) NOT NULL UNIQUE,
  label VARCHAR(200),
  phone_number VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_messages_per_minute INTEGER NOT NULL DEFAULT 20,
  last_ready_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_sessions_status ON wa_sessions(status);
CREATE INDEX IF NOT EXISTS idx_wa_sessions_enabled ON wa_sessions(is_enabled) WHERE is_enabled = TRUE;

CREATE TABLE IF NOT EXISTS wa_services (
  id SERIAL PRIMARY KEY,
  key VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  type VARCHAR(32) NOT NULL DEFAULT 'chatbot'
    CHECK (type IN ('chatbot', 'transactional', 'broadcast')),
  scope VARCHAR(32) NOT NULL DEFAULT 'platform'
    CHECK (scope IN ('platform', 'tenant')),
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_services_type ON wa_services(type);
CREATE INDEX IF NOT EXISTS idx_wa_services_tenant ON wa_services(tenant_id);

CREATE TABLE IF NOT EXISTS wa_service_sessions (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL REFERENCES wa_services(id) ON DELETE CASCADE,
  session_slug VARCHAR(64) NOT NULL REFERENCES wa_sessions(slug) ON DELETE CASCADE,
  weight INTEGER NOT NULL DEFAULT 1 CHECK (weight >= 1),
  priority INTEGER NOT NULL DEFAULT 0,
  role VARCHAR(32) NOT NULL DEFAULT 'primary'
    CHECK (role IN ('primary', 'fallback')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (service_id, session_slug)
);

CREATE INDEX IF NOT EXISTS idx_wa_service_sessions_service
  ON wa_service_sessions(service_id) WHERE is_enabled = TRUE;

CREATE TABLE IF NOT EXISTS wa_conversations (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES wa_services(id) ON DELETE SET NULL,
  session_slug VARCHAR(64) NOT NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  student_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  contact_phone VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'bot'
    CHECK (status IN ('bot', 'waiting_human', 'human', 'closed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  wwebjs_conversation_id TEXT,
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_open_phone
  ON wa_conversations(service_id, contact_phone, status)
  WHERE status IN ('bot', 'waiting_human', 'human');

CREATE INDEX IF NOT EXISTS idx_wa_conversations_session
  ON wa_conversations(session_slug, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_tenant
  ON wa_conversations(tenant_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS wa_inbound_events (
  id SERIAL PRIMARY KEY,
  wa_message_id TEXT NOT NULL,
  session_slug VARCHAR(64) NOT NULL,
  from_phone VARCHAR(32) NOT NULL,
  body TEXT,
  event_type VARCHAR(64) NOT NULL DEFAULT 'message.inbound',
  routed_service_id INTEGER REFERENCES wa_services(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES wa_conversations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (wa_message_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_inbound_events_session
  ON wa_inbound_events(session_slug, processed_at DESC);

CREATE TABLE IF NOT EXISTS wa_outbound_jobs (
  id SERIAL PRIMARY KEY,
  service_id INTEGER REFERENCES wa_services(id) ON DELETE SET NULL,
  session_slug VARCHAR(64) NOT NULL,
  to_phone VARCHAR(32) NOT NULL,
  body TEXT NOT NULL,
  media_url TEXT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES wa_conversations(id) ON DELETE SET NULL,
  trigger_type VARCHAR(64),
  trigger_ref TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  last_error TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_outbound_jobs_pending
  ON wa_outbound_jobs(status, scheduled_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_wa_outbound_jobs_session
  ON wa_outbound_jobs(session_slug, created_at DESC);

-- Seed default technical support bot (disabled until handler is built)
INSERT INTO wa_services (key, name, description, type, scope, is_enabled, config)
VALUES (
  'technical_support_bot',
  'الدعم الفني',
  'روبوت دعم فني للطلاب عبر واتساب (تسجيل الدخول / إنشاء حساب على منصات المدرسين)',
  'chatbot',
  'platform',
  FALSE,
  '{"language":"ar","business_hours":null}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Down Migration
DROP TABLE IF EXISTS wa_outbound_jobs CASCADE;
DROP TABLE IF EXISTS wa_inbound_events CASCADE;
DROP TABLE IF EXISTS wa_conversations CASCADE;
DROP TABLE IF EXISTS wa_service_sessions CASCADE;
DROP TABLE IF EXISTS wa_services CASCADE;
DROP TABLE IF EXISTS wa_sessions CASCADE;
