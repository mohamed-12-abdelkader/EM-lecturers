-- Up Migration
CREATE TABLE IF NOT EXISTS lecture_views (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, lecture_id)
);

-- Down Migration
DROP TABLE IF EXISTS lecture_views; 