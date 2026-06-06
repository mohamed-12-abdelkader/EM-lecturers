# API محتوى الكورس

## نظرة عامة
APIs لإدارة محتوى الكورس (محاضرات، فيديوهات، امتحانات، ملفات مرفقة). تسمح للأدمن والمدرسين المصرح لهم بإضافة وتعديل وحذف محتوى الكورسات التي يملكونها.

## الجداول في قاعدة البيانات

### جدول المحاضرات
```sql
CREATE TABLE course_lectures (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    content TEXT, -- محتوى نصي للمحاضرة
    video_url TEXT, -- رابط الفيديو
    video_duration INTEGER, -- مدة الفيديو بالدقائق
    order_index INTEGER DEFAULT 0, -- ترتيب المحاضرة
    is_free BOOLEAN DEFAULT TRUE, -- هل المحاضرة مجانية
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول الامتحانات
```sql
CREATE TABLE course_exams (
    id SERIAL PRIMARY KEY,
    course_id INTEGER NOT NULL REFERENCES subject_courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    total_questions INTEGER DEFAULT 0,
    total_grade INTEGER DEFAULT 100,
    duration_minutes INTEGER DEFAULT 60,
    passing_grade INTEGER DEFAULT 60,
    is_comprehensive BOOLEAN DEFAULT FALSE, -- امتحان شامل أم لا
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول الأسئلة
```sql
CREATE TABLE course_exam_questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES course_exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    question_type VARCHAR(20) DEFAULT 'multiple_choice',
    grade INTEGER DEFAULT 1,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### جدول خيارات الأسئلة
```sql
CREATE TABLE course_exam_question_options (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES course_exam_questions(id) ON DELETE CASCADE,
    option_text TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT FALSE,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### جدول الملفات المرفقة
```sql
CREATE TABLE course_lecture_attachments (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES course_lectures(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    file_size INTEGER,
    file_type VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## أنواع الأسئلة

| النوع | الوصف |
|-------|-------|
| `multiple_choice` | اختيار من متعدد |
| `true_false` | صح أو خطأ |
| `essay` | إجابة نصية |

## ===== إدارة المحاضرات =====

### 1. إنشاء محاضرة جديدة

#### Endpoint
```
POST /api/course-content/lectures
```

#### الوصف
إنشاء محاضرة جديدة في كورس (للأدمن والمدرسين المصرح لهم)

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: application/json
```

#### Body
```json
{
  "course_id": 1,
  "title": "مقدمة في الجبر",
  "description": "محاضرة تمهيدية في أساسيات الجبر",
  "content": "محتوى نصي للمحاضرة...",
  "video_url": "https://example.com/video.mp4",
  "video_duration": 45,
  "order_index": 1,
  "is_free": true
}
```

#### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/course-content/lectures \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "course_id": 1,
    "title": "مقدمة في الجبر",
    "description": "محاضرة تمهيدية في أساسيات الجبر",
    "content": "محتوى نصي للمحاضرة...",
    "video_url": "https://example.com/video.mp4",
    "video_duration": 45,
    "order_index": 1,
    "is_free": true
  }'
```

#### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء المحاضرة بنجاح",
  "lecture": {
    "id": 1,
    "course_id": 1,
    "title": "مقدمة في الجبر",
    "description": "محاضرة تمهيدية في أساسيات الجبر",
    "content": "محتوى نصي للمحاضرة...",
    "video_url": "https://example.com/video.mp4",
    "video_duration": 45,
    "order_index": 1,
    "is_free": true,
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

### 2. تحديث محاضرة

#### Endpoint
```
PUT /api/course-content/lectures/:id
```

#### الوصف
تحديث محاضرة موجودة

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: application/json
```

#### Body
```json
{
  "title": "مقدمة في الجبر - محدث",
  "description": "وصف محدث للمحاضرة",
  "video_duration": 50,
  "is_free": false
}
```

#### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/course-content/lectures/1 \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "مقدمة في الجبر - محدث",
    "description": "وصف محدث للمحاضرة",
    "video_duration": 50,
    "is_free": false
  }'
