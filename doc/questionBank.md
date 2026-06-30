## Question Bank API — التوثيق الرئيسي

> **آخر تحديث:** يشمل طبقة **الكتب** بين المادة والفصول.

### ملفات توثيق مرتبطة

| الملف | المحتوى |
|-------|---------|
| [`question-bank-student-api.md`](./question-bank-student-api.md) | APIs الطالب |
| [`question-bank-v2-api.md`](./question-bank-v2-api.md) | أسئلة V2 — `/api/question-bank-v2` |
| [`question-bank-books-api.md`](./question-bank-books-api.md) | تفاصيل طبقة الكتب |
| [`question-bank-subject-management.md`](./question-bank-subject-management.md) | **إدارة محتوى المادة** (كتب → فصول → دروس → أسئلة) |
| [`question_bank_admin_change_requests_api.md`](./question_bank_admin_change_requests_api.md) | طلبات موافقة الموظف |
| [`teacher-question-library-system.md`](./teacher-question-library-system.md) | مكتبة المدرّس الخاصة (نظام منفصل) |

### الهيكل الحالي

```
بنك الأسئلة → مادة → كتاب → فصل → درس → أسئلة
```

**Migration:** `1772700000000_question_bank_subject_books.sql` — الفصول القديمة → كتاب **«كتاب عام»** لكل مادة.

### نظرة عامة
- **المسار الأساسي**: `/api/question-banks`
- **المصادقة**: JWT — `admin`، `employee` (+ `question_bank_management`)، `teacher`، `student` (مسارات `/student/*`)
- **الهيدر**: `Authorization: Bearer <JWT>`
- **رفع الصور**: `multipart/form-data` للحقل `image`، أو `image_url` كنص

### سير العمل (Admin)

1. بنك → 2. مادة → 3. **كتاب** → 4. فصل → 5. درس → 6. أسئلة (V2 أو legacy)

### تنسيق الاستجابة العام
جميع الاستجابات تتبع الصيغة:

```json
{
  "success": true,
  "message": "... اختياري ...",
  "data": { ... أو مصفوفة / كائن ... }
}
```

عند الخطأ:

```json
{
  "success": false,
  "message": "رسالة الخطأ",
  "error": "تفاصيل إضافية (اختياري)",
  "errors": [ ... أخطاء التحقق Zod (اختياري) ... ]
}
```

---

### 1) إنشاء بنك أسئلة
- **Endpoint**: `POST /api/question-banks`
- **Auth**: Admin أو Employee (صلاحية `question_bank_management`)
- **Request**: `multipart/form-data`
  - `name` (مطلوب), `description`, `grade_id`, `price`, `is_active`
  - `image` (file) أو `image_url`

```http
POST {{base_url}}/question-banks
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: بنك أسئلة الصف الأول
grade_id: 1
description: ...
```

---

### 2) جلب كل بنوك الأسئلة (مع ترقيم صفحات وفلاتر)
- **Endpoint**: `GET /api/question-banks`
- **Auth**: Admin فقط

معاملات الاستعلام (اختيارية):
- `page` (number) الافتراضي 1
- `limit` (number) الافتراضي 20
- `grade_id` (number)
- `is_active` (boolean: true/false)
- `search` (string) بحث بالاسم/الوصف

مثال:

```http
GET {{base_url}}/question-banks?page=1&limit=10&search=رياضيات
Authorization: Bearer {{admin_token}}
```

استجابة ناجحة (مثال):

