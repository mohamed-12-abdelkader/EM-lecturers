# API مجموعات مادة الباقة (Package Subject Groups)

توثيق APIs الخاصة بنظام **المجموعات داخل المادة الدراسية داخل الباقة**.

## Base URL
- كل المسارات تبدأ بـ: `/api`

## Realtime Chat (شات مجموعات الباقات)
- توثيق منفصل: `doc/package-subject-group-chat-api.md`

## Auth
كل الـ endpoints تتطلب:
- `Authorization: Bearer <token>`

## الكيانات
- **Subject** هنا المقصود بها: `package_subject_items` (مادة داخل باقة)
- **Group**: مجموعة داخل مادة (`package_subject_item_groups`)
- **Schedule**: مواعيد المحاضرات (`package_subject_item_group_schedules`)
- **Group Students**: طلاب المجموعة (`package_subject_item_group_students`)

---

## 1) Admin APIs

### 1.1 إنشاء مجموعة داخل مادة
**POST** `/api/subjects/:subjectId/groups`  
**Roles**: `admin`

**Path Params**
- `subjectId`: رقم (ID المادة داخل الباقة)

**Body (JSON)**
```json
{
  "name": "Group A",
  "teacher_id": 55,
  "schedule_days": ["sat", "tue"],
  "schedule_time": "20:00"
}
```

**ملاحظات**
- `teacher_id` اختياري (يمكن إنشاء المجموعة بدون مدرس ثم تعيينه لاحقًا بإعادة إنشاء/تحديث - حسب ما ستعتمده في المرحلة القادمة).
- `schedule` اختياري.

**Response (201)**
```json
{
  "success": true,
  "group": {
    "id": 1,
    "package_subject_item_id": 14,
    "name": "Group A",
    "teacher_id": 55,
    "schedule_days": ["sat", "tue"],
    "schedule_time": "20:00",
    "created_by": 1,
    "created_at": "2025-12-29T12:00:00.000Z",
    "updated_at": "2025-12-29T12:00:00.000Z"
  }
}
```

**Response (404)**
```json
{ "error": "المادة غير موجودة" }
```

---

### 1.2 تعديل مجموعة (الاسم/المدرس/المعاد)
**PUT** `/api/subjects/:subjectId/groups/:groupId`  
**Roles**: `admin`

**Body (JSON)** (أرسل حقل واحد أو أكثر):
```json
{
  "name": "Group A - Updated",
  "teacher_id": 60,
  "schedule_days": ["sat", "tue"],
  "schedule_time": "21:00"
}
```

**Response (200)**
```json
{
  "success": true,
  "group": {
    "id": 1,
    "package_subject_item_id": 14,
    "name": "Group A - Updated",
    "teacher_id": 60,
    "schedule_days": ["sat", "tue"],
    "schedule_time": "21:00"
  }
}
```

---

### 1.3 حذف مجموعة
**DELETE** `/api/subjects/:subjectId/groups/:groupId`  
**Roles**: `admin`

**Response (200)**
```json
{
  "success": true,
  "deleted": true
}
```

**ملاحظة**
- حذف المجموعة سيحذف تلقائياً ربط الطلاب بالمجموعة (Cascade).
- وإذا كان هناك دروس مرتبطة بالمجموعة (`package_subject_item_lessons.group_id`) سيتم تعيين `group_id = NULL` (ON DELETE SET NULL).

---

### 1.2 عرض كل المجموعات داخل مادة
**GET** `/api/subjects/:subjectId/groups`  
**Roles**: `admin`

