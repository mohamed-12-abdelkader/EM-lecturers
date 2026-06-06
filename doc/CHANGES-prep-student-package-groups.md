# تغييرات النظام: Preparatory Student Package + Groups داخل المادة

هذا المستند يشرح **كل التعديلات** التي تمت على مشروع `emOnline-api` خلال تنفيذ:
- إصلاح مسارات APIs الموجودة
- فصل صلاحيات الطالب/الأدمن/المدرس بشكل واضح
- تفعيل الباقات **بالكود فقط**
- إضافة نظام **Groups داخل مادة الباقة** (Subject Groups) كبنية جديدة

> ملاحظة: جميع المسارات أدناه تبدأ بـ `/api` لأن `app.ts` يقوم بـ `app.use('/api', router);`

---

## 1) إصلاح مسار دروس المادة داخل الباقة

### المشكلة
كان endpoint الخاص بالدروس مكتوب داخل راوتر مُثبت بالفعل على `/subjects`، فكان ينتج مسار فعلي خاطئ مثل:
`/api/subjects/subjects/:subjectId/lessons` وبالتالي يظهر `404`.

### الحل
تم تعديل المسار داخل `src/controllers/packageSubjectLessons.ts` ليصبح:
- `GET /api/subjects/:subjectId/lessons`
- `POST /api/subjects/:subjectId/lessons`
- `POST /api/subjects/:subjectId/lessons/activate-all`
- `POST /api/subjects/:subjectId/activate`

---

## 2) تفعيل الباقة: السماح للطالب “بالكود فقط” (Security)

### الهدف
أنت طلبت أن **الطالب لا يصل لمحتوى الباقة إلا لو فعّلها بالكود**.

### التغيير الأساسي
تم تشديد التحقق داخل:
`src/services/packageActivationCodes.ts` → `PackageActivationCodeService.isActivated`

وأصبح “مفعل” فقط إذا كان يوجد سجل في `package_activations` يحقق:
- `is_active = TRUE`
- `activation_code_id IS NOT NULL`

وبالتالي أي سجل “يدوي/قديم” بدون `activation_code_id` **لن يعطي صلاحية**.

### إزالة تفعيل يدوي
تم حذف endpoint (كان مضاف للتجربة) الذي يفعّل الباقة للطالب يدويًا بواسطة الأدمن داخل `src/controllers/packages.ts`.

---

## 3) إصلاح وتثبيت Routers الخاصة بالواجبات والأسئلة

### المشكلة
كانت بعض الـ controllers موجودة لكن غير “mount” داخل `src/routes.ts` مما يؤدي إلى `404`.

### الحل
تم تسجيل (mount) الـ routers التالية في `src/routes.ts`:
- `assignmentQuestionsRouter`
- `assignmentSubmissionsRouter`

---

## 4) فصل APIs الطالب عن APIs الأدمن/المدرس لتجنب تعارض المسارات

### المشكلة (المتكررة)
عند وجود أكثر من route بنفس المسار (مثلاً `/assignments/:id/questions`) ومع اختلاف الأدوار، كان يحصل:
- الأدمن/المدرس يقع على route الطالب → `403 required_roles: student`
- الطالب يقع على route أدمن → `403 required_roles: admin`

### الحل
تم اعتماد مبدأ:
- **مسارات الطالب تكون تحت `/api/student/...`** (داخل `studentRouter`)
- ومسارات الأدمن/المدرس تبقى في controllers العامة

وكذلك تم تعديل Route الطالب القديم `GET /api/assignments/:id/questions` بحيث:
- لو المستخدم ليس طالب → يعمل `next()` ويمرر للـ handler الآخر في `assignmentQuestions.ts`

> هذا يجعل `GET /api/assignments/:id/questions` يعمل للأدمن/المدرس/الطالب بدون كسر.

---

## 5) APIs الطالب للواجبات (أسئلة/تسليم/نتيجة)

هذه مسارات “طالب فقط” داخل `src/controllers/student.ts`:

