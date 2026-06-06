# 🏆 API المسابقات - التوثيق الشامل

## 📋 نظرة عامة
نظام المسابقات يوفر واجهات برمجة تطبيقات (APIs) متكاملة لإدارة المسابقات التعليمية. النظام مصمم ليكون آمناً وسهل الاستخدام مع صلاحيات محددة للأدمن وعرض عام للطلاب.

---

## 🗄️ هيكل قاعدة البيانات

### جدول المسابقات (competitions)
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `id` | SERIAL | المعرف الفريد | ✅ |
| `title` | VARCHAR(255) | عنوان المسابقة | ✅ |
| `description` | TEXT | وصف المسابقة | ❌ |
| `image_url` | VARCHAR(500) | رابط صورة المسابقة | ❌ |
| `duration` | INTEGER | مدة المسابقة بالدقائق | ✅ |
| `grade_id` | INTEGER | معرف الصف الدراسي | ✅ |
| `is_visible` | BOOLEAN | حالة الرؤية (true/false) | ❌ |
| `is_active` | BOOLEAN | حالة النشاط (true/false) | ❌ |
| `created_at` | TIMESTAMP | تاريخ الإنشاء | ✅ |
| `updated_at` | TIMESTAMP | تاريخ آخر تحديث | ✅ |
| `created_by` | INTEGER | معرف المستخدم المنشئ | ✅ |

### العلاقات
- `grade_id` → `grades(id)` (ON DELETE CASCADE)
- `created_by` → `users(id)` (ON DELETE CASCADE)

---

## 🔐 الأمان والصلاحيات

### المستويات
- **أدمن فقط**: إنشاء، تعديل، حذف، تغيير الحالات
- **جميع المستخدمين**: عرض المسابقات المرئية والنشطة

### المصادقة
- JWT Token في header: `Authorization: Bearer {token}`
- التحقق من الدور: `authMiddleware(['admin'])`

---

## 📡 نقاط النهاية (Endpoints)

### 1. 🆕 إنشاء مسابقة جديدة
```http
POST /competitions
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: multipart/form-data
```

**Body (Form Data):**
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `title` | string | عنوان المسابقة | ✅ |
| `description` | string | وصف المسابقة | ❌ |
| `image` | file | صورة المسابقة | ❌ |
| `duration` | number | مدة المسابقة بالدقائق | ✅ |
| `grade_id` | number | معرف الصف الدراسي | ✅ |
| `is_visible` | boolean | حالة الرؤية | ❌ |
| `is_active` | boolean | حالة النشاط | ❌ |

**مثال الطلب:**
```bash
curl -X POST /competitions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "title=مسابقة الرياضيات" \
  -F "description=مسابقة في الجبر والهندسة" \
  -F "image=@math.jpg" \
  -F "duration=60" \
  -F "grade_id=1" \
  -F "is_visible=true" \
  -F "is_active=true"
```

**الاستجابة الناجحة (201):**
```json
{
  "success": true,
  "message": "تم إنشاء المسابقة بنجاح",
  "data": {
    "id": 1,
    "title": "مسابقة الرياضيات",
    "description": "مسابقة في الجبر والهندسة",
    "image_url": "https://storage.bunny.net/competitions/image.jpg",
    "duration": 60,
    "grade_id": 1,
    "is_visible": true,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "created_by": 1
  }
}
```

---

### 2. 📋 الحصول على جميع المسابقات (للأدمن)
```http
GET /competitions/admin
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**مثال الطلب:**
```bash
curl -X GET /competitions/admin \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "description": "مسابقة في الجبر والهندسة",
      "image_url": "https://storage.bunny.net/competitions/image.jpg",
      "duration": 60,
      "grade_id": 1,
      "grade_name": "الصف الأول",
      "is_visible": true,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1,
      "creator_name": "أحمد محمد"
    }
  ]
}
```

---

### 3. 👀 الحصول على المسابقات المرئية (للطلاب)
```http
GET /competitions
```

**الصلاحيات:** جميع المستخدمين

**Query Parameters:**
| المعامل | النوع | الوصف | مطلوب |
|---------|-------|--------|--------|
| `grade_id` | number | معرف الصف الدراسي | ❌ |

**مثال الطلب:**
```bash
# جميع المسابقات المرئية
curl -X GET /competitions

# مسابقات صف معين
curl -X GET /competitions?grade_id=1
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "description": "مسابقة في الجبر والهندسة",
      "image_url": "https://storage.bunny.net/competitions/image.jpg",
      "duration": 60,
      "grade_id": 1,
      "grade_name": "الصف الأول",
      "is_visible": true,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1
    }
  ]
}
```

---

### 4. 🔍 الحصول على مسابقة محددة
```http
GET /competitions/{id}
```

**الصلاحيات:** جميع المستخدمين

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X GET /competitions/1
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "title": "مسابقة الرياضيات",
    "description": "مسابقة في الجبر والهندسة",
    "image_url": "https://storage.bunny.net/competitions/image.jpg",
    "duration": 60,
    "grade_id": 1,
    "grade_name": "الصف الأول",
    "is_visible": true,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "created_by": 1,
    "creator_name": "أحمد محمد"
  }
}
```

---

