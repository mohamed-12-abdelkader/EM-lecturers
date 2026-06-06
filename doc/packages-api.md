# API الباقات الدراسية

## نظرة عامة
APIs لإدارة الباقات الدراسية في النظام. تسمح للأدمن بإنشاء وتعديل وحذف الباقات، وعرضها للجميع.

## الجداول في قاعدة البيانات
```sql
-- جدول الباقات
CREATE TABLE packages (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    image TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    grade_id INTEGER REFERENCES grades(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول المواد
CREATE TABLE subjects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- جدول ربط الباقات بالمواد
CREATE TABLE package_subjects (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(package_id, subject_id)
);
```

---

## 1. إنشاء باقة دراسية جديدة

### Endpoint
```
POST /api/packages
```

### الوصف
إنشاء باقة دراسية جديدة مع صورة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | string | ✅ | اسم الباقة (مطلوب) |
| `price` | number | ✅ | سعر الباقة (مطلوب) |
| `grade_id` | number | ✅ | معرف الصف الدراسي (مطلوب) |
| `image` | file | ❌ | صورة الباقة (JPG, PNG, etc.) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=باقة الرياضيات الشاملة" \
  -F "price=299.99" \
  -F "grade_id=1" \
  -F "image=@/path/to/image.jpg"
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء الباقة بنجاح",
  "package": {
    "id": 1,
    "name": "باقة الرياضيات الشاملة",
    "image": "/uploads/package-1234567890.jpg",
    "price": "299.99",
    "grade_id": 1,
    "grade_name": "الصف الأول الإعدادي",
    "subjects": [],
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 2. عرض الباقات الدراسية

### Endpoint
```
GET /api/packages
```

### الوصف
عرض الباقات الدراسية مع معلومات الصف الدراسي والمواد المرتبطة بها.

**السلوك حسب دور المستخدم:**
- **للأدمن:** يعرض كل الباقات التي أنشأها الأدمن (يمكن فلترة حسب `grade_id`)
- **للطالب:** يعرض فقط الباقات الخاصة بصفه الدراسي تلقائياً

### Headers
```
Authorization: Bearer <token>
```

### الصلاحيات
- `admin` - يمكنه رؤية كل الباقات التي أنشأها
- `student` - يرى فقط الباقات الخاصة بصفه الدراسي

### Query Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `limit` | number | ❌ | عدد النتائج (افتراضي: 20) |
| `offset` | number | ❌ | عدد النتائج للتخطي (افتراضي: 0) |
| `grade_id` | number | ❌ | فلترة حسب الصف الدراسي (للأدمن فقط) |

### مثال للطلب (للأدمن)
```bash
curl -X GET "http://localhost:8000/api/packages?limit=10&grade_id=1" \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للطلب (للطالب)
```bash
curl -X GET "http://localhost:8000/api/packages?limit=10" \
  -H "Authorization: Bearer <student_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "packages": [
    {
      "id": 1,
      "name": "باقة الرياضيات الشاملة",
      "image": "https://res.cloudinary.com/.../package-1234567890.jpg",
      "price": "299.99",
      "grade_id": 1,
      "grade_name": "الصف الأول الإعدادي",
      "created_by": 5,
      "created_by_name": "اسم الأدمن",
      "subjects": [
        {
          "id": 1,
          "name": "الرياضيات",
          "description": "مادة الرياضيات والجبر والهندسة"
        },
        {
          "id": 2,
          "name": "الفيزياء",
          "description": "مادة الفيزياء والميكانيكا"
        }
      ],
      "created_at": "2024-01-01T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

### أخطاء محتملة

#### 400 Bad Request - للطالب بدون صف دراسي
```json
{
  "error": "لم يتم تعيين صف دراسي لك",
  "message": "يجب أن يكون لديك صف دراسي لعرض الباقات"
}
```

#### 401 Unauthorized
```json
{
  "message": "Unauthorized"
}
```

#### 500 Internal Server Error
```json
{
  "error": "خطأ في جلب الباقات"
}
```

### ملاحظات
- للطالب: يتم جلب صف الطالب تلقائياً من جدول `user_grades`
- للأدمن: يمكن استخدام `grade_id` كفلترة اختيارية لعرض باقات صف معين
- جميع الباقات المعروضة يجب أن تكون قد أنشأها الأدمن (`created_by IS NOT NULL`)
- يتم عرض المواد المرتبطة بكل باقة تلقائياً

---

## 3. عرض باقة محددة

### Endpoint
```
GET /api/packages/:id
```

### الوصف
عرض باقة دراسية محددة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/packages/1
```

### مثال للاستجابة (200 OK)
```json
{
  "package": {
    "id": 1,
    "name": "باقة الرياضيات الشاملة",
    "image": "/uploads/package-1234567890.jpg",
    "price": "299.99",
    "grade_id": 1,
    "grade_name": "الصف الأول الإعدادي",
    "subjects": [
      {
        "id": 1,
        "name": "الرياضيات",
        "description": "مادة الرياضيات والجبر والهندسة"
      },
      {
        "id": 2,
        "name": "الفيزياء",
        "description": "مادة الفيزياء والميكانيكا"
      }
    ],
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 4. تحديث باقة دراسية

### Endpoint
```
PUT /api/packages/:id
```

### الوصف
تحديث باقة دراسية (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | string | ❌ | اسم الباقة |
| `price` | number | ❌ | سعر الباقة |
| `grade_id` | number | ❌ | معرف الصف الدراسي |
| `image` | file | ❌ | صورة الباقة |

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/packages/1 \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=باقة الرياضيات المحدثة" \
  -F "price=399.99"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تحديث الباقة بنجاح",
  "package": {
    "id": 1,
    "name": "باقة الرياضيات المحدثة",
    "image": "/uploads/package-1234567890.jpg",
    "price": "399.99",
    "grade_id": 1,
    "grade_name": "الصف الأول الإعدادي",
    "subjects": [
      {
        "id": 1,
        "name": "الرياضيات",
        "description": "مادة الرياضيات والجبر والهندسة"
      }
    ],
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 5. حذف باقة دراسية

### Endpoint
```
DELETE /api/packages/:id
```

### الوصف
حذف باقة دراسية (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
```

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/packages/1 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم حذف الباقة بنجاح"
}
```

---

## 6. إدارة المواد العامة في الباقات

**ملاحظة مهمة**: هذه المواد العامة التي يمكن ربطها بأي باقة. لإنشاء مواد مخصصة لكل باقة مع صور، استخدم [API مواد الباقات](/doc/package-subjects-api.md).

### ربط مواد بباقة
```bash
curl -X POST http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [1, 2, 3]
  }'
```

### جلب مواد باقة محددة
```bash
curl -X GET http://localhost:8000/api/subjects/package/1
```

### تحديث مواد الباقة (استبدال كامل)
```bash
curl -X PUT http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [1, 4, 5]
  }'
```

### إزالة مواد من باقة
```bash
curl -X DELETE http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [2, 3]
  }'
```

### جلب جميع المواد المتاحة
```bash
curl -X GET http://localhost:8000/api/subjects
```

---

## المواد المتاحة

النظام يحتوي على المواد الدراسية التالية:

| ID | اسم المادة | الوصف |
|----|------------|-------|
| 1 | الرياضيات | مادة الرياضيات والجبر والهندسة |
| 2 | الفيزياء | مادة الفيزياء والميكانيكا |
| 3 | الكيمياء | مادة الكيمياء والتفاعلات الكيميائية |
| 4 | الأحياء | مادة الأحياء والعلوم الطبيعية |
| 5 | اللغة العربية | مادة اللغة العربية والنحو والأدب |
| 6 | اللغة الإنجليزية | مادة اللغة الإنجليزية |
| 7 | التاريخ | مادة التاريخ والجغرافيا |
| 8 | العلوم | مادة العلوم العامة |
| 9 | الكمبيوتر | مادة الحاسوب والبرمجة |
| 10 | الاقتصاد | مادة الاقتصاد والمحاسبة |

يمكن للأدمن إضافة مواد جديدة عبر `POST /api/subjects`

---

## 7. مواد الباقات المخصصة

لإنشاء مواد مخصصة لكل باقة مع صور، استخدم API منفصل:

### Endpoints المتاحة:
- `GET /api/package-subjects/package/:packageId` - جلب مواد الباقة
- `POST /api/package-subjects/package/:packageId` - إنشاء مادة جديدة
- `PUT /api/package-subjects/:id` - تحديث مادة
- `DELETE /api/package-subjects/:id` - حذف مادة

### مثال لإنشاء مادة مخصصة:
```bash
curl -X POST http://localhost:8000/api/package-subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=الرياضيات المتقدمة" \
  -F "image=@/path/to/image.jpg"
```

**راجع [وثائق مواد الباقات](/doc/package-subjects-api.md) للحصول على التفاصيل الكاملة.**

---

## أمثلة على الاستخدام

### إنشاء باقة جديدة
```javascript
const formData = new FormData();
formData.append('name', 'باقة الفيزياء المتقدمة');
formData.append('price', '199.99');
formData.append('grade_id', '2');
formData.append('image', fileInput.files[0]);

fetch('/api/packages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

### جلب الباقات حسب الصف الدراسي
```javascript
fetch('/api/packages?grade_id=1')
.then(response => response.json())
.then(data => {
  console.log('باقات الصف الأول الإعدادي:', data.packages);
});
```

### جلب جميع الباقات
```javascript
fetch('/api/packages')
.then(response => response.json())
.then(data => {
  console.log('جميع الباقات:', data.packages);
  // عرض المواد لكل باقة
  data.packages.forEach(pkg => {
    console.log(`الباقة: ${pkg.name}`);
    console.log(`المواد: ${pkg.subjects.map(s => s.name).join(', ')}`);
  });
});
```

### إنشاء باقة مع مواد
```javascript
// 1. إنشاء الباقة
const formData = new FormData();
formData.append('name', 'باقة العلوم الشاملة');
formData.append('price', '399.99');
formData.append('grade_id', '1');
formData.append('image', fileInput.files[0]);

fetch('/api/packages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: formData
})
.then(response => response.json())
.then(async (data) => {
  const packageId = data.package.id;
  
  // 2. ربط المواد بالباقة
  const subjectsResponse = await fetch(`/api/subjects/package/${packageId}`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + adminToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      subject_ids: [1, 2, 3, 4] // الرياضيات، الفيزياء، الكيمياء، الأحياء
    })
  });
  
  const subjectsData = await subjectsResponse.json();
  console.log('تم ربط المواد:', subjectsData);
});
```

### تحديث مواد الباقة
```javascript
fetch('/api/subjects/package/1', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + adminToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    subject_ids: [1, 5, 6] // الرياضيات، اللغة العربية، اللغة الإنجليزية
  })
})
.then(response => response.json())
.then(data => console.log(data.message));
```

### جلب مواد باقة محددة
```javascript
fetch('/api/subjects/package/1')
.then(response => response.json())
.then(data => {
  console.log('مواد الباقة:', data.subjects);
});
```

---

## 8. أكواد تفعيل الباقات

### نظرة عامة
نظام أكواد تفعيل الباقات يسمح للأدمن بإنشاء أكواد تفعيل للطلاب. كل كود:
- يتكون من 8 أرقام عشوائية
- للاستخدام مرة واحدة فقط
- يحتوي على QR code للمسح السريع
- يمكن تحديد تاريخ انتهاء صلاحية

### الجداول في قاعدة البيانات
```sql
-- جدول أكواد تفعيل الباقات
CREATE TABLE package_activation_codes (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    code VARCHAR(8) NOT NULL UNIQUE,
    max_uses INTEGER NOT NULL DEFAULT 1,
    uses INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMP,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- جدول تفعيلات الباقات (ربط الطلاب بالباقات)
CREATE TABLE package_activations (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activation_code_id INTEGER REFERENCES package_activation_codes(id) ON DELETE SET NULL,
    activated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    UNIQUE(package_id, student_id)
);
```

---

## 8.1. إنشاء أكواد تفعيل للباقة

### Endpoint
```
POST /api/packages/:id/activation-codes
```

### الوصف
إنشاء عدة أكواد تفعيل للباقة دفعة واحدة. كل كود للاستخدام مرة واحدة فقط ويحتوي على QR code.

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### الصلاحيات
- `admin` فقط

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف الباقة |

### Body (JSON)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `count` | number | ✅ | عدد الأكواد المطلوبة (من 1 إلى 100) |
| `expires_at` | string | ❌ | تاريخ انتهاء الصلاحية (ISO 8601 format) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages/1/activation-codes \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "count": 5,
    "expires_at": "2025-12-31T23:59:59Z"
  }'
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء 5 كود تفعيل بنجاح",
  "total_created": 5,
  "total_requested": 5,
  "package_id": 1,
  "package_name": "باقة الرياضيات الشاملة",
  "activation_codes": [
    {
      "id": 1,
      "code": "12345678",
      "package_id": 1,
      "package_name": "باقة الرياضيات الشاملة",
      "max_uses": 1,
      "uses": 0,
      "expires_at": "2025-12-31T23:59:59Z",
      "created_at": "2025-01-15T10:00:00Z",
      "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    },
    {
      "id": 2,
      "code": "87654321",
      "package_id": 1,
      "package_name": "باقة الرياضيات الشاملة",
      "max_uses": 1,
      "uses": 0,
      "expires_at": "2025-12-31T23:59:59Z",
      "created_at": "2025-01-15T10:00:01Z",
      "qr_code": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
    }
    // ... باقي الأكواد
  ]
}
```

### أخطاء محتملة

#### 400 Bad Request - Validation Error
```json
{
  "error": "Validation failed",
  "errors": [
    {
      "path": ["count"],
      "message": "Expected number, received string"
    }
  ]
}
```

#### 404 Not Found - Package Not Found
```json
{
  "error": "الباقة غير موجودة"
}
```

#### 500 Internal Server Error
```json
{
  "error": "خطأ في إنشاء أكواد التفعيل"
}
```

### ملاحظات
- كل كود للاستخدام مرة واحدة فقط (`max_uses = 1`)
- الحد الأقصى لعدد الأكواد في الطلب الواحد: 100
- QR code يحتوي على معلومات الكود والباقة بصيغة JSON
- إذا فشل إنشاء بعض الأكواد، سيتم إرجاع الأكواد الناجحة مع قائمة الأخطاء

---

## 8.2. تفعيل الباقة بالكود (للطالب)

### Endpoint
```
POST /api/packages/activate
```

### الوصف
تفعيل الباقة للطالب باستخدام كود التفعيل المكون من 8 أرقام.

### Headers
```
Authorization: Bearer <student_token>
Content-Type: application/json
```

### الصلاحيات
- `student` فقط

### Body (JSON)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `package_id` | number | ✅ | معرف الباقة |
| `code` | string | ✅ | كود التفعيل (8 أرقام) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages/activate \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "package_id": 1,
    "code": "12345678"
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تفعيل الباقة بنجاح",
  "package": {
    "id": 1,
    "name": "باقة الرياضيات الشاملة"
  }
}
```

### أخطاء محتملة

#### 400 Bad Request - Invalid Code
```json
{
  "message": "كود التفعيل غير صحيح أو لا ينتمي لهذه الباقة"
}
```

#### 400 Bad Request - Code Expired
```json
{
  "message": "كود التفعيل منتهي الصلاحية"
}
```

#### 400 Bad Request - Code Fully Used
```json
{
  "message": "كود التفعيل مستنفذ"
}
```

#### 400 Bad Request - Already Activated
```json
{
  "message": "لقد قمت بتفعيل هذه الباقة من قبل"
}
```

#### 400 Bad Request - Validation Error
```json
{
  "message": "Validation failed",
  "errors": [
    {
      "path": ["code"],
      "message": "Expected string, received number"
    }
  ]
}
```

---

## 8.3. تفعيل الباقة بمسح QR Code (للطالب)

### Endpoint
```
POST /api/packages/scan-qr-activate
```

### الوصف
تفعيل الباقة للطالب بمسح QR code الذي يحتوي على معلومات الكود والباقة.

### Headers
```
Authorization: Bearer <student_token>
Content-Type: application/json
```

### الصلاحيات
- `student` فقط

### Body (JSON)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `qr_data` | string | ✅ | بيانات QR code (JSON string) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages/scan-qr-activate \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "qr_data": "{\"type\":\"package_activation_code\",\"code\":\"12345678\",\"package_id\":1,\"created_at\":\"2025-01-15T10:00:00Z\"}"
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "success": true,
  "message": "تم تفعيل الباقة بنجاح",
  "package": {
    "id": 1,
    "name": "باقة الرياضيات الشاملة"
  }
}
```

