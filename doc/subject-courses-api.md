# API الكورسات للمواد الدراسية

## نظرة عامة
APIs لإدارة الكورسات المرتبطة بالمواد الدراسية. تسمح للأدمن والمدرسين المصرح لهم بإنشاء وتعديل وحذف الكورسات للمواد التي لديهم صلاحيات عليها.

## الجداول في قاعدة البيانات
```sql
-- جدول الكورسات للمواد
CREATE TABLE subject_courses (
    id SERIAL PRIMARY KEY,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    image TEXT,
    price NUMERIC(10, 2) DEFAULT 0.00, -- 0.00 يعني مجاني
    duration_hours INTEGER DEFAULT 0,
    level VARCHAR(50) DEFAULT 'مبتدئ',
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

## أنواع الكورسات

| النوع | الوصف |
|-------|-------|
| **مجاني** | `price = 0.00` - كورس بدون مقابل |
| **مدفوع** | `price > 0.00` - كورس بمقابل مادي |

## حالات الكورس

| الحالة | الوصف |
|--------|-------|
| `draft` | مسودة (غير منشور) |
| `published` | منشور |
| `archived` | مؤرشف |

## مستويات الكورس

| المستوى | الوصف |
|---------|-------|
| `مبتدئ` | للمبتدئين |
| `متوسط` | للمستوى المتوسط |
| `متقدم` | للمستوى المتقدم |

---

## 1. إنشاء كورس جديد

### Endpoint
```
POST /api/subject-courses
```

### الوصف
إنشاء كورس جديد لمادة محددة (للأدمن والمدرسين المصرح لهم)

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `subject_id` | number | ✅ | معرف المادة |
| `title` | string | ✅ | عنوان الكورس |
| `description` | string | ❌ | وصف الكورس |
| `image` | file | ❌ | صورة الكورس |
| `price` | number | ❌ | سعر الكورس |
| `duration_hours` | number | ❌ | مدة الكورس بالساعات |
| `level` | string | ❌ | مستوى الكورس (مبتدئ، متوسط، متقدم) |
| `status` | string | ❌ | حالة الكورس (draft، published، archived) |

### مثال للطلب (كورس مجاني)
```bash
curl -X POST http://localhost:8000/api/subject-courses \
  -H "Authorization: Bearer <teacher_token>" \
  -F "subject_id=1" \
  -F "title=مقدمة في الجبر" \
  -F "description=كورس شامل في أساسيات الجبر" \
  -F "price=0.00" \
  -F "duration_hours=20" \
  -F "level=مبتدئ" \
  -F "status=draft" \
  -F "image=@/path/to/course-image.jpg"
```

### مثال للطلب (كورس مدفوع)
```bash
curl -X POST http://localhost:8000/api/subject-courses \
  -H "Authorization: Bearer <teacher_token>" \
  -F "subject_id=1" \
  -F "title=الجبر المتقدم" \
  -F "description=كورس متقدم في الجبر" \
  -F "price=100.00" \
  -F "duration_hours=30" \
  -F "level=متقدم" \
  -F "status=draft" \
  -F "image=@/path/to/course-image.jpg"
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء الكورس بنجاح",
  "course": {
    "id": 1,
    "subject_id": 1,
    "teacher_id": 2,
    "title": "مقدمة في الجبر",
    "description": "كورس شامل في أساسيات الجبر",
    "image": "/uploads/course-1234567890.jpg",
    "price": "0.00",
    "duration_hours": 20,
    "level": "مبتدئ",
    "status": "draft",
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 2. تحديث كورس

### Endpoint
```
PUT /api/subject-courses/:id
```

### الوصف
تحديث كورس موجود (لصاحب الكورس أو الأدمن)

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
Content-Type: multipart/form-data
```

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `title` | string | ❌ | عنوان الكورس |
| `description` | string | ❌ | وصف الكورس |
| `image` | file | ❌ | صورة الكورس |
| `price` | number | ❌ | سعر الكورس |
| `duration_hours` | number | ❌ | مدة الكورس بالساعات |
| `level` | string | ❌ | مستوى الكورس |
| `status` | string | ❌ | حالة الكورس |

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/subject-courses/1 \
  -H "Authorization: Bearer <teacher_token>" \
  -F "title=مقدمة في الجبر المحدثة" \
  -F "price=60.00" \
  -F "status=published"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تحديث الكورس بنجاح",
  "course": {
    "id": 1,
    "subject_id": 1,
    "teacher_id": 2,
    "title": "مقدمة في الجبر المحدثة",
    "description": "كورس شامل في أساسيات الجبر",
    "image": "/uploads/course-1234567890.jpg",
    "price": "60.00",
    "duration_hours": 20,
    "level": "مبتدئ",
    "status": "published",
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T13:00:00Z"
  }
}
```

---

## 3. حذف كورس

### Endpoint
```
DELETE /api/subject-courses/:id
```

### الوصف
حذف كورس (لصاحب الكورس أو الأدمن)

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/subject-courses/1 \
  -H "Authorization: Bearer <teacher_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم حذف الكورس بنجاح"
}
```

---

## 4. جلب كورس بواسطة ID

### Endpoint
```
GET /api/subject-courses/:id
```

### الوصف
جلب كورس محدد بواسطة ID

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subject-courses/1
```

