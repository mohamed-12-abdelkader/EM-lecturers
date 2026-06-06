-- Up Migration
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS meeting (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), -- works as room name also.

    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,

    room_sid VARCHAR(255) UNIQUE,

    egress_url VARCHAR(255), -- Recording URL

    title TEXT NOT NULL,
    allow_chat BOOLEAN DEFAULT TRUE,

    status VARCHAR(20) NOT NULL DEFAULT 'idle'
        CHECK (status IN ('idle', 'started', 'ended')),

    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kicked_participants (
    id SERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL REFERENCES meeting(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Down Migration
DROP TABLE IF EXISTS kicked_participants;
DROP TABLE IF EXISTS meeting;
