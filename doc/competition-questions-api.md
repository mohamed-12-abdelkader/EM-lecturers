# 🎯 API أسئلة المسابقات - التوثيق الشامل

## 📋 نظرة عامة
نظام أسئلة المسابقات يوفر واجهات برمجة تطبيقات (APIs) لإدارة الأسئلة التعليمية للمسابقات. النظام يدعم طريقتين لإضافة الأسئلة: إضافة سؤال واحد أو إضافة مجموعة أسئلة دفعة واحدة.

---

## 🗄️ هيكل قاعدة البيانات

### جدول أسئلة المسابقات (competition_questions)
| الحقل | النوع | الوصف | مطلوب |
|-------|-------|--------|--------|
| `id` | SERIAL | المعرف الفريد | ✅ |
| `competition_id` | INTEGER | معرف المسابقة | ✅ |
| `question_text` | TEXT | نص السؤال | ✅ |
| `option_a` | VARCHAR(500) | الخيار أ | ✅ |
| `option_b` | VARCHAR(500) | الخيار ب | ✅ |
| `option_c` | VARCHAR(500) | الخيار ج | ✅ |
| `option_d` | VARCHAR(500) | الخيار د | ✅ |
| `correct_answer` | CHAR(1) | الإجابة الصحيحة (A/B/C/D) | ✅ |
| `points` | INTEGER | نقاط السؤال | ❌ |
| `question_order` | INTEGER | ترتيب السؤال | ❌ |
| `is_active` | BOOLEAN | حالة النشاط | ❌ |
| `created_at` | TIMESTAMP | تاريخ الإنشاء | ✅ |
| `updated_at` | TIMESTAMP | تاريخ آخر تحديث | ✅ |
| `created_by` | INTEGER | معرف المستخدم المنشئ | ✅ |

### العلاقات
- `competition_id` → `competitions(id)` (ON DELETE CASCADE)
- `created_by` → `users(id)` (ON DELETE CASCADE)

### الميزات الإضافية
- **عد الأسئلة التلقائي**: يتم تحديث `questions_count` في جدول المسابقات تلقائياً
- **ترتيب الأسئلة**: يمكن تغيير ترتيب الأسئلة
- **نقاط مخصصة**: كل سؤال له نقاط خاصة به

---

## 🔐 الأمان والصلاحيات

### المستويات
- **أدمن فقط**: إنشاء، تعديل، حذف، تغيير الحالات، تغيير الترتيب
- **جميع المستخدمين**: عرض الأسئلة النشطة

### المصادقة
- JWT Token في header: `Authorization: Bearer {token}`
- التحقق من الدور: `authMiddleware(['admin'])`

---

## 📡 نقاط النهاية (Endpoints)

### 1. 🆕 إنشاء سؤال واحد
```http
POST /competition-questions
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

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

**مثال الطلب:**
```bash
curl -X POST /competition-questions \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "competition_id": 1,
    "question_text": "Due to strong winds, the boat kept __________ in circles.",
    "option_a": "swimming",
    "option_b": "spinning",
    "option_c": "surrounding",
    "option_d": "span",
    "correct_answer": "B",
    "points": 1
  }'
```

**الاستجابة الناجحة (201):**
```json
{
  "success": true,
  "message": "تم إنشاء السؤال بنجاح",
  "data": {
    "id": 1,
    "competition_id": 1,
    "question_text": "Due to strong winds, the boat kept __________ in circles.",
    "option_a": "swimming",
    "option_b": "spinning",
    "option_c": "surrounding",
    "option_d": "span",
    "correct_answer": "B",
    "points": 1,
    "question_order": 0,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "created_by": 1
  }
}
```

---

### 2. 📚 إنشاء مجموعة أسئلة دفعة واحدة
```http
POST /competition-questions/bulk
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

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

---

### 2.5. 📝 إنشاء أسئلة من نص بسيط
```http
POST /competition-questions/text
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

**Body (JSON):**
```json
{
  "competition_id": 1,
  "questions_text": "Due to strong winds, the boat kept __________ in circles.\nA) swimming\nB) spinning\nC) surrounding\nD) span\n\nPublishers suffer significant losses as a result of book __________.\nA) literacy\nB) punishment\nC) piracy\nD) privacy"
}
```

**مثال الطلب:**
```bash
curl -X POST /competition-questions/text \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "competition_id": 1,
    "questions_text": "Due to strong winds, the boat kept __________ in circles.\nA) swimming\nB) spinning\nC) surrounding\nD) span\n\nPublishers suffer significant losses as a result of book __________.\nA) literacy\nB) punishment\nC) piracy\nD) privacy"
  }'
