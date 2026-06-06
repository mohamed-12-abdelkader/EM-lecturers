# API أسئلة الواجبات

## نظرة عامة

نظام APIs كامل لإدارة أسئلة الواجبات في دروس المواد الموجودة في الباقات. يدعم نوعين من الأسئلة:
- **أسئلة نصية**: سؤال نصي مع 4 خيارات (أ، ب، ج، د)
- **أسئلة بصورة**: سؤال بصورة واحدة أو أكثر (حتى 10 صور) مع 4 خيارات (أ، ب، ج، د)

## البنية الهرمية

```
Package (باقة)
  └── Subject (مادة)
      └── Lesson (درس)
          └── Assignment (واجب)
              └── Question (سؤال)
                  ├── Text Question (سؤال نصي)
                  └── Image Question (سؤال بصورة)
                      └── Images (حتى 10 صور)
```

## نظام الصلاحيات

| الدور | الصلاحيات |
|-------|-----------|
| **Admin** | صلاحية كاملة على جميع العمليات (إنشاء، تعديل، حذف، قراءة) |
| **Teacher** | يمكنه إنشاء/تعديل/حذف فقط إذا كان لديه صلاحية على المادة |
| **Student** | صلاحية قراءة فقط - يمكنه الجلب فقط إذا كان مشترك في الباقة |

---

## الجداول في قاعدة البيانات

```sql
-- جدول أسئلة الواجبات
CREATE TABLE assignment_questions (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER NOT NULL REFERENCES package_subject_item_lesson_assignments(id) ON DELETE CASCADE,
    question_type TEXT NOT NULL CHECK (question_type IN ('text', 'image')),
    question_text TEXT, -- nullable if question_type is 'image'
    correct_answer TEXT NOT NULL CHECK (correct_answer IN ('a', 'b', 'c', 'd')),
    option_a TEXT NOT NULL,
    option_b TEXT NOT NULL,
    option_c TEXT NOT NULL,
    option_d TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول صور أسئلة الواجبات (للدعم حتى 10 صور لكل سؤال)
CREATE TABLE assignment_question_images (
    id SERIAL PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES assignment_questions(id) ON DELETE CASCADE,
    image_url TEXT NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Base URL

جميع المسارات تبدأ بـ:
```
/api
```

---

## Authentication

جميع الـ endpoints تتطلب مصادقة باستخدام Bearer token في header:
```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. إضافة سؤال نصي

**Endpoint**: `POST /api/assignments/:assignmentId/questions/text`

**الوصف**: إضافة سؤال نصي جديد لواجب معين

