-- Up Migration
-- جدول تخزين Expo Push Tokens للموبايل (ربط التوكن بالمستخدم)
CREATE TABLE IF NOT EXISTS expo_push_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    device_id TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, token)
);

CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_user_id ON expo_push_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_token ON expo_push_tokens (token);

-- Down Migration
DROP TABLE IF EXISTS expo_push_tokens;