### 5. ✏️ تحديث مسابقة
```http
PUT /competitions/{id}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: multipart/form-data
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**Body (Form Data):**
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `title` | string | عنوان المسابقة | ❌ |
| `description` | string | وصف المسابقة | ❌ |
| `image` | file | صورة المسابقة | ❌ |
| `duration` | number | مدة المسابقة بالدقائق | ❌ |
| `grade_id` | number | معرف الصف الدراسي | ❌ |
| `is_visible` | boolean | حالة الرؤية | ❌ |
| `is_active` | boolean | حالة النشاط | ❌ |

**مثال الطلب:**
```bash
curl -X PUT /competitions/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -F "title=مسابقة الرياضيات المحدثة" \
  -F "duration=90"
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم تحديث المسابقة بنجاح",
  "data": {
    "id": 1,
    "title": "مسابقة الرياضيات المحدثة",
    "description": "مسابقة في الجبر والهندسة",
    "image_url": "https://storage.bunny.net/competitions/image.jpg",
    "duration": 90,
    "grade_id": 1,
    "is_visible": true,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z",
    "created_by": 1
  }
}
```

---

### 6. 🗑️ حذف مسابقة
```http
DELETE /competitions/{id}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X DELETE /competitions/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم حذف المسابقة بنجاح"
}
```

---

### 7. 👁️ تغيير حالة الرؤية
```http
PATCH /competitions/{id}/toggle-visibility
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X PATCH /competitions/1/toggle-visibility \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم إخفاء المسابقة بنجاح",
  "data": {
    "id": 1,
    "title": "مسابقة الرياضيات",
    "is_visible": false,
    "is_active": true,
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

### 8. ⚡ تغيير حالة النشاط
```http
PATCH /competitions/{id}/toggle-active
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X PATCH /competitions/1/toggle-active \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم إلغاء تفعيل المسابقة بنجاح",
  "data": {
    "id": 1,
    "title": "مسابقة الرياضيات",
    "is_visible": true,
    "is_active": false,
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 🖼️ رفع الصور

### المواصفات
- **الأنواع المدعومة:** JPEG, JPG, PNG, GIF, WebP
- **الحد الأقصى:** 5 ميجابايت
- **المجلد المحلي:** `uploads/competitions/`
- **التخزين النهائي:** Bunny.net Storage

### مثال رفع صورة
```javascript
const formData = new FormData();
formData.append('title', 'مسابقة العلوم');
formData.append('image', imageFile);
formData.append('duration', '45');
formData.append('grade_id', '2');

fetch('/competitions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

---

## ❌ رسائل الخطأ

### 400 - Bad Request
```json
{
  "success": false,
  "message": "العنوان والمدة والصف الدراسي مطلوبون"
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized"
}
```

### 403 - Forbidden
```json
{
  "success": false,
  "message": "Forbidden: insufficient role",
  "details": {
    "user_role": "student",
    "required_roles": ["admin"],
    "user_id": 123
  }
}
```

### 404 - Not Found
```json
{
  "success": false,
  "message": "المسابقة غير موجودة"
}
```

### 500 - Internal Server Error
```json
{
  "success": false,
  "message": "فشل في إنشاء المسابقة",
  "error": "Database connection failed"
}
```

---

## 🔧 أمثلة الاستخدام

### إنشاء مسابقة جديدة
```javascript
const createCompetition = async (competitionData) => {
  const formData = new FormData();
  
  // إضافة البيانات الأساسية
  formData.append('title', competitionData.title);
  formData.append('description', competitionData.description);
  formData.append('duration', competitionData.duration);
  formData.append('grade_id', competitionData.grade_id);
  formData.append('is_visible', competitionData.is_visible);
  formData.append('is_active', competitionData.is_active);
  
  // إضافة الصورة إذا وجدت
  if (competitionData.image) {
    formData.append('image', competitionData.image);
  }
  
  const response = await fetch('/competitions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });
  
  return response.json();
};
```

### تحديث مسابقة
```javascript
const updateCompetition = async (id, updates) => {
  const formData = new FormData();
  
  // إضافة الحقول المحدثة فقط
  Object.keys(updates).forEach(key => {
    if (updates[key] !== undefined) {
      formData.append(key, updates[key]);
    }
  });
  
  const response = await fetch(`/competitions/${id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    },
    body: formData
  });
  
  return response.json();
};
```

### تغيير حالة الرؤية
```javascript
const toggleVisibility = async (id) => {
  const response = await fetch(`/competitions/${id}/toggle-visibility`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    }
  });
  
  return response.json();
};
```

---

## 📊 حالات المسابقة

### حالة الرؤية (is_visible)
- **`true`**: المسابقة مرئية للطلاب
- **`false`**: المسابقة مخفية عن الطلاب

### حالة النشاط (is_active)
- **`true`**: المسابقة مفعلة ومتاحة
- **`false`**: المسابقة معطلة وغير متاحة

### الجمع بين الحالتين
| is_visible | is_active | النتيجة |
|------------|-----------|----------|
| `true` | `true` | مسابقة مرئية ومفعلة ✅ |
| `true` | `false` | مسابقة مرئية لكن معطلة ❌ |
| `false` | `true` | مسابقة مخفية لكن مفعلة ❌ |
| `false` | `false` | مسابقة مخفية ومعطلة ❌ |

---

## 🚀 أفضل الممارسات

### للأدمن
1. **استخدم أوصاف واضحة** للمسابقات
2. **اختر صور مناسبة** تعكس محتوى المسابقة
3. **حدد مدة مناسبة** حسب مستوى الصف
4. **اختبر الرؤية** قبل نشر المسابقة

### للمطورين
1. **تحقق من الصلاحيات** قبل كل طلب
2. **استخدم معالجة الأخطاء** المناسبة
3. **تحقق من صحة البيانات** قبل الإرسال
4. **استخدم التخزين المؤقت** للطلبات المتكررة

---

## 📝 ملاحظات تقنية

### قاعدة البيانات
- **PostgreSQL** مع triggers وفهارس
- **Foreign Keys** مع CASCADE DELETE
- **Timestamps** تلقائية للتحديث

### الخادم
- **Node.js + Express**
- **Multer** لرفع الملفات
- **JWT** للمصادقة

### الأمان
- **Role-based access control**
- **Input validation** باستخدام Zod
- **File type validation**
- **Size limits** للملفات

---

## 🔗 روابط مفيدة

- [ملف الهجرة](migrations/1700000000045_create_competitions_table.sql)
- [الخدمة](src/services/competitions.ts)
- [وحدة التحكم](src/controllers/competitions.ts)
- [الأنواع](src/db/types.ts)
- [ملف الاختبار](test-competitions.http)
- [البيانات التجريبية](sql/insert_sample_competitions.sql)

---

## 🎯 نظام أسئلة المسابقات

### نظرة عامة
نظام أسئلة المسابقات يوفر واجهات برمجة تطبيقات (APIs) لإدارة الأسئلة التعليمية للمسابقات. النظام يدعم طريقتين لإضافة الأسئلة: إضافة سؤال واحد أو إضافة مجموعة أسئلة دفعة واحدة.

### الميزات الرئيسية
- **إضافة أسئلة**: سؤال واحد أو مجموعة أسئلة دفعة واحدة
- **إدارة الأسئلة**: تعديل، حذف، تفعيل/إلغاء تفعيل
- **ترتيب الأسئلة**: تغيير ترتيب الأسئلة بسهولة
- **إحصائيات**: عرض إحصائيات شاملة للأسئلة
- **التحكم الكامل**: في جميع جوانب الأسئلة

### نقاط النهاية (Endpoints)

#### 1. إنشاء سؤال واحد
```http
POST /competition-questions
```
**الصلاحيات:** أدمن فقط

**Body (JSON):**
```json
{
  "competition_id": 1,
  "question_text": "Due to strong winds, the boat kept __________ in circles.",
  "option_a": "swimming",
  "option_b": "spinning",
  "option_c": "surrounding",
  "option_d": "span",
  "correct_answer": "B",
  "points": 1,
  "question_order": 0,
  "is_active": true
}
```

#### 2. إنشاء مجموعة أسئلة دفعة واحدة
```http
POST /competition-questions/bulk
```
**الصلاحيات:** أدمن فقط

**Body (JSON):**
```json
{
  "competition_id": 1,
  "questions": [
    {
      "question_text": "Due to strong winds, the boat kept __________ in circles.",
      "option_a": "swimming",
      "option_b": "spinning",
      "option_c": "surrounding",
      "option_d": "span",
      "correct_answer": "B",
      "points": 1,
      "question_order": 0
    },
    {
      "question_text": "Publishers suffer significant losses as a result of book __________.",
      "option_a": "literacy",
      "option_b": "punishment",
      "option_c": "piracy",
      "option_d": "privacy",
      "correct_answer": "C",
      "points": 1,
      "question_order": 1
    }
  ]
}
```

#### 2.5. إنشاء أسئلة من نص بسيط
```http
POST /competition-questions/text
```
**الصلاحيات:** أدمن فقط

**Body (JSON):**
```json
{
  "competition_id": 1,
  "questions_text": "Due to strong winds, the boat kept __________ in circles.\nA) swimming\nB) spinning\nC) surrounding\nD) span\n\nPublishers suffer significant losses as a result of book __________.\nA) literacy\nB) punishment\nC) piracy\nD) privacy"
}
```

**ملاحظات مهمة:**
- **تنسيق النص**: يجب أن ينتهي كل سؤال بنقطة (.) أو علامة استفهام (؟) أو علامة تعجب (!)
- **تنسيق الخيارات**: يجب أن تبدأ كل خيار بحرف كبير + ) + مسافة + النص (مثل: A) swimming)
- **الإجابة الصحيحة**: لا يتم تعيين إجابة صحيحة افتراضياً - يجب تحديدها لاحقاً
- **النقاط الافتراضية**: يتم تعيين 1 نقطة لكل سؤال افتراضياً
- **التحديث اللاحق**: يمكنك تحديد الإجابة الصحيحة بعد إنشاء الأسئلة باستخدام API تحديث الإجابة الصحيحة

#### 3. الحصول على أسئلة مسابقة معينة
```http
GET /competition-questions/competition/{competitionId}
```
**الصلاحيات:** جميع المستخدمين

#### 4. الحصول على أسئلة مع تفاصيل إضافية
```http
GET /competition-questions/competition/{competitionId}/details
```
**الصلاحيات:** أدمن فقط

#### 5. الحصول على سؤال بواسطة المعرف
```http
GET /competition-questions/{id}
```
**الصلاحيات:** جميع المستخدمين

#### 6. تحديث سؤال
```http
PUT /competition-questions/{id}
```
**الصلاحيات:** أدمن فقط

#### 6.5. تحديد الإجابة الصحيحة للسؤال
```http
PATCH /competition-questions/{id}/correct-answer
```
**الصلاحيات:** أدمن فقط

**Body (JSON):**
```json
{
  "correct_answer": "B"
}
```

**ملاحظات:**
- يمكن تحديد الإجابة الصحيحة من الخيارات: A, B, C, أو D
- يتم تحديث `updated_at` تلقائياً
- لا يمكن تحديد إجابة غير صحيحة

#### 7. حذف سؤال
```http
DELETE /competition-questions/{id}
```
**الصلاحيات:** أدمن فقط

#### 8. تغيير حالة النشاط
```http
PATCH /competition-questions/{id}/toggle-active
```
**الصلاحيات:** أدمن فقط

#### 9. تغيير ترتيب الأسئلة
```http
PATCH /competition-questions/reorder/{competitionId}
```
**الصلاحيات:** أدمن فقط

**Body (JSON):**
```json
{
  "questionOrders": [
    { "id": 1, "order": 3 },
    { "id": 2, "order": 0 },
    { "id": 3, "order": 1 },
    { "id": 4, "order": 2 }
  ]
}
```

#### 10. الحصول على إحصائيات الأسئلة
```http
GET /competition-questions/stats/{competitionId}
```
**الصلاحيات:** أدمن فقط

### أمثلة الاستخدام

#### إنشاء سؤال واحد
```javascript
const questionData = {
  competition_id: 1,
  question_text: "Due to strong winds, the boat kept __________ in circles.",
  option_a: "swimming",
  option_b: "spinning",
  option_c: "surrounding",
  option_d: "span",
  correct_answer: "B",
  points: 1
};