### مثال للاستجابة (200 OK)
```json
{
  "course": {
    "id": 1,
    "subject_id": 1,
    "teacher_id": 2,
    "title": "مقدمة في الجبر",
    "description": "كورس شامل في أساسيات الجبر",
    "image": "/uploads/course-1234567890.jpg",
    "price": "60.00",
    "duration_hours": 20,
    "level": "مبتدئ",
    "status": "published",
    "created_at": "2024-01-01T12:00:00Z",
    "updated_at": "2024-01-01T13:00:00Z",
    "subject_name": "الرياضيات",
    "subject_description": "مادة الرياضيات والجبر والهندسة",
    "teacher_name": "أحمد محمد",
    "teacher_email": "ahmed@example.com"
  }
}
```

---

## 5. جلب كورسات مادة محددة

### Endpoint
```
GET /api/subject-courses/subject/:subjectId
```

### الوصف
جلب جميع الكورسات لمادة محددة

### Query Parameters
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `status` | string | فلترة حسب الحالة (draft، published، archived) |

### مثال للطلب
```bash
curl -X GET "http://localhost:8000/api/subject-courses/subject/1?status=published"
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 1,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "مقدمة في الجبر",
      "description": "كورس شامل في أساسيات الجبر",
      "image": "/uploads/course-1234567890.jpg",
      "price": "60.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T13:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com"
    }
  ]
}
```

---

## 6. جلب كورسات مدرس

### Endpoint
```
GET /api/subject-courses/teacher/:teacherId
```

### الوصف
جلب جميع الكورسات لمدرس محدد

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### Query Parameters
| المعامل | النوع | الوصف |
|---------|-------|-------|
| `status` | string | فلترة حسب الحالة |

### مثال للطلب
```bash
curl -X GET "http://localhost:8000/api/subject-courses/teacher/2?status=published" \
  -H "Authorization: Bearer <teacher_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 1,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "مقدمة في الجبر",
      "description": "كورس شامل في أساسيات الجبر",
      "image": "/uploads/course-1234567890.jpg",
      "price": "60.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T13:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة"
    }
  ]
}
```

---

## 7. جلب الكورسات المنشورة

### Endpoint
```
GET /api/subject-courses/published/all
```

### الوصف
جلب جميع الكورسات المنشورة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subject-courses/published/all
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 1,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "مقدمة في الجبر",
      "description": "كورس شامل في أساسيات الجبر",
      "image": "/uploads/course-1234567890.jpg",
      "price": "0.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T13:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com"
    }
  ]
}
```

---

## 7.1. جلب الكورسات المجانية

### Endpoint
```
GET /api/subject-courses/free/all
```

### الوصف
جلب جميع الكورسات المجانية المنشورة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subject-courses/free/all
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 1,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "مقدمة في الجبر",
      "description": "كورس شامل في أساسيات الجبر",
      "image": "/uploads/course-1234567890.jpg",
      "price": "0.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T13:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com"
    }
  ]
}
```

---

## 7.2. جلب الكورسات المدفوعة

### Endpoint
```
GET /api/subject-courses/paid/all
```

