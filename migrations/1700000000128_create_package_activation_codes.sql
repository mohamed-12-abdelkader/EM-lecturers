-- Up Migration
-- إنشاء جدول أكواد تفعيل الباقات
CREATE TABLE IF NOT EXISTS package_activation_codes (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- إنشاء جدول تفعيلات الباقات (ربط الطلاب بالباقات)
CREATE TABLE IF NOT EXISTS package_activations (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activation_code_id INTEGER REFERENCES package_activation_codes(id) ON DELETE SET NULL,
    activated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(package_id, student_id)
);

-- إنشاء indexes
CREATE INDEX IF NOT EXISTS idx_package_activation_codes_package ON package_activation_codes(package_id);
CREATE INDEX IF NOT EXISTS idx_package_activation_codes_code ON package_activation_codes(code);
CREATE INDEX IF NOT EXISTS idx_package_activation_codes_created_by ON package_activation_codes(created_by);
CREATE INDEX IF NOT EXISTS idx_package_activations_package ON package_activations(package_id);
CREATE INDEX IF NOT EXISTS idx_package_activations_student ON package_activations(student_id);
CREATE INDEX IF NOT EXISTS idx_package_activations_code ON package_activations(activation_code_id);

-- Down Migration
DROP TABLE IF EXISTS package_activations;
DROP TABLE IF EXISTS package_activation_codes;
