### 5.1 جلب أسئلة واجب (طالب فقط)
- `GET /api/student/assignments/:assignmentId/questions`
يرجع الأسئلة بدون الإجابات الصحيحة.
لو الطالب غير مفعل: يرجع رسالة واضحة:
`غير مسموح الوصول، فعل الباقة أولاً`

### 5.2 تسليم الواجب (طالب فقط)
- `POST /api/student/assignments/:assignmentId/submit`
يرجع:
- `submission` (score/عدد الصح/الغلط…)
- `review.wrong_answers` (الأسئلة التي أخطأ فيها الطالب + اختيار الطالب + الإجابة الصحيحة)

### 5.3 جلب نتيجة الواجب بعد التسليم (طالب فقط)
- `GET /api/student/assignments/:assignmentId/result`
يرجع:
- لو لم يسلم: `has_submitted: false`
- لو سلم: `submission` + `review.wrong_answers` (تصحيح الغلط)

---

## 6) إضافة API لعرض واجبات الدرس + أسئلتها

تم إضافة endpoint في `src/controllers/packageSubjectAssignments.ts`:
- `GET /api/lessons/:lessonId/assignments/questions`

السلوك:
- **admin**: يرى كل شيء
- **teacher**: يرى إذا لديه صلاحية على مادة الدرس
- **student**: يرى فقط إذا الباقة مفعلة بالكود، ويرى فقط الواجبات المرئية، والأسئلة بدون الإجابات الصحيحة

---

## 7) نظام Groups داخل مادة الباقة (الميزة الجديدة الأساسية)

### الهدف
بدلاً من إعطاء المدرس صلاحية على “المادة بالكامل”، أصبح لدينا:
- المادة تحتوي على عدة Groups
- كل Group له Teacher واحد (أو NULL)
- الطلاب يتم ربطهم بـ Group
- المحتوى (الدروس حالياً) يتم ربطه بـ Group عبر `group_id`

### 7.1 تغييرات قاعدة البيانات (Migrations)

تم إضافة:

1) `migrations/1700000000950_create_package_subject_groups.sql`
- `package_subject_item_groups`
- `package_subject_item_group_schedules`
- `package_subject_item_group_students`

2) `migrations/1700000000951_add_group_id_to_package_subject_lessons.sql`
- إضافة `group_id` إلى `package_subject_item_lessons`

### 7.2 Services
تم إضافة:
- `src/services/packageSubjectGroups.ts`

يوفر:
- إنشاء group + schedule
- listing groups للـ subject
- listing groups للمدرس داخل subject
- إضافة طلاب للـ group
- جلب group الطالب داخل subject
- جلب schedule للـ group

### 7.3 Controllers / Endpoints
تم إضافة:
- `src/controllers/packageSubjectGroups.ts`
ومُثبت في `src/routes.ts` تحت:
`router.use('/subjects', packageSubjectGroupsRouter);`

#### Admin
- `POST /api/subjects/:subjectId/groups`  
  إنشاء group داخل subject
- `GET /api/subjects/:subjectId/groups`  
  عرض كل groups داخل subject
- `POST /api/subjects/:subjectId/groups/:groupId/students`  
  إضافة طلاب للـ group
- `GET /api/subjects/:subjectId/groups/:groupId/students`  
  عرض طلاب group (Admin أو Teacher صاحب الـ group)

#### Teacher
- `GET /api/subjects/:subjectId/groups/mine`  
  عرض Groups الخاصة بالمدرس داخل المادة

#### Student (Seamless)
- `GET /api/subjects/:subjectId/my-group`  
  يرجع group الطالب داخل المادة + schedule  
  - لو غير مفعل الباقة: `غير مسموح الوصول، فعل الباقة أولاً`
  - لو مفعل لكن لم يتم إضافته لمجموعة: `لم يتم إضافتك إلى مجموعة داخل هذه المادة بعد`

---

## 8) تعديل Service الدروس لدعم group_id (تهيئة للمرحلة التالية)