```

---

### 3. حذف محاضرة

#### Endpoint
```
DELETE /api/course-content/lectures/:id
```

#### الوصف
حذف محاضرة

#### Headers
```
Authorization: Bearer <teacher_token>
```

#### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/course-content/lectures/1 \
  -H "Authorization: Bearer <teacher_token>"
```

---

### 4. جلب محاضرة بواسطة ID

#### Endpoint
```
GET /api/course-content/lectures/:id
```

#### الوصف
جلب محاضرة مع ملفاتها المرفقة

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/lectures/1
```

#### مثال للاستجابة (200 OK)
```json
{
  "lecture": {
    "id": 1,
    "course_id": 1,
    "title": "مقدمة في الجبر",
    "description": "محاضرة تمهيدية في أساسيات الجبر",
    "content": "محتوى نصي للمحاضرة...",
    "video_url": "https://example.com/video.mp4",
    "video_duration": 45,
    "order_index": 1,
    "is_free": true,
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z",
    "course_title": "مقدمة في الجبر",
    "course_price": "0.00",
    "attachments": [
      {
        "id": 1,
        "lecture_id": 1,
        "file_name": "lecture-notes.pdf",
        "file_url": "/uploads/course-content/lecture-notes.pdf",
        "file_size": 1024000,
        "file_type": "application/pdf",
        "description": "ملاحظات المحاضرة",
        "created_at": "2024-01-01T12:00:00Z"
      }
    ]
  }
}
```

---

### 5. جلب جميع محاضرات الكورس

#### Endpoint
```
GET /api/course-content/courses/:courseId/lectures
```

#### الوصف
جلب جميع محاضرات كورس معين

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/courses/1/lectures
```

#### مثال للاستجابة (200 OK)
```json
{
  "lectures": [
    {
      "id": 1,
      "course_id": 1,
      "title": "مقدمة في الجبر",
      "description": "محاضرة تمهيدية في أساسيات الجبر",
      "content": "محتوى نصي للمحاضرة...",
      "video_url": "https://example.com/video.mp4",
      "video_duration": 45,
      "order_index": 1,
      "is_free": true,
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:00Z",
      "attachments_count": 2
    }
  ]
}
```

## ===== إدارة الامتحانات =====

### 6. إنشاء امتحان جديد

#### Endpoint
```
POST /api/course-content/exams
```

#### الوصف
إنشاء امتحان جديد في كورس

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: application/json
```

#### Body
```json
{
  "course_id": 1,
  "title": "امتحان الوحدة الأولى",
  "description": "امتحان شامل للوحدة الأولى",
  "total_questions": 20,
  "total_grade": 100,
  "duration_minutes": 60,
  "passing_grade": 60,
  "is_comprehensive": false
}
```

> **إعدادات تحكم إضافية:** يمكن إرسال نفس الحقول الخاصة بنظام Exam Flow (مثل `showAt`, `showAnswersImmediately`, `allowMultipleAttempts`, `timeLimitEnabled`, `startWindow`, ... إلخ) سواء بصيغة camelCase أو snake_case (`show_at`). يتم تطبيق نفس شروط التحقق المذكورة في `doc/exam-flow-teacher-controls.md` (مثلاً ضرورة توفير `answersReleaseDate` عند تفعيل `showAnswersLater`، أو توفير مدة موجبة عند تفعيل `timeLimitEnabled`).

#### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/course-content/exams \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "course_id": 1,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان شامل للوحدة الأولى",
    "total_questions": 20,
    "total_grade": 100,
    "duration_minutes": 60,
    "passing_grade": 60,
    "is_comprehensive": false
  }'
```

---

### 7. تحديث امتحان

#### Endpoint
```
PUT /api/course-content/exams/:id
```

