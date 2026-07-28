-- Up Migration
-- Audit log for WhatsApp technical support bot sensitive actions

CREATE TABLE IF NOT EXISTS wa_support_audit (
  id SERIAL PRIMARY KEY,
  action VARCHAR(64) NOT NULL,
  contact_phone VARCHAR(32) NOT NULL,
  student_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES wa_conversations(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_support_audit_phone_created
  ON wa_support_audit(contact_phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_support_audit_action_created
  ON wa_support_audit(action, created_at DESC);

-- Down Migration
DROP TABLE IF EXISTS wa_support_audit CASCADE;