### الوصف
جلب جميع الكورسات المدفوعة المنشورة

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/subject-courses/paid/all
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 2,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "الجبر المتقدم",
      "description": "كورس متقدم في الجبر",
      "image": "/uploads/course-1234567891.jpg",
      "price": "100.00",
      "duration_hours": 30,
      "level": "متقدم",
      "status": "published",
      "created_at": "2024-01-01T14:00:00Z",
      "updated_at": "2024-01-01T14:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com"
    }
  ]
}
```

---

## 8. البحث في الكورسات

### Endpoint
```
GET /api/subject-courses/search
```

### الوصف
البحث في الكورسات مع فلاتر متعددة

### Query Parameters
| المعامل | النوع | مطلوب | الوصف |
|---------|-------|-------|-------|
| `q` | string | ✅ | مصطلح البحث |
| `subject_id` | number | ❌ | فلترة حسب المادة |
| `teacher_id` | number | ❌ | فلترة حسب المدرس |
| `level` | string | ❌ | فلترة حسب المستوى |
| `status` | string | ❌ | فلترة حسب الحالة |
| `min_price` | number | ❌ | الحد الأدنى للسعر |
| `max_price` | number | ❌ | الحد الأقصى للسعر |

### مثال للطلب
```bash
curl -X GET "http://localhost:8000/api/subject-courses/search?q=جبر&level=مبتدئ&min_price=50&max_price=100"
```

### مثال للاستجابة (200 OK)
```json
{
  "courses": [
    {
      "id": 1,
      "subject_id": 1,
      "teacher_id": 2,
      "title": "مقدمة في الجبر",
      "description": "كورس شامل في أساسيات الجبر",
      "image": "/uploads/course-1234567890.jpg",
      "price": "60.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T13:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com"
    }
  ]
}
```

---

## 9. جلب إحصائيات الكورسات

### Endpoint
```
GET /api/subject-courses/stats/:teacherId?
```

### الوصف
جلب إحصائيات الكورسات (لجميع الكورسات أو لمدرس محدد)

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### مثال للطلب
```bash
# إحصائيات جميع الكورسات (للأدمن)
curl -X GET http://localhost:8000/api/subject-courses/stats \
  -H "Authorization: Bearer <admin_token>"

# إحصائيات مدرس محدد
curl -X GET http://localhost:8000/api/subject-courses/stats/2 \
  -H "Authorization: Bearer <teacher_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "stats": {
    "total_courses": 10,
    "published_courses": 7,
    "draft_courses": 2,
    "archived_courses": 1,
    "average_price": "75.50",
    "total_duration": 150
  }
}
```

---

## أمثلة على الاستخدام

### JavaScript (Fetch API)

#### إنشاء كورس مجاني
```javascript
const formData = new FormData();
formData.append('subject_id', '1');
formData.append('title', 'مقدمة في الجبر');
formData.append('description', 'كورس شامل في أساسيات الجبر');
formData.append('price', '0.00'); // مجاني
formData.append('duration_hours', '20');
formData.append('level', 'مبتدئ');
formData.append('status', 'draft');
formData.append('image', imageFile);

const response = await fetch('/api/subject-courses', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

#### إنشاء كورس مدفوع
```javascript
const formData = new FormData();
formData.append('subject_id', '1');
formData.append('title', 'الجبر المتقدم');
formData.append('description', 'كورس متقدم في الجبر');
formData.append('price', '100.00'); // مدفوع
formData.append('duration_hours', '30');
formData.append('level', 'متقدم');
formData.append('status', 'draft');
formData.append('image', imageFile);

const response = await fetch('/api/subject-courses', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

#### جلب كورسات مادة
```javascript
const response = await fetch('/api/subject-courses/subject/1?status=published');
const result = await response.json();
console.log(result.courses);
```

#### جلب الكورسات المجانية
```javascript
const response = await fetch('/api/subject-courses/free/all');
const result = await response.json();
console.log(result.courses);
```

#### جلب الكورسات المدفوعة
```javascript
const response = await fetch('/api/subject-courses/paid/all');
const result = await response.json();
console.log(result.courses);
```

#### البحث في الكورسات
```javascript
const response = await fetch('/api/subject-courses/search?q=جبر&level=مبتدئ&min_price=50');
const result = await response.json();
console.log(result.courses);
```

---

## ملاحظات مهمة

1. **الصلاحيات**: المدرسين يحتاجون صلاحية `can_create_content` على المادة لإنشاء كورس
2. **الملكية**: المدرسين يمكنهم تعديل وحذف كورساتهم فقط
3. **الأدمن**: لديه صلاحيات كاملة على جميع الكورسات
4. **الصور**: اختيارية، الحد الأقصى 5 ميجابايت
5. **الحالات**: draft (مسودة)، published (منشور)، archived (مؤرشف)
6. **المستويات**: مبتدئ، متوسط، متقدم
7. **البحث**: يدعم البحث في العنوان والوصف واسم المادة
8. **الفلترة**: متعددة المعايير (المادة، المدرس، المستوى، الحالة، السعر)
9. **الكورسات المجانية**: 
    - `price = 0.00` يعني كورس مجاني
    - `price > 0.00` يعني كورس مدفوع
    - القيمة الافتراضية هي 0.00 (مجاني)
10. **Endpoints خاصة**: 
    - `/free/all` لجلب الكورسات المجانية فقط
    - `/paid/all` لجلب الكورسات المدفوعة فقط 