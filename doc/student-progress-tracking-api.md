# Student Progress Tracking API Documentation

## نظرة عامة
تم تطوير نظام شامل لتتبع تقدم الطلاب في الكورسات، يتضمن تتبع مشاهدات الفيديوهات الفردية ونتائج الامتحانات مع تقارير مفصلة لكل طالب.

## الجداول الجديدة

### جدول تتبع مشاهدات الفيديوهات
```sql
CREATE TABLE video_views (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id INTEGER NOT NULL REFERENCES lecture_videos(id) ON DELETE CASCADE,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
    course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    viewed_at TIMESTAMP DEFAULT NOW(),
    watch_duration INTEGER DEFAULT 0, -- المدة المشاهدة بالثواني
    completion_percentage DECIMAL(5,2) DEFAULT 0, -- نسبة الإكمال
    is_completed BOOLEAN DEFAULT FALSE, -- هل تم إكمال الفيديو بالكامل
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE (user_id, video_id)
);
```

## APIs الجديدة والمحدثة

### 1. تحديث API تقدم الطلاب في الكورس
**Endpoint:** `GET /api/course/:courseId/students-progress`  
**Authorization:** Teacher, Admin only

#### Response المحدث
```json
{
  "total_students": 25,
  "completed_students": 15,
  "course_stats": {
    "total_lectures": 10,
    "total_videos": 30,
    "total_lecture_exams": 8,
    "total_course_exams": 2,
    "total_students": 25
  },
  "students_details": [
    {
      "id": 1,
      "name": "أحمد محمد",
      "email": "ahmed@example.com",
      "watched_lectures": [
        {
          "id": 1,
          "title": "المحاضرة الأولى"
        }
      ],
      "not_watched_lectures": [
        {
          "id": 2,
          "title": "المحاضرة الثانية"
        }
      ],
      "watched_videos": [
        {
          "id": 1,
          "title": "فيديو المحاضرة الأولى",
          "lecture_id": 1,
          "position": 1,
          "watch_duration": 1200,
          "completion_percentage": 100.0,
          "is_completed": true,
          "viewed_at": "2024-01-15T10:30:00.000Z"
        }
      ],
      "not_watched_videos": [
        {
          "id": 2,
          "title": "فيديو المحاضرة الثانية",
          "lecture_id": 2,
          "position": 1
        }
      ],
      "watched_count": 1,
      "total_lectures": 10,
      "watched_videos_count": 1,
      "total_videos": 30,
      "lecture_exams_solved": [
        {
          "id": 1,
          "title": "امتحان المحاضرة الأولى",
          "lecture_id": 1,
          "grade": 85
        }
      ],
      "lecture_exams_not_solved": [
        {
          "id": 2,
          "title": "امتحان المحاضرة الثانية",
          "lecture_id": 2
        }
      ],
      "course_exams_solved": [
        {
          "id": 1,
          "title": "الامتحان الشامل الأول",
          "grade": 78
        }
      ],
      "course_exams_not_solved": [
        {
          "id": 2,
          "title": "الامتحان الشامل الثاني"
        }
      ]
    }
  ]
}
```

### 2. تسجيل مشاهدة فيديو
**Endpoint:** `POST /api/course/video/:videoId/track-view`  
**Authorization:** Student only

#### Request Body
```json
{
  "watch_duration": 1200,
  "completion_percentage": 100.0,
  "is_completed": true
}
```