fetch('/competition-questions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(questionData)
});
```

#### إنشاء مجموعة أسئلة دفعة واحدة
```javascript
const bulkData = {
  competition_id: 1,
  questions: [
    {
      question_text: "Due to strong winds, the boat kept __________ in circles.",
      option_a: "swimming",
      option_b: "spinning",
      option_c: "surrounding",
      option_d: "span",
      correct_answer: "B",
      points: 1
    },
    {
      question_text: "Publishers suffer significant losses as a result of book __________.",
      option_a: "literacy",
      option_b: "punishment",
      option_c: "piracy",
      option_d: "privacy",
      correct_answer: "C",
      points: 1
    }
  ]
};

fetch('/competition-questions/bulk', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(bulkData)
});
```

#### إنشاء أسئلة من نص بسيط
```javascript
const createQuestionsFromText = async (competitionId, questionsText) => {
  const textData = {
    competition_id: competitionId,
    questions_text: questionsText
  };
  
  const response = await fetch('/competition-questions/text', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(textData)
  });
  
  return response.json();
};

// استخدام
const questionsText = `Due to strong winds, the boat kept __________ in circles.
A) swimming
B) spinning
C) surrounding
D) span

Publishers suffer significant losses as a result of book __________.
A) literacy
B) punishment
C) piracy
D) privacy

It is cruel to __________ children by making them go hungry.
A) publication
B) publish
C) punish
D) compensate

The show's success made her an overnight __________.
A) celebrate
B) celebrity
C) celebration
D) deliberate`;