**الصلاحيات**: `admin`, `teacher` (مع صلاحية على المادة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "question_text": "ما هي عاصمة مصر؟",
  "option_a": "القاهرة",
  "option_b": "الإسكندرية",
  "option_c": "الجيزة",
  "option_d": "أسوان",
  "correct_answer": "a",
  "order_index": 0
}
```

**Body Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `question_text` | string | ✅ | نص السؤال |
| `option_a` | string | ✅ | الخيار أ |
| `option_b` | string | ✅ | الخيار ب |
| `option_c` | string | ✅ | الخيار ج |
| `option_d` | string | ✅ | الخيار د |
| `correct_answer` | string | ✅ | الإجابة الصحيحة (`a`, `b`, `c`, أو `d`) |
| `order_index` | number | ❌ | ترتيب السؤال (افتراضي: 0) |

**مثال للطلب**:
```bash
curl -X POST http://localhost:8000/api/assignments/1/questions/text \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "question_text": "ما هي عاصمة مصر؟",
    "option_a": "القاهرة",
    "option_b": "الإسكندرية",
    "option_c": "الجيزة",
    "option_d": "أسوان",
    "correct_answer": "a",
    "order_index": 0
  }'
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم إضافة السؤال النصي بنجاح",
  "question": {
    "id": 1,
    "assignment_id": 1,
    "question_type": "text",
    "question_text": "ما هي عاصمة مصر؟",
    "option_a": "القاهرة",
    "option_b": "الإسكندرية",
    "option_c": "الجيزة",
    "option_d": "أسوان",
    "correct_answer": "a",
    "order_index": 0,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:30:00.000Z",
    "images": []
  }
}
```

**أخطاء محتملة**:

- **400 Bad Request** - بيانات غير صحيحة:
```json
{
  "error": "Validation failed",
  "errors": [
    {
      "path": ["question_text"],
      "message": "نص السؤال مطلوب"
    }
  ]
}
```

- **403 Forbidden** - لا توجد صلاحية:
```json
{
  "error": "Forbidden",
  "message": "ليس لديك صلاحية لإضافة أسئلة لهذا الواجب"
}
```

- **404 Not Found** - الواجب غير موجود:
```json
{
  "error": "الواجب غير موجود"
}
```

---

### 2. إضافة سؤال بصورة

**Endpoint**: `POST /api/assignments/:assignmentId/questions/image`

**الوصف**: إضافة سؤال بصورة واحدة أو أكثر (حتى 10 صور) لواجب معين

**الصلاحيات**: `admin`, `teacher` (مع صلاحية على المادة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body (Form Data)**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `images` | file[] | ✅ | الصور (حتى 10 صور) |
| `order_index` | number | ❌ | ترتيب السؤال (افتراضي: 0) |

**ملاحظات مهمة**:
- **الخيارات ثابتة**: الخيارات ستكون دائماً: أ، ب، ج، د (لا حاجة لإرسالها)
- **الإجابة الصحيحة**: سيتم تعيينها افتراضياً كـ `a`، ويمكن تحديثها لاحقاً عبر API تحديث الإجابة الصحيحة
- الحد الأقصى للصور هو 10 صور
- يجب رفع صورة واحدة على الأقل
- الصور يتم رفعها تلقائياً إلى Cloudinary
- أنواع الصور المدعومة: JPEG, JPG, PNG, GIF, WebP
- الحد الأقصى لحجم كل صورة: 5MB

**مثال للطلب**:
```bash
curl -X POST http://localhost:8000/api/assignments/1/questions/image \
  -H "Authorization: Bearer <token>" \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg" \
  -F "order_index=0"
```

**ملاحظة**: لا حاجة لإرسال الخيارات (`option_a`, `option_b`, إلخ) أو `correct_answer` - الخيارات ثابتة (أ، ب، ج، د) والإجابة الصحيحة يتم تحديثها لاحقاً.

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم إضافة السؤال بالصورة بنجاح",
  "question": {
    "id": 2,
    "assignment_id": 1,
    "question_type": "image",
    "question_text": null,
    "option_a": "أ",
    "option_b": "ب",
    "option_c": "ج",
    "option_d": "د",
    "correct_answer": "a",
    "order_index": 0,
    "created_at": "2024-01-15T10:35:00.000Z",
    "updated_at": "2024-01-15T10:35:00.000Z",
    "images": [
      {
        "id": 1,
        "image_url": "https://res.cloudinary.com/.../image1.jpg",
        "order_index": 0
      },
      {
        "id": 2,
        "image_url": "https://res.cloudinary.com/.../image2.jpg",
        "order_index": 1
      }
    ]
  }
}
```

**أخطاء محتملة**:

- **400 Bad Request** - لا توجد صور:
```json
{
  "error": "يجب رفع صورة واحدة على الأقل"
}
```

- **400 Bad Request** - عدد الصور أكثر من 10:
```json
{
  "error": "الحد الأقصى للصور هو 10 صور"
}
```

- **500 Internal Server Error** - فشل رفع الصور:
```json
{
  "error": "فشل في رفع بعض الصور",
  "errors": ["image1.jpg", "image2.jpg"]
}
```

---

### 3. تحديث الإجابة الصحيحة

**Endpoint**: `PATCH /api/questions/:questionId/correct-answer`

**الوصف**: تحديث الإجابة الصحيحة لسؤال معين فقط

