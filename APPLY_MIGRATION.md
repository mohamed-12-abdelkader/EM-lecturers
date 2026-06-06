# تطبيق Migration للدروس والفيديوهات والواجبات

## المشكلة
الخطأ: `relation "package_subject_item_lessons" does not exist`

## الحل

يجب تطبيق الـ migration التالي على قاعدة البيانات:

**ملف Migration**: `migrations/1700000000900_create_package_subject_lessons_tables.sql`

## طريقة التطبيق

### الطريقة 1: استخدام psql (موصى بها)

```bash
# الاتصال بقاعدة البيانات
psql -U your_username -d your_database_name

# ثم تشغيل الـ migration
\i migrations/1700000000900_create_package_subject_lessons_tables.sql
```

أو مباشرة من سطر الأوامر:

```bash
psql -U your_username -d your_database_name -f migrations/1700000000900_create_package_subject_lessons_tables.sql
```

### الطريقة 2: استخدام npm migrate (عندما تكون قاعدة البيانات متصلة)

```bash
npm run migrate up
```

### الطريقة 3: استخدام ملف SQL الجاهز

```bash
psql -U your_username -d your_database_name -f sql/create_package_subject_lessons_tables.sql
```

### الطريقة 4: نسخ ولصق SQL مباشرة

افتح ملف `sql/create_package_subject_lessons_tables.sql` وانسخ محتواه ثم الصقه في أي أداة إدارة قاعدة بيانات (pgAdmin, DBeaver, etc.)

## التحقق من التطبيق

بعد تطبيق الـ migration، تحقق من وجود الجداول:

```sql
-- التحقق من وجود الجداول
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'package_subject_item_lessons',
    'package_subject_item_lesson_videos',
    'package_subject_item_lesson_assignments'
  );
```

يجب أن ترى 3 جداول في النتيجة.

## ملاحظة

إذا كان الخادم يعمل، قد تحتاج إلى إعادة تشغيله بعد تطبيق الـ migration.

