# 🎯 API نظام بنك الأسئلة الموحد (V2) - التوثيق الشامل

## 📋 نظرة عامة

نظام موحد ومرن لإدارة الأسئلة في بنك الأسئلة يدعم أنواع متعددة من الأسئلة مع إمكانية التوسع مستقبلاً. النظام مصمم ليكون سريعاً ومرناً بدون تعقيد في البيانات.

### المميزات الرئيسية:
- ✅ **إضافة جماعية**: إضافة عدد كبير من الأسئلة النصية دفعة واحدة
- ✅ **دعم الصور**: إضافة أسئلة باختيارات صورية
- ✅ **صور اختيارية**: إضافة صورة لأي سؤال لاحقاً
- ✅ **Schema موحد**: جدول واحد يدعم جميع الأنواع
- ✅ **مرن وقابل للتوسع**: سهل إضافة أنواع جديدة من الأسئلة

---

## 🗄️ هيكل قاعدة البيانات

### 1. جدول الأسئلة الموحد (`questions_v2`)

| الحقل | النوع | الوصف |
|-------|-------|--------|
| `id` | SERIAL | المعرف الفريد |
| `question_text` | TEXT | نص السؤال |
| `question_type` | VARCHAR(20) | نوع السؤال: `text_only`, `text_with_image`, `image_choices` |
| `lesson_id` | INTEGER | معرف الدرس |
| `teacher_id` | INTEGER | معرف المدرس |
| `correct_answer_index` | INTEGER | فهرس الإجابة الصحيحة (0-3) |
| `explanation` | TEXT | شرح الإجابة (اختياري) |
| `difficulty_level` | VARCHAR(20) | مستوى الصعوبة: `easy`, `medium`, `hard` |
| `points` | INTEGER | نقاط السؤال |
| `status` | VARCHAR(20) | الحالة: `pending`, `approved`, `rejected` |
| `approved_by` | INTEGER | معرف الأدمن الموافق (اختياري) |
| `approved_at` | TIMESTAMP | تاريخ الموافقة (اختياري) |
| `rejection_reason` | TEXT | سبب الرفض (اختياري) |
| `created_at` | TIMESTAMP | تاريخ الإنشاء |
| `updated_at` | TIMESTAMP | تاريخ آخر تحديث |

### 2. جدول خيارات الأسئلة (`question_options`)

| الحقل | النوع | الوصف |
|-------|-------|--------|
| `id` | SERIAL | المعرف الفريد |
| `question_id` | INTEGER | معرف السؤال |
| `option_index` | INTEGER | فهرس الخيار (0-3) |
| `option_type` | VARCHAR(20) | نوع الخيار: `text`, `image` |
| `text_content` | TEXT | محتوى نصي (للخيارات النصية) |
| `image_url` | TEXT | رابط الصورة (للخيارات الصورية) |
| `created_at` | TIMESTAMP | تاريخ الإنشاء |

### 3. جدول صور الأسئلة (`question_media`)

| الحقل | النوع | الوصف |
|-------|-------|--------|
| `id` | SERIAL | المعرف الفريد |
| `question_id` | INTEGER | معرف السؤال (UNIQUE) |
| `media_type` | VARCHAR(20) | نوع الميديا: `image`, `diagram`, `chart` |
| `media_url` | TEXT | رابط الميديا |
| `media_name` | VARCHAR(255) | اسم الملف |
| `media_size` | INTEGER | حجم الملف بالبايت |
| `uploaded_by` | INTEGER | معرف المستخدم الذي رفع الملف |
| `created_at` | TIMESTAMP | تاريخ الإنشاء |

---

## 🔐 الأمان والصلاحيات

- **المدرس (Teacher)**: يمكنه إضافة وتعديل وحذف أسئلته فقط (يحتاج صلاحيات للمادة)
- **الأدمن (Admin)**: يمكنه إضافة وتعديل وحذف أي سؤال + الموافقة/رفض الأسئلة (صلاحيات كاملة)
- **الطالب (Student)**: يمكنه قراءة الأسئلة فقط

---

## 📡 REST APIs

### Base URL
```
/api/question-bank-v2
```

---

### 1. إضافة أسئلة نصية جماعية (Bulk Add)

إضافة أكثر من سؤال نصي في نفس الطلب.