```json
{
  "success": true,
  "data": {
    "question_banks": [
      {
        "id": 1,
        "name": "بنك أسئلة الصف الأول",
        "description": "...",
        "image_url": "https://...",
        "grade_id": 1,
        "grade_name": "الصف الأول الابتدائي",
        "grade_level": null,
        "is_active": true,
        "created_by": 10,
        "created_at": "2024-01-01T10:00:00.000Z",
        "updated_at": "2024-01-01T10:00:00.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

### 3) تعديل بنك أسئلة
- **Endpoint**: `PUT /api/question-banks/:id`
- **Auth**: Admin فقط
- **نوع الطلب**:
  - `multipart/form-data` إذا أردت تحديث الصورة عبر الحقل `image`
  - أو `application/json` لتحديث الحقول النصية فقط أو `image_url`

الحقول المقبولة (اختيارية كلها):
- `name` (string)
- `description` (string)
- `grade_id` (number)
- `is_active` (boolean)
- `image` (file) أو `image_url` (string)

مثال (multipart):

```http
PUT {{base_url}}/question-banks/1
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: بنك أسئلة الصف الأول - محدث
image: @/path/to/new-image.jpg
```

استجابة ناجحة (مثال):

```json
{
  "success": true,
  "message": "تم تحديث بنك الأسئلة بنجاح",
  "data": {
    "id": 1,
    "name": "بنك أسئلة الصف الأول - محدث",
    "description": "...",
    "image_url": "https://res.cloudinary.com/...",
    "grade_id": 1,
    "is_active": true,
    "created_by": 10,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-02T12:00:00.000Z"
  }
}
```

---

### 4) حذف بنك أسئلة
- **Endpoint**: `DELETE /api/question-banks/:id`
- **Auth**: Admin فقط

ملاحظة: لن يتم الحذف إذا كان هناك مواد/فصول/دروس/أسئلة مرتبطة بالبنك.

استجابة ناجحة (مثال):

```json
{
  "success": true,
  "message": "تم حذف بنك الأسئلة بنجاح"
}
```

استجابات أخطاء محتملة:
- `404`: بنك الأسئلة غير موجود
- `400`: لا يمكن الحذف لوجود كيانات مرتبطة

---

### 5) جلب بنك أسئلة بالمعرف
- **Endpoint**: `GET /api/question-banks/:id`
- **Auth**: Admin فقط

استجابة ناجحة (مثال):

```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "بنك أسئلة الصف الأول",
    "description": "...",
    "image_url": "https://...",
    "grade_id": 1,
    "grade_name": "الصف الأول الابتدائي",
    "grade_level": null,
    "is_active": true,
    "created_by": 10,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-01T10:00:00.000Z"
  }
}
```

---

### 5.1) جلب بنك أسئلة + المواد + الكتب + الفصول + الدروس
- **Endpoint**: `GET /api/question-banks/:id/with-subjects`
- **Auth**: Admin / Employee

كل مادة تُرجع:
- `books[]` — كل كتاب يحتوي `chapters[]` وكل فصل يحتوي `lessons[]`
- `chapters[]` — قائمة مسطّحة لجميع الفصول (legacy / توافق)

استجابة ناجحة (مختصر):

```json
{
  "success": true,
  "data": {
    "question_bank": { "id": 1, "name": "بنك أسئلة الصف الأول", "grade_id": 1 },
    "subjects": [
      {
        "id": 10,
        "name": "فيزياء",
        "question_bank_id": 1,
        "books": [
          {
            "id": 3,
            "subject_id": 10,
            "name": "كتاب الامتحان",
            "order_num": 1,
            "chapters": [
              {
                "id": 12,
                "book_id": 3,
                "subject_id": 10,
                "name": "الفصل الأول",
                "lessons": [{ "id": 15, "name": "درس 1" }]
              }
            ]
          },
          {
            "id": 4,
            "name": "كتاب نيوتن",
            "chapters": []
          }
        ],
        "chapters": [
          { "id": 12, "book_id": 3, "name": "الفصل الأول", "lessons": [] }
        ]
      }
    ]
  }
}
```

**بدائل لجلب شجرة مادة واحدة:**
- `GET /api/subjects/:id/with-books` — مادة + كتب + فصول + دروس
- `GET /api/subjects/:id/with-chapters` — مادة + فصول مسطّحة (legacy)
- `GET /api/books/:id/with-chapters` — كتاب واحد + فصول + دروس

---

### 6) البحث في بنوك الأسئلة
- **Endpoint**: `GET /api/question-banks/search`
- **Auth**: Admin فقط
- **معاملات الاستعلام**:
  - `q` (string) نص البحث (إجباري)
  - `page`, `limit` (اختياريان)

مثال:

```http
GET {{base_url}}/question-banks/search?q=رياضيات&page=1&limit=10
Authorization: Bearer {{admin_token}}
```

شكل الاستجابة مماثل لقائمة بنوك الأسئلة مع ترقيم الصفحات.

---

### 7) إحصائيات بنك أسئلة
- **Endpoint**: `GET /api/question-banks/:id/stats`
- **Auth**: Admin فقط

تعيد أرقامًا مجمعة مثل عدد المواد، الفصول، الدروس، والأسئلة وحالتها.

مثال استجابة (مختصر):

```json
{
  "success": true,
  "data": {
    "question_bank": { "id": 1, "name": "..." },
    "grade": { "name": "الصف الأول الابتدائي", "level": null },
    "statistics": {
      "subjects": 3,
      "books": 8,
      "chapters": 10,
      "lessons": 50,
      "questions": 400,
      "approved_questions": 300,
      "pending_questions": 80,
      "rejected_questions": 20
    }
  }
}
```

---

### الأكواد الشائعة
- **401 Unauthorized**: عدم إرسال JWT أو غير صالح
- **403 Forbidden**: المستخدم ليس Admin
- **400 Bad Request**: أخطاء تحقق/بيانات غير صحيحة
- **404 Not Found**: الكيان غير موجود
- **500 Internal Server Error**: خطأ غير متوقع في الخادم



---

### واجهات الكتب (Books) — Admin / Employee

- جدول DB: `subject_books`
- الاسم فريد داخل المادة: `(subject_id, LOWER(name))`
- حذف الكتاب يحذف فصوله تلقائياً (CASCADE)

#### 1) قائمة كتب المادة
- **Endpoint**: `GET /api/subjects/:subjectId/books`
- **Auth**: Admin / Employee / Teacher (مواده) / Student

#### 2) إنشاء كتاب
- **Endpoint**: `POST /api/subjects/:subjectId/books`
- **Auth**: Admin / Employee (`question_bank_management`)
- **Request**: `multipart/form-data`
  - `name` (مطلوب), `description`, `order_num`, `image`

```http
POST {{base_url}}/subjects/5/books
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: كتاب الامتحان
description: أسئلة امتحانات الترم
order_num: 1
```

استجابة (201):

```json
{
  "success": true,
  "message": "تم إنشاء الكتاب بنجاح",
  "data": {
    "id": 3,
    "subject_id": 5,
    "name": "كتاب الامتحان",
    "description": "أسئلة امتحانات الترم",
    "image_url": null,
    "order_num": 1,
    "is_active": true,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

#### 3) تعديل كتاب
- **Endpoint**: `PUT /api/books/:id`
- **Auth**: Admin / Employee — الموظف يرسل طلب موافقة (`202`)

#### 4) حذف كتاب
- **Endpoint**: `DELETE /api/books/:id`

#### 5) كتاب + فصول + دروس
- **Endpoint**: `GET /api/books/:id/with-chapters`

---

### واجهات الفصول (Chapters) — Admin / Employee

- جميع النقاط محمية بـ JWT ودور `admin` أو `employee` (للتعديل).
- رفع الصورة اختياري عبر `multipart/form-data` بالحقل `image`.
- **الاسم فريد داخل نفس الكتاب**: `(book_id, LOWER(name))` — لم يعد فريداً على مستوى المادة فقط.

#### 1) إنشاء فصل داخل كتاب (الطريقة المفضلة)
- **Endpoint**: `POST /api/books/:bookId/chapters`
- **Auth**: Admin / Employee
- **Request**: `multipart/form-data`
  - fields: `name` (مطلوب), `description` (اختياري)
  - file: `image` (اختياري)

```http
POST {{base_url}}/books/3/chapters
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: الفصل الأول
description: مقدمة
```

#### 2) إنشاء فصل عبر المادة (Legacy)
- **Endpoint**: `POST /api/subjects/:subjectId/chapters`
- يتطلب `book_id` في الـ body، أو يستخدم **أول كتاب** في المادة إن وُجد
- إن لم يوجد أي كتاب: `400` — «يجب إنشاء كتاب للمادة أولاً»

```http
POST {{base_url}}/subjects/5/chapters
Content-Type: multipart/form-data

book_id: 3
name: الفصل الأول
```

#### 3) تعديل فصل
- Endpoint: `PUT /api/chapters/:id`
- Auth: Admin فقط
- Request: `multipart/form-data`
  - fields: `name` (اختياري), `description` (اختياري)
  - file: `image` (اختياري؛ عند الإرسال يتم استبدال الصورة)

مثال (HTTP):

```http
PUT {{base_url}}/chapters/12
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: Updated Chapter Title
```

استجابة (200):

```json
{
  "success": true,
  "message": "تم تعديل الفصل بنجاح",
  "data": {
    "id": 12,
    "subject_id": 5,
    "book_id": 3,
    "name": "Updated Chapter Title",
    "description": "Basics of the subject",
    "image_url": "https://res.cloudinary.com/...",
    "created_by": 1,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-02T12:00:00.000Z"
  }
}
```

مثال cURL:

```bash
curl -X PUT http://localhost:8000/api/chapters/12 \
  -H "Authorization: Bearer <TOKEN>" \
  -F "name=Updated Chapter Title"
```

أخطاء شائعة:
- `404` الفصل غير موجود
- `409` يوجد فصل بنفس الاسم داخل نفس **الكتاب**
- `400` لا توجد بيانات للتحديث

#### 3) حذف فصل
- Endpoint: `DELETE /api/chapters/:id`
- Auth: Admin فقط

مثال (HTTP):

```http
DELETE {{base_url}}/chapters/12
Authorization: Bearer {{admin_token}}
```

استجابة (200):

```json
{ "success": true, "message": "تم حذف الفصل بنجاح" }
```

مثال cURL:

```bash
curl -X DELETE http://localhost:8000/api/chapters/12 \
  -H "Authorization: Bearer <TOKEN>"
```

أخطاء شائعة:
- `404` الفصل غير موجود

---

### واجهات مواد بنك الأسئلة (Subjects) - Admin Only

- جميع النقاط التالية محمية بـ JWT ودور `admin`.
- رفع الصورة اختياري عبر `multipart/form-data` بالحقل `image`. يتم تخزين رابط الصورة فقط (`image_url`).
- الاسم فريد داخل نفس بنك الأسئلة: `(question_bank_id, LOWER(name))`.

#### 1) إنشاء مادة داخل بنك أسئلة
- Endpoint: `POST /api/question-banks/:bankId/subjects`
- Auth: Admin فقط
- Request: `multipart/form-data`
  - fields: `name` (مطلوب), `description` (اختياري)
  - file: `image` (اختياري)

مثال (HTTP):

```http
POST {{base_url}}/question-banks/6/subjects
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: Physics Basics
description: Intro module
image: @/path/to/file.png
```

استجابة (201):

```json
{
  "success": true,
  "message": "تم إنشاء المادة بنجاح",
  "data": {
    "id": 10,
    "name": "Physics Basics",
    "description": "Intro module",
    "image_url": "https://res.cloudinary.com/...",
    "question_bank_id": 6,
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-01T10:00:00.000Z"
  }
}
```

مثال cURL:

```bash
curl -X POST http://localhost:8000/api/question-banks/6/subjects \
  -H "Authorization: Bearer <TOKEN>" \
  -F "name=Physics Basics" \
  -F "description=Intro module" \
  -F "image=@/path/to/file.png"
```

أخطاء شائعة:
- `404` بنك غير موجود
- `409` يوجد مادة بنفس الاسم داخل نفس البنك

#### 2) تعديل مادة
- Endpoint: `PUT /api/subjects/:id`
- Auth: Admin فقط
- Request: `multipart/form-data`
  - fields: `name` (اختياري), `description` (اختياري)
  - file: `image` (اختياري؛ عند الإرسال يتم استبدال الصورة)

مثال (HTTP):

```http
PUT {{base_url}}/subjects/10
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: Physics 101
```

استجابة (200):

```json
{
  "success": true,
  "message": "تم تحديث المادة بنجاح",
  "data": {
    "id": 10,
    "name": "Physics 101",
    "description": "Intro module",
    "image_url": "https://res.cloudinary.com/...",
    "question_bank_id": 6,
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-02T12:00:00.000Z"
  }
}
```

مثال cURL:

```bash
curl -X PUT http://localhost:8000/api/subjects/10 \
  -H "Authorization: Bearer <TOKEN>" \
  -F "name=Physics 101"
```

أخطاء شائعة:
- `404` المادة غير موجودة
- `409` يوجد مادة بنفس الاسم داخل نفس البنك

#### 3) حذف مادة
- Endpoint: `DELETE /api/subjects/:id`
- Auth: Admin فقط

مثال (HTTP):

```http
DELETE {{base_url}}/subjects/10
Authorization: Bearer {{admin_token}}
```

استجابة (200):

```json
{ "success": true, "message": "تم حذف المادة بنجاح" }
```

مثال cURL:

```bash
curl -X DELETE http://localhost:8000/api/subjects/10 \
  -H "Authorization: Bearer <TOKEN>"
```

أخطاء شائعة:
- `404` المادة غير موجودة
- `409` لا يمكن الحذف لوجود كتب أو فصول أو دروس أو أسئلة مرتبطة



---

### واجهات المدرّس (Teacher)

- **Auth**: `teacher` — المواد المعيّنة فقط (`teacher_subjects`)

| Endpoint | الوصف |
|----------|--------|
| `GET /api/teacher/subjects` | مواد المدرّس + `books[]` (فصول + دروس) + `chapters[]` flat |
| `GET /api/teacher/subjects/:id/content` | `books`, `chapters`, `lessons`, `questions` (approved) |
| `GET /api/subjects/:id/with-books` | نفس الشجرة — Admin/Teacher/Employee |
| `GET /api/books/:id/with-chapters` | كتاب + فصول + دروس |
| `POST /api/teacher/lessons/:id/questions` | إضافة سؤال pending |

> **ملاحظة:** مكتبة أسئلة المدرّس **الخاصة** (`/api/teacher/questions`) نظام منفصل — [`teacher-question-library-system.md`](./teacher-question-library-system.md)

---

### واجهات الدروس (Lessons) - Admin Only

- جميع النقاط التالية محمية بـ JWT ودور `admin`.
- رفع الصورة اختياري عبر `multipart/form-data` بالحقل `image`. يتم تخزين رابط الصورة فقط (`image_url`).
- الاسم فريد داخل نفس الفصل: `(chapter_id, LOWER(name))`.

#### 1) إنشاء درس داخل فصل
- Endpoint: `POST /api/chapters/:chapterId/lessons`
- Auth: Admin فقط
- Request: `multipart/form-data`
  - fields: `name` (مطلوب), `description` (اختياري)
  - file: `image` (اختياري)

مثال (HTTP):

```http
POST {{base_url}}/chapters/7/lessons
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: Lesson One
description: Introduction to the chapter
image: @/path/to/file.png
```

استجابة (201):

```json
{
  "success": true,
  "message": "تم إنشاء الدرس بنجاح",
  "data": {
    "id": 15,
    "chapter_id": 7,
    "name": "Lesson One",
    "description": "Introduction to the chapter",
    "image_url": "https://res.cloudinary.com/...",
    "created_by": 1,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-01T10:00:00.000Z"
  }
}
```

مثال cURL:

```bash
curl -X POST http://localhost:8000/api/chapters/7/lessons \
  -H "Authorization: Bearer <TOKEN>" \
  -F "name=Lesson One" \
  -F "description=Introduction to the chapter" \
  -F "image=@/path/to/file.png"
```

أخطاء شائعة:
- `404` الفصل غير موجود
- `409` يوجد درس بنفس الاسم داخل نفس الفصل

#### 2) تعديل درس
- Endpoint: `PUT /api/lessons/:id`
- Auth: Admin فقط
- Request: `multipart/form-data`
  - fields: `name` (اختياري), `description` (اختياري)
  - file: `image` (اختياري؛ عند الإرسال يتم استبدال الصورة)

مثال (HTTP):

```http
PUT {{base_url}}/lessons/15
Authorization: Bearer {{admin_token}}
Content-Type: multipart/form-data

name: Updated Lesson Title
```

استجابة (200):

```json
{
  "success": true,
  "message": "تم تعديل الدرس بنجاح",
  "data": {
    "id": 15,
    "chapter_id": 7,
    "name": "Updated Lesson Title",
    "description": "Introduction to the chapter",
    "image_url": "https://res.cloudinary.com/...",
    "created_by": 1,
    "created_at": "2024-01-01T10:00:00.000Z",
    "updated_at": "2024-01-02T12:00:00.000Z"
  }
}
```

مثال cURL:

```bash
curl -X PUT http://localhost:8000/api/lessons/15 \
  -H "Authorization: Bearer <TOKEN>" \
  -F "name=Updated Lesson Title"
```

أخطاء شائعة:
- `404` الدرس غير موجود
- `409` يوجد درس بنفس الاسم داخل نفس الفصل
- `400` لا توجد بيانات للتحديث

#### 3) حذف درس
- Endpoint: `DELETE /api/lessons/:id`
- Auth: Admin فقط

مثال (HTTP):

```http
DELETE {{base_url}}/lessons/15
Authorization: Bearer {{admin_token}}
```

استجابة (200):

```json
{ "success": true, "message": "تم حذف الدرس بنجاح" }
```

مثال cURL:

```bash
curl -X DELETE http://localhost:8000/api/lessons/15 \
  -H "Authorization: Bearer <TOKEN>"
```

أخطاء شائعة:
- `404` الدرس غير موجود


---

### واجهات أسئلة الدرس (Lesson Questions) - Admin Only

- جميع النقاط التالية محمية بـ JWT ودور `admin`.
- هذه الواجهة تقرأ نصًا خام يحتوي على عدة أسئلة، وتستخرج كل سؤال مع 4 اختيارات بالصيغة A) / B) / C) / D)، ثم تحفظهم.
- يتم الحفظ في جدول `lesson_questions` المرتبط بـ `lessons`.

