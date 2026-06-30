-- Up Migration — ملفاتي (My Files) for teachers

CREATE TABLE IF NOT EXISTS file_categories (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_file_categories_teacher_name UNIQUE (teacher_id, name)
);

CREATE TABLE IF NOT EXISTS teacher_files (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    file_url TEXT NOT NULL,
    file_key TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    file_extension VARCHAR(20) NOT NULL,
    mime_type VARCHAR(150) NOT NULL,
    category_id INTEGER REFERENCES file_categories(id) ON DELETE SET NULL,
    downloads_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_teacher_files_teacher_id
    ON teacher_files(teacher_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_files_category_id
    ON teacher_files(category_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_files_created_at
    ON teacher_files(created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_teacher_files_extension
    ON teacher_files(file_extension) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_file_categories_teacher_id
    ON file_categories(teacher_id);

-- Down Migration
DROP TABLE IF EXISTS teacher_files;
DROP TABLE IF EXISTS file_categories;