**الصلاحيات**: `admin`, `teacher` (مع صلاحية على المادة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `questionId` | number | ✅ | معرف السؤال |

**Headers**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "correct_answer": "b"
}
```

**Body Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `correct_answer` | string | ✅ | الإجابة الصحيحة (`a`, `b`, `c`, أو `d`) |

**مثال للطلب**:
```bash
curl -X PATCH http://localhost:8000/api/questions/1/correct-answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correct_answer": "b"
  }'
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم تحديث الإجابة الصحيحة بنجاح",
  "question": {
    "id": 1,
    "assignment_id": 1,
    "question_type": "text",
    "question_text": "ما هي عاصمة مصر؟",
    "option_a": "القاهرة",
    "option_b": "الإسكندرية",
    "option_c": "الجيزة",
    "option_d": "أسوان",
    "correct_answer": "b",
    "order_index": 0,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:35:00.000Z",
    "images": []
  }
}
```

**أخطاء محتملة**:

- **404 Not Found** - السؤال غير موجود:
```json
{
  "error": "السؤال غير موجود"
}
```

---

### 4. تحديث سؤال

**Endpoint**: `PUT /api/questions/:questionId`

**الوصف**: تحديث سؤال كامل (يمكن تحديث أي حقل)

**الصلاحيات**: `admin`, `teacher` (مع صلاحية على المادة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `questionId` | number | ✅ | معرف السؤال |

**Headers**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body** (جميع الحقول اختيارية):
```json
{
  "question_text": "ما هي عاصمة مصر؟ (محدث)",
  "option_a": "القاهرة",
  "option_b": "الإسكندرية",
  "option_c": "الجيزة",
  "option_d": "أسوان",
  "correct_answer": "a",
  "order_index": 1,
  "image_urls": [
    "https://res.cloudinary.com/.../new-image1.jpg",
    "https://res.cloudinary.com/.../new-image2.jpg"
  ]
}
```

**Body Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `question_text` | string | ❌ | نص السؤال (للسؤال النصي فقط) |
| `option_a` | string | ❌ | الخيار أ |
| `option_b` | string | ❌ | الخيار ب |
| `option_c` | string | ❌ | الخيار ج |
| `option_d` | string | ❌ | الخيار د |
| `correct_answer` | string | ❌ | الإجابة الصحيحة (`a`, `b`, `c`, أو `d`) |
| `order_index` | number | ❌ | ترتيب السؤال |
| `image_urls` | string[] | ❌ | روابط الصور (للسؤال بالصورة فقط، حتى 10 صور) |

**ملاحظات**:
- يمكن تحديث أي حقل أو أكثر
- للأسئلة بالصورة: يمكن تحديث `image_urls` لاستبدال جميع الصور
- عند تحديث `image_urls`، سيتم حذف الصور القديمة واستبدالها بالجديدة

**مثال للطلب**:
```bash
curl -X PUT http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "question_text": "ما هي عاصمة مصر؟ (محدث)",
    "correct_answer": "a",
    "order_index": 1
  }'
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم تحديث السؤال بنجاح",
  "question": {
    "id": 1,
    "assignment_id": 1,
    "question_type": "text",
    "question_text": "ما هي عاصمة مصر؟ (محدث)",
    "option_a": "القاهرة",
    "option_b": "الإسكندرية",
    "option_c": "الجيزة",
    "option_d": "أسوان",
    "correct_answer": "a",
    "order_index": 1,
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-15T10:40:00.000Z",
    "images": []
  }
}
```

**أخطاء محتملة**:

- **400 Bad Request** - عدد الصور أكثر من 10:
```json
{
  "error": "الحد الأقصى للصور هو 10 صور"
}
```

---

### 5. حذف سؤال

**Endpoint**: `DELETE /api/questions/:questionId`

**الوصف**: حذف سؤال معين

**الصلاحيات**: `admin`, `teacher` (مع صلاحية على المادة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `questionId` | number | ✅ | معرف السؤال |

**Headers**:
```
Authorization: Bearer <token>
```

**مثال للطلب**:
```bash
curl -X DELETE http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK)**:
```json
{
  "success": true,
  "message": "تم حذف السؤال بنجاح"
}
```

**أخطاء محتملة**:

- **404 Not Found** - السؤال غير موجود:
```json
{
  "error": "السؤال غير موجود"
}
```

- **403 Forbidden** - لا توجد صلاحية:
```json
{
  "error": "Forbidden",
  "message": "ليس لديك صلاحية لحذف هذا السؤال"
}
```

---

### 6. عرض أسئلة واجب معين

**Endpoint**: `GET /api/assignments/:assignmentId/questions`