### أخطاء محتملة

#### 400 Bad Request - Missing QR Data
```json
{
  "success": false,
  "message": "QR code data is required"
}
```

#### 400 Bad Request - Invalid QR Format
```json
{
  "success": false,
  "message": "Invalid QR code format"
}
```

#### 400 Bad Request - QR Code Expired
```json
{
  "success": false,
  "message": "QR code is expired or invalid"
}
```

#### 400 Bad Request - Invalid QR for Package
```json
{
  "success": false,
  "message": "Invalid QR code for package activation"
}
```

### ملاحظات
- QR code يحتوي على بيانات JSON بصيغة:
  ```json
  {
    "type": "package_activation_code",
    "code": "12345678",
    "package_id": 1,
    "expires_at": "2025-12-31T23:59:59Z",
    "created_at": "2025-01-15T10:00:00Z"
  }
  ```
- يتم التحقق من صحة QR code وتاريخ انتهاء الصلاحية تلقائياً
- نفس قواعد التحقق من كود التفعيل العادي تنطبق هنا

---

## أمثلة على الاستخدام - أكواد التفعيل

### إنشاء أكواد تفعيل للباقة
```javascript
// إنشاء 10 أكواد تفعيل للباقة رقم 1
fetch('/api/packages/1/activation-codes', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    count: 10,
    expires_at: '2025-12-31T23:59:59Z'
  })
})
.then(response => response.json())
.then(data => {
  console.log('تم إنشاء', data.total_created, 'كود تفعيل');
  data.activation_codes.forEach(code => {
    console.log('الكود:', code.code);
    console.log('QR Code:', code.qr_code);
  });
});
```