#### Response
```json
{
  "message": "تم تسجيل المشاهدة بنجاح",
  "view": {
    "id": 1,
    "user_id": 1,
    "video_id": 1,
    "lecture_id": 1,
    "course_id": 1,
    "watch_duration": 1200,
    "completion_percentage": 100.0,
    "is_completed": true,
    "viewed_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. تقرير مفصل لطالب معين في الكورس
**Endpoint:** `GET /api/course/:courseId/student/:studentId/detailed-report`  
**Authorization:** Teacher, Admin only

#### Response
```json
{
  "student": {
    "id": 1,
    "name": "أحمد محمد",
    "email": "ahmed@example.com",
    "phone": "01234567890"
  },
  "course": {
    "id": 1,
    "title": "كورس الرياضيات",
    "description": "كورس شامل في الرياضيات"
  },
  "enrollment_date": "2024-01-01T00:00:00.000Z",
  "progress_summary": {
    "total_lectures": 10,
    "watched_lectures": 8,
    "lectures_completion_percentage": 80.0,
    "total_videos": 30,
    "watched_videos": 25,
    "completed_videos": 20,
    "videos_completion_percentage": 83.33,
    "total_lecture_exams": 8,
    "solved_lecture_exams": 6,
    "lecture_exams_completion_percentage": 75.0,
    "total_course_exams": 2,
    "solved_course_exams": 1,
    "passed_course_exams": 1,
    "course_exams_completion_percentage": 50.0,
    "average_lecture_exam_grade": 82.5,
    "average_course_exam_grade": 78.0
  },
  "lectures": [
    {
      "id": 1,
      "title": "المحاضرة الأولى",
      "description": "مقدمة في الرياضيات",
      "position": 1,
      "is_watched": true,
      "watched_at": "2024-01-15T10:30:00.000Z",
      "videos": [
        {
          "id": 1,
          "title": "فيديو المحاضرة الأولى",
          "position": 1,
          "video_url": "https://example.com/video1.mp4",
          "is_watched": true,
          "watch_duration": 1200,
          "completion_percentage": 100.0,
          "is_completed": true,
          "viewed_at": "2024-01-15T10:30:00.000Z"
        }
      ],
      "exams": [
        {
          "id": 1,
          "title": "امتحان المحاضرة الأولى",
          "is_solved": true,
          "grade": 85,
          "submitted_at": "2024-01-15T11:00:00.000Z"
        }
      ]
    }
  ],
  "course_exams": [
    {
      "id": 1,
      "title": "الامتحان الشامل الأول",
      "total_grade": 100,
      "passing_grade": 60,
      "is_solved": true,
      "obtained_grade": 78,
      "passed": true,
      "submitted_at": "2024-01-20T14:00:00.000Z"
    }
  ]
}
```

## الميزات الجديدة

### 1. تتبع الفيديوهات الفردية
- **تسجيل المشاهدة:** تتبع متى شاهد الطالب كل فيديو
- **مدة المشاهدة:** تسجيل المدة الفعلية للمشاهدة بالثواني
- **نسبة الإكمال:** حساب نسبة إكمال الفيديو
- **حالة الإكمال:** تحديد ما إذا تم إكمال الفيديو بالكامل

### 2. تقارير مفصلة
- **تقرير شامل لكل طالب:** عرض تفصيلي لكل نشاطات الطالب في الكورس
- **إحصائيات التقدم:** نسب الإكمال للمحاضرات والفيديوهات والامتحانات
- **متوسط الدرجات:** حساب متوسط درجات الامتحانات
- **تاريخ التسجيل:** عرض تاريخ انضمام الطالب للكورس

### 3. تتبع الامتحانات
- **امتحانات المحاضرات:** تتبع حل الطالب لامتحانات كل محاضرة
- **امتحانات الكورس الشاملة:** تتبع حل الامتحانات الشاملة
- **الدرجات والنتائج:** عرض الدرجات المحققة وحالة النجاح

## استخدام الـ APIs

### للطلاب
```javascript
// تسجيل مشاهدة فيديو
const response = await fetch('/api/course/video/123/track-view', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token
  },
  body: JSON.stringify({
    watch_duration: 1200,
    completion_percentage: 100.0,
    is_completed: true
  })
});
```

### للمدرسين
```javascript
// جلب تقرير مفصل لطالب
const response = await fetch('/api/course/6/student/123/detailed-report', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});

// جلب تقدم جميع الطلاب
const response = await fetch('/api/course/6/students-progress', {
  headers: {
    'Authorization': 'Bearer ' + token
  }
});
```

## Migration
تم إنشاء migration file: `migrations/1700000000052_create_video_views_tracking.sql`

لتشغيل الـ migration:
```bash
npx node-pg-migrate up
```

## ملاحظات مهمة

1. **الأمان:** فقط الطلاب المشتركين في الكورس يمكنهم تسجيل مشاهدات الفيديوهات
2. **التحديث التلقائي:** يتم تحديث سجلات المشاهدة تلقائياً عند إرسال بيانات جديدة
3. **الأداء:** تم إنشاء فهارس لتحسين أداء الاستعلامات
4. **التوافق:** النظام متوافق مع الجداول الموجودة ولا يؤثر على البيانات الحالية