createQuestionsFromText(1, questionsText);

// ملاحظة: الأسئلة يتم إنشاؤها بدون تحديد الإجابة الصحيحة
// يجب تحديد الإجابة الصحيحة لاحقاً باستخدام API تحديث الإجابة الصحيحة
```

#### تحديد الإجابة الصحيحة للسؤال
```javascript
const updateCorrectAnswer = async (questionId, correctAnswer) => {
  const response = await fetch(`/competition-questions/${questionId}/correct-answer`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      correct_answer: correctAnswer
    })
  });
  
  return response.json();
};

// استخدام
updateCorrectAnswer(1, 'B'); // تحديد أن الخيار B هو الصحيح
updateCorrectAnswer(2, 'C'); // تحديد أن الخيار C هو الصحيح
```

### الملفات المرتبطة
- [ملف الهجرة](migrations/1700000000046_create_competition_questions_table.sql)
- [الخدمة](src/services/competitionQuestions.ts)
- [وحدة التحكم](src/controllers/competitionQuestions.ts)
- [التوثيق الكامل](doc/competition-questions-api.md)
- [ملف الاختبار](test-competition-questions.http)

---

**🎉 تم إنشاء التوثيق الشامل لـ API المسابقات وأسئلتها!**

---

## 🎯 نظام حل المسابقات والنتائج

### نظرة عامة
نظام حل المسابقات يوفر واجهات برمجة تطبيقات (APIs) للطلاب لحل المسابقات وإرسال الإجابات، مع نظام تقييم شامل يعرض النتائج والترتيب.

### الميزات الرئيسية
- **حل المسابقات**: إرسال إجابات الطالب وتقييمها فورياً
- **عرض النتائج**: الدرجة النهائية والإجابات الصحيحة والخاطئة
- **ترتيب الطلاب**: ترتيب الطلاب حسب الدرجات في كل مسابقة
- **إحصائيات شاملة**: للطلاب والأدمن
- **حماية من التكرار**: لا يمكن حل المسابقة مرتين

---

## 📝 APIs حل المسابقات

### 1. 🎯 حل المسابقة وإرسال الإجابات
```http
POST api/competitions/{id}/solve
```

**الصلاحيات:** طالب فقط (ويجب أن يكون مشتركاً في المسابقة)

**Headers:**
```
Authorization: Bearer {student_token}
Content-Type: application/json
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**Body (JSON):**
```json
{
  "answers": [
    {
      "question_id": 1,
      "selected_answer": "B"
    },
    {
      "question_id": 2,
      "selected_answer": "A"
    },
    {
      "question_id": 3,
      "selected_answer": "C"
    }
  ]
}
```

