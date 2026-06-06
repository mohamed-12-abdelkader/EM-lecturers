# API نشاطات المدرس

## نظرة عامة
هذا API يتيح للمدرس عرض آخر النشاطات التي قام بها على المنصة، مع إحصائيات مفصلة عن نشاطه.

## الجداول المطلوبة

### جدول teacher_activities
```sql
CREATE TABLE IF NOT EXISTS teacher_activities (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    activity_type TEXT NOT NULL, -- 'course_created', 'lecture_added', 'video_added', 'file_added', 'quiz_created', 'exam_created'
    title TEXT NOT NULL,
    description TEXT,
    course_id INTEGER REFERENCES courses (id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures (id) ON DELETE CASCADE,
    quiz_id INTEGER REFERENCES quizzes (id) ON DELETE CASCADE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Endpoints

### 1. جلب آخر نشاطات المدرس
**GET** `/api/teachers/activities`

**الوصف:** جلب آخر النشاطات التي قام بها المدرس

**المعاملات:**
- `limit` (اختياري): عدد النشاطات المطلوبة (الافتراضي: 20)
- `offset` (اختياري): عدد النشاطات للتخطي (الافتراضي: 0)
- `type` (اختياري): نوع النشاط المطلوب

**الاستجابة:**
```json
{
  "success": true,
  "activities": [
    {
      "id": 1,
      "activity_type": "course_created",
      "title": "تم إنشاء كورس جديد",
      "description": "تم إنشاء كورس \"الرياضيات للصف الأول الثانوي\"",
      "course_id": 1,
      "lecture_id": null,
      "quiz_id": null,
      "metadata": {
        "course_title": "الرياضيات للصف الأول الثانوي"
      },
      "created_at": "2024-01-15T10:30:00Z",
      "course_title": "الرياضيات للصف الأول الثانوي",
      "lecture_title": null,
      "quiz_title": null
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0
  }
}
```

### 2. جلب إحصائيات نشاطات المدرس
**GET** `/api/teachers/activities/stats`

**الوصف:** جلب إحصائيات مفصلة عن نشاطات المدرس

**الاستجابة:**
```json
{
  "success": true,
  "stats": {
    "total": 45,
    "monthly": 12,
    "weekly": 3,
    "byType": [
      {
        "type": "course_created",
        "count": 15
      },
      {
        "type": "lecture_added",
        "count": 20
      },
      {
        "type": "video_added",
        "count": 10
      }
    ]
  }
}
```

### 3. جلب نشاطات محددة حسب النوع
**GET** `/api/teachers/activities/:type`

**الوصف:** جلب نشاطات محددة حسب نوع النشاط

**المعاملات:**
- `type`: نوع النشاط (course_created, lecture_added, video_added, file_added, quiz_created, exam_created)
- `limit` (اختياري): عدد النشاطات المطلوبة
- `offset` (اختياري): عدد النشاطات للتخطي

**الاستجابة:**
```json
{
  "success": true,
  "activities": [...],
  "activityType": "course_created",
  "pagination": {
    "limit": 20,
    "offset": 0
  }
}
```

### 4. جلب نشاطات المدرس (API خاص)
**GET** `/api/teachers/my-activities`

**الوصف:** API خاص للمدرس لعرض نشاطاته مع الإحصائيات

**المعاملات:**
- `limit` (اختياري): عدد النشاطات المطلوبة (الافتراضي: 10)
- `offset` (اختياري): عدد النشاطات للتخطي (الافتراضي: 0)

**الاستجابة:**
```json
{
  "success": true,
  "data": {
    "activities": [...],
    "stats": {
      "total": 45,
      "monthly": 12,
      "weekly": 3,
      "byType": [...]
    },
    "pagination": {
      "limit": 10,
      "offset": 0
    }
  }
}
```

### 5. جلب تفاصيل نشاط محدد
**GET** `/api/teachers/activities/detail/:activityId`

**الوصف:** جلب تفاصيل كاملة لنشاط محدد

**الاستجابة:**
```json
{
  "success": true,
  "activity": {
    "id": 1,
    "activity_type": "course_created",
    "title": "تم إنشاء كورس جديد",
    "description": "تم إنشاء كورس \"الرياضيات للصف الأول الثانوي\"",
    "course_id": 1,
    "lecture_id": null,
    "quiz_id": null,
    "metadata": {
      "course_title": "الرياضيات للصف الأول الثانوي"
    },
    "created_at": "2024-01-15T10:30:00Z",
    "course_title": "الرياضيات للصف الأول الثانوي",
    "course_description": "كورس شامل للرياضيات للصف الأول الثانوي",
    "lecture_title": null,
    "lecture_description": null,
    "quiz_title": null
  }
}
```

## أنواع النشاطات

1. **course_created**: إنشاء كورس جديد
2. **lecture_added**: إضافة محاضرة جديدة
3. **video_added**: إضافة فيديو جديد
4. **file_added**: إضافة ملف جديد
5. **quiz_created**: إنشاء اختبار جديد
6. **exam_created**: إنشاء امتحان جديد
7. **course_updated**: تحديث كورس موجود
8. **lecture_updated**: تحديث محاضرة موجودة

## الأمان
- جميع الـ endpoints تتطلب مصادقة
- المدرس يمكنه الوصول فقط لنشاطاته الخاصة
- المدير يمكنه الوصول لجميع النشاطات

## الاستخدام في الكود

### تسجيل نشاط جديد
```typescript
import { TeacherActivityService } from '../services/teacherActivities';

// تسجيل إنشاء كورس جديد
await TeacherActivityService.logCourseCreated(teacherId, courseId, courseTitle);

// تسجيل إضافة محاضرة جديدة
await TeacherActivityService.logLectureAdded(teacherId, courseId, lectureId, lectureTitle, courseTitle);

// تسجيل إضافة فيديو جديد
await TeacherActivityService.logVideoAdded(teacherId, courseId, lectureId, videoTitle, lectureTitle, courseTitle);
```

## ملاحظات
- يتم تسجيل النشاطات تلقائياً عند القيام بالإجراءات المختلفة
- يمكن تصفية النشاطات حسب النوع والتاريخ
- الإحصائيات تُحدث في الوقت الفعلي
- البيانات محفوظة في قاعدة البيانات مع indexes لتحسين الأداء 