-- جلسات بث مباشر لمجموعات الكورسات العامة (مثل meeting للكورس العادي)

CREATE TABLE IF NOT EXISTS general_course_group_meeting (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id INTEGER NOT NULL REFERENCES general_course_groups(id) ON DELETE CASCADE,
    room_sid VARCHAR(255) UNIQUE,
    egress_url VARCHAR(255),
    title TEXT NOT NULL,
    allow_chat BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'started', 'ended')),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_general_course_group_meeting_group ON general_course_group_meeting(group_id);
CREATE INDEX IF NOT EXISTS idx_general_course_group_meeting_created_by ON general_course_group_meeting(created_by);
CREATE INDEX IF NOT EXISTS idx_general_course_group_meeting_status ON general_course_group_meeting(status);

CREATE TABLE IF NOT EXISTS general_course_group_meeting_kicked (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES general_course_group_meeting(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gc_group_meeting_kicked_meeting ON general_course_group_meeting_kicked(meeting_id);