### تفعيل الباقة بالكود
```javascript
// تفعيل الباقة للطالب
fetch('/api/packages/activate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + studentToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    package_id: 1,
    code: '12345678'
  })
})
.then(response => response.json())
.then(data => {
  console.log(data.message);
  console.log('الباقة المفعلة:', data.package);
});
```

### تفعيل الباقة بمسح QR Code
```javascript
// تفعيل الباقة بمسح QR code
// qrDataString هو النص المستخرج من QR code
const qrDataString = '{"type":"package_activation_code","code":"12345678","package_id":1,"created_at":"2025-01-15T10:00:00Z"}';

fetch('/api/packages/scan-qr-activate', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + studentToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    qr_data: qrDataString
  })
})
.then(response => response.json())
.then(data => {
  if (data.success) {
    console.log(data.message);
    console.log('الباقة المفعلة:', data.package);
  } else {
    console.error('فشل التفعيل:', data.message);
  }
});
```

---

## 10. جلب تفاصيل المادة الدراسية

### Endpoint
```
GET /api/packages/subjects/:id
```

### الوصف
جلب تفاصيل مادة دراسية معينة. متاح للادمن والطالب المشترك في الباقة والمدرس المصرح له.

### Permissions
- **Admin:** يمكنه رؤية كل شيء بما في ذلك قائمة المدرسين المصرح لهم
- **Student:** يجب أن يكون مشترك في الباقة (مفعل الباقة)
- **Teacher:** يجب أن يكون لديه صلاحية على المادة

