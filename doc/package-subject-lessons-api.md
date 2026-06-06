# API دروس ومحتوى مواد الباقات

## نظرة عامة
APIs لإدارة المحتوى التعليمي (دروس، فيديوهات، واجبات) داخل مواد الباقات الدراسية.
تسمح للأدمن والمدرسين المصرح لهم بإدارة المحتوى، وللطلاب المشتركين بعرضه.

---

## الصلاحيات
- **Admin**: صلاحية كاملة على كل شيء.
- **Teacher**: صلاحية كاملة ولكن **فقط** على المواد التي تم منحه إذن الوصول إليها من قبل الأدمن.
- **Student**: صلاحية **عرض فقط (Read Only)** وشرط أن يكون الطالب قد قام بتفعيل الباقة (Scan QR أو كود).

---

## 1. إدارة الفصول/الدروس (Lessons)

### جلب جميع الدروس والمحتوى (للطلاب والمدرسين)
يعرض هذا الـ API هيكلية المادة بالكامل: الدروس وبداخل كل درس الفيديوهات والواجبات الخاصة به.

**Endpoint:**
```
GET /api/subjects/:subjectId/lessons
```

**Header:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "lessons": [
    {
      "id": 1,
      "subject_id": 15,
      "name": "مقدمة في التفاضل",
      "order_index": 0,
      "created_at": "2024-01-24T12:00:00Z",
      "videos": [
        {
          "id": 101,
          "lesson_id": 1,
          "name": "شرح الدرس - جزء 1",
          "link": "https://youtu.be/example",
          "platform": "other",
          "created_at": "2024-01-24T12:05:00Z"
        }
      ],
      "assignments": [
        {
          "id": 55,
          "lesson_id": 1,
          "name": "واجب على الدرس الأول",
          "question_count": 10,
          "total_marks": 20,
          "created_at": "2024-01-24T12:10:00Z"
        }
      ]
    }
  ]
}
```

---

### إضافة درس جديد
**Endpoint:**
```
POST /api/subjects/:subjectId/lessons
```
(للأدمن أو المدرس المصرح له)

**Body:**
```json
{
  "name": "اسم الدرس الجديد"
}
```

### تعديل اسم الدرس
**Endpoint:**
```
PUT /api/subjects/lessons/:lessonId
```

**Body:**
```json
{
  "name": "الاسم المعدل"
}
```

### حذف درس
**Endpoint:**
```
DELETE /api/subjects/lessons/:lessonId
```
*(سيتم حذف جميع الفيديوهات والواجبات المرتبطة به تلقائياً)*

---

## 2. إدارة الفيديوهات (Videos)

### إضافة فيديو لدرس
**Endpoint:**
```
POST /api/subjects/lessons/:lessonId/videos
```

**Body:**
```json
{
  "name": "عنوان الفيديو",
  "link": "https://vimeo.com/123456789"
}
```

### حذف فيديو
**Endpoint:**
```
DELETE /api/subjects/videos/:videoId
```

---

## 3. إدارة الواجبات (Assignments)
*ملاحظة: هذا الـ API ينشئ فقط "وعاء" الواجب (Metadata). لإضافة الأسئلة، سيتم استخدام APIs الأسئلة المنفصلة لاحقاً.*

### إضافة واجب لدرس
**Endpoint:**
```
POST /api/subjects/lessons/:lessonId/assignments
```

**Body:**
```json
{
  "name": "عنوان الواجب",
  "question_count": 10,
  "total_marks": 50
}
```

### حذف واجب
**Endpoint:**
```
DELETE /api/subjects/assignments/:assignmentId
```

---

## 4. صلاحيات المدرسين (Permissions)
هذه الـ APIs خاصة بمدير النظام (Admin) فقط لإعطاء المدرسين حق الوصول لمواد الباقات.

### منح صلاحية لمدرس
**Endpoint:**
```
POST /api/packages/subjects/:subjectId/permissions
```

**Body:**
```json
{
  "teacherId": 5
}
```

### إلغاء صلاحية مدرس
**Endpoint:**
```
DELETE /api/packages/subjects/:subjectId/permissions/:teacherId
```

### عرض المدرسين المصرح لهم بمادة
**Endpoint:**
```
GET /api/packages/subjects/:subjectId/permissions
```

---

## 5. التحكم في ظهور المحتوى (Visibility)
الدروس والواجبات تكون مخفية (`is_visible = false`) افتراضياً عند إنشائها. يجب على الأدمن أو المدرس تفعيلها لتظهر للطلاب.

### ملاحظة هامة:
*   API عرض الدروس `GET /api/subjects/:subjectId/lessons`:
    *   **للطالب:** يعرض فقط الدروس المرئية (`is_visible=true`) والواجبات المرئية.
    *   **للأدمن/المدرس:** يعرض كل الدروس والواجبات مع حقل `is_visible` لكل عنصر.

### تغيير حالة ظهور الدرس
**Endpoint:**
```
PUT /api/subjects/lessons/:lessonId/visibility
```

**Body:**
```json
{
  "is_visible": true // أو false للإخفاء
}
```

### تغيير حالة ظهور الواجب
**Endpoint:**
```
PUT /api/subjects/assignments/:assignmentId/visibility
```

**Body:**
```json
{
  "is_visible": true // أو false للإخفاء
}
```