```

**الاستجابة الناجحة (201):**
```json
{
  "success": true,
  "message": "تم إنشاء 2 سؤال بنجاح من النص",
  "data": {
    "questions": [
      {
        "id": 1,
        "competition_id": 1,
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "correct_answer": null,
        "points": 1
      },
      {
        "id": 2,
        "competition_id": 1,
        "question_text": "Publishers suffer significant losses as a result of book __________.",
        "correct_answer": null,
        "points": 1
      }
    ],
    "parsed_count": 2,
    "errors": []
  },
  "note": "تم إنشاء الأسئلة بدون تحديد الإجابة الصحيحة. يمكنك تحديدها لاحقاً باستخدام API تحديث الإجابة الصحيحة."
}
```

**ملاحظات مهمة:**
- **تنسيق النص**: يجب أن ينتهي كل سؤال بنقطة (.) أو علامة استفهام (؟) أو علامة تعجب (!)
- **تنسيق الخيارات**: يجب أن تبدأ كل خيار بحرف كبير + ) + مسافة + النص (مثل: A) swimming)
- **الإجابة الصحيحة**: لا يتم تعيين إجابة صحيحة افتراضياً - يجب تحديدها لاحقاً
- **النقاط الافتراضية**: يتم تعيين 1 نقطة لكل سؤال افتراضياً
- **التحديث اللاحق**: يمكنك تحديد الإجابة الصحيحة بعد إنشاء الأسئلة باستخدام API تحديث الإجابة الصحيحة

**مثال الطلب:**
```bash
curl -X POST /competition-questions/bulk \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "competition_id": 1,
    "questions": [
      {
        "question_text": "Due to strong winds, the boat kept __________ in circles.",
        "option_a": "swimming",
        "option_b": "spinning",
        "option_c": "surrounding",
        "option_d": "span",
        "correct_answer": "B",
        "points": 1
      }
    ]
  }'
```

**الاستجابة الناجحة (201):**
```json
{
  "success": true,
  "message": "تم إنشاء 2 سؤال بنجاح",
  "data": [
    {
      "id": 1,
      "competition_id": 1,
      "question_text": "Due to strong winds, the boat kept __________ in circles.",
      "correct_answer": "B",
      "points": 1
    },
    {
      "id": 2,
      "competition_id": 1,
      "question_text": "Publishers suffer significant losses as a result of book __________.",
      "correct_answer": "C",
      "points": 1
    }
  ]
}
```

---

### 3. 👀 الحصول على أسئلة مسابقة معينة
```http
GET /competition-questions/competition/{competitionId}
```

**الصلاحيات:** جميع المستخدمين

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `competitionId` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X GET /competition-questions/competition/1
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "competition_id": 1,
      "question_text": "Due to strong winds, the boat kept __________ in circles.",
      "option_a": "swimming",
      "option_b": "spinning",
      "option_c": "surrounding",
      "option_d": "span",
      "correct_answer": "B",
      "points": 1,
      "question_order": 0,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1
    }
  ]
}
```

---

### 4. 🔍 الحصول على أسئلة مسابقة مع تفاصيل إضافية
```http
GET /competition-questions/competition/{competitionId}/details
```

