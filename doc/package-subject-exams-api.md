# API امتحانات المادة (Package Subject Exams)

## نظرة عامة

نظام امتحانات على مستوى المادة داخل الباقة. يمكن للأدمن والمدرس إنشاء امتحانات، والطلاب المشتركين في الباقة يمكنهم رؤية الامتحانات المرئية فقط.

---

## Authentication

جميع الطلبات تتطلب Bearer Token في Header:

```
Authorization: Bearer <token>
```

---

## APIs

### 1. جلب امتحانات المادة

**Endpoint:** `GET /api/package-subjects/:subjectId/exams`

**Description:** جلب جميع امتحانات المادة

**Roles:** `admin`, `teacher`, `student`

**Request:**
```http
GET /api/package-subjects/1/exams
Authorization: Bearer <token>
```

**Response (200 OK):**

**للطالب:**
```json
{
  "exams": [
    {
      "id": 1,
      "subject_id": 1,
      "name": "امتحان الوحدة الأولى",
      "duration": 60,
      "total_marks": 100,
      "question_count": 20,
      "is_visible": true,
      "created_at": "2024-01-15T10:00:00Z",
      "is_submitted": false,
      "score": null
    },
    {
      "id": 2,
      "subject_id": 1,
      "name": "امتحان الوحدة الثانية",
      "duration": 45,
      "total_marks": 50,
      "question_count": 15,
      "is_visible": true,
      "created_at": "2024-01-15T11:00:00Z",
      "is_submitted": true,
      "score": 85
    }
  ]
}
```

**للأدمن/المدرس:**
```json
{
  "exams": [
    {
      "id": 1,
      "subject_id": 1,
      "name": "امتحان الوحدة الأولى",
      "duration": 60,
      "total_marks": 100,
      "question_count": 20,
      "is_visible": true,
      "created_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": 2,
      "subject_id": 1,
      "name": "امتحان الوحدة الثانية",
      "duration": 45,
      "total_marks": 50,
      "question_count": 15,
      "is_visible": false,
      "created_at": "2024-01-15T11:00:00Z"
    }
  ]
}
```

**ملاحظات:**
- **للطالب**: يرى فقط الامتحانات المرئية (`is_visible = true`) مع حالة الإرسال (`is_submitted`) والدرجة (`score`)
- **للأدمن/المدرس**: يرى جميع الامتحانات (مرئية ومخفية)

---

### 2. إنشاء امتحان

**Endpoint:** `POST /api/package-subjects/:subjectId/exams`

**Description:** إنشاء امتحان جديد (مخفي افتراضياً)

**Roles:** `admin`, `teacher`

**Request:**
```http
POST /api/package-subjects/1/exams
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "امتحان الوحدة الأولى",
  "duration": 60,
  "total_marks": 100,
  "question_count": 20
}
```

**Request Body:**
```json
{
  "name": "امتحان الوحدة الأولى",  // required
  "duration": 60,                   // required - المدة بالدقائق
  "total_marks": 100,               // required - الدرجة الكلية
  "question_count": 20              // required - عدد الأسئلة
}
```

