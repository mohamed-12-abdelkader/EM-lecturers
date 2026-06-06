# API ملفات المادة والدرس (Package Subject Files)

## نظرة عامة

نظام إدارة الملفات للمادة والدرس داخل الباقة. يمكن للأدمن والمدرس إضافة ملفات، والطلاب المشتركين في الباقة يمكنهم عرض الملفات.

---

## Authentication

جميع الطلبات تتطلب Bearer Token في Header:

```
Authorization: Bearer <token>
```

---

## APIs - ملفات المادة

### 1. جلب ملفات المادة

**Endpoint:** `GET /api/package-subjects/:subjectId/files`

**Description:** جلب جميع ملفات المادة

**Roles:** `admin`, `teacher`, `student`

**Request:**
```http
GET /api/package-subjects/1/files
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "files": [
    {
      "id": 1,
      "subject_id": 1,
      "name": "ملف الشرح",
      "file_url": "https://cloudinary.com/file.pdf",
      "file_size": 1024000,
      "file_type": "application/pdf",
      "order_index": 0,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### 2. إضافة ملف للمادة

**Endpoint:** `POST /api/package-subjects/:subjectId/files`

**Description:** إضافة ملف جديد للمادة (يمكن رفع ملف أو إرسال رابط)

**Roles:** `admin`, `teacher`

**Request (رفع ملف):**
```http
POST /api/package-subjects/1/files
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data