تم تعديل:
`src/services/packageSubjectLessons.ts`

- `getLessonsBySubject(subjectId, forStudent, groupId?)` أصبح يدعم فلترة الدروس على `group_id`
- `createLesson` أصبح يستقبل `group_id` داخل `LessonData` ويحفظه في الجدول

> ملاحظة: ربط “عرض الدروس” تلقائياً بـ group الطالب + فرض العزل الكامل على كل المحتوى (Assignments/Exams/...) سيكون ضمن المرحلة التالية (تحديث الـ permission checks والـ controllers).

---

## 9) الملفات التي تم تعديلها/إضافتها (High-level)

### Added
- `migrations/1700000000950_create_package_subject_groups.sql`
- `migrations/1700000000951_add_group_id_to_package_subject_lessons.sql`
- `src/services/packageSubjectGroups.ts`
- `src/controllers/packageSubjectGroups.ts`
- `doc/CHANGES-prep-student-package-groups.md` (هذا الملف)

### Updated (أهمها)
- `src/controllers/packageSubjectLessons.ts`
- `src/services/packageSubjectLessons.ts`
- `src/services/packageActivationCodes.ts`
- `src/routes.ts`
- `src/controllers/assignmentQuestions.ts`
- `src/controllers/assignmentSubmissions.ts`
- `src/controllers/packageSubjectAssignments.ts`
- `src/controllers/student.ts`
- `src/controllers/packages.ts`

---

## 10) ملاحظات تشغيل/Deployment

1) بعد إضافة migrations الجديدة، تأكد أن تشغيل السيرفر يقوم بتطبيقها (عندكم `applyMigrations` في `src/index.ts`).
2) إذا كان لديك بيانات قديمة في `package_activations` بدون `activation_code_id` لن تحصل على صلاحية وصول حسب شرط “الكود فقط”.

---

# API Reference (شرح دقيق لكل API)

## قواعد عامة

### Base URL
- كل المسارات تبدأ بـ: `/api`

### Auth Header
- أغلب الـ endpoints تحتاج:
  - `Authorization: Bearer <token>`

### Roles
- `admin`
- `teacher`
- `student`

---

## A) تفعيل الباقة (Student)

### A1) تفعيل الباقة بكود
**POST** `/api/packages/activate`  
**Roles**: `student`

**Body (JSON)**:
```json
{
  "package_id": 5,
  "code": "12345678"
}
```

**Response (200)**:
```json
{
  "message": "تم تفعيل الباقة بنجاح",
  "package": {
    "id": 5,
    "name": "اسم الباقة"
  }
}
```

**Response (400)** (مثال):
```json
{
  "message": "package_id و code مطلوبان"
}
```

> ملاحظة أمنية: الوصول لمحتوى الباقة يعتمد على وجود سجل `package_activations` بـ `is_active=true` و `activation_code_id NOT NULL`.

---

## B) الدروس داخل مادة الباقة (Subject Lessons)

### B1) جلب دروس مادة + الفيديوهات + الواجبات
**GET** `/api/subjects/:subjectId/lessons`  
**Roles**: `admin`, `teacher` (صلاحية), `student` (باقة مفعلة بالكود)

**Path Params**
- `subjectId`: رقم (هو `package_subject_items.id`)

**Response (200)**:
```json
{
  "success": true,
  "lessons": [
    {
      "id": 10,
      "package_subject_item_id": 14,
      "group_id": null,
      "title": "الدرس الأول",
      "description": "....",
      "is_visible": true,
      "created_by": 1,
      "created_by_name": "Admin",
      "created_at": "2025-12-29T10:00:00.000Z",
      "updated_at": "2025-12-29T10:00:00.000Z",
      "videos": [],
      "assignments": []
    }
  ],
  "total": 1
}
```

**Response (403)** للطالب غير مفعل:
```json
{
  "success": false,
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً للوصول إلى هذه المادة"
}
```

---

## C) الواجبات داخل درس الباقة (Lesson Assignments)

