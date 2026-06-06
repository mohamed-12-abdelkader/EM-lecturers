-- إنشاء نظام الدردشة
-- This migration creates the basic chat system tables

-- إنشاء جدول مجموعات الدردشة
CREATE TABLE IF NOT EXISTS chat_groups (
    id SERIAL PRIMARY KEY,
    grade_id INTEGER NOT NULL,
    name VARCHAR(255) NOT NULL,
    owner_teacher_id INTEGER,
    allow_student_send BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    CONSTRAINT fk_chat_groups_grade 
        FOREIGN KEY (grade_id) 
        REFERENCES grades(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_chat_groups_owner_teacher 
        FOREIGN KEY (owner_teacher_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
    
    -- Constraints
    CONSTRAINT valid_grade_id CHECK (grade_id > 0),
    CONSTRAINT valid_name CHECK (LENGTH(name) > 0)
);

-- إنشاء جدول أعضاء مجموعات الدردشة
CREATE TABLE IF NOT EXISTS chat_group_members (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('student', 'teacher')),
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Foreign key constraints
    CONSTRAINT fk_chat_group_members_group 
        FOREIGN KEY (group_id) 
        REFERENCES chat_groups(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_chat_group_members_user 
        FOREIGN KEY (user_id) 
        REFERENCES users(id) 
        ON DELETE CASCADE,
    
    -- Unique constraint to prevent duplicate memberships
    CONSTRAINT unique_group_member 
        UNIQUE (group_id, user_id),
    
    -- Constraints
    CONSTRAINT valid_role CHECK (role IN ('student', 'teacher'))
);

-- إنشاء جدول رسائل الدردشة
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    group_id INTEGER NOT NULL,
    sender_id INTEGER,
    text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,


    attachment_url TEXT,
    attachment_type TEXT,
    attachment_name TEXT,
    attachment_mime TEXT,
    attachment_size INTEGER,
    attachment_duration_ms INTEGER,

    
    -- Foreign key constraints
    CONSTRAINT fk_chat_messages_group 
        FOREIGN KEY (group_id) 
        REFERENCES chat_groups(id) 
        ON DELETE CASCADE,
    
    CONSTRAINT fk_chat_messages_sender 
        FOREIGN KEY (sender_id) 
        REFERENCES users(id) 
        ON DELETE SET NULL,
    
    -- Constraints
    CONSTRAINT valid_group_id CHECK (group_id > 0),
    CONSTRAINT message_content_check CHECK (
        text IS NOT NULL OR 
        (text IS NULL AND attachment_url IS NOT NULL)
    )
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_chat_groups_grade_id ON chat_groups(grade_id);
CREATE INDEX IF NOT EXISTS idx_chat_groups_owner_teacher_id ON chat_groups(owner_teacher_id);
CREATE INDEX IF NOT EXISTS idx_chat_groups_created_at ON chat_groups(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_group_id ON chat_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user_id ON chat_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_role ON chat_group_members(role);

CREATE INDEX IF NOT EXISTS idx_chat_messages_group_id ON chat_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_id ON chat_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at DESC);

-- Create trigger to update updated_at timestamp for chat_groups
CREATE OR REPLACE FUNCTION update_chat_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_chat_groups_updated_at
    BEFORE UPDATE ON chat_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_groups_updated_at();

-- Create trigger to update updated_at timestamp for chat_messages
CREATE OR REPLACE FUNCTION update_chat_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_chat_messages_updated_at
    BEFORE UPDATE ON chat_messages
    FOR EACH ROW
    EXECUTE FUNCTION update_chat_messages_updated_at();

-- Add comments
COMMENT ON TABLE chat_groups IS 'جدول مجموعات الدردشة';
COMMENT ON COLUMN chat_groups.grade_id IS 'معرف الصف الدراسي';
COMMENT ON COLUMN chat_groups.name IS 'اسم المجموعة';
COMMENT ON COLUMN chat_groups.owner_teacher_id IS 'معرف المعلم المالك للمجموعة';
COMMENT ON COLUMN chat_groups.allow_student_send IS 'هل يسمح للطلاب بإرسال الرسائل';

COMMENT ON TABLE chat_group_members IS 'جدول أعضاء مجموعات الدردشة';
COMMENT ON COLUMN chat_group_members.group_id IS 'معرف المجموعة';
COMMENT ON COLUMN chat_group_members.user_id IS 'معرف المستخدم';
COMMENT ON COLUMN chat_group_members.role IS 'دور المستخدم في المجموعة';

COMMENT ON TABLE chat_messages IS 'جدول رسائل الدردشة';
COMMENT ON COLUMN chat_messages.group_id IS 'معرف المجموعة';
COMMENT ON COLUMN chat_messages.sender_id IS 'معرف المرسل';
COMMENT ON COLUMN chat_messages.text IS 'نص الرسالة';