**Response (201 Created):**
```json
{
  "message": "تم إنشاء الامتحان بنجاح",
  "exam": {
    "id": 1,
    "subject_id": 1,
    "name": "امتحان الوحدة الأولى",
    "duration": 60,
    "total_marks": 100,
    "question_count": 20,
    "is_visible": false,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

**ملاحظات:**
- الامتحان يُنشأ **مخفي** افتراضياً (`is_visible = false`)
- يجب أن يكون المدرس لديه صلاحية على المادة

---

### 3. تحديث امتحان

**Endpoint:** `PUT /api/package-subjects/exams/:examId`

**Description:** تحديث بيانات الامتحان

**Roles:** `admin`, `teacher`

**Request:**
```http
PUT /api/package-subjects/exams/1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "امتحان الوحدة الأولى - محدث",
  "duration": 90,
  "total_marks": 120,
  "question_count": 25
}
```

**Request Body (جميع الحقول اختيارية):**
```json
{
  "name": "امتحان الوحدة الأولى - محدث",  // optional
  "duration": 90,                           // optional
  "total_marks": 120,                       // optional
  "question_count": 25                       // optional
}
```

**Response (200 OK):**
```json
{
  "message": "تم تحديث الامتحان",
  "exam": {
    "id": 1,
    "subject_id": 1,
    "name": "امتحان الوحدة الأولى - محدث",
    "duration": 90,
    "total_marks": 120,
    "question_count": 25,
    "is_visible": false,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 4. حذف امتحان

**Endpoint:** `DELETE /api/package-subjects/exams/:examId`

**Description:** حذف امتحان

**Roles:** `admin`, `teacher`

**Request:**
```http
DELETE /api/package-subjects/exams/1
Authorization: Bearer <admin_token>
```

**Response (200 OK):**
```json
{
  "message": "تم حذف الامتحان"
}
```

---

### 5. إظهار/إخفاء امتحان

**Endpoint:** `PUT /api/package-subjects/exams/:examId/visibility`

**Description:** تغيير حالة ظهور الامتحان للطلاب

**Roles:** `admin`, `teacher`

**Request:**
```http
PUT /api/package-subjects/exams/1/visibility
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "is_visible": true
}
```

**Request Body:**
```json
{
  "is_visible": true  // required - boolean
}
```

**Response (200 OK):**
```json
{
  "message": "تم تحديث حالة الظهور",
  "exam": {
    "id": 1,
    "subject_id": 1,
    "name": "امتحان الوحدة الأولى",
    "duration": 60,
    "total_marks": 100,
    "question_count": 20,
    "is_visible": true,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

---

## أمثلة على الاستخدام

### مثال 1: إنشاء امتحان وإظهاره

```javascript
// 1. إنشاء الامتحان
const createResponse = await fetch('/api/package-subjects/1/exams', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'امتحان الوحدة الأولى',
    duration: 60,
    total_marks: 100,
    question_count: 20
  })
});
const { exam } = await createResponse.json();

// 2. إظهار الامتحان للطلاب
const visibilityResponse = await fetch(`/api/package-subjects/exams/${exam.id}/visibility`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    is_visible: true
  })
});
```

### مثال 2: جلب امتحانات المادة (للطالب)

```javascript
const response = await fetch('/api/package-subjects/1/exams', {
  headers: {
    'Authorization': `Bearer ${studentToken}`
  }
});
const { exams } = await response.json();

exams.forEach(exam => {
  if (exam.is_submitted) {
    console.log(`${exam.name}: تم الإرسال - الدرجة: ${exam.score}`);
  } else {
    console.log(`${exam.name}: لم يتم الإرسال بعد`);
  }
});
```

### مثال 3: تحديث امتحان

```javascript
const response = await fetch('/api/package-subjects/exams/1', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    duration: 90,
    total_marks: 120
  })
});
const { exam } = await response.json();
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "جميع الحقول مطلوبة (الاسم، المدة، الدرجة، عدد الأسئلة)"
}
```

### 403 Forbidden
```json
{
  "error": "ليس لديك صلاحية لهذا المحتوى"
}
```

### 404 Not Found
```json
{
  "error": "المادة غير موجودة"
}
```

### 500 Internal Server Error
```json
{
  "error": "خطأ في جلب الامتحانات"
}
```

---

## ملاحظات مهمة

1. **الصلاحيات**:
   - الأدمن: يمكنه إنشاء/تعديل/حذف أي امتحان
   - المدرس: يمكنه إنشاء/تعديل/حذف امتحانات المواد التي لديه صلاحية عليها
   - الطالب: يرى فقط الامتحانات المرئية والمشترك في الباقة

2. **الرؤية**:
   - عند الإنشاء: الامتحان يكون **مخفي** افتراضياً (`is_visible = false`)
   - يجب استخدام API إظهار/إخفاء لجعل الامتحان مرئياً للطلاب

3. **حالة الإرسال**:
   - للطالب: يتم إرجاع `is_submitted` و `score` إذا كان قد أرسل الامتحان
   - للأدمن/المدرس: لا يتم إرجاع هذه المعلومات

4. **الترتيب**: الامتحانات مرتبة من الأحدث للأقدم

---

## Flow Chart

```
إنشاء امتحان
    ↓
is_visible = false (مخفي)
    ↓
إضافة الأسئلة (API منفصل)
    ↓
إظهار الامتحان (PUT /exams/:id/visibility)
    ↓
الطلاب يرون الامتحان
    ↓
الطلاب يؤدون الامتحان (API منفصل)
    ↓
is_submitted = true
```