### C1) إضافة واجب لدرس
**POST** `/api/lessons/:lessonId/assignments`  
**Roles**: `admin`, `teacher` (صلاحية على المادة)

**Body (JSON)**:
```json
{
  "name": "واجب 1",
  "questions_count": 10,
  "duration_minutes": 20
}
```

**Response (201)**:
```json
{
  "success": true,
  "message": "تم إضافة الواجب بنجاح",
  "assignment": {
    "id": 7,
    "lesson_id": 14,
    "name": "واجب 1",
    "questions_count": 10,
    "duration_minutes": 20,
    "is_visible": false,
    "created_at": "2025-12-29T10:00:00.000Z",
    "updated_at": "2025-12-29T10:00:00.000Z"
  }
}
```

### C2) جلب واجبات الدرس + أسئلتها
**GET** `/api/lessons/:lessonId/assignments/questions`  
**Roles**:
- `admin`: يرى كل شيء
- `teacher`: صلاحية على المادة
- `student`: باقة مفعلة بالكود (ويرى فقط المرئي + بدون إجابات صحيحة)

**Response (200)** (للطالب – بدون إجابات صحيحة):
```json
{
  "success": true,
  "lesson_id": 14,
  "assignments": [
    {
      "id": 7,
      "lesson_id": 14,
      "name": "واجب 1",
      "is_visible": true,
      "questions": [
        {
          "id": 100,
          "assignment_id": 7,
          "question_type": "text",
          "question_text": "....؟",
          "order_index": 0,
          "options": [
            { "id": 501, "option_text": "أ", "option_letter": "a", "order_index": 0 }
          ],
          "images": []
        }
      ]
    }
  ],
  "total": 1
}
```

---

## D) أسئلة الواجب (Admin/Teacher)

> هذه APIs لإضافة/تعديل/حذف الأسئلة. **ليست للطالب**.

### D1) إضافة سؤال نصي
**POST** `/api/assignments/:assignmentId/questions/text`  
**Roles**: `admin`, `teacher` (صلاحية على المادة)

**Body (JSON)** (صيغة options الجديدة):
```json
{
  "question_text": "ما هي عاصمة مصر؟",
  "options": [
    { "option_text": "القاهرة", "option_letter": "a" },
    { "option_text": "الإسكندرية", "option_letter": "b" },
    { "option_text": "الجيزة", "option_letter": "c" },
    { "option_text": "أسوان", "option_letter": "d" }
  ],
  "correct_answer": "a",
  "order_index": 0
}
```

**Response (201)** (مثال):
```json
{
  "success": true,
  "message": "تم إضافة السؤال بنجاح",
  "question": {
    "id": 100,
    "assignment_id": 7,
    "question_type": "text",
    "question_text": "ما هي عاصمة مصر؟",
    "correct_answer": "a",
    "order_index": 0
  }
}
```

### D2) إضافة سؤال صورة
**POST** `/api/assignments/:assignmentId/questions/image`  
**Roles**: `admin`, `teacher` (صلاحية على المادة)

> يتم رفع الصور حسب طريقة الـ controller الحالية (multipart/form-data) أو حسب الـ implementation عندكم.

---

## E) أسئلة الواجب (Student)

### E1) جلب أسئلة واجب للطالب
**GET** `/api/student/assignments/:assignmentId/questions`  
**Roles**: `student` فقط

**Response (200)**:
```json
{
  "success": true,
  "assignment_id": 7,
  "questions": [
    {
      "id": 100,
      "assignment_id": 7,
      "question_type": "text",
      "question_text": "....؟",
      "order_index": 0,
      "options": [
        { "id": 501, "option_text": "أ", "option_letter": "a", "order_index": 0 }
      ],
      "images": []
    }
  ],
  "total": 1,
  "has_submitted": false
}
```

**Response (403)** (غير مفعل):
```json
{
  "success": false,
  "message": "غير مسموح الوصول، فعل الباقة أولاً"
}
```

---

## F) تسليم الواجب + التصحيح (Student)