**Endpoint**: `POST /api/question-bank-v2/bulk-text`

**Headers**:
```
Authorization: Bearer <teacher_token> أو <admin_token>
Content-Type: application/json
```

**ملاحظة**: الأدمن يمكنه استخدام هذا الـ API أيضاً بدون الحاجة لصلاحيات المادة.

**Request Body**:
```json
{
  "lesson_id": 1,
  "questions": [
    {
      "question_text": "ما هي عاصمة مصر؟",
      "options": [
        {
          "option_index": 0,
          "option_type": "text",
          "text_content": "القاهرة"
        },
        {
          "option_index": 1,
          "option_type": "text",
          "text_content": "الإسكندرية"
        },
        {
          "option_index": 2,
          "option_type": "text",
          "text_content": "الجيزة"
        },
        {
          "option_index": 3,
          "option_type": "text",
          "text_content": "أسوان"
        }
      ],
      "correct_answer_index": 0,
      "explanation": "القاهرة هي عاصمة مصر",
      "difficulty_level": "easy",
      "points": 1
    },
    {
      "question_text": "ما هي أكبر قارة في العالم؟",
      "options": [
        {
          "option_index": 0,
          "option_type": "text",
          "text_content": "أفريقيا"
        },
        {
          "option_index": 1,
          "option_type": "text",
          "text_content": "آسيا"
        },
        {
          "option_index": 2,
          "option_type": "text",
          "text_content": "أوروبا"
        },
        {
          "option_index": 3,
          "option_type": "text",
          "text_content": "أمريكا الشمالية"
        }
      ],
      "correct_answer_index": 1,
      "difficulty_level": "medium",
      "points": 2
    }
  ]
}
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم إضافة 2 سؤال بنجاح",
  "data": [
    {
      "id": 1,
      "question_text": "ما هي عاصمة مصر؟",
      "question_type": "text_only",
      "lesson_id": 1,
      "teacher_id": 5,
      "correct_answer_index": 0,
      "explanation": "القاهرة هي عاصمة مصر",
      "difficulty_level": "easy",
      "points": 1,
      "status": "pending",
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z",
      "options": [
        {
          "id": 1,
          "question_id": 1,
          "option_index": 0,
          "option_type": "text",
          "text_content": "القاهرة",
          "created_at": "2024-01-15T10:00:00Z"
        },
        {
          "id": 2,
          "question_id": 1,
          "option_index": 1,
          "option_type": "text",
          "text_content": "الإسكندرية",
          "created_at": "2024-01-15T10:00:00Z"
        },
        {
          "id": 3,
          "question_id": 1,
          "option_index": 2,
          "option_type": "text",
          "text_content": "الجيزة",
          "created_at": "2024-01-15T10:00:00Z"
        },
        {
          "id": 4,
          "question_id": 1,
          "option_index": 3,
          "option_type": "text",
          "text_content": "أسوان",
          "created_at": "2024-01-15T10:00:00Z"
        }
      ]
    }
  ]
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/question-bank-v2/bulk-text \
  -H "Authorization: Bearer <teacher_token> أو <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "lesson_id": 1,
    "questions": [...]
  }'
```

**Error Responses**:
- `400 Bad Request` - إذا كانت البيانات غير صحيحة
- `403 Forbidden` - إذا لم يكن للمدرس صلاحيات للمادة
- `404 Not Found` - إذا كان الدرس غير موجود

**Error Response Example**:
```json
{
  "success": false,
  "message": "بيانات غير صحيحة",
  "errors": [
    {
      "path": ["questions", 0, "options"],
      "message": "يجب أن يكون هناك 4 خيارات"
    }
  ]
}
```

---

### 1b. إضافة أسئلة صورة فقط (Bulk) — حتى 20 صورة

سؤال = صورة فقط + 4 اختيارات ثابتة (a, b, c, d). نظام مستقل (Additive) بدون المساس ببقية الـ APIs.

**Endpoint**: `POST /api/question-bank-v2/lesson/:lessonId/questions/image-only-bulk`

