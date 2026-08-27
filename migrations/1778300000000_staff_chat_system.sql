-- Admin ↔ Employee real-time chat (منفصل عن chat_groups/chat_messages)

CREATE TABLE IF NOT EXISTS staff_conversations (
  id                  SERIAL PRIMARY KEY,
  type                VARCHAR(20) NOT NULL CHECK (type IN ('group', 'direct')),
  name                TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  direct_admin_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  direct_employee_id  INTEGER REFERENCES users(id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT staff_direct_pair CHECK (
    (type = 'direct' AND direct_admin_id IS NOT NULL AND direct_employee_id IS NOT NULL)
    OR (type = 'group' AND direct_admin_id IS NULL AND direct_employee_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_direct_conversation
  ON staff_conversations (direct_admin_id, direct_employee_id)
  WHERE type = 'direct';

CREATE INDEX IF NOT EXISTS idx_staff_conversations_type ON staff_conversations (type);

CREATE TABLE IF NOT EXISTS staff_conversation_members (
  id                    SERIAL PRIMARY KEY,
  conversation_id       INTEGER NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_message_id  INTEGER,
  last_read_at          TIMESTAMPTZ,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_conv_members_user ON staff_conversation_members (user_id);
CREATE INDEX IF NOT EXISTS idx_staff_conv_members_conv ON staff_conversation_members (conversation_id);

CREATE TABLE IF NOT EXISTS staff_messages (
  id                SERIAL PRIMARY KEY,
  conversation_id   INTEGER NOT NULL REFERENCES staff_conversations(id) ON DELETE CASCADE,
  sender_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type              VARCHAR(20) NOT NULL CHECK (type IN ('text', 'image')),
  content           TEXT,
  image_url         TEXT,
  edited_at         TIMESTAMPTZ,
  deleted_at        TIMESTAMPTZ,
  deleted_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_staff_messages_conv_created
  ON staff_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_messages_sender ON staff_messages (sender_id);

ALTER TABLE staff_conversation_members
  ADD CONSTRAINT staff_conv_members_last_read_fk
  FOREIGN KEY (last_read_message_id) REFERENCES staff_messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS staff_message_reads (
  id          SERIAL PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES staff_messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_staff_message_reads_msg ON staff_message_reads (message_id);
CREATE INDEX IF NOT EXISTS idx_staff_message_reads_user ON staff_message_reads (user_id);

-- مجموعة العمل الافتراضية
INSERT INTO staff_conversations (type, name, created_by)
SELECT 'group', 'فريق العمل', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM staff_conversations WHERE type = 'group' AND name = 'فريق العمل'
);

-- إضافة Admins و Employees النشطين للمجموعة
INSERT INTO staff_conversation_members (conversation_id, user_id)
SELECT gc.id, u.id
FROM staff_conversations gc
CROSS JOIN users u
LEFT JOIN employees e ON e.user_id = u.id
WHERE gc.type = 'group' AND gc.name = 'فريق العمل'
  AND (
    u.role = 'admin'
    OR (u.role = 'employee' AND COALESCE(e.is_active, TRUE) = TRUE)
  )
ON CONFLICT (conversation_id, user_id) DO NOTHING;