### Headers
```
Authorization: Bearer <token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية |

### مثال للطلب (Admin)
```bash
curl -X GET http://localhost:8000/api/packages/subjects/1 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK) - Admin
```json
{
  "subject": {
    "id": 1,
    "name": "الرياضيات المتقدمة",
    "image": "https://cloudinary.com/image.jpg",
    "package_id": 1,
    "package_name": "باقة الرياضيات الشاملة",
    "package_price": "299.99",
    "package_image": "https://cloudinary.com/package.jpg",
    "grade_id": 1,
    "grade_name": "الصف الأول الثانوي",
    "created_at": "2024-01-01T12:00:00Z"
  },
  "permissions": [
    {
      "id": 1,
      "teacher_id": 5,
      "granted_by": 1,
      "granted_at": "2024-01-15T10:00:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com",
      "teacher_avatar": "https://cloudinary.com/avatar.jpg",
      "granted_by_name": "Admin User"
    }
  ]
}
```

### مثال للاستجابة (200 OK) - Student/Teacher
```json
{
  "subject": {
    "id": 1,
    "name": "الرياضيات المتقدمة",
    "image": "https://cloudinary.com/image.jpg",
    "package_id": 1,
    "package_name": "باقة الرياضيات الشاملة",
    "package_price": "299.99",
    "package_image": "https://cloudinary.com/package.jpg",
    "grade_id": 1,
    "grade_name": "الصف الأول الثانوي",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

### مثال للاستجابة (403 Forbidden) - Student غير مشترك
```json
{
  "error": "يجب تفعيل الباقة أولاً للوصول إلى هذه المادة"
}
```

### مثال للاستجابة (403 Forbidden) - Teacher بدون صلاحية
```json
{
  "error": "ليس لديك صلاحية للوصول إلى هذه المادة"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "المادة غير موجودة"
}
```

---

## 11. إعطاء صلاحية لمدرس للوصول لمادة معينة

### Endpoint
```
POST /api/packages/subjects/:id/permissions
```

### الوصف
إعطاء صلاحية لمدرس معين للوصول إلى مادة دراسية معينة. (للادمن فقط)

### Permissions
- **Admin:** فقط

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية |

### Body Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `teacher_id` | number | ✅ | معرف المدرس |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages/subjects/1/permissions \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "teacher_id": 5
  }'
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم منح الصلاحية للمدرس بنجاح",
  "permission": {
    "id": 1,
    "subject_id": 1,
    "teacher_id": 5,
    "granted_at": "2024-01-15T10:00:00Z"
  }
}
```