**Headers**:
```
Authorization: Bearer <teacher_token> أو <admin_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `images` (required) — مصفوفة ملفات صور (حتى 20 صورة)، كل صورة = سؤال مستقل
- `meta` (optional) — JSON string: مصفوفة بنفس ترتيب الصور، كل عنصر: `{ "correct_answer_index": 0, "difficulty_level": "medium", "points": 1 }`
  - `correct_answer_index`: 0–3 (افتراضي 0)
  - `difficulty_level`: `easy` | `medium` | `hard` (افتراضي `medium`)
  - `points`: رقم (افتراضي 1)
- `teacher_id` (optional) — للأدمن فقط: تحديد المدرس المرتبط بالسؤال

**Response (201 Created)** — عند نجاح الكل:
```json
{
  "success": true,
  "message": "تمت إضافة 5 سؤال بنجاح",
  "data": {
    "added": 5,
    "failed": 0,
    "questions": [
      {
        "id": 1,
        "question_text": "",
        "question_type": "text_with_image",
        "lesson_id": 44,
        "teacher_id": 22,
        "correct_answer_index": 0,
        "difficulty_level": "medium",
        "points": 1,
        "status": "pending",
        "options": [
          { "option_index": 0, "text_content": "a" },
          { "option_index": 1, "text_content": "b" },
          { "option_index": 2, "text_content": "c" },
          { "option_index": 3, "text_content": "d" }
        ],
        "media": {
          "media_type": "image",
          "media_url": "https://res.cloudinary.com/..."
        }
      }
    ],
    "errors": []
  }
}
```

**Response (207 Multi-Status)** — عند نجاح جزء وفشل جزء:
```json
{
  "success": true,
  "message": "تمت إضافة 3 سؤال، وفشل 2",
  "data": {
    "added": 3,
    "failed": 2,
    "questions": [ ... ],
    "errors": [
      { "index": 1, "message": "فشل رفع الصورة" },
      { "index": 3, "message": "..." }
    ]
  }
}
```

**ملاحظات**:
- في حالة فشل رفع صورة واحدة يُرجَع تقرير يوضح الصور التي نجحت والتي فشلت.
- عند عرض السؤال في الدرس يُرجَع: صورة السؤال + أربع اختيارات a, b, c, d.

---

### 2. إضافة سؤال باختيارات صور

إضافة سؤال واحد باختيارات صورية.

**Endpoint**: `POST /api/question-bank-v2/image-choices`

**Headers**:
```
Authorization: Bearer <teacher_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `question_text` (required) - نص السؤال
- `lesson_id` (required) - معرف الدرس
- `option_0` (required) - صورة الخيار الأول
- `option_1` (required) - صورة الخيار الثاني
- `option_2` (required) - صورة الخيار الثالث
- `option_3` (required) - صورة الخيار الرابع
- `correct_answer_index` (required) - فهرس الإجابة الصحيحة (0-3)
- `explanation` (optional) - شرح الإجابة
- `difficulty_level` (optional) - مستوى الصعوبة
- `points` (optional) - نقاط السؤال

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم إضافة السؤال بنجاح",
  "data": {
    "id": 2,
    "question_text": "اختر الشكل الصحيح",
    "question_type": "image_choices",
    "lesson_id": 1,
    "teacher_id": 5,
    "correct_answer_index": 1,
    "difficulty_level": "medium",
    "points": 2,
    "status": "pending",
    "options": [
      {
        "id": 5,
        "question_id": 2,
        "option_index": 0,
        "option_type": "image",
        "image_url": "https://cloudinary.com/option0.jpg"
      },
      {
        "id": 6,
        "question_id": 2,
        "option_index": 1,
        "option_type": "image",
        "image_url": "https://cloudinary.com/option1.jpg"
      },
      {
        "id": 7,
        "question_id": 2,
        "option_index": 2,
        "option_type": "image",
        "image_url": "https://cloudinary.com/option2.jpg"
      },
      {
        "id": 8,
        "question_id": 2,
        "option_index": 3,
        "option_type": "image",
        "image_url": "https://cloudinary.com/option3.jpg"
      }
    ]
  }
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/question-bank-v2/image-choices \
  -H "Authorization: Bearer <teacher_token> أو <admin_token>" \
  -F "question_text=اختر الشكل الصحيح" \
  -F "lesson_id=1" \
  -F "option_0=@image0.jpg" \
  -F "option_1=@image1.jpg" \
  -F "option_2=@image2.jpg" \
  -F "option_3=@image3.jpg" \
  -F "correct_answer_index=1" \
  -F "difficulty_level=medium" \
  -F "points=2"
