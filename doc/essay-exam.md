# Essay Exams API Documentation

## نظرة عامة
API للامتحانات المقالية يسمح للمدرسين بإنشاء وإدارة الامتحانات المقالية، والطلاب بحلها وتلقي التصحيح.

## Base URL
```
/essay-exams
```

## Authentication
جميع الـ endpoints تتطلب مصادقة باستخدام Bearer token في header:
```
Authorization: Bearer <token>
```

## Endpoints

### 1. إدارة الامتحانات

#### إنشاء امتحان مقالي جديد
```http
POST /essay-exams/lectures/:lectureId/exams
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `lectureId` (path): معرف المحاضرة

**Body:**
```json
{
  "title": "امتحان الوحدة الأولى",
  "description": "امتحان مقالي حول أساسيات البرمجة",
  "is_visible": true
}
```

**Response (201):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان مقالي حول أساسيات البرمجة",
    "is_visible": true,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

#### جلب امتحانات محاضرة معينة
```http
GET /essay-exams/lectures/:lectureId/exams
```

**الصلاحيات المطلوبة:** أي مستخدم مصادق

**المعاملات:**
- `lectureId` (path): معرف المحاضرة

**Response (200):**
```json
{
  "exams": [
    {
      "id": 1,
      "lecture_id": 5,
      "title": "امتحان الوحدة الأولى",
      "description": "امتحان مقالي حول أساسيات البرمجة",
      "is_visible": true,
      "created_by": 10,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "questions_count": 3,
      "students_count": 15
    }
  ]
}
```

#### جلب امتحان معين بالتفصيل
```http
GET /essay-exams/exams/:examId
```

**الصلاحيات المطلوبة:** أي مستخدم مصادق

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200) - للمدرسين والإدمن:**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان مقالي حول أساسيات البرمجة",
    "is_visible": true,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "questions_count": 3,
    "students_count": 15
  },
  "questions": [
    {
      "id": 1,
      "exam_id": 1,
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0,
      "created_at": "2024-01-15T10:35:00Z"
    }
  ],
  "message": "",
  "status": ""
}
```

**Response (200) - للطلاب (لم يرسل إجابة بعد):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان مقالي حول أساسيات البرمجة",
    "is_visible": true,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "questions_count": 3,
    "students_count": 15
  },
  "questions": [
    {
      "id": 1,
      "exam_id": 1,
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0,
      "created_at": "2024-01-15T10:35:00Z"
    }
  ],
  "message": "يمكنك الآن حل الأسئلة",
  "status": "available"
}
```

**Response (200) - للطلاب (بعد إرسال الإجابة - في انتظار التصحيح):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان مقالي حول أساسيات البرمجة",
    "is_visible": true,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "questions_count": 3,
    "students_count": 15
  },
  "questions": [],
  "message": "جار تصحيح الأسئلة",
  "status": "pending"
}
```

**Response (200) - للطلاب (بعد التصحيح):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى",
    "description": "امتحان مقالي حول أساسيات البرمجة",
    "is_visible": true,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "questions_count": 3,
    "students_count": 15
  },
  "questions": [],
  "message": "تم تصحيح إجابتك",
  "status": "graded"
}
```

#### تحديث امتحان مقالي
```http
PUT /essay-exams/exams/:examId
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Body:**
```json
{
  "title": "امتحان الوحدة الأولى - محدث",
  "description": "امتحان مقالي محدث حول أساسيات البرمجة",
  "is_visible": false
}
```

**Response (200):**
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 5,
    "title": "امتحان الوحدة الأولى - محدث",
    "description": "امتحان مقالي محدث حول أساسيات البرمجة",
    "is_visible": false,
    "created_by": 10,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

#### حذف امتحان مقالي
```http
DELETE /essay-exams/exams/:examId
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200):**
```json
{
  "message": "Exam deleted successfully"
}
```

### 2. إدارة الأسئلة

#### إضافة سؤال مقالي
```http
POST /essay-exams/exams/:examId/questions
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Body:**
```json
{
  "question_text": "اشرح مفهوم المتغيرات في البرمجة مع إعطاء أمثلة",
  "order_index": 0
}
```

**Response (201):**
```json
{
  "question": {
    "id": 1,
    "exam_id": 1,
    "question_text": "اشرح مفهوم المتغيرات في البرمجة مع إعطاء أمثلة",
    "order_index": 0,
    "created_at": "2024-01-15T10:35:00Z"
  }
}
```