**الصلاحيات:** أدمن فقط

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `competitionId` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X GET /competition-questions/competition/1/details \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "competition_id": 1,
      "question_text": "Due to strong winds, the boat kept __________ in circles.",
      "option_a": "swimming",
      "option_b": "spinning",
      "option_c": "surrounding",
      "option_d": "span",
      "correct_answer": "B",
      "points": 1,
      "question_order": 0,
      "is_active": true,
      "created_at": "2024-01-01T00:00:00Z",
      "updated_at": "2024-01-01T00:00:00Z",
      "created_by": 1,
      "competition_title": "مسابقة اللغة الإنجليزية",
      "creator_name": "أحمد محمد"
    }
  ]
}
```

---

### 5. 🔍 الحصول على سؤال بواسطة المعرف
```http
GET /competition-questions/{id}
```

**الصلاحيات:** جميع المستخدمين

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف السؤال |

**مثال الطلب:**
```bash
curl -X GET /competition-questions/1
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "competition_id": 1,
    "question_text": "Due to strong winds, the boat kept __________ in circles.",
    "option_a": "swimming",
    "option_b": "spinning",
    "option_c": "surrounding",
    "option_d": "span",
    "correct_answer": "B",
    "points": 1,
    "question_order": 0,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z",
    "created_by": 1
  }
}
```

---

### 6. ✏️ تحديث سؤال
```http
PUT /competition-questions/{id}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف السؤال |

**Body (JSON):**
```json
{
  "question_text": "Due to strong winds, the boat kept __________ in circles. (Updated)",
  "correct_answer": "B",
  "points": 2
}
```

**مثال الطلب:**
```bash
curl -X PUT /competition-questions/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "question_text": "Due to strong winds, the boat kept __________ in circles. (Updated)",
    "points": 2
  }'
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم تحديث السؤال بنجاح",
  "data": {
    "id": 1,
    "question_text": "Due to strong winds, the boat kept __________ in circles. (Updated)",
    "points": 2,
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

### 6.5. 🎯 تحديد الإجابة الصحيحة للسؤال
```http
PATCH /competition-questions/{id}/correct-answer
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف السؤال |

**Body (JSON):**
```json
{
  "correct_answer": "B"
}
```

**ملاحظات مهمة:**
- يمكن تحديد الإجابة الصحيحة من الخيارات: A, B, C, أو D
- يتم تحديث `updated_at` تلقائياً
- لا يمكن تحديد إجابة غير صحيحة

**مثال الطلب:**
```bash
curl -X PATCH /competition-questions/1/correct-answer \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "correct_answer": "B"
  }'
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم تحديث الإجابة الصحيحة إلى B بنجاح",
  "data": {
    "id": 1,
    "competition_id": 1,
    "question_text": "Due to strong winds, the boat kept __________ in circles.",
    "option_a": "swimming",
    "option_b": "spinning",
    "option_c": "surrounding",
    "option_d": "span",
    "correct_answer": "B",
    "points": 1,
    "question_order": 0,
    "is_active": true,
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z",
    "created_by": 1
  }
}
```

---

### 7. 🗑️ حذف سؤال
```http
DELETE /competition-questions/{id}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف السؤال |

**مثال الطلب:**
```bash
curl -X DELETE /competition-questions/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم حذف السؤال بنجاح"
}
```

---

### 8. ⚡ تغيير حالة النشاط
```http
PATCH /competition-questions/{id}/toggle-active
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `id` | number | معرف السؤال |

**مثال الطلب:**
```bash
curl -X PATCH /competition-questions/1/toggle-active \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم إلغاء تفعيل السؤال بنجاح",
  "data": {
    "id": 1,
    "is_active": false,
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

### 9. 🔄 تغيير ترتيب الأسئلة
```http
PATCH /competition-questions/reorder/{competitionId}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
Content-Type: application/json
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `competitionId` | number | معرف المسابقة |

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

**مثال الطلب:**
```bash
curl -X PATCH /competition-questions/reorder/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{
    "questionOrders": [
      { "id": 1, "order": 3 },
      { "id": 2, "order": 0 },
      { "id": 3, "order": 1 },
      { "id": 4, "order": 2 }
    ]
  }'
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "message": "تم تغيير ترتيب الأسئلة بنجاح"
}
```

---

### 10. 📊 الحصول على إحصائيات الأسئلة
```http
GET /competition-questions/stats/{competitionId}
```

**الصلاحيات:** أدمن فقط

**Headers:**
```
Authorization: Bearer {admin_token}
```

**Path Parameters:**
| المعامل | النوع | الوصف |
|---------|-------|--------|
| `competitionId` | number | معرف المسابقة |