```

**Error Responses**:
- `400 Bad Request` - إذا كانت البيانات غير صحيحة أو الملفات ناقصة
- `403 Forbidden` - إذا لم يكن للمدرس صلاحيات للمادة
- `404 Not Found` - إذا كان الدرس غير موجود

**Error Response Example**:
```json
{
  "success": false,
  "message": "يجب رفع صورة للخيار 1"
}
```

---

### 3. إضافة/تحديث صورة السؤال (Optional)

إضافة أو تحديث صورة اختيارية لأي سؤال.

**Endpoint**: `POST /api/question-bank-v2/:questionId/media`

**Headers**:
```
Authorization: Bearer <teacher_token> أو <admin_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `media` (required) - ملف الصورة
- `media_type` (optional) - نوع الميديا: `image`, `diagram`, `chart`
- `media_name` (optional) - اسم الملف

**ملاحظة**: الأدمن يمكنه إضافة/تحديث صورة لأي سؤال، بينما المدرس يمكنه فقط لأسئلته.

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم إضافة/تحديث صورة السؤال بنجاح",
  "data": {
    "id": 1,
    "question_id": 1,
    "media_type": "image",
    "media_url": "https://cloudinary.com/question-image.jpg",
    "media_name": "question-image.jpg",
    "media_size": 1024000,
    "uploaded_by": 5,
    "created_at": "2024-01-15T10:05:00Z"
  }
}
```

**ملاحظة**: عند إضافة صورة لسؤال من نوع `text_only`، يتم تحديث نوعه تلقائياً إلى `text_with_image`.

**مثال**:
```bash
curl -X POST http://localhost:8000/api/question-bank-v2/1/media \
  -H "Authorization: Bearer <teacher_token> أو <admin_token>" \
  -F "media=@question-image.jpg" \
  -F "media_type=image"
```

**Error Responses**:
- `400 Bad Request` - إذا كان الملف مفقوداً أو معرف السؤال غير صحيح
- `403 Forbidden` - إذا لم يكن السؤال ملكاً للمدرس
- `404 Not Found` - إذا كان السؤال غير موجود

**Error Response Example**:
```json
{
  "success": false,
  "message": "يجب رفع ملف"
}
```

---

### 4. جلب سؤال معين

جلب سؤال مع خياراته وصوره (إن وجدت).

**Endpoint**: `GET /api/question-bank-v2/:questionId`

**Headers**:
```
Authorization: Bearer <token>
```

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "question_text": "ما هي عاصمة مصر؟",
    "question_type": "text_with_image",
    "lesson_id": 1,
    "teacher_id": 5,
    "correct_answer_index": 0,
    "explanation": "القاهرة هي عاصمة مصر",
    "difficulty_level": "easy",
    "points": 1,
    "status": "approved",
    "approved_by": 2,
    "approved_at": "2024-01-15T11:00:00Z",
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T11:00:00Z",
    "options": [
      {
        "id": 1,
        "question_id": 1,
        "option_index": 0,
        "option_type": "text",
        "text_content": "القاهرة",
        "created_at": "2024-01-15T10:00:00Z"
      },
      ...
    ],
    "media": {
      "id": 1,
      "question_id": 1,
      "media_type": "image",
      "media_url": "https://cloudinary.com/question-image.jpg",
      "media_name": "question-image.jpg",
      "media_size": 1024000,
      "uploaded_by": 5,
      "created_at": "2024-01-15T10:05:00Z"
    }
  }
}
```

**Error Responses**:
- `400 Bad Request` - إذا كان معرف السؤال غير صحيح
- `404 Not Found` - إذا كان السؤال غير موجود

---

### 5. جلب أسئلة الدرس

### 5. جلب أسئلة الدرس

جلب جميع أسئلة درس معين مع إمكانية التصفية.

**Endpoint**: `GET /api/question-bank-v2/lesson/:lessonId`

**Headers**:
```
Authorization: Bearer <token>
```

**Query Parameters**:
- `status` (optional) - تصفية حسب الحالة: `pending`, `approved`, `rejected`
- `limit` (optional, default: 50) - عدد الأسئلة
- `offset` (optional, default: 0) - للـ pagination