**Response (200)**
```json
{
  "success": true,
  "subject_id": 14,
  "groups": [
    {
      "id": 1,
      "package_subject_item_id": 14,
      "name": "Group A",
      "teacher_id": 55,
      "teacher_name": "Teacher Name",
      "teacher_avatar": null,
      "created_at": "2025-12-29T12:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

### 1.4 إضافة طلاب إلى مجموعة
**POST** `/api/subjects/:subjectId/groups/:groupId/students`  
**Roles**: `admin`

**Body (JSON)**
```json
{
  "student_ids": [108, 109]
}
```

**Response (200)**
```json
{
  "success": true,
  "group_id": 1,
  "added": 2
}
```

**Response (404)**
```json
{ "error": "المجموعة غير موجودة" }
```

---

### 1.5 عرض طلاب مجموعة (Admin أو Teacher صاحب المجموعة)
**GET** `/api/subjects/:subjectId/groups/:groupId/students`  
**Roles**: `admin`, `teacher` (لكن المدرس لازم يكون owner للمجموعة)

**Response (200)**
```json
{
  "success": true,
  "group_id": 1,
  "students": [
    {
      "id": 108,
      "name": "Student Name",
      "email": null,
      "phone": "0100....",
      "avatar": null,
      "added_at": "2025-12-29T12:10:00.000Z"
    }
  ],
  "total": 1
}
```

**Response (403) للمدرس غير صاحب المجموعة**
```json
{ "error": "Forbidden", "message": "ليس لديك صلاحية" }
```

---

### 1.6 عرض تفاصيل مجموعة + إحصائيات
**GET** `/api/subjects/:subjectId/groups/:groupId`  
**Roles**: `admin`, `teacher` (owner only)

**Response (200)**
```json
{
  "success": true,
  "group": {
    "id": 1,
    "name": "Group A",
    "teacher_id": 55,
    "schedule_days": ["sat", "tue"],
    "schedule_time": "20:00"
  },
  "stats": {
    "students": 25,
    "lessons": 10
  }
}
```

**Response (403)**
```json
{ "error": "Forbidden" }
```

---

### 1.7 إنشاء درس داخل مجموعة
**POST** `/api/subjects/:subjectId/groups/:groupId/lessons`  
**Roles**: `admin`, `teacher` (owner only)

**Body (JSON)**
```json
{
  "title": "الدرس الأول – النحو",
  "description": "شرح أدوات الاستفهام"
}
```

**Response (201)**
```json
{
  "success": true,
  "lesson": {
    "id": 5,
    "package_subject_item_id": 14,
    "group_id": 2,
    "title": "الدرس الأول – النحو",
    "description": "شرح أدوات الاستفهام",
    "is_visible": false
  }
}
```

---

### 1.8 جلب محتوى مجموعة (للأدمن/المدرس صاحب المجموعة)
**GET** `/api/subjects/:subjectId/groups/:groupId/content`  
**Roles**: `admin`, `teacher` (owner only)

**Response (200)**
```json
{
  "success": true,
  "group": {
    "id": 2,
    "name": "Group B",
    "teacher_id": 55,
    "schedule_days": ["sat", "tue"],
    "schedule_time": "20:00"
  },
  "lessons": [
    {
      "id": 5,
      "title": "الدرس الأول",
      "description": "....",
      "videos": [],
      "files": [],
      "exams": [],
      "assignments": []
    }
  ],
  "total": 1
}
```

**Response (403)**
```json
{ "error": "Forbidden" }
```

---

## 2) إدارة محتوى الدرس (Videos / PDF Files / Exams / Assignments)
> هذه الـ APIs تعمل للأدمن والمدرس، مع شرط أن المدرس يكون **Owner** لمجموعة الدرس (عبر `lesson.group_id`).

### 2.1 إضافة فيديو للدرس
**POST** `/api/lessons/:lessonId/videos`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{
  "title": "اسم الفيديو",
  "video_url": "https://...",
  "duration_minutes": 15,
  "order_index": 0
}
```

### 2.2 تعديل فيديو
**PUT** `/api/videos/:videoId`  
**Roles**: `admin`, `teacher`

### 2.3 حذف فيديو
**DELETE** `/api/videos/:videoId`  
**Roles**: `admin`, `teacher`

---