#### 1) إضافة مجموعة أسئلة من نص خام
- Endpoint: `POST /api/lessons/:lessonId/questions/text-bulk`
- Auth: Admin فقط
- Request: يدعم طريقتين
  - `Content-Type: text/plain` ويرسل النص مباشرة في الجسم
  - أو `Content-Type: application/json` مع كائن: `{ "text": "النص الكامل" }`

صيغة النص المتوقعة:
- سطر للسؤال
- 4 أسطر اختيارات بالشكل:
  - `A) ...`
  - `B) ...`
  - `C) ...`
  - `D) ...`
- سطر فارغ بين كل سؤالين

مثال (نص خام):

```text
Ali who won the quiz is a __________. He looked up the answers online, which wasn't allowed.
A) chat
B) bias
C) cheat
D) spin

People were __________ while the firefighters helped the family from the fire.
A) waiting without bated breathe
B) waiting with bated breath
C) long-awaited ending
D) pirating digital copy
```

مثال (HTTP - نص خام):

```http
POST {{base_url}}/lessons/15/questions/text-bulk
Authorization: Bearer {{admin_token}}
Content-Type: text/plain

Ali who won the quiz is a __________. He looked up the answers online, which wasn't allowed.
A) chat
B) bias
C) cheat
D) spin

People were __________ while the firefighters helped the family from the fire.
A) waiting without bated breathe
B) waiting with bated breath
C) long-awaited ending
D) pirating digital copy
```