### F1) تسليم الواجب
**POST** `/api/student/assignments/:assignmentId/submit`  
**Roles**: `student` فقط

**Body (JSON)**:
```json
{
  "answers": [
    { "question_id": 100, "option_id": 501 }
  ]
}
```

**Response (201)**:
```json
{
  "success": true,
  "message": "تم تسليم الواجب بنجاح",
  "submission": {
    "id": 123,
    "assignment_id": 7,
    "student_id": 108,
    "total_questions": 10,
    "correct_answers": 7,
    "wrong_answers": 3,
    "score": 70,
    "submitted_at": "2025-12-29T10:20:30.000Z"
  },
  "review": {
    "wrong_count": 3,
    "wrong_answers": [
      {
        "question_id": 100,
        "question_type": "text",
        "question_text": "....؟",
        "images": [],
        "options": [
          { "id": 501, "option_text": "أ", "option_letter": "a", "order_index": 0 }
        ],
        "student_option": { "id": 501, "option_text": "أ", "option_letter": "a" },
        "correct_option": { "id": 504, "option_text": "د", "option_letter": "d" }
      }
    ]
  }
}
```

---

## G) نتيجة الواجب + تصحيح الغلط (Student)

### G1) جلب نتيجة الواجب للطالب بعد التسليم
**GET** `/api/student/assignments/:assignmentId/result`  
**Roles**: `student`

**Response (200)** إذا لم يسلم:
```json
{
  "success": true,
  "assignment_id": 7,
  "has_submitted": false,
  "submission": null,
  "review": { "wrong_count": 0, "wrong_answers": [] }
}
```

**Response (200)** إذا سلم:
نفس شكل `submission + review` بالأعلى (قسم F).

---

## H) Groups داخل مادة الباقة (Subject Groups)

### H1) إنشاء Group داخل مادة (Admin)
**POST** `/api/subjects/:subjectId/groups`  
**Roles**: `admin`

**Body (JSON)**:
```json
{
  "name": "Group A",
  "teacher_id": 55,
  "schedule": [
    { "title": "Lecture 1", "starts_at": "2026-01-05T18:00:00Z", "ends_at": "2026-01-05T20:00:00Z" }
  ]
}
```

**Response (201)**:
```json
{
  "success": true,
  "group": {
    "id": 1,
    "package_subject_item_id": 14,
    "name": "Group A",
    "teacher_id": 55,
    "created_by": 1,
    "created_at": "2025-12-29T12:00:00.000Z",
    "updated_at": "2025-12-29T12:00:00.000Z"
  }
}
```

### H2) عرض كل Groups داخل مادة (Admin)
**GET** `/api/subjects/:subjectId/groups`  
**Roles**: `admin`

### H3) عرض Groups الخاصة بالمدرس داخل مادة (Teacher)
**GET** `/api/subjects/:subjectId/groups/mine`  
**Roles**: `teacher`

### H4) إضافة طلاب لمجموعة (Admin)
**POST** `/api/subjects/:subjectId/groups/:groupId/students`  
**Roles**: `admin`

**Body**:
```json
{ "student_ids": [108, 109] }
```

**Response (200)**:
```json
{ "success": true, "group_id": 1, "added": 2 }
```

### H5) عرض طلاب مجموعة (Admin/Teacher-owner)
**GET** `/api/subjects/:subjectId/groups/:groupId/students`  
**Roles**: `admin` أو `teacher` (لازم يكون teacher صاحب المجموعة)

### H6) الطالب يعرف مجموعته داخل المادة + جدولها (Seamless)
**GET** `/api/subjects/:subjectId/my-group`  
**Roles**: `student`

**Response (200)**:
```json
{
  "success": true,
  "group": { "id": 1, "package_subject_item_id": 14, "name": "Group A", "teacher_id": 55 },
  "schedule": [
    { "id": 10, "title": "Lecture 1", "starts_at": "2026-01-05T18:00:00Z", "ends_at": "2026-01-05T20:00:00Z" }
  ]
}
```