### مثال للاستجابة (400 Bad Request) - المدرس ليس مدرس
```json
{
  "error": "المستخدم المحدد ليس مدرس"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "المادة غير موجودة"
}
```

---

## 12. إزالة صلاحية من مدرس

### Endpoint
```
DELETE /api/packages/subjects/:id/permissions/:teacherId
```

### الوصف
إزالة صلاحية مدرس من مادة دراسية معينة. (للادمن فقط)

### Permissions
- **Admin:** فقط

### Headers
```
Authorization: Bearer <admin_token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية |
| `teacherId` | number | ✅ | معرف المدرس |

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/packages/subjects/1/permissions/5 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم إزالة الصلاحية بنجاح"
}
```

### مثال للاستجابة (404 Not Found) - الصلاحية غير موجودة
```json
{
  "error": "الصلاحية غير موجودة"
}
```

---

## 13. عرض المدرسين المصرح لهم بمادة معينة

### Endpoint
```
GET /api/packages/subjects/:id/permissions
```

### الوصف
عرض قائمة بجميع المدرسين المصرح لهم بالوصول إلى مادة دراسية معينة. (للادمن فقط)

### Permissions
- **Admin:** فقط

### Headers
```
Authorization: Bearer <admin_token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية |

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/packages/subjects/1/permissions \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "subject_id": 1,
  "subject_name": "الرياضيات المتقدمة",
  "permissions": [
    {
      "id": 1,
      "teacher_id": 5,
      "granted_by": 1,
      "granted_at": "2024-01-15T10:00:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com",
      "teacher_avatar": "https://cloudinary.com/avatar.jpg",
      "granted_by_name": "Admin User"
    },
    {
      "id": 2,
      "teacher_id": 7,
      "granted_by": 1,
      "granted_at": "2024-01-16T14:30:00Z",
      "teacher_name": "فاطمة علي",
      "teacher_email": "fatima@example.com",
      "teacher_avatar": "https://cloudinary.com/avatar2.jpg",
      "granted_by_name": "Admin User"
    }
  ],
  "total": 2
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "المادة غير موجودة"
}
```

