-- إضافة بيانات تجريبية للمسابقات
-- تأكد من وجود الصفوف الدراسية أولاً

-- مسابقة الرياضيات للصف الأول
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة الرياضيات للصف الأول',
    'مسابقة شاملة في الرياضيات تشمل الجمع والطرح والضرب والقسمة',
    45,
    1,
    true,
    true,
    1
);

-- مسابقة العلوم للصف الثاني
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة العلوم للصف الثاني',
    'مسابقة في العلوم تشمل النباتات والحيوانات والطبيعة',
    60,
    2,
    true,
    true,
    1
);

-- مسابقة اللغة العربية للصف الثالث
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة اللغة العربية للصف الثالث',
    'مسابقة في القراءة والكتابة والنحو والإملاء',
    50,
    3,
    true,
    true,
    1
);

-- مسابقة اللغة الإنجليزية للصف الرابع
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة اللغة الإنجليزية للصف الرابع',
    'مسابقة في المفردات والقواعد والقراءة',
    55,
    4,
    true,
    true,
    1
);

-- مسابقة التاريخ للصف الخامس
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة التاريخ للصف الخامس',
    'مسابقة في التاريخ الإسلامي والعربي',
    40,
    5,
    true,
    true,
    1
);

-- مسابقة الجغرافيا للصف السادس
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة الجغرافيا للصف السادس',
    'مسابقة في جغرافية الوطن العربي والعالم',
    65,
    6,
    true,
    true,
    1
);

-- مسابقة مخفية (للاختبار)
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة مخفية للاختبار',
    'هذه مسابقة مخفية لاختبار نظام الرؤية',
    30,
    1,
    false,
    true,
    1
);

-- مسابقة غير مفعلة (للاختبار)
INSERT INTO competitions (title, description, duration, grade_id, is_visible, is_active, created_by) 
VALUES (
    'مسابقة غير مفعلة للاختبار',
    'هذه مسابقة غير مفعلة لاختبار نظام النشاط',
    35,
    2,
    true,
    false,
    1
);

-- عرض المسابقات المضافة
SELECT 
    c.id,
    c.title,
    c.description,
    c.duration,
    c.grade_id,
    g.name as grade_name,
    c.is_visible,
    c.is_active,
    c.created_at,
    u.name as creator_name
FROM competitions c
LEFT JOIN grades g ON c.grade_id = g.id
LEFT JOIN users u ON c.created_by = u.id
ORDER BY c.created_at DESC;




