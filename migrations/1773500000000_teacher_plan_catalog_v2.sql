-- Up Migration
-- تحديث كatalog باقات المدرسين (الانطلاقة / التوسع / الاحتراف / التميز)

UPDATE teacher_subscription_plans
SET name_ar = 'الانطلاقة',
    name_en = 'Launch',
    default_price = 1500,
    sort_order = 1,
    features = '[
      "دعم فني",
      "إدارة الكورسات",
      "سيستم إدارة السنتر",
      "بنك أسئلة",
      "6 لايف في الشهر",
      "80 طالب"
    ]'::JSONB,
    updated_at = NOW()
WHERE code = 'bronze';

UPDATE teacher_subscription_plans
SET name_ar = 'التوسع',
    name_en = 'Expansion',
    default_price = 2000,
    sort_order = 2,
    features = '[
      "دعم فني",
      "إدارة الكورسات",
      "سيستم إدارة السنتر",
      "بنك أسئلة",
      "10 لايف في الشهر",
      "150 طالب"
    ]'::JSONB,
    updated_at = NOW()
WHERE code = 'silver';

UPDATE teacher_subscription_plans
SET name_ar = 'الاحتراف',
    name_en = 'Professional',
    default_price = 3000,
    sort_order = 3,
    features = '[
      "دعم فني",
      "إدارة الكورسات",
      "سيستم إدارة السنتر",
      "بنك أسئلة",
      "16 لايف في الشهر",
      "300 طالب",
      "إنشاء الامتحانات بالـ AI",
      "دعم علمي بالـ AI"
    ]'::JSONB,
    updated_at = NOW()
WHERE code = 'gold';

UPDATE teacher_subscription_plans
SET name_ar = 'التميز',
    name_en = 'Distinction',
    default_price = 4000,
    sort_order = 4,
    features = '[
      "دعم فني",
      "إدارة الكورسات",
      "سيستم إدارة السنتر",
      "بنك أسئلة",
      "لايف غير محدود",
      "طلاب غير محدود",
      "إنشاء الامتحانات بالـ AI",
      "دعم علمي بالـ AI",
      "محلل مستوى الطلاب بالـ AI",
      "مساعد السوشيال ميديا بالـ AI"
    ]'::JSONB,
    updated_at = NOW()
WHERE code = 'diamond';

-- Down Migration (restore legacy catalog)
UPDATE teacher_subscription_plans SET name_ar = 'الباقة الأساسية', name_en = 'Basic', default_price = 500, sort_order = 1, features = '["بدون بث مباشر"]'::JSONB WHERE code = 'bronze';
UPDATE teacher_subscription_plans SET name_ar = 'الباقة الاحترافية', name_en = 'Professional', default_price = 1000, sort_order = 2, features = '["4 بثوث مباشرة شهرياً"]'::JSONB WHERE code = 'silver';
UPDATE teacher_subscription_plans SET name_ar = 'الباقة المتقدمة', name_en = 'Premium', default_price = 1500, sort_order = 3, features = '["8 بثوث مباشرة شهرياً"]'::JSONB WHERE code = 'gold';
UPDATE teacher_subscription_plans SET name_ar = 'الباقة الماسية', name_en = 'Diamond', default_price = 2500, sort_order = 4, features = '["بث مباشر غير محدود"]'::JSONB WHERE code = 'diamond';