**Response (200 OK)**:
```json
{
  "success": true,
  "data": {
    "questions": [
      {
        "id": 1,
        "question_text": "ما هي عاصمة مصر؟",
        "question_type": "text_only",
        "status": "approved",
        ...
      }
    ],
    "total": 10
  }
}
```

**مثال**:
```bash
# جلب جميع الأسئلة
curl -X GET "http://localhost:8000/api/question-bank-v2/lesson/1" \
  -H "Authorization: Bearer <token>"

# جلب الأسئلة المعلقة فقط
curl -X GET "http://localhost:8000/api/question-bank-v2/lesson/1?status=pending" \
  -H "Authorization: Bearer <token>"

# جلب الأسئلة مع pagination
curl -X GET "http://localhost:8000/api/question-bank-v2/lesson/1?limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

**Error Responses**:
- `400 Bad Request` - إذا كان معرف الدرس غير صحيح

---

### 6. تحديث حالة السؤال (Admin)

الموافقة أو رفض سؤال.

**Endpoint**: `PUT /api/question-bank-v2/:questionId/status`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "status": "approved"
}
```

أو للرفض:
```json
{
  "status": "rejected",
  "rejection_reason": "السؤال يحتوي على معلومات خاطئة"
}
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تمت الموافقة على السؤال",
  "data": {
    "id": 1,
    "status": "approved",
    "approved_by": 2,
    "approved_at": "2024-01-15T11:00:00Z",
    ...
  }
}
```

**مثال**:
```bash
# الموافقة على سؤال
curl -X PUT http://localhost:8000/api/question-bank-v2/1/status \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "approved"}'

# رفض سؤال
curl -X PUT http://localhost:8000/api/question-bank-v2/1/status \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "rejected",
    "rejection_reason": "السؤال يحتوي على معلومات خاطئة"
  }'
```

**Error Responses**:
- `400 Bad Request` - إذا كانت البيانات غير صحيحة أو سبب الرفض مفقود
- `404 Not Found` - إذا كان السؤال غير موجود أو تمت مراجعته بالفعل

**Error Response Example**:
```json
{
  "success": false,
  "message": "سبب الرفض مطلوب عند رفض السؤال"
}
```

---

### 6b. تحديد الإجابة الصحيحة لسؤال (Admin)

يسمح للأدمن بتحديث الإجابة الصحيحة لسؤال في بنك الأسئلة (فهرس الخيار 0–3).

**Endpoint**: `PATCH /api/question-bank-v2/:questionId/correct-answer`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "correct_answer_index": 0
}
```

- `correct_answer_index`: رقم من 0 إلى 3 (0 = أ، 1 = ب، 2 = ج، 3 = د).

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم تحديث الإجابة الصحيحة بنجاح",
  "data": {
    "id": 1,
    "question_text": "...",
    "correct_answer_index": 0,
    ...
  }
}
```

**مثال**:
```bash
curl -X PATCH http://localhost:8000/api/question-bank-v2/1/correct-answer \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"correct_answer_index": 2}'
```

**Error Responses**:
- `400 Bad Request` - معرف السؤال غير صحيح أو `correct_answer_index` خارج النطاق 0–3
- `404 Not Found` - السؤال غير موجود

---

### 7. حذف سؤال

حذف سؤال (المدرس يمكنه حذف أسئلته فقط).

**Endpoint**: `DELETE /api/question-bank-v2/:questionId`

**Headers**:
```
Authorization: Bearer <teacher_token> أو <admin_token>
```

**ملاحظة**: الأدمن يمكنه حذف أي سؤال، بينما المدرس يمكنه حذف أسئلته فقط.

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم حذف السؤال بنجاح"
}
```

**مثال**:
```bash
curl -X DELETE http://localhost:8000/api/question-bank-v2/1 \
  -H "Authorization: Bearer <teacher_token> أو <admin_token>"
