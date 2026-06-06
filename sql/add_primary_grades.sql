INSERT INTO grades (name) VALUES
('الصف الرابع الابتدائي'),
('الصف الخامس الابتدائي'),
('الصف السادس الابتدائي')
ON CONFLICT (name) DO NOTHING;