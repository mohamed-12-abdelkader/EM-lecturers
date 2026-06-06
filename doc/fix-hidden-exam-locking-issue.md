# إصلاح مشكلة قفل المحاضرات مع الامتحانات المخفية

## المشكلة
عند إنشاء امتحان مع `is_visible = false` و `lock_next_lectures = true`، كانت المحاضرات التالية تبقى مقفلة رغم أن الامتحان مخفي عن الطالب.

## السبب
المنطق السابق كان يفحص فقط `lock_next_lectures = true` دون التأكد من أن الامتحان مرئي للطالب حالياً.

## الحل المطبق

### 1. تحديث منطق فحص الامتحانات المانعة للوصول
```sql
-- الاستعلام الجديد يفحص جميع الشروط:
SELECT e.id FROM exams e
JOIN lectures l ON l.id = e.lecture_id
JOIN courses c ON c.id = l.course_id
JOIN enrollments en ON en.course_id = c.id
WHERE e.lecture_id = $1 
AND en.user_id = $2
AND e.lock_next_lectures = true
AND e.is_visible = true  -- يجب أن يكون مرئي
AND (e.show_at IS NULL OR e.show_at <= $3)  -- يجب أن يكون في الوقت المحدد
AND (e.hide_at IS NULL OR e.hide_at >= $3)
```

### 2. شروط قفل المحاضرات التالية
قفل المحاضرات التالية يعمل **فقط** إذا:
- ✅ `lock_next_lectures` = `true`
- ✅ `is_visible` = `true` (الامتحان مرئي للمدرس)
- ✅ الوقت الحالي بين `show_at` و `hide_at` (إذا تم تحديدهما)
- ✅ الطالب مسجل في الكورس

### 3. السيناريوهات المختلفة

#### السيناريو 1: امتحان مخفي مع قفل المحاضرات
```json
{
  "is_visible": false,
  "lock_next_lectures": true
}
```
**النتيجة**: ✅ المحاضرات التالية مفتوحة (لأن الامتحان مخفي)

#### السيناريو 2: إظهار الامتحان المخفي لاحقاً
```json
{
  "is_visible": true
}
```
**النتيجة**: ✅ المحاضرات التالية تصبح مقفلة (لأن الامتحان أصبح مرئياً)

#### السيناريو 3: امتحان خارج الوقت المحدد
```json
{
  "is_visible": true,
  "lock_next_lectures": true,
  "hide_at": "2024-01-05T23:59:59Z"
}
```
**النتيجة**: ✅ المحاضرات التالية مفتوحة (لأن الامتحان انتهت صلاحيته)

## أدوات Debug المضافة

### 1. دالة Debug
```typescript
static async debugBlockingExams(lectureId: number, studentId: number)
```
تعرض جميع الامتحانات في المحاضرات السابقة مع حالة كل امتحان.

### 2. Debug Endpoint
```
GET /api/course/lecture/:lectureId/debug-access
```
يعرض معلومات مفصلة عن حالة الامتحانات المانعة للوصول.

### 3. Console Logging
تم إضافة logging مفصل في الدوال لمراقبة سلوك النظام.

## اختبار الحل

### 1. إنشاء امتحان مخفي
```bash
POST /api/course/lecture/1/exam
{
  "title": "امتحان مخفي للاختبار",
  "is_visible": false,
  "lock_next_lectures": true
}
```

### 2. فحص حالة الوصول
```bash
GET /api/course/lecture/2/debug-access
GET /api/course/lecture/2/access-check
```

### 3. النتيجة المتوقعة
- `can_access`: `true`
- `blocking_exams`: `[]` (فارغة)
- `message`: "يمكن الوصول للمحاضرة"

## ملاحظات مهمة

1. **المنطق الجديد متسق**: إذا كان الامتحان غير مرئي للطالب، فلا يجب أن يؤثر على وصوله للمحاضرات التالية.

2. **التوافق العكسي**: جميع الحقول الجديدة اختيارية مع قيم افتراضية منطقية.

3. **المرونة**: يمكن للمدرس إخفاء وإظهار الامتحانات دون تأثير على المحاضرات التالية حتى يصبح الامتحان مرئياً.

4. **الأمان**: يتم فحص تسجيل الطالب في الكورس قبل أي عملية وصول.