#### تحديث سؤال مقالي
```http
PUT /essay-exams/questions/:questionId
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `questionId` (path): معرف السؤال

**Body:**
```json
{
  "question_text": "اشرح مفهوم المتغيرات في البرمجة مع إعطاء أمثلة عملية",
  "order_index": 1
}
```

**Response (200):**
```json
{
  "question": {
    "id": 1,
    "exam_id": 1,
    "question_text": "اشرح مفهوم المتغيرات في البرمجة مع إعطاء أمثلة عملية",
    "order_index": 1,
    "created_at": "2024-01-15T10:35:00Z"
  }
}
```

#### حذف سؤال مقالي
```http
DELETE /essay-exams/questions/:questionId
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `questionId` (path): معرف السؤال

**Response (200):**
```json
{
  "message": "Question deleted successfully"
}
```

#### جلب أسئلة امتحان معين
```http
GET /essay-exams/exams/:examId/questions
```

**الصلاحيات المطلوبة:** أي مستخدم مصادق

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200) - للمدرسين والإدمن:**
```json
{
  "questions": [
    {
      "id": 1,
      "exam_id": 1,
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0,
      "created_at": "2024-01-15T10:35:00Z"
    },
    {
      "id": 2,
      "exam_id": 1,
      "question_text": "ما هي أنواع البيانات في JavaScript؟",
      "order_index": 1,
      "created_at": "2024-01-15T10:36:00Z"
    }
  ],
  "message": "أسئلة الامتحان",
  "status": "available"
}
```

**Response (200) - للطلاب (لم يرسل إجابة بعد):**
```json
{
  "questions": [
    {
      "id": 1,
      "exam_id": 1,
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0,
      "created_at": "2024-01-15T10:35:00Z"
    },
    {
      "id": 2,
      "exam_id": 1,
      "question_text": "ما هي أنواع البيانات في JavaScript؟",
      "order_index": 1,
      "created_at": "2024-01-15T10:36:00Z"
    }
  ],
  "message": "يمكنك الآن حل الأسئلة",
  "status": "available"
}
```

**Response (200) - للطلاب (بعد إرسال الإجابة - في انتظار التصحيح):**
```json
{
  "questions": [],
  "message": "جار تصحيح الأسئلة",
  "status": "pending"
}
```

**Response (200) - للطلاب (بعد التصحيح):**
```json
{
  "questions": [],
  "message": "تم تصحيح إجابتك",
  "status": "graded"
}
```

### 3. إجابات الطلاب

#### إرسال إجابة طالب
```http
POST /essay-exams/exams/:examId/answers
```

**الصلاحيات المطلوبة:** `student`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Body:**
```json
{
  "question_id": 1,
  "answer_text": "المتغيرات في البرمجة هي حاويات لتخزين البيانات..."
}
```

**Response (201):**
```json
{
  "answer": {
    "id": 1,
    "exam_id": 1,
    "student_id": 5,
    "question_id": 1,
    "answer_text": "المتغيرات في البرمجة هي حاويات لتخزين البيانات...",
    "submitted_at": "2024-01-15T14:30:00Z"
  },
  "message": "تم إرسال إجابتك بنجاح، في انتظار تصحيح المعلم",
  "status": "pending",
  "grade": null
}
```

**Response (201) - إذا كان مصحح:**
```json
{
  "answer": {
    "id": 1,
    "exam_id": 1,
    "student_id": 5,
    "question_id": 1,
    "answer_text": "المتغيرات في البرمجة هي حاويات لتخزين البيانات...",
    "submitted_at": "2024-01-15T14:30:00Z"
  },
  "message": "تم تصحيح إجابتك",
  "status": "graded",
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 5,
    "total_grade": 85,
    "max_grade": 100,
    "graded_by": 10,
    "graded_at": "2024-01-16T09:00:00Z",
    "feedback": "إجابة ممتازة مع أمثلة واضحة"
  }
}
```

#### جلب إجابات طالب على امتحان معين
```http
GET /essay-exams/exams/:examId/my-answers
```

**الصلاحيات المطلوبة:** `student`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200):**
```json
{
  "answers": [
    {
      "id": 1,
      "exam_id": 1,
      "student_id": 5,
      "question_id": 1,
      "answer_text": "المتغيرات في البرمجة هي حاويات لتخزين البيانات...",
      "submitted_at": "2024-01-15T14:30:00Z",
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0
    }
  ]
}
```

### 4. إدارة الطلاب والتصحيح

#### جلب الطلاب الذين حلوا امتحان معين
```http
GET /essay-exams/exams/:examId/students
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200):**
```json
{
  "students": [
    {
      "student_id": 5,
      "student_name": "أحمد محمد",
      "student_email": "ahmed@example.com",
      "answered_questions": 3,
      "total_questions": 3,
      "total_grade": 85,
      "max_grade": 100,
      "graded_at": "2024-01-16T09:00:00Z",
      "feedback": "إجابة ممتازة مع أمثلة واضحة"
    }
  ]
}
```

#### جلب إجابات طالب معين
```http
GET /essay-exams/exams/:examId/students/:studentId/answers
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان
- `studentId` (path): معرف الطالب