**الوصف**: جلب جميع أسئلة واجب معين

**الصلاحيات**: 
- `admin` - يمكنه رؤية جميع الأسئلة
- `teacher` - يمكنه رؤية الأسئلة إذا كان لديه صلاحية على المادة
- `student` - يمكنه رؤية الأسئلة فقط إذا كان مشترك في الباقة

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
```

**مثال للطلب**:
```bash
curl -X GET http://localhost:8000/api/assignments/1/questions \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK)**:
```json
{
  "success": true,
  "assignment_id": 1,
  "questions": [
    {
      "id": 1,
      "assignment_id": 1,
      "question_type": "text",
      "question_text": "ما هي عاصمة مصر؟",
      "option_a": "القاهرة",
      "option_b": "الإسكندرية",
      "option_c": "الجيزة",
      "option_d": "أسوان",
      "correct_answer": "a",
      "order_index": 0,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "images": []
    },
    {
      "id": 2,
      "assignment_id": 1,
      "question_type": "image",
      "question_text": null,
      "option_a": "الخيار الأول",
      "option_b": "الخيار الثاني",
      "option_c": "الخيار الثالث",
      "option_d": "الخيار الرابع",
      "correct_answer": "a",
      "order_index": 1,
      "created_at": "2024-01-15T10:35:00.000Z",
      "updated_at": "2024-01-15T10:35:00.000Z",
      "images": [
        {
          "id": 1,
          "image_url": "https://res.cloudinary.com/.../image1.jpg",
          "order_index": 0
        },
        {
          "id": 2,
          "image_url": "https://res.cloudinary.com/.../image2.jpg",
          "order_index": 1
        }
      ]
    }
  ],
  "total": 2
}
```

**ملاحظات**:
- الأسئلة مرتبة حسب `order_index` ثم `created_at`
- للأسئلة بالصورة: يتم إرجاع جميع الصور مرتبة حسب `order_index`
- للطلاب: يجب أن يكونوا مشتركين في الباقة للوصول إلى الأسئلة

**أخطاء محتملة**:

- **404 Not Found** - الواجب غير موجود:
```json
{
  "error": "الواجب غير موجود"
}
```

- **403 Forbidden** - للطالب غير المشترك:
```json
{
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب"
}
```

---

## أمثلة استخدام متكاملة

### سيناريو 1: إنشاء واجب كامل

```bash
# 1. إضافة سؤال نصي
curl -X POST http://localhost:8000/api/assignments/1/questions/text \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "question_text": "ما هي عاصمة مصر؟",
    "option_a": "القاهرة",
    "option_b": "الإسكندرية",
    "option_c": "الجيزة",
    "option_d": "أسوان",
    "correct_answer": "a",
    "order_index": 0
  }'

# 2. إضافة سؤال بصورة (فقط الصور - الخيارات ثابتة)
curl -X POST http://localhost:8000/api/assignments/1/questions/image \
  -H "Authorization: Bearer <admin_token>" \
  -F "images=@/path/to/question-image.jpg" \
  -F "order_index=1"

# 3. تحديد الإجابة الصحيحة (اختياري - يمكن تحديده لاحقاً)
curl -X PATCH http://localhost:8000/api/questions/2/correct-answer \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correct_answer": "b"
  }'

# 3. عرض جميع الأسئلة
curl -X GET http://localhost:8000/api/assignments/1/questions \
  -H "Authorization: Bearer <admin_token>"
```

### سيناريو 2: إضافة سؤال بصورة وتحديد الإجابة الصحيحة

```bash
# 1. إضافة سؤال بصورة (فقط الصور)
curl -X POST http://localhost:8000/api/assignments/1/questions/image \
  -H "Authorization: Bearer <admin_token>" \
  -F "images=@/path/to/question-image.jpg" \
  -F "order_index=1"

# 2. تحديث الإجابة الصحيحة (بعد إضافة السؤال)
curl -X PATCH http://localhost:8000/api/questions/2/correct-answer \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correct_answer": "b"
  }'
```

### سيناريو 3: تحديث سؤال بالصورة