---

## 14. عرض المواد المتاحة للمدرس

### Endpoint
```
GET /api/packages/subjects/available
```

### الوصف
عرض جميع المواد الدراسية المتاحة للمدرس (المواد التي لديه صلاحية عليها). (للمدرس فقط)

### Permissions
- **Teacher:** فقط

### Headers
```
Authorization: Bearer <teacher_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/packages/subjects/available \
  -H "Authorization: Bearer <teacher_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "subjects": [
    {
      "id": 1,
      "package_id": 1,
      "name": "الرياضيات المتقدمة",
      "image": "https://cloudinary.com/subject-image.jpg",
      "created_at": "2024-01-01T12:00:00Z",
      "package_name": "باقة الرياضيات الشاملة",
      "grade_id": 1,
      "grade_name": "الصف الأول الثانوي",
      "courses_count": 3,
      "courses": [
        {
          "id": 1,
          "title": "كورس الرياضيات المتقدمة",
          "price": "199.99",
          "avatar": "https://cloudinary.com/course-avatar.jpg",
          "is_visible": true,
          "created_at": "2024-01-15T10:00:00Z"
        },
        {
          "id": 2,
          "title": "كورس الجبر الخطي",
          "price": "149.99",
          "avatar": null,
          "is_visible": true,
          "created_at": "2024-01-16T14:30:00Z"
        }
      ]
    },
    {
      "id": 2,
      "package_id": 1,
      "name": "الفيزياء العملية",
      "image": "https://cloudinary.com/subject-image2.jpg",
      "created_at": "2024-01-02T10:00:00Z",
      "package_name": "باقة الرياضيات الشاملة",
      "grade_id": 1,
      "grade_name": "الصف الأول الثانوي",
      "courses_count": 1,
      "courses": [
        {
          "id": 3,
          "title": "كورس الفيزياء الأساسية",
          "price": "179.99",
          "avatar": "https://cloudinary.com/course-avatar2.jpg",
          "is_visible": true,
          "created_at": "2024-01-17T09:00:00Z"
        }
      ]
    }
  ],
  "total": 2
}
```

### مثال للاستجابة (403 Forbidden) - غير مدرس
```json
{
  "error": "Unauthorized"
}
```

---

## ملاحظات مهمة

### نظام الصلاحيات
- **الادمن:** يمكنه رؤية جميع المواد وإدارة الصلاحيات
- **الطالب:** يمكنه رؤية المواد فقط إذا كان مشترك في الباقة (مفعل الباقة)
- **المدرس:** يمكنه رؤية المواد فقط إذا كان لديه صلاحية صريحة من الادمن

### إدارة الصلاحيات
- يمكن للادمن منح صلاحية لمدرس على مادة معينة
- يمكن للادمن إزالة صلاحية من مدرس
- يمكن للادمن رؤية قائمة بجميع المدرسين المصرح لهم بكل مادة
- الصلاحيات فريدة لكل مادة ومدرس (UNIQUE constraint)
- يمكن للمدرس عرض جميع المواد المتاحة له من خلال `GET /api/packages/subjects/available`

### قاعدة البيانات
```sql
-- جدول صلاحيات المدرسين على مواد الباقات
CREATE TABLE package_subject_item_teacher_permissions (
    id SERIAL PRIMARY KEY,
    package_subject_item_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(package_subject_item_id, teacher_id)
);
``` 