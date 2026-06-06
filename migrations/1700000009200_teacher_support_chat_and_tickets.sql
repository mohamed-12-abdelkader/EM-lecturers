-- شات دعم فني للمدرسين + جدول تذاكر الدعم
BEGIN;

-- شات المدرس (مثل support_chats للطالب)
CREATE TABLE IF NOT EXISTS teacher_support_chats (
  id SERIAL PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'bot_handling'
    CHECK (status IN ('open', 'closed', 'resolved', 'bot_handling', 'waiting_for_admin', 'admin_handling')),
  last_message_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  current_intent VARCHAR(50),
  bot_attempts INTEGER DEFAULT 0,
  escalation_reason TEXT,
  escalated_at TIMESTAMP,
  UNIQUE(teacher_id)
);

-- رسائل شات المدرس
CREATE TABLE IF NOT EXISTS teacher_support_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES teacher_support_chats(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('teacher', 'admin')),
  message_type VARCHAR(20) NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'file', 'audio', 'auto_reply')),
  text TEXT,
  media_url TEXT,
  media_type VARCHAR(100),
  media_name VARCHAR(255),
  media_size INTEGER,
  duration INTEGER,
  is_auto_reply BOOLEAN DEFAULT FALSE,
  faq_id INTEGER,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- تذاكر الدعم (مشاكل المدرسين أو الطلاب المُبلّغ عنها)
CREATE TABLE IF NOT EXISTS support_tickets (
  id SERIAL PRIMARY KEY,
  teacher_support_chat_id INTEGER REFERENCES teacher_support_chats(id) ON DELETE SET NULL,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_text TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  admin_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teacher_support_chats_teacher_id ON teacher_support_chats(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_support_chats_status ON teacher_support_chats(status);
CREATE INDEX IF NOT EXISTS idx_teacher_support_messages_chat_id ON teacher_support_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_teacher_support_messages_created_at ON teacher_support_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_teacher_id ON support_tickets(teacher_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);

COMMIT;