#### الوصف
تحديث امتحان موجود

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: application/json
```

#### Body
```json
{
  "title": "امتحان الوحدة الأولى - محدث",
  "duration_minutes": 90,
  "passing_grade": 70
}
```

---

### 8. حذف امتحان

#### Endpoint
```
DELETE /api/course-content/exams/:id
```

#### الوصف
حذف امتحان

#### Headers
```
Authorization: Bearer <teacher_token>
```

---

### 9. جلب امتحان بواسطة ID

#### Endpoint
```
GET /api/course-content/exams/:id
```

#### الوصف
جلب امتحان مع أسئلته

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/exams/1
```

#### مثال للاستجابة (200 OK)
```json
{
  "exam": {
    "id": 1,
    "course_id": 1,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان شامل للوحدة الأولى",
    "total_questions": 20,
    "total_grade": 100,
    "duration_minutes": 60,
    "passing_grade": 60,
    "is_comprehensive": false,
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z",
    "course_title": "مقدمة في الجبر",
    "questions": [
      {
        "id": 1,
        "exam_id": 1,
        "question_text": "ما هو ناتج 2 + 2؟",
        "question_type": "multiple_choice",
        "grade": 5,
        "order_index": 1,
        "created_at": "2024-01-01T12:00:00Z",
        "options_count": 4,
        "options": [
          {
            "id": 1,
            "question_id": 1,
            "option_text": "3",
            "is_correct": false,
            "order_index": 1
          },
          {
            "id": 2,
            "question_id": 1,
            "option_text": "4",
            "is_correct": true,
            "order_index": 2
          }
        ]
      }
    ]
  }
}
```

---

### 10. جلب جميع امتحانات الكورس

#### Endpoint
```
GET /api/course-content/courses/:courseId/exams
```

#### الوصف
جلب جميع امتحانات كورس معين

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/courses/1/exams
```

#### مثال للاستجابة (200 OK)
```json
{
  "exams": [
    {
      "id": 1,
      "course_id": 1,
      "title": "امتحان الوحدة الأولى",
      "description": "امتحان شامل للوحدة الأولى",
      "total_questions": 20,
      "total_grade": 100,
      "duration_minutes": 60,
      "passing_grade": 60,
      "is_comprehensive": false,
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:00Z",
      "questions_count": 20,
      "submissions_count": 15
    }
  ]
}
```

## ===== إدارة الأسئلة =====

### 11. إنشاء سؤال جديد

#### Endpoint
```
POST /api/course-content/questions
```

#### الوصف
إنشاء سؤال جديد في امتحان

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: application/json
```

#### Body
```json
{
  "exam_id": 1,
  "question_text": "ما هو ناتج 2 + 2؟",
  "question_type": "multiple_choice",
  "grade": 5,
  "order_index": 1,
  "options": [
    {
      "option_text": "3",
      "is_correct": false,
      "order_index": 1
    },
    {
      "option_text": "4",
      "is_correct": true,
      "order_index": 2
    },
    {
      "option_text": "5",
      "is_correct": false,
      "order_index": 3
    }
  ]
}
```

#### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/course-content/questions \
  -H "Authorization: Bearer <teacher_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "exam_id": 1,
    "question_text": "ما هو ناتج 2 + 2؟",
    "question_type": "multiple_choice",
    "grade": 5,
    "order_index": 1,
    "options": [
      {
        "option_text": "3",
        "is_correct": false,
        "order_index": 1
      },
      {
        "option_text": "4",
        "is_correct": true,
        "order_index": 2
      }
    ]
  }'
```

---

### 12. جلب أسئلة الامتحان

#### Endpoint
```
GET /api/course-content/exams/:examId/questions
```

#### الوصف
جلب جميع أسئلة امتحان معين

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/exams/1/questions
```

## ===== إدارة الملفات المرفقة =====

### 13. إضافة ملف مرفق للمحاضرة

#### Endpoint
```
POST /api/course-content/lectures/:lectureId/attachments
```

#### الوصف
إضافة ملف مرفق لمحاضرة