**الوصف:**
- يرسل الطالب إجاباته على أسئلة المسابقة
- يتم تقييم الإجابات فورياً وحساب الدرجة
- لا يمكن حل المسابقة مرتين
- يتم حفظ النتيجة في قاعدة البيانات

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم حل المسابقة بنجاح",
  "data": {
    "score": 85,
    "total_questions": 10,
    "correct_answers": 8,
    "wrong_answers": 2,
    "total_points": 10,
    "earned_points": 8,
    "percentage": 80,
    "rank": 3,
    "total_students": 15,
    "submitted_at": "2024-01-01T14:30:00Z"
  }
}
```

**أخطاء شائعة:**
- 400: "معرف المسابقة غير صحيح"
- 403: "يجب الاشتراك في المسابقة لحلها"
- 409: "لقد قمت بحل هذه المسابقة مسبقاً"
- 404: "المسابقة غير موجودة"

---

### 2. 📊 عرض نتيجة الطالب في المسابقة
```http
GET api/competitions/{id}/student-result
```

**الصلاحيات:** طالب فقط (ويجب أن يكون قد حل المسابقة)

**Headers:**
```
Authorization: Bearer {student_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**الوصف:**
- يعرض نتيجة الطالب في المسابقة المحددة
- يعرض الإجابات الصحيحة والخاطئة مع التصحيح
- يعرض الدرجة النهائية والترتيب

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "duration": 60
    },
    "result": {
      "score": 85,
      "total_questions": 10,
      "correct_answers": 8,
      "wrong_answers": 2,
      "total_points": 10,
      "earned_points": 8,
      "percentage": 80,
      "rank": 3,
      "total_students": 15,
      "submitted_at": "2024-01-01T14:30:00Z"
    },
    "answers": [
      {
        "question_id": 1,
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "student_answer": "B",
        "correct_answer": "B",
        "is_correct": true,
        "points": 1,
        "earned_points": 1
      },
      {
        "question_id": 2,
        "question_text": "Publishers suffer significant losses as a result of book __________.",
        "student_answer": "A",
        "correct_answer": "C",
        "is_correct": false,
        "points": 1,
        "earned_points": 0,
        "explanation": "الإجابة الصحيحة هي C) piracy (القرصنة)"
      }
    ]
  }
}
```

**أخطاء شائعة:**
- 400: "معرف المسابقة غير صحيح"
- 403: "يجب الاشتراك في المسابقة لعرض النتيجة"
- 404: "لم تقم بحل هذه المسابقة بعد"

---

### 3. 📈 ترتيب الطلاب في مسابقة معينة
```http
GET /competitions/{id}/leaderboard
```

**الصلاحيات:** طالب فقط (ويجب أن يكون مشتركاً في المسابقة)

**Headers:**
```
Authorization: Bearer {student_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**Query Parameters:**
| المعامل | النوع | الوصف | مطلوب |
|---------|-------|--------|--------|
| `limit` | number | عدد الطلاب المطلوب عرضهم | ❌ |
| `offset` | number | عدد الطلاب المراد تخطيهم | ❌ |

**الوصف:**
- يعرض ترتيب الطلاب في المسابقة المحددة
- مرتب حسب الدرجات (من الأعلى للأقل)
- يعرض الدرجة والنسبة المئوية لكل طالب

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "total_students": 15
    },
    "leaderboard": [
      {
        "rank": 1,
        "student_name": "أحمد محمد",
        "score": 95,
        "percentage": 95,
        "correct_answers": 9,
        "total_questions": 10,
        "submitted_at": "2024-01-01T14:25:00Z"
      },
      {
        "rank": 2,
        "student_name": "فاطمة علي",
        "score": 90,
        "percentage": 90,
        "correct_answers": 9,
        "total_questions": 10,
        "submitted_at": "2024-01-01T14:28:00Z"
      },
      {
        "rank": 3,
        "student_name": "محمد أحمد",
        "score": 85,
        "percentage": 85,
        "correct_answers": 8,
        "total_questions": 10,
        "submitted_at": "2024-01-01T14:30:00Z"
      }
    ],
    "pagination": {
      "total": 15,
      "limit": 10,
      "offset": 0,
      "has_more": true
    }
  }
}
```

---

### 4. 🏆 ترتيب أوائل مسابقة معينة (للطالب والأدمن)
```http
GET /competitions/{id}/leaderboard
```

**الصلاحيات:** طالب وأدمن

**Headers:**
```
Authorization: Bearer {token}
```

**Path Parameters:**
| المعامل | النوع | الوصف | مطلوب |
|---------|-------|--------|--------|
| `id` | number | معرف المسابقة | ✅ |

**Query Parameters:**
| المعامل | النوع | الوصف | مطلوب | ملاحظات |
|---------|-------|--------|--------|----------|
| `grade_id` | number | معرف الصف الدراسي | ❌ | للأدمن فقط |
| `limit` | number | عدد الطلاب المطلوب عرضهم | ❌ | للطالب والأدمن |
| `offset` | number | عدد الطلاب المراد تخطيهم | ❌ | للطالب والأدمن |

**الوصف:**
- يعرض ترتيب أوائل الطلاب في مسابقة معينة
- **للطالب:** يجب أن يكون مشتركاً في المسابقة، يعرض النتائج العادية
- **للأدمن:** يمكنه تصفية النتائج حسب الصف الدراسي، يعرض نتائج مفصلة
- مرتب حسب الدرجات (من الأعلى للأقل)

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "total_students": 45
    },
    "leaderboard": [
      {
        "rank": 1,
        "student_name": "أحمد محمد",
        "score": 95,
        "percentage": 95,
        "correct_answers": 9,
        "total_questions": 10,
        "submitted_at": "2024-01-01T14:25:00Z"
      },
      {
        "rank": 2,
        "student_name": "فاطمة علي",
        "score": 92,
        "percentage": 92,
        "correct_answers": 9,
        "total_questions": 10,
        "submitted_at": "2024-01-01T15:30:00Z"
      }
    ],
    "pagination": {
      "total": 45,
      "limit": 10,
      "offset": 0,
      "has_more": true
    },
    "filters": {
      "grade_id": null,
      "grade_name": "جميع الصفوف"
    }
  }
}
```