```bash
# تحديث الصور والخيارات
curl -X PUT http://localhost:8000/api/questions/2 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "option_a": "خيار أ محدث",
    "option_b": "خيار ب محدث",
    "option_c": "خيار ج محدث",
    "option_d": "خيار د محدث",
    "correct_answer": "c",
    "image_urls": [
      "https://res.cloudinary.com/.../new-image1.jpg",
      "https://res.cloudinary.com/.../new-image2.jpg"
    ]
  }'
```

---

## ملاحظات مهمة

1. **الصلاحيات**:
   - الأدمن لديه صلاحية كاملة على جميع الواجبات
   - المدرس يحتاج صلاحية على المادة لإدارة أسئلة الواجبات
   - الطالب يحتاج تفعيل الباقة لعرض الأسئلة

2. **الأسئلة بالصورة**:
   - **الخيارات ثابتة**: عند إضافة سؤال بصورة، الخيارات ستكون دائماً: أ، ب، ج، د (لا حاجة لإرسالها)
   - **الإجابة الصحيحة**: يتم تعيينها افتراضياً كـ `a` عند الإنشاء، ويمكن تحديثها لاحقاً عبر API تحديث الإجابة الصحيحة
   - الحد الأقصى للصور هو 10 صور لكل سؤال
   - الصور يتم رفعها تلقائياً إلى Cloudinary
   - عند تحديث الصور، يتم استبدال جميع الصور القديمة بالجديدة
   - **سير العمل الموصى به**: إضافة السؤال بالصور → تحديد الإجابة الصحيحة عبر API تحديث الإجابة الصحيحة

3. **ترتيب الأسئلة**:
   - يتم ترتيب الأسئلة حسب `order_index` ثم `created_at`
   - يمكن تحديث `order_index` عند الإنشاء أو التعديل

4. **الإجابة الصحيحة**:
   - يجب أن تكون `a`, `b`, `c`, أو `d` فقط
   - يمكن تحديثها منفصلة باستخدام endpoint تحديث الإجابة الصحيحة

5. **حذف الأسئلة**:
   - عند حذف سؤال، يتم حذف جميع الصور المرتبطة به تلقائياً
   - العملية لا يمكن التراجع عنها

---

## كود الحالة (Status Codes)

| الكود | الوصف |
|-------|-------|
| `200` | نجح الطلب |
| `201` | تم الإنشاء بنجاح |
| `400` | بيانات غير صحيحة |
| `401` | غير مصرح (مفقود أو غير صحيح token) |
| `403` | ممنوع (لا توجد صلاحية) |
| `404` | غير موجود |
| `500` | خطأ في السيرفر |

---

## APIs للطلاب

### 1. عرض أسئلة الواجب (للطالب)

**Endpoint**: `GET /api/assignments/:assignmentId/questions`

**الوصف**: جلب جميع أسئلة واجب معين للطالب (بدون الإجابات الصحيحة)