```

**Error Responses**:
- `400 Bad Request` - إذا كان معرف السؤال غير صحيح
- `403 Forbidden` - إذا لم يكن السؤال ملكاً للمدرس
- `404 Not Found` - إذا كان السؤال غير موجود

**Error Response Example**:
```json
{
  "success": false,
  "message": "ليس لديك صلاحية لحذف هذا السؤال"
}
```

---

## 📝 ملاحظات مهمة

1. **Bulk Add**: يمكن إضافة عدد غير محدود من الأسئلة في طلب واحد
2. **Image Choices**: يجب رفع 4 صور بالضبط للخيارات
3. **Media Optional**: يمكن إضافة صورة لأي سؤال لاحقاً
4. **Status Flow**: `pending` → `approved` / `rejected`
5. **Permissions**: المدرس يحتاج صلاحيات للمادة لإضافة أسئلة
6. **File Size**: الحد الأقصى لحجم الملف 10MB

---

## 🎯 أنواع الأسئلة المدعومة

### 1. `text_only`
- سؤال نصي فقط
- 4 خيارات نصية
- يمكن إضافة صورة لاحقاً (يصبح `text_with_image`)

### 2. `text_with_image`
- سؤال نصي مع صورة
- 4 خيارات نصية
- الصورة اختيارية ويمكن إضافتها لاحقاً

### 3. `image_choices`
- سؤال نصي
- 4 خيارات صورية
- كل خيار عبارة عن صورة

---

## 🔄 سيناريوهات الاستخدام

### سيناريو 1: إضافة 10 أسئلة نصية دفعة واحدة
```bash
POST /api/question-bank-v2/bulk-text
{
  "lesson_id": 1,
  "questions": [/* 10 أسئلة */]
}
```

### سيناريو 2: إضافة سؤال بصور
```bash
POST /api/question-bank-v2/image-choices
Form Data: question_text, lesson_id, option_0-3 (4 صور), correct_answer_index
```

### سيناريو 3: إضافة صورة لسؤال موجود
```bash
POST /api/question-bank-v2/1/media
Form Data: media (صورة)
```

---

## ✅ المميزات

- ✅ **Schema موحد**: جدول واحد يدعم جميع الأنواع
- ✅ **مرن**: سهل التوسع لإضافة أنواع جديدة
- ✅ **فصل المنطق**: رفع الصور منفصل عن إنشاء السؤال
- ✅ **Bulk Add**: إضافة عدد كبير من الأسئلة بسرعة
- ✅ **Optional Media**: إضافة صور اختيارية لاحقاً
- ✅ **Type Safety**: استخدام Zod للتحقق من البيانات
- ✅ **Transaction Support**: استخدام Transactions لضمان سلامة البيانات
- ✅ **Permission Check**: التحقق من صلاحيات المدرس تلقائياً

---

## 📊 ملخص جميع APIs

| Method | Endpoint | الوصف | الصلاحيات |
|--------|----------|-------|-----------|
| `POST` | `/api/question-bank-v2/bulk-text` | إضافة أسئلة نصية جماعية | Teacher, Admin |
| `POST` | `/api/question-bank-v2/lesson/:lessonId/questions/image-only-bulk` | إضافة أسئلة صورة فقط (حتى 20 صورة، اختيارات a,b,c,d) | Teacher, Admin |
| `POST` | `/api/question-bank-v2/image-choices` | إضافة سؤال باختيارات صور | Teacher, Admin |
| `POST` | `/api/question-bank-v2/:questionId/media` | إضافة/تحديث صورة السؤال | Teacher, Admin |
| `GET` | `/api/question-bank-v2/:questionId` | جلب سؤال معين | Teacher, Admin, Student |
| `GET` | `/api/question-bank-v2/lesson/:lessonId` | جلب أسئلة الدرس | Teacher, Admin, Student |
| `PUT` | `/api/question-bank-v2/:questionId/status` | تحديث حالة السؤال | Admin |
| `PATCH` | `/api/question-bank-v2/:questionId/correct-answer` | تحديد الإجابة الصحيحة لسؤال | Admin |
| `DELETE` | `/api/question-bank-v2/:questionId` | حذف سؤال | Teacher, Admin |

---

## 🔍 أمثلة كاملة (JavaScript/TypeScript)

### مثال 1: إضافة أسئلة نصية جماعية

```typescript
const addBulkQuestions = async (lessonId: number, token: string) => {
  const response = await fetch('http://localhost:8000/api/question-bank-v2/bulk-text', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      lesson_id: lessonId,
      questions: [
        {
          question_text: 'ما هي عاصمة مصر؟',
          options: [
            { option_index: 0, option_type: 'text', text_content: 'القاهرة' },
            { option_index: 1, option_type: 'text', text_content: 'الإسكندرية' },
            { option_index: 2, option_type: 'text', text_content: 'الجيزة' },
            { option_index: 3, option_type: 'text', text_content: 'أسوان' }
          ],
          correct_answer_index: 0,
          explanation: 'القاهرة هي عاصمة مصر',
          difficulty_level: 'easy',
          points: 1
        },
        {
          question_text: 'ما هي أكبر قارة في العالم؟',
          options: [
            { option_index: 0, option_type: 'text', text_content: 'أفريقيا' },
            { option_index: 1, option_type: 'text', text_content: 'آسيا' },
            { option_index: 2, option_type: 'text', text_content: 'أوروبا' },
            { option_index: 3, option_type: 'text', text_content: 'أمريكا الشمالية' }
          ],
          correct_answer_index: 1,
          difficulty_level: 'medium',
          points: 2
        }
      ]
    })
  });

  const data = await response.json();
  console.log('تم إضافة', data.data.length, 'سؤال');
  return data;
};
```

### مثال 2: إضافة سؤال باختيارات صور

```typescript
const addImageChoicesQuestion = async (
  lessonId: number,
  questionText: string,
  correctIndex: number,
  optionFiles: File[],
  token: string
) => {
  const formData = new FormData();
  formData.append('question_text', questionText);
  formData.append('lesson_id', lessonId.toString());
  formData.append('correct_answer_index', correctIndex.toString());
  formData.append('difficulty_level', 'medium');
  formData.append('points', '2');

  // إضافة الملفات
  for (let i = 0; i < 4; i++) {
    formData.append(`option_${i}`, optionFiles[i]);
  }

  const response = await fetch('http://localhost:8000/api/question-bank-v2/image-choices', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();
  return data;
};
```

### مثال 3: إضافة صورة لسؤال موجود

```typescript
const addQuestionImage = async (questionId: number, imageFile: File, token: string) => {
  const formData = new FormData();
  formData.append('media', imageFile);
  formData.append('media_type', 'image');

  const response = await fetch(`http://localhost:8000/api/question-bank-v2/${questionId}/media`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });

  const data = await response.json();
  return data;
};
```

### مثال 4: جلب أسئلة الدرس

```typescript
const getLessonQuestions = async (
  lessonId: number,
  status?: string,
  limit: number = 50,
  offset: number = 0,
  token: string
) => {
  const params = new URLSearchParams({
    limit: limit.toString(),
    offset: offset.toString()
  });
  
  if (status) {
    params.append('status', status);
  }

  const response = await fetch(
    `http://localhost:8000/api/question-bank-v2/lesson/${lessonId}?${params}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    }
  );

  const data = await response.json();
  return data.data; // { questions: [], total: number }
};
```

### مثال 5: تحديث حالة السؤال (Admin)

```typescript
const approveQuestion = async (questionId: number, token: string) => {
  const response = await fetch(`http://localhost:8000/api/question-bank-v2/${questionId}/status`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'approved'
    })
  });

  const data = await response.json();
  return data;
};

