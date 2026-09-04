-- Up Migration
CREATE TABLE IF NOT EXISTS wa_support_policy_messages (
  id SERIAL PRIMARY KEY,
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant')),
  body TEXT NOT NULL,
  admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_support_policy_messages_created
  ON wa_support_policy_messages(id DESC);

-- Down Migration
DROP TABLE IF EXISTS wa_support_policy_messages;
