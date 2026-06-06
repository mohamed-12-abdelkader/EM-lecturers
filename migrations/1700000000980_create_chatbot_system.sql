-- إنشاء نظام Chatbot ذكي جديد
BEGIN;

-- جدول قاعدة المعرفة (Knowledge Base)
CREATE TABLE IF NOT EXISTS chatbot_knowledge_base (
    id SERIAL PRIMARY KEY,
    problem TEXT NOT NULL, -- المشكلة الشائعة
    solution TEXT NOT NULL, -- الحل الخاص بالمشكلة
    keywords TEXT[], -- كلمات مفتاحية للمطابقة
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 0, -- الأولوية (كلما زادت كلما تم فحصها أولاً)
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول الشاتات
CREATE TABLE IF NOT EXISTS chatbot_chats (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'pending', 'resolved', 'closed')),
    needs_human_support BOOLEAN DEFAULT FALSE, -- يحتاج تدخل بشري
    last_message_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(student_id)
);

-- جدول الرسائل
CREATE TABLE IF NOT EXISTS chatbot_messages (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chatbot_chats(id) ON DELETE CASCADE,
    sender_type VARCHAR(20) NOT NULL CHECK (sender_type IN ('student', 'ai', 'admin')),
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- NULL للـ AI
    message_type VARCHAR(20) DEFAULT 'text' CHECK (message_type IN ('text', 'image', 'file', 'audio')),
    text TEXT NOT NULL,
    media_url TEXT,
    media_type VARCHAR(100),
    media_name VARCHAR(255),
    media_size INTEGER,
    duration INTEGER, -- مدة الرسالة الصوتية بالثواني
    knowledge_base_id INTEGER REFERENCES chatbot_knowledge_base(id) ON DELETE SET NULL, -- إذا كانت الإجابة من Knowledge Base
    delivered_at TIMESTAMP,
    read_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT chatbot_message_content_check CHECK (
        text IS NOT NULL OR 
        (text IS NULL AND media_url IS NOT NULL)
    )
);

-- جدول المشاكل المعلقة (Pending Chats)
CREATE TABLE IF NOT EXISTS chatbot_pending_chats (
    id SERIAL PRIMARY KEY,
    chat_id INTEGER NOT NULL REFERENCES chatbot_chats(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_student_message TEXT NOT NULL, -- آخر رسالة من الطالب
    last_student_message_at TIMESTAMP NOT NULL,
    assigned_admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(chat_id)
);

-- إنشاء الفهارس
CREATE INDEX IF NOT EXISTS idx_chatbot_knowledge_base_is_active ON chatbot_knowledge_base(is_active);
CREATE INDEX IF NOT EXISTS idx_chatbot_knowledge_base_priority ON chatbot_knowledge_base(priority DESC);

CREATE INDEX IF NOT EXISTS idx_chatbot_chats_student_id ON chatbot_chats(student_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_chats_admin_id ON chatbot_chats(admin_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_chats_status ON chatbot_chats(status);
CREATE INDEX IF NOT EXISTS idx_chatbot_chats_needs_human ON chatbot_chats(needs_human_support) WHERE needs_human_support = TRUE;
CREATE INDEX IF NOT EXISTS idx_chatbot_chats_last_message_at ON chatbot_chats(last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_chatbot_messages_chat_id ON chatbot_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_sender_type ON chatbot_messages(sender_type);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_created_at ON chatbot_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chatbot_messages_read_at ON chatbot_messages(read_at);

CREATE INDEX IF NOT EXISTS idx_chatbot_pending_chats_chat_id ON chatbot_pending_chats(chat_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_pending_chats_student_id ON chatbot_pending_chats(student_id);
CREATE INDEX IF NOT EXISTS idx_chatbot_pending_chats_resolved_at ON chatbot_pending_chats(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_chatbot_pending_chats_last_message_at ON chatbot_pending_chats(last_student_message_at DESC);

-- Triggers لتحديث updated_at
CREATE OR REPLACE FUNCTION update_chatbot_knowledge_base_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chatbot_knowledge_base_updated_at ON chatbot_knowledge_base;
CREATE TRIGGER trigger_chatbot_knowledge_base_updated_at
    BEFORE UPDATE ON chatbot_knowledge_base
    FOR EACH ROW
    EXECUTE FUNCTION update_chatbot_knowledge_base_updated_at();

CREATE OR REPLACE FUNCTION update_chatbot_chats_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_chatbot_chats_updated_at ON chatbot_chats;
CREATE TRIGGER trigger_chatbot_chats_updated_at
    BEFORE UPDATE ON chatbot_chats
    FOR EACH ROW
    EXECUTE FUNCTION update_chatbot_chats_updated_at();

COMMIT;