const rejectQuestion = async (questionId: number, reason: string, token: string) => {
  const response = await fetch(`http://localhost:8000/api/question-bank-v2/${questionId}/status`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      status: 'rejected',
      rejection_reason: reason
    })
  });

  const data = await response.json();
  return data;
};
```

---

## 🎨 أمثلة React/TypeScript Components

### Component لإضافة أسئلة نصية جماعية

```typescript
import { useState } from 'react';

function BulkAddQuestions({ lessonId, token }: { lessonId: number; token: string }) {
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const addQuestion = () => {
    setQuestions([...questions, {
      question_text: '',
      options: [
        { option_index: 0, option_type: 'text', text_content: '' },
        { option_index: 1, option_type: 'text', text_content: '' },
        { option_index: 2, option_type: 'text', text_content: '' },
        { option_index: 3, option_type: 'text', text_content: '' }
      ],
      correct_answer_index: 0,
      difficulty_level: 'medium',
      points: 1
    }]);
  };

  const submitQuestions = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:8000/api/question-bank-v2/bulk-text', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          lesson_id: lessonId,
          questions
        })
      });

      const data = await response.json();
      if (data.success) {
        alert(`تم إضافة ${data.data.length} سؤال بنجاح`);
        setQuestions([]);
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={addQuestion}>إضافة سؤال</button>
      {questions.map((q, idx) => (
        <div key={idx}>
          <input
            value={q.question_text}
            onChange={(e) => {
              const newQuestions = [...questions];
              newQuestions[idx].question_text = e.target.value;
              setQuestions(newQuestions);
            }}
            placeholder="نص السؤال"
          />
          {/* ... باقي الحقول */}
        </div>
      ))}
      <button onClick={submitQuestions} disabled={loading}>
        {loading ? 'جاري الإضافة...' : 'إرسال الأسئلة'}
      </button>
    </div>
  );
}
```

---

## 🔄 سير العمل (Workflow)

### للمدرس:
1. إضافة أسئلة نصية جماعية → `POST /bulk-text` (يحتاج صلاحيات للمادة)
2. إضافة سؤال بصور → `POST /image-choices` (يحتاج صلاحيات للمادة)
3. إضافة صورة لسؤال موجود → `POST /:questionId/media` (لأسئلته فقط)
4. جلب أسئلتي → `GET /lesson/:lessonId?status=pending`
5. حذف سؤال → `DELETE /:questionId` (أسئلته فقط)

### للأدمن:
1. إضافة أسئلة نصية جماعية → `POST /bulk-text` (صلاحيات كاملة)
2. إضافة سؤال بصور → `POST /image-choices` (صلاحيات كاملة)
3. إضافة صورة لأي سؤال → `POST /:questionId/media` (لأي سؤال)
4. جلب جميع الأسئلة → `GET /lesson/:lessonId`
5. الموافقة/رفض سؤال → `PUT /:questionId/status`
6. حذف أي سؤال → `DELETE /:questionId` (لأي سؤال)

### للأدمن:
1. جلب الأسئلة المعلقة → `GET /lesson/:lessonId?status=pending`
2. الموافقة على سؤال → `PUT /:questionId/status` (status: "approved")
3. رفض سؤال → `PUT /:questionId/status` (status: "rejected")
4. تحديد الإجابة الصحيحة لسؤال → `PATCH /:questionId/correct-answer` (correct_answer_index: 0–3)

---

## ⚠️ قواعد التحقق (Validation Rules)

### Bulk Text Questions:
- `lesson_id`: مطلوب، يجب أن يكون رقم صحيح موجب
- `questions`: مطلوب، مصفوفة تحتوي على سؤال واحد على الأقل
- كل سؤال يجب أن يحتوي على:
  - `question_text`: نص غير فارغ
  - `options`: 4 خيارات بالضبط، جميعها نصية
  - `correct_answer_index`: رقم بين 0 و 3
  - `difficulty_level`: `easy`, `medium`, أو `hard`
  - `points`: رقم صحيح موجب

### Image Choices Question:
- `question_text`: مطلوب
- `lesson_id`: مطلوب
- `option_0` إلى `option_3`: 4 ملفات صور مطلوبة
- `correct_answer_index`: رقم بين 0 و 3

### Question Media:
- `media`: ملف مطلوب
- `media_type`: `image`, `diagram`, أو `chart` (افتراضي: `image`)

---

## 🚀 Best Practices

1. **استخدم Bulk Add للأسئلة النصية**: أسرع بكثير من إضافة كل سؤال على حدة
2. **تحقق من الصلاحيات**: تأكد من أن المدرس لديه صلاحيات للمادة قبل الإضافة
3. **استخدم Transactions**: النظام يستخدم Transactions تلقائياً لضمان سلامة البيانات
4. **تحقق من الملفات**: تأكد من رفع 4 صور بالضبط للأسئلة بصور
5. **حجم الملفات**: الحد الأقصى 10MB لكل ملف
6. **Error Handling**: تعامل مع الأخطاء بشكل صحيح في Frontend

---

## 📚 المراجع

- **Migration File**: `migrations/1700000001000_create_unified_question_bank_system.sql`
- **Service**: `src/services/questionBankV2.ts`
- **Controller**: `src/controllers/questionBankV2.ts`
- **Types**: `src/db/types/questionBankV2.ts`