**Response (200):**
```json
{
  "answers": [
    {
      "id": 1,
      "exam_id": 1,
      "student_id": 5,
      "question_id": 1,
      "answer_text": "المتغيرات في البرمجة هي حاويات لتخزين البيانات...",
      "submitted_at": "2024-01-15T14:30:00Z",
      "question_text": "اشرح مفهوم المتغيرات في البرمجة",
      "order_index": 0
    }
  ]
}
```

#### تصحيح إجابات طالب
```http
POST /essay-exams/exams/:examId/students/:studentId/grade
```

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**المعاملات:**
- `examId` (path): معرف الامتحان
- `studentId` (path): معرف الطالب

**Body:**
```json
{
  "total_grade": 85,
  "max_grade": 100,
  "feedback": "إجابة ممتازة مع أمثلة واضحة، لكن يمكن تحسين الشرح في الجزء الأخير"
}
```

**Response (200):**
```json
{
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 5,
    "total_grade": 85,
    "max_grade": 100,
    "graded_by": 10,
    "graded_at": "2024-01-16T09:00:00Z",
    "feedback": "إجابة ممتازة مع أمثلة واضحة، لكن يمكن تحسين الشرح في الجزء الأخير"
  }
}
```

### 5. درجات الطلاب

#### جلب درجات طالب في امتحان معين
```http
GET /essay-exams/exams/:examId/my-grade
```

**الصلاحيات المطلوبة:** `student`

**المعاملات:**
- `examId` (path): معرف الامتحان

**Response (200):**
```json
{
  "grade": {
    "id": 1,
    "exam_id": 1,
    "student_id": 5,
    "total_grade": 85,
    "max_grade": 100,
    "graded_by": 10,
    "graded_at": "2024-01-16T09:00:00Z",
    "feedback": "إجابة ممتازة مع أمثلة واضحة",
    "graded_by_name": "د. محمد أحمد"
  }
}
```

#### جلب جميع درجات طالب
```http
GET /essay-exams/my-grades
```

**الصلاحيات المطلوبة:** `student`

**Response (200):**
```json
{
  "grades": [
    {
      "id": 1,
      "exam_id": 1,
      "student_id": 5,
      "total_grade": 85,
      "max_grade": 100,
      "graded_by": 10,
      "graded_at": "2024-01-16T09:00:00Z",
      "feedback": "إجابة ممتازة مع أمثلة واضحة",
      "exam_title": "امتحان الوحدة الأولى",
      "lecture_title": "أساسيات البرمجة",
      "course_title": "مقدمة في البرمجة",
      "graded_by_name": "د. محمد أحمد"
    }
  ]
}
```

## Error Responses

### 400 Bad Request
```json
{
  "message": "Invalid payload",
  "errors": {
    "fieldErrors": {
      "title": ["Title is required"]
    }
  }
}
```

### 401 Unauthorized
```json
{
  "message": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "message": "Access denied"
}
```

### 404 Not Found
```json
{
  "message": "Exam not found or access denied"
}
```

### 500 Internal Server Error
```json
{
  "message": "Internal server error"
}
```


## ملاحظات مهمة

1. **الصلاحيات**: 
   - المدرسون يمكنهم إنشاء وتعديل وحذف الامتحانات والأسئلة
   - الطلاب يمكنهم فقط حل الامتحانات الظاهرة
   - الإدمن يمكنه الوصول لجميع الامتحانات

2. **الرؤية**: 
   - الطلاب يرون فقط الامتحانات التي `is_visible = true`
   - المدرسون يرون فقط امتحاناتهم الخاصة

3. **الإشعارات**: 
   - يتم إرسال إشعارات تلقائية عند إنشاء امتحان جديد
   - يتم إرسال إشعارات عند تصحيح الامتحانات

4. **التحديث**: 
   - يمكن للطلاب تحديث إجاباتهم في أي وقت
   - يمكن للمدرسين تحديث التصحيح في أي وقت

5. **الترتيب**: 
   - الأسئلة مرتبة حسب `order_index` ثم `id`
   - يمكن تغيير ترتيب الأسئلة بتحديث `order_index`

6. **نظام التصحيح**:
   - المدرس يصحح إجابات الطالب كاملة
   - حالة الامتحان (مصحح أم لا) تعتمد على تصحيح المدرس الكامل
   - الطالب يرى الأسئلة فقط قبل الإرسال
   - بعد الإرسال: يرى رسالة "جار تصحيح الأسئلة"
   - بعد التصحيح: يرى رسالة "تم تصحيح إجابتك" مع الدرجة
