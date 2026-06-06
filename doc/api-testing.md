# اختبار API نشاطات المدرس

## المشكلة
إذا ظهر خطأ "Route not found" عند استخدام API نشاطات المدرس، فهناك عدة حلول:

## الحلول

### 1. التأكد من تشغيل الـ migration
```bash
# تشغيل الـ migration
npm run migrate up

# أو إذا كان هناك مشكلة في SSL
DATABASE_URL="postgresql://username:password@localhost:5432/database?sslmode=require"
```

### 2. التأكد من صحة الـ URLs
الـ API endpoints المتاحة:

```
GET /api/teacher/activities
GET /api/teacher/activities/stats  
GET /api/teacher/activities/detail/:activityId
GET /api/teacher/activities/:type
GET /api/teacher/my-activities
```

### 3. اختبار الـ API

#### اختبار جلب نشاطات المدرس
```bash
curl -X GET "http://localhost:3000/api/teacher/my-activities" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### اختبار جلب إحصائيات النشاطات
```bash
curl -X GET "http://localhost:3000/api/teacher/activities/stats" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

#### اختبار جلب نشاطات محددة
```bash
curl -X GET "http://localhost:3000/api/teacher/activities/course_created" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### 4. التأكد من الـ Authentication
- يجب أن يكون المستخدم مصادق عليه
- يجب أن يكون المستخدم من نوع 'teacher' أو 'admin'
- يجب إرسال token صحيح في header

### 5. إصلاح مشكلة قاعدة البيانات
إذا كانت هناك مشكلة في SSL:

```bash
# إضافة sslmode=disable في DATABASE_URL
DATABASE_URL="postgresql://username:password@localhost:5432/database?sslmode=disable"
```

### 6. إنشاء جدول النشاطات يدوياً
إذا فشل الـ migration، يمكن إنشاء الجدول يدوياً:

```sql
CREATE TABLE IF NOT EXISTS teacher_activities (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    course_id INTEGER REFERENCES courses (id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures (id) ON DELETE CASCADE,
    quiz_id INTEGER REFERENCES quizzes (id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_teacher_activities_teacher_id ON teacher_activities(teacher_id);
CREATE INDEX idx_teacher_activities_created_at ON teacher_activities(created_at DESC);
```

### 7. اختبار الـ API بدون بيانات
إذا لم تكن هناك بيانات، ستحصل على:
```json
{
  "success": true,
  "data": {
    "activities": [],
    "stats": {
      "total": 0,
      "monthly": 0,
      "weekly": 0,
      "byType": []
    },
    "pagination": {
      "limit": 10,
      "offset": 0
    }
  }
}
```

## ملاحظات مهمة
1. تأكد من أن الخادم يعمل على المنفذ الصحيح
2. تأكد من صحة token المصادقة
3. تأكد من أن المستخدم له صلاحيات المدرس
4. تأكد من وجود جدول teacher_activities في قاعدة البيانات 