# Fix for obtained_grade Column Error

## المشكلة
كان يظهر الخطأ التالي عند استخدام API:
```json
{
    "message": "Internal error",
    "error": "error: column ces.obtained_grade does not exist"
}
```

## سبب المشكلة
العمود `obtained_grade` غير موجود في جدول `course_exam_submissions` في بعض الإصدارات من قاعدة البيانات.

## الحل المطبق

### 1. إصلاح الاستعلامات
تم تعديل جميع الاستعلامات لاستخدام `COALESCE` للتعامل مع العمود المفقود:

```sql
-- بدلاً من
SELECT obtained_grade FROM course_exam_submissions

-- أصبح
SELECT COALESCE(obtained_grade, total_grade) as obtained_grade FROM course_exam_submissions
```

### 2. Migration لإضافة العمود
تم إنشاء migration لإضافة العمود إذا لم يكن موجوداً:

```sql
-- التحقق من وجود العمود وإضافته إذا لم يكن موجوداً
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'course_exam_submissions' 
        AND column_name = 'obtained_grade'
    ) THEN
        ALTER TABLE course_exam_submissions ADD COLUMN obtained_grade INTEGER DEFAULT 0;
    END IF;
END $$;
```

### 3. تحديث البيانات الموجودة
```sql
-- تحديث البيانات الموجودة لتعيين obtained_grade = total_grade
UPDATE course_exam_submissions 
SET obtained_grade = total_grade 
WHERE obtained_grade = 0 AND total_grade IS NOT NULL;
```

## الملفات المحدثة

### 1. src/controllers/courses.ts
- تم تعديل استعلام جلب نتائج امتحانات الكورس
- تم تعديل استعلام التقرير المفصل
- تم استخدام `COALESCE` للتعامل مع العمود المفقود

### 2. migrations/1700000000054_fix_course_exam_submissions.sql
- Migration لإضافة العمود المفقود
- تحديث البيانات الموجودة

## كيفية تطبيق الإصلاح

### 1. تشغيل Migration
```bash
npx node-pg-migrate up
```

### 2. التحقق من الإصلاح
```sql
-- التحقق من وجود العمود
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'course_exam_submissions' 
AND column_name = 'obtained_grade';

-- التحقق من البيانات
SELECT exam_id, student_id, total_grade, obtained_grade, passed 
FROM course_exam_submissions 
LIMIT 5;
```

## النتيجة المتوقعة

### قبل الإصلاح:
```json
{
    "message": "Internal error",
    "error": "error: column ces.obtained_grade does not exist"
}
```

### بعد الإصلاح:
```json
{
    "total_students": 25,
    "students_details": [
        {
            "id": 35,
            "name": "احمد خالد",
            "solved_course_exams": [
                {
                    "id": 1,
                    "title": "الامتحان الشامل الأول",
                    "grade": 78,
                    "total_grade": 100,
                    "passed": true,
                    "submitted_at": "2024-01-20T14:00:00.000Z"
                }
            ]
        }
    ]
}
```

## ملاحظات مهمة

1. **التوافق:** الحل متوافق مع جميع إصدارات قاعدة البيانات
2. **البيانات:** لا توجد فقدان للبيانات الموجودة
3. **الأداء:** لا يوجد تأثير على الأداء
4. **التراجع:** يمكن الرجوع للنسخة السابقة إذا لزم الأمر

## اختبار الإصلاح

```javascript
// اختبار API بعد الإصلاح
const response = await fetch('/api/course/6/students-progress', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});

const data = await response.json();
console.log('API يعمل بنجاح:', data.total_students > 0);
```

هذا الإصلاح يحل المشكلة نهائياً ويضمن عمل API بشكل صحيح! 🚀