name: ملف الشرح
file: [binary file]
order_index: 0 (optional)
```

**Request (رابط ملف):**
```http
POST /api/package-subjects/1/files
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "ملف الشرح",
  "file_url": "https://example.com/file.pdf",
  "order_index": 0
}
```

**Request Body:**
- `name` (required) - اسم الملف
- `file` (optional) - الملف المرفوع (multipart/form-data)
- `file_url` (optional) - رابط الملف (إذا لم يتم رفع ملف)
- `order_index` (optional, default: 0) - ترتيب الملف

**Response (201 Created):**
```json
{
  "success": true,
  "file": {
    "id": 1,
    "subject_id": 1,
    "name": "ملف الشرح",
    "file_url": "https://cloudinary.com/file.pdf",
    "file_size": 1024000,
    "file_type": "application/pdf",
    "order_index": 0,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 3. تحديث ملف المادة

**Endpoint:** `PUT /api/package-subjects/files/:fileId`

**Description:** تحديث بيانات ملف المادة

**Roles:** `admin`, `teacher`

**Request:**
```http
PUT /api/package-subjects/files/1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "name": "ملف الشرح - محدث",
  "order_index": 1
}
```

**Request Body (جميع الحقول اختيارية):**
```json
{
  "name": "ملف الشرح - محدث",  // optional
  "file_url": "https://example.com/new-file.pdf",  // optional
  "order_index": 1  // optional
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "file": {
    "id": 1,
    "subject_id": 1,
    "name": "ملف الشرح - محدث",
    "file_url": "https://cloudinary.com/file.pdf",
    "file_size": 1024000,
    "file_type": "application/pdf",
    "order_index": 1,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:01:00Z"
  }
}
```

---

### 4. حذف ملف المادة

**Endpoint:** `DELETE /api/package-subjects/files/:fileId`

**Description:** حذف ملف من المادة

**Roles:** `admin`, `teacher`

**Request:**
```http
DELETE /api/package-subjects/files/1
Authorization: Bearer <admin_token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "تم حذف الملف بنجاح"
}
```

---

## APIs - ملفات الدرس

### 1. جلب ملفات الدرس

**Endpoint:** `GET /api/lessons/:lessonId/files`

**Description:** جلب جميع ملفات الدرس

**Roles:** `admin`, `teacher`, `student`

**Request:**
```http
GET /api/lessons/1/files
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "files": [
    {
      "id": 1,
      "lesson_id": 1,
      "title": "ملف الشرح",
      "file_url": "https://cloudinary.com/file.pdf",
      "order_index": 0,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

---

### 2. إضافة ملف للدرس

**Endpoint:** `POST /api/lessons/:lessonId/files`

**Description:** إضافة ملف جديد للدرس (يمكن رفع ملف أو إرسال رابط)

**Roles:** `admin`, `teacher`

**Request (رفع ملف):**
```http
POST /api/lessons/1/files
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data

title: ملف الشرح
file: [binary file]
order_index: 0 (optional)
```

**Request (رابط ملف):**
```http
POST /api/lessons/1/files
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "title": "ملف الشرح",
  "file_url": "https://example.com/file.pdf",
  "order_index": 0
}
```

**Request Body:**
- `title` (required) - عنوان الملف
- `file` (optional) - الملف المرفوع (multipart/form-data)
- `file_url` (optional) - رابط الملف (إذا لم يتم رفع ملف)
- `order_index` (optional, default: 0) - ترتيب الملف

**Response (201 Created):**
```json
{
  "success": true,
  "file": {
    "id": 1,
    "lesson_id": 1,
    "title": "ملف الشرح",
    "file_url": "https://cloudinary.com/file.pdf",
    "order_index": 0,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

---

### 3. تحديث ملف الدرس

**Endpoint:** `PUT /api/files/:fileId`

**Description:** تحديث بيانات ملف الدرس

**Roles:** `admin`, `teacher`

**Request:**
```http
PUT /api/files/1
Authorization: Bearer <admin_token>
Content-Type: application/json

{
  "title": "ملف الشرح - محدث",
  "order_index": 1
}
```

**Request Body (جميع الحقول اختيارية):**
```json
{
  "title": "ملف الشرح - محدث",  // optional
  "file_url": "https://example.com/new-file.pdf",  // optional
  "order_index": 1  // optional
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "file": {
    "id": 1,
    "lesson_id": 1,
    "title": "ملف الشرح - محدث",
    "file_url": "https://cloudinary.com/file.pdf",
    "order_index": 1,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:01:00Z"
  }
}
```

---

### 4. حذف ملف الدرس

**Endpoint:** `DELETE /api/files/:fileId`

**Description:** حذف ملف من الدرس

**Roles:** `admin`, `teacher`

**Request:**
```http
DELETE /api/files/1
Authorization: Bearer <admin_token>
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "تم حذف الملف بنجاح"
}
```

---

## أمثلة على الاستخدام

### مثال 1: إضافة ملف للمادة (رفع ملف)

```javascript
const formData = new FormData();
formData.append('name', 'ملف الشرح');
formData.append('file', fileInput.files[0]);
formData.append('order_index', '0');

const response = await fetch('/api/package-subjects/1/files', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`
  },
  body: formData
});
const { file } = await response.json();
```

### مثال 2: إضافة ملف للمادة (رابط)

```javascript
const response = await fetch('/api/package-subjects/1/files', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'ملف الشرح',
    file_url: 'https://example.com/file.pdf',
    order_index: 0
  })
});
const { file } = await response.json();
```

### مثال 3: جلب ملفات المادة

```javascript
const response = await fetch('/api/package-subjects/1/files', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
const { files } = await response.json();
```

### مثال 4: إضافة ملف للدرس

```javascript
const formData = new FormData();
formData.append('title', 'ملف الشرح');
formData.append('file', fileInput.files[0]);

const response = await fetch('/api/lessons/1/files', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`
  },
  body: formData
});
const { file } = await response.json();
```

### مثال 5: حذف ملف

```javascript
const response = await fetch('/api/package-subjects/files/1', {
  method: 'DELETE',
  headers: {
    'Authorization': `Bearer ${adminToken}`
  }
});
const { message } = await response.json();
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "يجب إرفاق ملف أو توفير رابط الملف"
}
```

### 403 Forbidden
```json
{
  "error": "ليس لديك صلاحية للوصول إلى هذه المادة"
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
  "error": "فشل في رفع الملف"
}
```

---

## ملاحظات مهمة

1. **الصلاحيات**:
   - الأدمن: يمكنه إضافة/تعديل/حذف أي ملف
   - المدرس: يمكنه إضافة/تعديل/حذف ملفات المواد التي لديه صلاحية عليها
   - الطالب: يرى فقط الملفات (لا يمكنه التعديل أو الحذف)

2. **رفع الملفات**:
   - يمكن رفع ملف مباشرة (multipart/form-data)
   - أو إرسال رابط ملف موجود (application/json)
   - الملفات المرفوعة يتم رفعها على Cloudinary تلقائياً

3. **الترتيب**: الملفات مرتبة حسب `order_index` ثم `created_at`

4. **حجم الملف**: الحد الأقصى 50MB

5. **أنواع الملفات**: جميع أنواع الملفات مسموحة

---

## Flow Chart

```
إضافة ملف
    ↓
رفع ملف أو رابط؟
    ├─ رفع ملف → رفع على Cloudinary → حفظ في قاعدة البيانات
    └─ رابط → حفظ مباشرة في قاعدة البيانات
    ↓
الطلاب يرون الملف
```