---

## 🔄 تحديث API تفاصيل المسابقة للطالب

### 📄 تفاصيل المسابقة للطالب المشترك (تشمل النتيجة)
```http
GET /competitions/{id}/student-details
```

**الصلاحيات:** طالب فقط (ويجب أن يكون مشتركاً في المسابقة)

**Headers:**
```
Authorization: Bearer {student_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**الوصف:**
- إذا لم يكن الطالب قد حل المسابقة: يعرض المسابقة والأسئلة
- إذا كان الطالب قد حل المسابقة: يعرض النتيجة والإجابات الصحيحة والخاطئة

**الاستجابة الناجحة (200):**

#### إذا لم يحل الطالب المسابقة بعد:
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "duration": 60,
      "grade_id": 1,
      "is_visible": true,
      "is_active": true
    },
    "questions": [
      {
        "id": 10,
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "option_a": "swimming",
        "option_b": "spinning",
        "option_c": "surrounding",
        "option_d": "span",
        "points": 1,
        "question_order": 0
      }
    ],
    "has_solved": false
  }
}
```

#### إذا كان الطالب قد حل المسابقة:
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "duration": 60,
      "grade_id": 1,
      "is_visible": true,
      "is_active": true
    },
    "result": {
      "score": 85,
      "total_questions": 10,
      "correct_answers": 8,
      "wrong_answers": 2,
      "total_points": 10,
      "earned_points": 8,
      "percentage": 80,
      "rank": 3,
      "total_students": 15,
      "submitted_at": "2024-01-01T14:30:00Z"
    },
    "answers": [
      {
        "question_id": 1,
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "student_answer": "B",
        "correct_answer": "B",
        "is_correct": true,
        "points": 1,
        "earned_points": 1
      }
    ],
    "has_solved": true
  }
}
```

---

## 🗄️ هيكل قاعدة البيانات الجديد

### جدول نتائج المسابقات (competition_results)
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `id` | SERIAL | المعرف الفريد | ✅ |
| `competition_id` | INTEGER | معرف المسابقة | ✅ |
| `student_id` | INTEGER | معرف الطالب | ✅ |
| `score` | INTEGER | الدرجة النهائية | ✅ |
| `total_questions` | INTEGER | إجمالي عدد الأسئلة | ✅ |
| `correct_answers` | INTEGER | عدد الإجابات الصحيحة | ✅ |
| `wrong_answers` | INTEGER | عدد الإجابات الخاطئة | ✅ |
| `total_points` | INTEGER | إجمالي النقاط | ✅ |
| `earned_points` | INTEGER | النقاط المكتسبة | ✅ |
| `percentage` | DECIMAL(5,2) | النسبة المئوية | ✅ |
| `submitted_at` | TIMESTAMP | وقت إرسال الإجابات | ✅ |
| `created_at` | TIMESTAMP | تاريخ الإنشاء | ✅ |
| `updated_at` | TIMESTAMP | تاريخ آخر تحديث | ✅ |

### جدول إجابات الطلاب (student_answers)
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `id` | SERIAL | المعرف الفريد | ✅ |
| `competition_result_id` | INTEGER | معرف نتيجة المسابقة | ✅ |
| `question_id` | INTEGER | معرف السؤال | ✅ |
| `student_answer` | VARCHAR(1) | إجابة الطالب (A/B/C/D) | ✅ |
| `is_correct` | BOOLEAN | هل الإجابة صحيحة | ✅ |
| `points` | INTEGER | نقاط السؤال | ✅ |
| `earned_points` | INTEGER | النقاط المكتسبة | ✅ |
| `created_at` | TIMESTAMP | تاريخ الإنشاء | ✅ |

### العلاقات
- `competition_id` → `competitions(id)` (ON DELETE CASCADE)
- `student_id` → `users(id)` (ON DELETE CASCADE)
- `competition_result_id` → `competition_results(id)` (ON DELETE CASCADE)
- `question_id` → `competition_questions(id)` (ON DELETE CASCADE)

---

## 🔧 أمثلة الاستخدام

### حل المسابقة
```javascript
const solveCompetition = async (competitionId, answers) => {
  const response = await fetch(`/competitions/${competitionId}/solve`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${studentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ answers })
  });
  
  return response.json();
};

// استخدام
const answers = [
  { question_id: 1, selected_answer: "B" },
  { question_id: 2, selected_answer: "A" },
  { question_id: 3, selected_answer: "C" }
];