**مثال الطلب:**
```bash
curl -X GET /competition-questions/stats/1 \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

**الاستجابة الناجحة (200):**
```json
{
  "success": true,
  "data": {
    "total_questions": 10,
    "active_questions": 8,
    "total_points": 12
  }
}
```

---

## ❌ رسائل الخطأ

### 400 - Bad Request
```json
{
  "success": false,
  "message": "جميع البيانات مطلوبة: معرف المسابقة، نص السؤال، جميع الخيارات، والإجابة الصحيحة"
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
  "message": "Forbidden: insufficient role"
}
```

### 404 - Not Found
```json
{
  "success": false,
  "message": "السؤال غير موجود"
}
```

### 500 - Internal Server Error
```json
{
  "success": false,
  "message": "فشل في إنشاء السؤال",
  "error": "Database connection failed"
}
```

---

## 🔧 أمثلة الاستخدام

### إنشاء سؤال واحد
```javascript
const createQuestion = async (questionData) => {
  const response = await fetch('/competition-questions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(questionData)
  });
  
  return response.json();
};

// استخدام
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

createQuestion(questionData);
```

### إنشاء مجموعة أسئلة دفعة واحدة
```javascript
const createBulkQuestions = async (competitionId, questions) => {
  const bulkData = {
    competition_id: competitionId,
    questions: questions
  };
  
  const response = await fetch('/competition-questions/bulk', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(bulkData)
  });
  
  return response.json();
};

// استخدام
const questions = [
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
];

createBulkQuestions(1, questions);
```

### تحديث سؤال
```javascript
const updateQuestion = async (id, updates) => {
  const response = await fetch(`/competition-questions/${id}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(updates)
  });
  
  return response.json();
};

// استخدام
updateQuestion(1, {
  question_text: "Due to strong winds, the boat kept __________ in circles. (Updated)",
  points: 2
});
```

### تغيير ترتيب الأسئلة
```javascript
const reorderQuestions = async (competitionId, questionOrders) => {
  const response = await fetch(`/competition-questions/reorder/${competitionId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${adminToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ questionOrders })
  });
  
  return response.json();
};

// استخدام
reorderQuestions(1, [
  { id: 1, order: 3 },
  { id: 2, order: 0 },
  { id: 3, order: 1 },
  { id: 4, order: 2 }
]);
```

---

## 📊 حالات السؤال

### حالة النشاط (is_active)
- **`true`**: السؤال نشط ومتاح
- **`false`**: السؤال معطل وغير متاح

### الإجابة الصحيحة (correct_answer)
- **`A`**: الخيار أ صحيح
- **`B`**: الخيار ب صحيح
- **`C`**: الخيار ج صحيح
- **`D`**: الخيار د صحيح

### ترتيب الأسئلة (question_order)
- **`0`**: أول سؤال
- **`1`**: ثاني سؤال
- **`2`**: ثالث سؤال
- وهكذا...

---

## 🚀 أفضل الممارسات

### للأدمن
1. **استخدم نصوص واضحة** للأسئلة
2. **اختبر الخيارات** قبل النشر
3. **حدد نقاط مناسبة** لكل سؤال
4. **رتب الأسئلة** بشكل منطقي

### للمطورين
1. **تحقق من الصلاحيات** قبل كل طلب
2. **استخدم معالجة الأخطاء** المناسبة
3. **تحقق من صحة البيانات** قبل الإرسال
4. **استخدم المعاملات** للعمليات المتعددة

---

## 📝 ملاحظات تقنية

### قاعدة البيانات
- **PostgreSQL** مع triggers وفهارس
- **Foreign Keys** مع CASCADE DELETE
- **Timestamps** تلقائية للتحديث
- **عد الأسئلة** تلقائي

### الخادم
- **Node.js + Express**
- **معاملات قاعدة البيانات** للعمليات المتعددة
- **JWT** للمصادقة

### الأمان
- **Role-based access control**
- **Input validation** باستخدام Zod
- **Data integrity** مع triggers

---

## 🔗 روابط مفيدة

- [ملف الهجرة](migrations/1700000000046_create_competition_questions_table.sql)
- [الخدمة](src/services/competitionQuestions.ts)
- [وحدة التحكم](src/controllers/competitionQuestions.ts)
- [الأنواع](src/db/types.ts)
- [ملف الاختبار](test-competition-questions.http)
- [API المسابقات](doc/comp.md)

---

**🎉 تم إنشاء التوثيق الشامل لـ API أسئلة المسابقات!**
