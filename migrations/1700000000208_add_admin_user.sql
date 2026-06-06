-- إضافة مستخدم admin
INSERT INTO users (email, password, name, role) 
VALUES ('admin@example.com', '$2b$10$rQZ8kL9vQZ8kL9vQZ8kL9u', 'Admin User', 'admin')
ON CONFLICT (email) DO NOTHING;

