# API مواد الباقات الدراسية

## نظرة عامة
APIs لإدارة مواد الباقات الدراسية. تسمح للأدمن بإنشاء وتعديل وحذف مواد مخصصة لكل باقة مع صور.

## الجداول في قاعدة البيانات
```sql
-- جدول مواد الباقات (مواد مخصصة لكل باقة)
CREATE TABLE package_subject_items (
    id SERIAL PRIMARY KEY,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    image TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 1. جلب جميع مواد الباقة

### Endpoint
```
GET /api/package-subjects/package/:packageId
```

### الوصف
جلب جميع المواد المخصصة لباقة محددة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/package-subjects/package/1
```

### مثال للاستجابة (200 OK)
```json
{
  "items": [
    {
      "id": 1,
      "package_id": 1,
      "name": "الرياضيات المتقدمة",
      "image": "/uploads/package-subject-1234567890.jpg",
      "created_at": "2024-01-01T12:00:00Z"
    },
    {
      "id": 2,
      "package_id": 1,
      "name": "الفيزياء العملية",
      "image": "/uploads/package-subject-1234567891.jpg",
      "created_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

---

## 2. جلب مادة باقة محددة

### Endpoint
```
GET /api/package-subjects/:id
```

### الوصف
جلب مادة باقة محددة بواسطة ID

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/package-subjects/1
```

### مثال للاستجابة (200 OK)
```json
{
  "item": {
    "id": 1,
    "package_id": 1,
    "name": "الرياضيات المتقدمة",
    "image": "/uploads/package-subject-1234567890.jpg",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 3. إنشاء مادة باقة جديدة

### Endpoint
```
POST /api/package-subjects/package/:packageId
```

### الوصف
إنشاء مادة مخصصة جديدة لباقة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | string | ✅ | اسم المادة (مطلوب) |
| `image` | file | ❌ | صورة المادة (JPG, PNG, etc.) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/package-subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=الرياضيات المتقدمة" \
  -F "image=@/path/to/math-image.jpg"
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء مادة الباقة بنجاح",
  "item": {
    "id": 1,
    "package_id": 1,
    "name": "الرياضيات المتقدمة",
    "image": "/uploads/package-subject-1234567890.jpg",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 4. تحديث مادة باقة

### Endpoint
```
PUT /api/package-subjects/:id
```

### الوصف
تحديث مادة باقة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | string | ❌ | اسم المادة (إذا لم يتم إرساله، سيتم الاحتفاظ بالاسم الحالي) |
| `image` | file | ❌ | صورة المادة (JPG, PNG, etc.) - إذا لم يتم إرسالها، سيتم الاحتفاظ بالصورة الحالية |

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/package-subjects/1 \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=الرياضيات المتقدمة المحدثة" \
  -F "image=@/path/to/new-math-image.jpg"
```

### مثال للاستجابة (200 OK)
```json
{
  "success": true,
  "message": "تم تحديث مادة الباقة بنجاح",
  "item": {
    "id": 1,
    "package_id": 1,
    "name": "الرياضيات المتقدمة المحدثة",
    "image": "https://cloudinary.com/image.jpg",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

### Response (404 Not Found)
```json
{
  "error": "المادة غير موجودة"
}
```

---

## 5. حذف مادة باقة

### Endpoint
```
DELETE /api/package-subjects/:id
```

### الوصف
حذف مادة باقة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
```

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/package-subjects/1 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "success": true,
  "message": "تم حذف مادة الباقة بنجاح",
  "deleted_item": {
    "id": 1,
    "name": "الرياضيات المتقدمة"
  }
}
```

### Response (404 Not Found)
```json
{
  "success": false,
  "error": "المادة غير موجودة"
}
```

---

## أمثلة على الاستخدام

### JavaScript (Fetch API)

#### إنشاء مادة باقة جديدة
```javascript
const formData = new FormData();
formData.append('name', 'الرياضيات المتقدمة');
formData.append('image', imageFile); // ملف الصورة

const response = await fetch('/api/package-subjects/package/1', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

#### جلب مواد باقة محددة
```javascript
const response = await fetch('/api/package-subjects/package/1');
const result = await response.json();
console.log(result.items);
```

#### تحديث مادة باقة
```javascript
const formData = new FormData();
formData.append('name', 'الرياضيات المتقدمة المحدثة');
formData.append('image', newImageFile);

const response = await fetch('/api/package-subjects/1', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

#### حذف مادة باقة
```javascript
const response = await fetch('/api/package-subjects/1', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  }
});

const result = await response.json();
console.log(result);
```

---

## ملاحظات مهمة

1. **الصلاحيات**: جميع عمليات التعديل (إنشاء، تحديث، حذف) تتطلب صلاحيات أدمن فقط
2. **الصور**: 
   - الصور اختيارية، يمكن إنشاء مادة بدون صورة
   - عند التحديث: إذا لم يتم إرسال صورة جديدة، سيتم الاحتفاظ بالصورة الحالية
   - الصور يتم رفعها على Cloudinary
3. **حجم الصور**: الحد الأقصى لحجم الصورة هو 5 ميجابايت
4. **أنواع الصور**: يدعم JPG, PNG, GIF, WebP
5. **التحديث**: 
   - جميع الحقول في التحديث اختيارية
   - إذا لم يتم إرسال `name`، سيتم الاحتفاظ بالاسم الحالي
   - إذا لم يتم إرسال `image`، سيتم الاحتفاظ بالصورة الحالية
6. **الحذف**: عند حذف المادة، يتم حذفها من قاعدة البيانات (الصور محفوظة على Cloudinary)
7. **الربط**: كل مادة مرتبطة بباقة محددة ولا يمكن نقلها لباقة أخرى 