**الصلاحيات**: `student` (يجب أن يكون مشترك في الباقة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
```

**مثال للطلب**:
```bash
curl -X GET http://localhost:8000/api/assignments/3/questions \
  -H "Authorization: Bearer <student_token>"
```

**Response (200 OK)**:
```json
{
  "success": true,
  "assignment_id": 3,
  "questions": [
    {
      "id": 1,
      "assignment_id": 3,
      "question_type": "text",
      "question_text": "ما هي عاصمة مصر؟",
      "option_a": "القاهرة",
      "option_b": "الإسكندرية",
      "option_c": "الجيزة",
      "option_d": "أسوان",
      "order_index": 0,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z",
      "images": []
    },
    {
      "id": 2,
      "assignment_id": 3,
      "question_type": "image",
      "question_text": null,
      "option_a": "أ",
      "option_b": "ب",
      "option_c": "ج",
      "option_d": "د",
      "order_index": 1,
      "created_at": "2024-01-15T10:35:00.000Z",
      "updated_at": "2024-01-15T10:35:00.000Z",
      "images": [
        {
          "id": 1,
          "image_url": "https://res.cloudinary.com/.../image1.jpg",
          "order_index": 0
        },
        {
          "id": 2,
          "image_url": "https://res.cloudinary.com/.../image2.jpg",
          "order_index": 1
        }
      ]
    }
  ],
  "total": 2,
  "has_submitted": false
}
```

**ملاحظات مهمة**:
- **لا يتم إرجاع الإجابات الصحيحة** (`correct_answer`) في هذا الـ endpoint للطلاب
- `has_submitted`: يشير إلى ما إذا كان الطالب قد سلم الواجب من قبل
- يجب أن يكون الطالب مشترك في الباقة للوصول إلى الأسئلة
- الأسئلة مرتبة حسب `order_index` ثم `created_at`

**أخطاء محتملة**:

- **403 Forbidden** - الطالب غير مشترك في الباقة:
```json
{
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً للوصول إلى أسئلة الواجب"
}
```

- **404 Not Found** - الواجب غير موجود:
```json
{
  "error": "الواجب غير موجود"
}
```

---

### 2. تسليم الواجب

**Endpoint**: `POST /api/assignments/:assignmentId/submit`

**الوصف**: تسليم إجابات الطالب على الواجب وحساب النتيجة تلقائياً

**الصلاحيات**: `student` (يجب أن يكون مشترك في الباقة)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "answers": [
    {
      "question_id": 1,
      "student_answer": "a"
    },
    {
      "question_id": 2,
      "student_answer": "b"
    },
    {
      "question_id": 3,
      "student_answer": "c"
    }
  ]
}
```

**Body Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `answers` | array | ✅ | مصفوفة من إجابات الطالب |
| `answers[].question_id` | number | ✅ | معرف السؤال |
| `answers[].student_answer` | string | ✅ | إجابة الطالب (`a`, `b`, `c`, أو `d`) |

**ملاحظات مهمة**:
- يجب الإجابة على **جميع الأسئلة** في الواجب
- لا يمكن تسليم الواجب أكثر من مرة واحدة
- يتم حساب النتيجة تلقائياً بعد التسليم
- النتيجة تُحسب كنسبة مئوية (score)

**مثال للطلب**:
```bash
curl -X POST http://localhost:8000/api/assignments/3/submit \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [
      {
        "question_id": 1,
        "student_answer": "a"
      },
      {
        "question_id": 2,
        "student_answer": "b"
      }
    ]
  }'
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم تسليم الواجب بنجاح",
  "submission": {
    "id": 1,
    "assignment_id": 3,
    "total_questions": 2,
    "correct_answers": 1,
    "wrong_answers": 1,
    "score": "50.00",
    "submitted_at": "2024-01-15T11:00:00.000Z"
  }
}
```

**أخطاء محتملة**:

- **400 Bad Request** - بيانات غير صحيحة:
```json
{
  "error": "Validation failed",
  "errors": [
    {
      "path": ["answers", 0, "student_answer"],
      "message": "الإجابة يجب أن تكون a, b, c, أو d"
    }
  ]
}
```

- **400 Bad Request** - عدد الإجابات لا يساوي عدد الأسئلة:
```json
{
  "error": "يجب الإجابة على جميع الأسئلة (2 سؤال)"
}
```

- **400 Bad Request** - تم التسليم من قبل:
```json
{
  "error": "لقد قمت بتسليم هذا الواجب من قبل"
}
```

- **403 Forbidden** - الطالب غير مشترك في الباقة:
```json
{
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً لتسليم الواجب"
}
```

---

### 3. عرض التصحيح والنتيجة

**Endpoint**: `GET /api/assignments/:assignmentId/submission`

**الوصف**: جلب تصحيح الواجب مع تفاصيل الأخطاء والإجابات الصحيحة

**الصلاحيات**: `student` (يجب أن يكون مشترك في الباقة ومسلم الواجب)

**Path Parameters**:
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `assignmentId` | number | ✅ | معرف الواجب |

**Headers**:
```
Authorization: Bearer <token>
```

**مثال للطلب**:
```bash
curl -X GET http://localhost:8000/api/assignments/3/submission \
  -H "Authorization: Bearer <student_token>"
```

**Response (200 OK)**:
```json
{
  "success": true,
  "submission": {
    "id": 1,
    "assignment_id": 3,
    "total_questions": 2,
    "correct_answers": 1,
    "wrong_answers": 1,
    "score": 50.00,
    "submitted_at": "2024-01-15T11:00:00.000Z",
    "answers": [
      {
        "question_id": 1,
        "question_type": "text",
        "question_text": "ما هي عاصمة مصر؟",
        "option_a": "القاهرة",
        "option_b": "الإسكندرية",
        "option_c": "الجيزة",
        "option_d": "أسوان",
        "images": [],
        "student_answer": "a",
        "correct_answer": "a",
        "is_correct": true
      },
      {
        "question_id": 2,
        "question_type": "image",
        "question_text": null,
        "option_a": "أ",
        "option_b": "ب",
        "option_c": "ج",
        "option_d": "د",
        "images": [
          {
            "id": 1,
            "image_url": "https://res.cloudinary.com/.../image1.jpg",
            "order_index": 0
          }
        ],
        "student_answer": "b",
        "correct_answer": "a",
        "is_correct": false,
        "error": {
          "message": "إجابة خاطئة",
          "your_answer": "b",
          "correct_answer": "a",
          "correct_option_text": "أ"
        }
      }
    ]
  }
}
```

**ملاحظات مهمة**:
- يعرض **جميع الإجابات** مع التصحيح
- لكل إجابة خاطئة، يتم إرجاع تفاصيل الخطأ:
  - `error.message`: رسالة الخطأ
  - `error.your_answer`: إجابة الطالب
  - `error.correct_answer`: الإجابة الصحيحة (a, b, c, أو d)
  - `error.correct_option_text`: نص الإجابة الصحيحة (أ، ب، ج، أو د)
- `score`: النسبة المئوية للنتيجة (0-100)
- `correct_answers`: عدد الإجابات الصحيحة
- `wrong_answers`: عدد الإجابات الخاطئة

**أخطاء محتملة**:

- **404 Not Found** - لم يتم تسليم الواجب:
```json
{
  "error": "لم تقم بتسليم هذا الواجب بعد"
}
```

- **403 Forbidden** - الطالب غير مشترك في الباقة:
```json
{
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً للوصول إلى التصحيح"
}
```

---

## أمثلة استخدام متكاملة للطلاب

### سيناريو كامل: حل الواجب وعرض التصحيح

```bash
# 1. عرض أسئلة الواجب (بدون الإجابات الصحيحة)
curl -X GET http://localhost:8000/api/assignments/3/questions \
  -H "Authorization: Bearer <student_token>"

# Response: يعرض الأسئلة مع has_submitted: false

# 2. تسليم الواجب
curl -X POST http://localhost:8000/api/assignments/3/submit \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "answers": [
      {
        "question_id": 1,
        "student_answer": "a"
      },
      {
        "question_id": 2,
        "student_answer": "b"
      }
    ]
  }'

# Response: يعرض النتيجة الإجمالية

# 3. عرض التصحيح الكامل مع الأخطاء
curl -X GET http://localhost:8000/api/assignments/3/submission \
  -H "Authorization: Bearer <student_token>"

# Response: يعرض جميع الإجابات مع التصحيح والأخطاء
```

---

## ملاحظات مهمة للطلاب

1. **الوصول إلى الواجبات**:
   - يجب أن يكون الطالب مشترك في الباقة (مفعل الباقة)
   - يمكن للطالب عرض الأسئلة فقط قبل التسليم
   - بعد التسليم، يمكن عرض التصحيح الكامل

2. **تسليم الواجب**:
   - يمكن تسليم الواجب **مرة واحدة فقط**
   - يجب الإجابة على **جميع الأسئلة**
   - يتم حساب النتيجة تلقائياً بعد التسليم

3. **عرض التصحيح**:
   - يعرض جميع الإجابات مع التصحيح
   - الإجابات الصحيحة: `is_correct: true`
   - الإجابات الخاطئة: `is_correct: false` مع تفاصيل الخطأ
   - النتيجة الإجمالية: `score` (نسبة مئوية)

4. **الأمان**:
   - لا يتم إرجاع الإجابات الصحيحة في endpoint عرض الأسئلة
   - الإجابات الصحيحة تظهر فقط في endpoint التصحيح بعد التسليم

---

## الدعم الفني

للمزيد من المعلومات أو المساعدة، يرجى التواصل مع فريق الدعم الفني.