### 2.4 إضافة ملف PDF للدرس
**POST** `/api/lessons/:lessonId/files`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{
  "title": "ملف الشرح",
  "file_url": "https://..."
}
```

### 2.5 تعديل ملف
**PUT** `/api/files/:fileId`  
**Roles**: `admin`, `teacher`

### 2.6 حذف ملف
**DELETE** `/api/files/:fileId`  
**Roles**: `admin`, `teacher`

---

### 2.7 إنشاء واجب للدرس
**POST** `/api/lessons/:lessonId/assignments`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{
  "name": "اسم الواجب",
  "duration_minutes": 20,
  "questions_count": 10
}
```

**ملاحظة مهمة**
- الواجب يتم إنشاؤه **مخفي عن الطالب** تلقائياً (`is_visible = false`).

### 2.8 تعديل واجب
**PUT** `/api/assignments/:assignmentId`  
**Roles**: `admin`, `teacher`

### 2.9 حذف واجب
**DELETE** `/api/assignments/:assignmentId`  
**Roles**: `admin`, `teacher`

### 2.10 تفعيل/إخفاء ظهور الواجب للطالب
**PATCH** `/api/assignments/:assignmentId/visibility`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{ "is_visible": true }
```

---

### 2.11 إنشاء امتحان للدرس
**POST** `/api/lessons/:lessonId/exams`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{
  "title": "اختبار الدرس",
  "duration": 20,
  "total_marks": 30
}
```

### 2.12 تعديل امتحان
**PUT** `/api/exams/:examId`  
**Roles**: `admin`, `teacher`

### 2.13 حذف امتحان
**DELETE** `/api/exams/:examId`  
**Roles**: `admin`, `teacher`

### 2.14 تفعيل/إخفاء ظهور الامتحان للطالب
**PATCH** `/api/exams/:examId/visibility`  
**Roles**: `admin`, `teacher`

**Body (JSON)**
```json
{ "is_visible": true }
```

---

## 2.15) محتوى عام على مستوى المجموعة (Group General Content)

> هذا المحتوى **مش مرتبط بدرس**. وهو خاص بـ `package_subject_item_groups`.
>
> ⚠️ ملاحظة: عندك Router قديم `/api/group-exams` خاص بـ `study_groups` ومتعطّل 503، لذلك هنا استخدمنا مسارات مختلفة: `package-group-exams`.

### 2.15.1 إضافة ملف PDF عام للمجموعة
**POST** `/api/subjects/:subjectId/groups/:groupId/group-files`  
**Roles**: `admin`, `teacher` (owner group فقط)

**Body (JSON)**
```json
{
  "title": "ملف الشرح العام",
  "file_url": "https://example.com/file.pdf",
  "order_index": 0
}
```

### 2.15.2 تعديل ملف PDF عام
**PUT** `/api/group-files/:fileId`  
**Roles**: `admin`, `teacher` (owner group فقط)

### 2.15.2.1 عرض ملفات المجموعة (Admin/Teacher)
**GET** `/api/subjects/:subjectId/groups/:groupId/group-files`  
**Roles**: `admin`, `teacher` (owner group فقط)

### 2.15.3 حذف ملف PDF عام
**DELETE** `/api/group-files/:fileId`  
**Roles**: `admin`, `teacher` (owner group فقط)

### 2.15.4 إنشاء امتحان عام للمجموعة
**POST** `/api/subjects/:subjectId/groups/:groupId/package-group-exams`  
**Roles**: `admin`, `teacher` (owner group فقط)

**Body (JSON)**
```json
{
  "title": "امتحان عام 1",
  "duration": 30,
  "total_marks": 50
}
```

### 2.15.5 تعديل امتحان عام
**PUT** `/api/package-group-exams/:examId`  
**Roles**: `admin`, `teacher` (owner group فقط)