مثال (HTTP - JSON):

```http
POST {{base_url}}/lessons/15/questions/text-bulk
Authorization: Bearer {{admin_token}}
Content-Type: application/json

{
  "text": "Ali who won the quiz is a __________. He looked up the answers online, which wasn't allowed.\nA) chat\nB) bias\nC) cheat\nD) spin\n\nPeople were __________ while the firefighters helped the family from the fire.\nA) waiting without bated breathe\nB) waiting with bated breath\nC) long-awaited ending\nD) pirating digital copy\n"
}
```

استجابة (201):

```json
{
  "success": true,
  "message": "تمت إضافة مجموعة الأسئلة بنجاح",
  "count": 2,
  "data": [
    {
      "id": 100,
      "lesson_id": 15,
      "question_text": "Ali who won the quiz is a __________. He looked up the answers online, which wasn't allowed.",
      "options": ["chat", "bias", "cheat", "spin"],
      "correct_answer": "",
      "image_url": null,
      "created_at": "2024-01-01T10:00:00.000Z",
      "updated_at": "2024-01-01T10:00:00.000Z"
    },
    {
      "id": 101,
      "lesson_id": 15,
      "question_text": "People were __________ while the firefighters helped the family from the fire.",
      "options": [
        "waiting without bated breathe",
        "waiting with bated breath",
        "long-awaited ending",
        "pirating digital copy"
      ],
      "correct_answer": "",
      "image_url": null,
      "created_at": "2024-01-01T10:00:00.000Z",
      "updated_at": "2024-01-01T10:00:00.000Z"
    }
  ]
}
```

ملاحظات:
- `correct_answer` تُترك فارغة افتراضيًا هنا ويمكن تحديثها لاحقًا عبر واجهة تعديل منفصلة.
- تُمنع التكرارات داخل نفس الدرس بناءً على نص السؤال.

أخطاء شائعة:
- `400` لا يوجد نص صالح أو لم يتم العثور على أسئلة بصيغة صحيحة
- `404` الدرس غير موجود
- `500` خطأ داخلي غير متوقع
