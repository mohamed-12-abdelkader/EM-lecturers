-- Up Migration
-- إنشاء جدول ملفات المادة (package_subject_item_files)
-- ملفات على مستوى المادة نفسها (package_subject_items)

CREATE TABLE IF NOT EXISTS package_subject_item_files (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER, -- حجم الملف بالبايت
    file_type VARCHAR(100), -- نوع الملف (mime type)
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_package_subject_item_files_subject_id ON package_subject_item_files(subject_id);
CREATE INDEX IF NOT EXISTS idx_package_subject_item_files_order_index ON package_subject_item_files(order_index);

-- Down Migration
DROP TABLE IF EXISTS package_subject_item_files;