### 2.15.5.1 عرض امتحانات المجموعة (Admin/Teacher)
**GET** `/api/subjects/:subjectId/groups/:groupId/package-group-exams`  
**Roles**: `admin`, `teacher` (owner group فقط)

### 2.15.6 إظهار/إخفاء امتحان عام
**PATCH** `/api/package-group-exams/:examId/visibility`  
**Roles**: `admin`, `teacher` (owner group فقط)

**Body (JSON)**
```json
{ "is_visible": false }
```

### 2.15.7 حذف امتحان عام
**DELETE** `/api/package-group-exams/:examId`  
**Roles**: `admin`, `teacher` (owner group فقط)

## 2) Teacher APIs

### 2.1 عرض مجموعات المدرس داخل مادة
**GET** `/api/subjects/:subjectId/groups/mine`  
**Roles**: `teacher`

**Response (200)**
```json
{
  "success": true,
  "subject_id": 14,
  "groups": [
    {
      "id": 1,
      "package_subject_item_id": 14,
      "name": "Group A",
      "teacher_id": 55,
      "teacher_name": "Teacher Name",
      "teacher_avatar": null,
      "created_at": "2025-12-29T12:00:00.000Z"
    }
  ],
  "total": 1
}
```

---

## 3) Student APIs (Seamless)

### 3.1 جلب مجموعة الطالب داخل مادة + الجدول
**GET** `/api/subjects/:subjectId/my-group`  
**Roles**: `student`

**السلوك**
- الطالب **لا يرى مجموعات أخرى**.
- يتم التحقق أولاً من تفعيل الباقة بالكود.
- ثم يتم جلب `group_id` الخاص بالطالب داخل المادة.

**Response (200)**
```json
{
  "success": true,
  "group": {
    "id": 1,
    "package_subject_item_id": 14,
    "name": "Group A",
    "teacher_id": 55,
    "schedule_days": ["sat", "tue"],
    "schedule_time": "20:00",
    "created_at": "2025-12-29T12:00:00.000Z"
  },
  "schedule": { "days": ["sat", "tue"], "time": "20:00" }
}
```

**Response (403) - الباقة غير مفعلة**
```json
{
  "success": false,
  "message": "غير مسموح الوصول، فعل الباقة أولاً"
}
```

**Response (403) - الطالب غير مضاف لأي مجموعة داخل المادة**
```json
{
  "success": false,
  "message": "لم يتم إضافتك إلى مجموعة داخل هذه المادة بعد"
}
```

---

### 3.2 جلب محتوى المادة للطالب (مفلتر حسب مجموعته)
**GET** `/api/subjects/:subjectId/content`  
**Roles**: `student`

**السلوك**
- التحقق من تفعيل الباقة
- تحديد مجموعة الطالب تلقائياً (بدون إرسال group_id)
- إرجاع محتوى المجموعة فقط (دروس + فيديوهات + ملفات + امتحانات + واجبات)

**Response (200)**
```json
{
  "success": true,
  "group": { "id": 2, "name": "Group B" },
  "group_files": [],
  "group_exams": [],
  "lessons": [
    {
      "id": 5,
      "title": "الدرس الأول",
      "description": "....",
      "videos": [],
      "files": [],
      "exams": [],
      "assignments": []
    }
  ]
}
```

---

### 3.3 جلب الملفات والامتحانات العامة للمجموعة (بدون الدروس)
**GET** `/api/subjects/:subjectId/group-general-content`  
**Roles**: `student`

**Response (200)**
```json
{
  "success": true,
  "group": { "id": 2, "name": "Group B" },
  "files": [],
  "exams": []
}
```

**Response (403) - الطالب غير مضاف لأي مجموعة**
```json
{
  "success": false,
  "message": "لم يتم إضافتك إلى مجموعة داخل هذه المادة"
}
```

**Response (403) - الباقة غير مفعلة**
```json
{
  "success": false,
  "message": "غير مسموح الوصول، فعل الباقة أولاً"
}
```



