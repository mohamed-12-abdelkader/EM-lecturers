# API المواد الدراسية

## نظرة عامة
APIs لإدارة المواد الدراسية وربطها بالباقات. تسمح للأدمن بإنشاء وتعديل وحذف المواد، وربطها بالباقات الدراسية.

## الجداول في قاعدة البيانات
```sql
-- جدول المواد
CREATE TABLE subjects (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    image TEXT,
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

## 1. جلب جميع المواد

### Endpoint
```
GET /api/subjects
```

### الوصف
جلب جميع المواد الدراسية المتاحة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subjects
```

### مثال للاستجابة (200 OK)
```json
{
  "subjects": [
    {
      "id": 1,
      "name": "الرياضيات",
      "description": "مادة الرياضيات والجبر والهندسة",
      "created_at": "2024-01-01T12:00:00Z"
    },
    {
      "id": 2,
      "name": "الفيزياء",
      "description": "مادة الفيزياء والميكانيكا",
      "created_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

---

## 2. إنشاء مادة جديدة

### Endpoint
```
POST /api/subjects
```

### الوصف
إنشاء مادة دراسية جديدة مع صورة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `name` | string | ✅ | اسم المادة (مطلوب) |
| `description` | string | ❌ | وصف المادة |
| `image` | file | ❌ | صورة المادة (JPG, PNG, etc.) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/subjects \
  -H "Authorization: Bearer <admin_token>" \
  -F "name=اللغة الفرنسية" \
  -F "description=مادة اللغة الفرنسية والقواعد" \
  -F "image=@/path/to/image.jpg"
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء المادة بنجاح",
  "subject": {
    "id": 11,
    "name": "اللغة الفرنسية",
    "description": "مادة اللغة الفرنسية والقواعد",
    "image": "/uploads/subject-1234567890.jpg",
    "created_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 3. ربط مواد بباقة

### Endpoint
```
POST /api/subjects/package/:packageId
```

### الوصف
ربط مواد دراسية بباقة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Body
```json
{
  "subject_ids": [1, 2, 3]
}
```

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [1, 2, 3]
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم ربط المواد بالباقة بنجاح"
}
```

---

## 4. جلب مواد باقة محددة

### Endpoint
```
GET /api/subjects/package/:packageId
```

### الوصف
جلب جميع المواد المرتبطة بباقة محددة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subjects/package/1
```

### مثال للاستجابة (200 OK)
```json
{
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
  ]
}
```

---

## 5. تحديث مواد الباقة (استبدال كامل)

### Endpoint
```
PUT /api/subjects/package/:packageId
```

### الوصف
تحديث مواد الباقة (حذف القديم وإضافة الجديد) (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Body
```json
{
  "subject_ids": [1, 4, 5]
}
```

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [1, 4, 5]
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تحديث مواد الباقة بنجاح"
}
```

---

## 6. إزالة مواد من باقة

### Endpoint
```
DELETE /api/subjects/package/:packageId
```

### الوصف
إزالة مواد محددة من باقة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Body
```json
{
  "subject_ids": [2, 3]
}
```

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/subjects/package/1 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "subject_ids": [2, 3]
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم إزالة المواد من الباقة بنجاح"
}
```

---

## 7. جلب الباقات حسب المادة

### Endpoint
```
GET /api/subjects/:id/packages
```

### الوصف
جلب جميع الباقات التي تحتوي على مادة محددة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subjects/1/packages
```

### مثال للاستجابة (200 OK)
```json
{
  "packages": [
    {
      "id": 1,
      "name": "باقة الرياضيات الشاملة",
      "image": "/uploads/package-1234567890.jpg",
      "price": "299.99",
      "grade_id": 1,
      "grade_name": "الصف الأول الإعدادي",
      "created_at": "2024-01-01T12:00:00Z"
    }
  ]
}
```

---

## أمثلة على الاستخدام

### إنشاء باقة مع مواد
```javascript
// 1. إنشاء الباقة
const packageFormData = new FormData();
packageFormData.append('name', 'باقة العلوم الشاملة');
packageFormData.append('price', '399.99');
packageFormData.append('grade_id', '1');
packageFormData.append('image', fileInput.files[0]);

const packageResponse = await fetch('/api/packages', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: packageFormData
});

const packageData = await packageResponse.json();
const packageId = packageData.package.id;

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

console.log('تم ربط المواد بالباقة:', await subjectsResponse.json());
```

### جلب باقة مع موادها
```javascript
fetch('/api/packages/1')
.then(response => response.json())
.then(data => {
  console.log('الباقة:', data.package);
  console.log('المواد:', data.package.subjects);
});
```

### جلب جميع الباقات مع موادها
```javascript
fetch('/api/packages')
.then(response => response.json())
.then(data => {
  data.packages.forEach(pkg => {
    console.log(`الباقة: ${pkg.name}`);
    console.log(`المواد: ${pkg.subjects.map(s => s.name).join(', ')}`);
  });
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