#### Headers
```
Authorization: Bearer <teacher_token>
Content-Type: multipart/form-data
```

#### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `file` | file | ✅ | الملف المرفق |
| `description` | string | ❌ | وصف الملف |

#### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/course-content/lectures/1/attachments \
  -H "Authorization: Bearer <teacher_token>" \
  -F "file=@/path/to/lecture-notes.pdf" \
  -F "description=ملاحظات المحاضرة"
```

#### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إضافة الملف المرفق بنجاح",
  "attachment": {
    "id": 1,
    "lecture_id": 1,
    "file_name": "lecture-notes.pdf",
    "file_url": "/uploads/course-content/course-content-1234567890.pdf",
    "file_size": 1024000,
    "file_type": "application/pdf",
    "description": "ملاحظات المحاضرة",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

### 14. جلب ملفات مرفقة المحاضرة

#### Endpoint
```
GET /api/course-content/lectures/:lectureId/attachments
```

#### الوصف
جلب جميع الملفات المرفقة لمحاضرة معينة

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/lectures/1/attachments
```

## ===== إحصائيات محتوى الكورس =====

### 15. جلب إحصائيات محتوى الكورس

#### Endpoint
```
GET /api/course-content/courses/:courseId/content-stats
```

#### الوصف
جلب إحصائيات محتوى الكورس

#### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/course-content/courses/1/content-stats
```

#### مثال للاستجابة (200 OK)
```json
{
  "stats": {
    "total_lectures": 10,
    "free_lectures": 3,
    "total_exams": 5,
    "comprehensive_exams": 1,
    "total_attachments": 25,
    "total_video_duration": 450
  }
}
```

## أمثلة على الاستخدام

### JavaScript (Fetch API)

#### إنشاء محاضرة جديدة
```javascript
const response = await fetch('/api/course-content/lectures', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    course_id: 1,
    title: 'مقدمة في الجبر',
    description: 'محاضرة تمهيدية في أساسيات الجبر',
    content: 'محتوى نصي للمحاضرة...',
    video_url: 'https://example.com/video.mp4',
    video_duration: 45,
    order_index: 1,
    is_free: true
  })
});

const result = await response.json();
console.log(result);
```

#### إنشاء امتحان جديد
```javascript
const response = await fetch('/api/course-content/exams', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    course_id: 1,
    title: 'امتحان الوحدة الأولى',
    description: 'امتحان شامل للوحدة الأولى',
    total_questions: 20,
    total_grade: 100,
    duration_minutes: 60,
    passing_grade: 60,
    is_comprehensive: false
  })
});

const result = await response.json();
console.log(result);
```

#### إضافة ملف مرفق
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('description', 'ملاحظات المحاضرة');

const response = await fetch('/api/course-content/lectures/1/attachments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

#### جلب محاضرات الكورس
```javascript
const response = await fetch('/api/course-content/courses/1/lectures');
const result = await response.json();
console.log(result.lectures);
```

#### جلب امتحانات الكورس
```javascript
const response = await fetch('/api/course-content/courses/1/exams');
const result = await response.json();
console.log(result.exams);
```

## ملاحظات مهمة

1. **الصلاحيات**: المدرسين يمكنهم إدارة محتوى كورساتهم فقط
2. **الأدمن**: لديه صلاحيات كاملة على جميع المحتويات
3. **المحاضرات المجانية**: `is_free = true` يعني محاضرة مجانية
4. **ترتيب المحاضرات**: `order_index` يحدد ترتيب عرض المحاضرات
5. **الملفات المرفقة**: الحد الأقصى 50 ميجابايت لكل ملف
6. **أنواع الأسئلة**: multiple_choice, true_false, essay
7. **الامتحانات الشاملة**: `is_comprehensive = true` للامتحانات النهائية
8. **مدة الفيديو**: بالدقائق
9. **الدرجات**: النجاح عند `obtained_grade >= passing_grade`
10. **الترتيب**: المحاضرات والأسئلة مرتبة حسب `order_index` 