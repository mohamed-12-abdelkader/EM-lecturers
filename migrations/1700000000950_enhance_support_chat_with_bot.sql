-- Migration: Enhance Support Chat with AI Bot Features
-- Date: 2024-01-XX
-- Description: Adds bot handling statuses, intent tracking, and escalation support

BEGIN;

-- الجدولان أساس شات الدعم للطالب ولم يُعرَّفا في migration أقدم من 0950
CREATE TABLE IF NOT EXISTS support_chats (
  id SERIAL PRIMARY KEY,
  student_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  admin_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT support_chats_status_check CHECK (
    status IN ('open', 'closed', 'resolved')
  )
);

CREATE TABLE IF NOT EXISTS support_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES support_chats (id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('student', 'admin')),
  message_type TEXT NOT NULL DEFAULT 'text',
  text TEXT,
  media_url TEXT,
  media_type TEXT,
  media_name TEXT,
  media_size INTEGER,
  duration INTEGER,
  is_auto_reply BOOLEAN NOT NULL DEFAULT false,
  faq_id INTEGER,
  delivered_at TIMESTAMP,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_messages_chat_id ON support_messages (chat_id);
CREATE INDEX IF NOT EXISTS idx_support_messages_chat_created ON support_messages (chat_id, created_at DESC);

-- Update support_chats table to add new statuses and tracking fields
ALTER TABLE support_chats 
  DROP CONSTRAINT IF EXISTS support_chats_status_check;

-- Add new status values: bot_handling, waiting_for_admin, admin_handling
ALTER TABLE support_chats 
  ADD CONSTRAINT support_chats_status_check 
  CHECK (status IN ('open', 'closed', 'resolved', 'bot_handling', 'waiting_for_admin', 'admin_handling'));

-- Add new columns for bot tracking
ALTER TABLE support_chats 
  ADD COLUMN IF NOT EXISTS current_intent VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bot_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_reason TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP;

-- Update existing 'open' status to 'bot_handling' for chats without admin
UPDATE support_chats 
SET status = 'bot_handling' 
WHERE status = 'open' AND admin_id IS NULL;

-- Update existing 'open' status to 'admin_handling' for chats with admin
UPDATE support_chats 
SET status = 'admin_handling' 
WHERE status = 'open' AND admin_id IS NOT NULL;

-- Create index for bot-related queries
CREATE INDEX IF NOT EXISTS idx_support_chats_status_bot ON support_chats(status) 
WHERE status IN ('bot_handling', 'waiting_for_admin');

CREATE INDEX IF NOT EXISTS idx_support_chats_current_intent ON support_chats(current_intent);

COMMIT;