const result = await solveCompetition(1, answers);
if (result.success) {
  console.log('الدرجة:', result.data.score);
  console.log('الترتيب:', result.data.rank);
}
```

### عرض النتيجة
```javascript
const getStudentResult = async (competitionId) => {
  const response = await fetch(`/competitions/${competitionId}/student-result`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// استخدام
const result = await getStudentResult(1);
console.log('الدرجة:', result.data.result.score);
console.log('الإجابات الصحيحة:', result.data.result.correct_answers);
```

### عرض ترتيب الطلاب
```javascript
const getLeaderboard = async (competitionId) => {
  const response = await fetch(`/competitions/${competitionId}/leaderboard`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// استخدام
const leaderboard = await getLeaderboard(1);
console.log('أوائل المسابقة:', leaderboard.data.leaderboard);
```

### عرض ترتيب أوائل مسابقة معينة (للطالب والأدمن)
```javascript
// للطالب
const getStudentLeaderboard = async (competitionId) => {
  const response = await fetch(`/competitions/${competitionId}/leaderboard`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// للأدمن
const getAdminLeaderboard = async (competitionId, gradeId = null) => {
  let url = `/competitions/${competitionId}/leaderboard`;
  if (gradeId) {
    url += `?grade_id=${gradeId}`;
  }
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    }
  });
  
  return response.json();
};

// استخدام
const studentLeaderboard = await getStudentLeaderboard(6); // للطالب
const adminLeaderboard = await getAdminLeaderboard(6); // للأدمن
const gradeLeaderboard = await getAdminLeaderboard(6, 2); // للأدمن + صف معين
```

---

## 🚀 سير العمل الكامل للطالب

```javascript
const completeCompetitionWorkflow = async (competitionId) => {
  try {
    // 1. جلب تفاصيل المسابقة والأسئلة
    const details = await getCompetitionDetails(competitionId);
    
    if (details.data.has_solved) {
      // الطالب قد حل المسابقة - عرض النتيجة
      console.log('لقد قمت بحل هذه المسابقة مسبقاً');
      console.log('الدرجة:', details.data.result.score);
      console.log('الترتيب:', details.data.result.rank);
      return;
    }
    
    // 2. عرض الأسئلة للطالب
    console.log('أسئلة المسابقة:', details.data.questions);
    
    // 3. جمع إجابات الطالب (في التطبيق الحقيقي)
    const studentAnswers = collectStudentAnswers(details.data.questions);
    
    // 4. إرسال الإجابات وحل المسابقة
    const solveResult = await solveCompetition(competitionId, studentAnswers);
    
    if (solveResult.success) {
      console.log('تم حل المسابقة بنجاح!');
      console.log('الدرجة:', solveResult.data.score);
      console.log('الترتيب:', solveResult.data.rank);
      
      // 5. عرض النتيجة التفصيلية
      const result = await getStudentResult(competitionId);
      console.log('النتيجة التفصيلية:', result.data);
      
      // 6. عرض ترتيب الطلاب
      const leaderboard = await getLeaderboard(competitionId);
      console.log('ترتيب الطلاب:', leaderboard.data.leaderboard);
    }
    
  } catch (error) {
    console.error('خطأ في سير العمل:', error);
  }
};

// تشغيل سير العمل
completeCompetitionWorkflow(1);
```

---

## 📊 إحصائيات إضافية

### للطالب
- **عدد المسابقات المحلولة**: إجمالي المسابقات التي تم حلها
- **متوسط الدرجات**: متوسط الدرجات في جميع المسابقات
- **أفضل ترتيب**: أفضل ترتيب تم تحقيقه
- **تاريخ آخر مسابقة**: آخر مسابقة تم حلها

### للأدمن
- **إحصائيات الصف**: متوسط الدرجات لكل صف
- **أفضل الطلاب**: الطلاب الأكثر تفوقاً
- **توزيع الدرجات**: عدد الطلاب في كل مستوى درجات
- **معدل المشاركة**: نسبة الطلاب المشاركين في المسابقات

---

**🎉 تم إضافة نظام حل المسابقات والنتائج الشامل!**

---

## 👨‍🎓 واجهات الطالب لمسابقات الصف

### 1. 🔎 جلب مسابقات الطالب حسب صفوفه
```http
GET /competitions/student
```

**الصلاحيات:** طالب فقط

**Headers:**
```
Authorization: Bearer {student_token}
```

**الوصف:**
- يعيد جميع المسابقات المرئية والمفعلة التي تتبع أي صف من صفوف الطالب.

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "description": "مسابقة في الجبر والهندسة",
      "image_url": "https://storage.bunny.net/competitions/image.jpg",
      "duration": 60,
      "grade_id": 1,
      "grade_name": "الصف الأول",
      "is_visible": true,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1
    }
  ]
}
```

---

### 2. ✅ اشتراك الطالب في مسابقة
```http
POST api/competitions/{id}/join
```

**الصلاحيات:** طالب فقط

**Headers:**
```
Authorization: Bearer {student_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**الوصف:**
- يُسجل اشتراك الطالب في المسابقة إن لم يكن مشتركاً مسبقاً.

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم الاشتراك في المسابقة بنجاح",
  "data": { "joined": true }
}
```

**أخطاء شائعة:**
- 400: "معرف المسابقة غير صحيح"
- 500: "فشل في الاشتراك في المسابقة"

---

### 3. 📄 تفاصيل المسابقة للطالب المشترك (تشمل الأسئلة)
```http
GET /competitions/{id}/student-details
```

**الصلاحيات:** طالب فقط (ويجب أن يكون مشتركاً في المسابقة)

**Headers:**
```
Authorization: Bearer {student_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف المسابقة |

**الوصف:**
- يعيد تفاصيل المسابقة مع الأسئلة النشطة فقط، بشرط أن يكون الطالب مشتركاً.

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "competition": {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "duration": 60,
      "grade_id": 1,
      "is_visible": true,
      "is_active": true
    },
    "questions": [
      {
        "id": 10,
        "competition_id": 1,
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "option_a": "swimming",
        "option_b": "spinning",
        "option_c": "surrounding",
        "option_d": "span",
        "correct_answer": null,
        "points": 1,
        "question_order": 0,
        "is_active": true
      }
    ]
  }
}
```

**أخطاء شائعة:**
- 400: "معرف المسابقة غير صحيح"
- 403: "يجب الاشتراك في المسابقة لعرض التفاصيل"
- 404: "المسابقة غير موجودة"

---

### أمثلة الاستخدام للطالب

#### جلب مسابقات الطالب
```javascript
const getStudentCompetitions = async () => {
  const response = await fetch('/competitions/student', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// استخدام
const competitions = await getStudentCompetitions();
console.log('مسابقات الطالب:', competitions.data);
```

#### الاشتراك في مسابقة
```javascript
const joinCompetition = async (competitionId) => {
  const response = await fetch(`/competitions/${competitionId}/join`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// استخدام
const result = await joinCompetition(1);
if (result.success) {
  console.log('تم الاشتراك بنجاح!');
}
```

#### عرض تفاصيل المسابقة والأسئلة
```javascript
const getCompetitionDetails = async (competitionId) => {
  const response = await fetch(`/competitions/${competitionId}/student-details`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  
  return response.json();
};

// استخدام
const details = await getCompetitionDetails(1);
console.log('تفاصيل المسابقة:', details.data.competition);
console.log('الأسئلة:', details.data.questions);
```

#### سير العمل الكامل للطالب
```javascript
const studentWorkflow = async () => {
  try {
    // 1. جلب المسابقات المتاحة للطالب
    const competitions = await getStudentCompetitions();
    console.log('المسابقات المتاحة:', competitions.data);
    
    if (competitions.data.length === 0) {
      console.log('لا توجد مسابقات متاحة لك');
      return;
    }
    
    // 2. اختيار مسابقة والاشتراك فيها
    const selectedCompetition = competitions.data[0];
    const joinResult = await joinCompetition(selectedCompetition.id);
    
    if (joinResult.success) {
      console.log('تم الاشتراك في المسابقة:', selectedCompetition.title);
      
      // 3. جلب تفاصيل المسابقة والأسئلة
      const details = await getCompetitionDetails(selectedCompetition.id);
      console.log('تفاصيل المسابقة:', details.data);
      
      // 4. عرض الأسئلة للطالب
      details.data.questions.forEach((question, index) => {
        console.log(`السؤال ${index + 1}:`, question.question_text);
        console.log('الخيارات:', {
          'A': question.option_a,
          'B': question.option_b,
          'C': question.option_c,
          'D': question.option_d
        });
        console.log('النقاط:', question.points);
        console.log('---');
      });
    }
  } catch (error) {
    console.error('خطأ في سير العمل:', error);
  }
};

// تشغيل سير العمل
studentWorkflow();
```

---

## 👨‍🎓 واجهات الطالب لمسابقات الصف

### 1. 🔎 جلب مسابقات الطالب حسب صفوفه
```http
GET /competitions/student
```

**الصلاحيات:** طالب فقط

**Headers:**
```
Authorization: Bearer {student_token}
```

**الوصف:**
- يعرض جميع المسابقات المتاحة للطالب حسب صفوفه
- يعرض فقط المسابقات المرئية والنشطة

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "title": "مسابقة الرياضيات",
      "description": "مسابقة في الرياضيات للصف الأول",
      "grade_name": "الصف الأول",
      "is_visible": true,
      "is_active": true
    }
  ]
}
```

---

### 2. 📊 جلب جميع الطلاب (للأدمن)
```http
GET /student/students-data
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**الوصف:**
- يعرض جميع الطلاب في النظام
- لا يوجد limit - يعرض جميع الطلاب
- يعرض معلومات مفصلة عن كل طالب مع الصفوف المسجل فيها

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "students": [
      {
        "id": 1,
        "name": "أحمد محمد",
        "phone": "0123456789",
        "email": "ahmed@example.com",
        "parent_phone": "0987654321",
        "avatar": "avatar1.jpg",
        "created_at": "2024-01-01T00:00:00Z",
        "grades": [
          {
            "id": 1,
            "name": "الصف الأول"
          }
        ]
      }
    ],
    "total": 150
  }
}
```

**مثال الاستخدام:**
```javascript
const getAllStudents = async () => {
  const response = await fetch('/api/student/students-data', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${adminToken}`
    }
  });
  
  return response.json();
};

// استخدام
const students = await getAllStudents();
console.log('إجمالي الطلاب:', students.data.total);
console.log('الطلاب:', students.data.students);
```

---

### 3. 🔐 تغيير كلمة سر الطالب (للأدمن)
```http
PATCH /users/students/{id}/password
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

**Path Parameters:**
| المعامل | النوع | الوصف | مطلوب |
|---------|-------|--------|--------|
| `id` | number | معرف الطالب | ✅ |

**Request Body:**
```json
{
  "new_password": "كلمة_السر_الجديدة"
}
```

**الوصف:**
- يسمح للأدمن بتغيير كلمة سر أي طالب
- كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل
- يتم تشفير كلمة السر الجديدة قبل حفظها

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم تغيير كلمة سر الطالب بنجاح",
  "data": {
    "student_id": 1,
    "student_name": "أحمد محمد",
    "student_phone": "0123456789",
    "password_changed_at": "2024-01-01T12:00:00Z"
  }
}
```

**أخطاء محتملة:**
- **400 Bad Request:** كلمة السر قصيرة جداً أو مفقودة
- **401 Unauthorized:** لا يوجد token
- **403 Forbidden:** المستخدم ليس أدمن
- **404 Not Found:** الطالب غير موجود

**مثال الاستخدام:**
```javascript
const changeStudentPassword = async (studentId, newPassword) => {
  const response = await fetch(`/api/users/students/${studentId}/password`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      new_password: newPassword
    })
  });
  
  return response.json();
};

// استخدام
const result = await changeStudentPassword(1, 'newpassword123');
if (result.success) {
  console.log('تم تغيير كلمة السر بنجاح');
  console.log('الطالب:', result.data.student_name);
}
```

---
