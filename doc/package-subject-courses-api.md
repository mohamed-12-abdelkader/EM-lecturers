# API الكورسات في المواد الدراسية للباقات

## نظرة عامة
APIs لإدارة الكورسات المرتبطة بالمواد الدراسية داخل الباقات. تسمح للأدمن والمدرسين المصرح لهم بإنشاء وتعديل وحذف الكورسات للمواد التي لديهم صلاحيات عليها. الكورسات لها نفس خصائص الكورسات العادية في النظام، لكنها مرتبطة بالمواد الدراسية بدلاً من الصفوف الدراسية.

## الجداول في قاعدة البيانات
```sql
-- جدول الكورسات في المواد الدراسية
CREATE TABLE package_subject_item_courses (
    id SERIAL PRIMARY KEY,
    package_subject_item_id INTEGER NOT NULL REFERENCES package_subject_items(id) ON DELETE CASCADE,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    avatar TEXT,
    is_visible BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_package_subject_item_courses_subject ON package_subject_item_courses(package_subject_item_id);
CREATE INDEX idx_package_subject_item_courses_teacher ON package_subject_item_courses(teacher_id);
CREATE INDEX idx_package_subject_item_courses_visible ON package_subject_item_courses(is_visible);
```

## نظام الصلاحيات

| الدور | الصلاحيات |
|-------|-----------|
| **Admin** | يمكنه إضافة/تعديل/حذف أي كورس في أي مادة |
| **Teacher** | يمكنه إضافة/تعديل/حذف الكورسات فقط في المواد التي لديه صلاحية عليها |
| **Student** | يمكنه عرض الكورسات المرئية فقط إذا كان مشترك في الباقة |

---

## 1. إضافة كورس جديد لمادة دراسية

### Endpoint
```
POST /api/packages/subjects/:id/courses
```

### الوصف
إضافة كورس جديد لمادة دراسية معينة داخل باقة. (للأدمن والمدرسين المصرح لهم)

### Permissions
- **Admin:** ✅ يمكنه إضافة كورسات لأي مادة
- **Teacher:** ✅ يمكنه إضافة كورسات فقط للمواد التي لديه صلاحية عليها
- **Student:** ❌ غير مسموح

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
Content-Type: multipart/form-data
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية (package_subject_item_id) |

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `title` | string | ✅ | عنوان الكورس |
| `description` | string | ❌ | وصف الكورس |
| `price` | number | ❌ | سعر الكورس (افتراضي: 0.00) |
| `avatar` | file | ❌ | صورة الكورس (JPG, PNG, etc.) |
| `is_visible` | boolean | ❌ | هل الكورس مرئي (افتراضي: true) |

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/packages/subjects/1/courses \
  -H "Authorization: Bearer <admin_token>" \
  -F "title=كورس الرياضيات المتقدمة" \
  -F "description=كورس شامل في الرياضيات المتقدمة" \
  -F "price=199.99" \
  -F "is_visible=true" \
  -F "avatar=@/path/to/image.jpg"
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم إنشاء الكورس بنجاح",
  "course": {
    "id": 1,
    "package_subject_item_id": 1,
    "teacher_id": 5,
    "title": "كورس الرياضيات المتقدمة",
    "description": "كورس شامل في الرياضيات المتقدمة",
    "price": "199.99",
    "avatar": "https://cloudinary.com/course-avatar.jpg",
    "is_visible": true,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

### مثال للاستجابة (400 Bad Request) - عنوان مطلوب
```json
{
  "error": "عنوان الكورس مطلوب"
}
```

### مثال للاستجابة (403 Forbidden) - المدرس بدون صلاحية
```json
{
  "error": "ليس لديك صلاحية لإضافة كورسات لهذه المادة"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "المادة الدراسية غير موجودة"
}
```

---

## 2. عرض كورسات مادة دراسية

### Endpoint
```
GET /api/packages/subjects/:id/courses
```

### الوصف
عرض جميع الكورسات المرتبطة بمادة دراسية معينة. يعتمد ما يتم عرضه على صلاحيات المستخدم.

### Permissions
- **Admin:** يرى كل الكورسات (حتى المخفية)
- **Teacher:** يرى كل الكورسات إذا كان لديه صلاحية على المادة
- **Student:** يرى فقط الكورسات المرئية إذا كان مشترك في الباقة

### Headers
```
Authorization: Bearer <token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | ✅ | معرف المادة الدراسية |

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/packages/subjects/1/courses \
  -H "Authorization: Bearer <token>"
```

### مثال للاستجابة (200 OK) - Admin/Teacher
```json
{
  "subject_id": 1,
  "subject_name": "الرياضيات المتقدمة",
  "courses": [
    {
      "id": 1,
      "package_subject_item_id": 1,
      "teacher_id": 5,
      "title": "كورس الرياضيات المتقدمة",
      "description": "كورس شامل في الرياضيات المتقدمة",
      "price": "199.99",
      "avatar": "https://cloudinary.com/course-avatar.jpg",
      "is_visible": true,
      "created_at": "2024-01-15T10:00:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_avatar": "https://cloudinary.com/teacher-avatar.jpg"
    },
    {
      "id": 2,
      "package_subject_item_id": 1,
      "teacher_id": 5,
      "title": "كورس الجبر الخطي",
      "description": "مقدمة في الجبر الخطي",
      "price": "149.99",
      "avatar": null,
      "is_visible": false,
      "created_at": "2024-01-16T14:30:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_avatar": "https://cloudinary.com/teacher-avatar.jpg"
    }
  ],
  "total": 2
}
```

### مثال للاستجابة (200 OK) - Student
```json
{
  "subject_id": 1,
  "subject_name": "الرياضيات المتقدمة",
  "courses": [
    {
      "id": 1,
      "package_subject_item_id": 1,
      "teacher_id": 5,
      "title": "كورس الرياضيات المتقدمة",
      "description": "كورس شامل في الرياضيات المتقدمة",
      "price": "199.99",
      "avatar": "https://cloudinary.com/course-avatar.jpg",
      "is_visible": true,
      "created_at": "2024-01-15T10:00:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_avatar": "https://cloudinary.com/teacher-avatar.jpg"
    }
  ],
  "total": 1
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
  "error": "المادة الدراسية غير موجودة"
}
```

---

## 3. عرض كورس محدد

### Endpoint
```
GET /api/packages/subjects/:subjectId/courses/:courseId
```

### الوصف
عرض تفاصيل كورس محدد في مادة دراسية معينة.

### Permissions
- **Admin:** يمكنه رؤية أي كورس
- **Teacher:** يمكنه رؤية الكورس إذا كان لديه صلاحية على المادة أو إذا كان صاحب الكورس
- **Student:** يمكنه رؤية الكورس فقط إذا كان مشترك في الباقة والكورس مرئي

### Headers
```
Authorization: Bearer <token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `subjectId` | number | ✅ | معرف المادة الدراسية |
| `courseId` | number | ✅ | معرف الكورس |

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/packages/subjects/1/courses/1 \
  -H "Authorization: Bearer <token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "course": {
    "id": 1,
    "package_subject_item_id": 1,
    "teacher_id": 5,
    "title": "كورس الرياضيات المتقدمة",
    "description": "كورس شامل في الرياضيات المتقدمة",
    "price": "199.99",
    "avatar": "https://cloudinary.com/course-avatar.jpg",
    "is_visible": true,
    "created_at": "2024-01-15T10:00:00Z",
    "subject_id": 1,
    "subject_name": "الرياضيات المتقدمة",
    "subject_image": "https://cloudinary.com/subject-image.jpg",
    "package_id": 1,
    "package_name": "باقة الرياضيات الشاملة",
    "teacher_name": "أحمد محمد",
    "teacher_avatar": "https://cloudinary.com/teacher-avatar.jpg"
  }
}
```

### مثال للاستجابة (400 Bad Request) - الكورس لا يخص المادة
```json
{
  "error": "الكورس لا يخص هذه المادة"
}
```

### مثال للاستجابة (403 Forbidden)
```json
{
  "error": "ليس لديك صلاحية للوصول إلى هذا الكورس"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "الكورس غير موجود"
}
```

---

## 4. تعديل كورس

### Endpoint
```
PUT /api/packages/subjects/:subjectId/courses/:courseId
```

### الوصف
تعديل كورس موجود في مادة دراسية. (للأدمن والمدرسين المصرح لهم)

### Permissions
- **Admin:** يمكنه تعديل أي كورس
- **Teacher:** يمكنه تعديل الكورس إذا كان لديه صلاحية على المادة أو إذا كان صاحب الكورس
- **Student:** ❌ غير مسموح

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
Content-Type: multipart/form-data
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `subjectId` | number | ✅ | معرف المادة الدراسية |
| `courseId` | number | ✅ | معرف الكورس |

### Body (Form Data)
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `title` | string | ❌ | عنوان الكورس |
| `description` | string | ❌ | وصف الكورس |
| `price` | number | ❌ | سعر الكورس |
| `avatar` | file | ❌ | صورة الكورس الجديدة |
| `is_visible` | boolean | ❌ | هل الكورس مرئي |

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/packages/subjects/1/courses/1 \
  -H "Authorization: Bearer <admin_token>" \
  -F "title=كورس الرياضيات المتقدمة - محدث" \
  -F "description=وصف محدث للكورس" \
  -F "price=249.99" \
  -F "is_visible=true" \
  -F "avatar=@/path/to/new-image.jpg"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تحديث الكورس بنجاح",
  "course": {
    "id": 1,
    "package_subject_item_id": 1,
    "teacher_id": 5,
    "title": "كورس الرياضيات المتقدمة - محدث",
    "description": "وصف محدث للكورس",
    "price": "249.99",
    "avatar": "https://cloudinary.com/new-course-avatar.jpg",
    "is_visible": true,
    "created_at": "2024-01-15T10:00:00Z"
  }
}
```

### مثال للاستجابة (400 Bad Request)
```json
{
  "error": "Invalid subject id or course id"
}
```

### مثال للاستجابة (400 Bad Request) - الكورس لا يخص المادة
```json
{
  "error": "الكورس لا يخص هذه المادة"
}
```

### مثال للاستجابة (403 Forbidden) - المدرس بدون صلاحية
```json
{
  "error": "ليس لديك صلاحية لتعديل هذا الكورس"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "الكورس غير موجود"
}
```

---

## 5. حذف كورس

### Endpoint
```
DELETE /api/packages/subjects/:subjectId/courses/:courseId
```

### الوصف
حذف كورس من مادة دراسية. (للأدمن والمدرسين المصرح لهم)

### Permissions
- **Admin:** يمكنه حذف أي كورس
- **Teacher:** يمكنه حذف الكورس إذا كان لديه صلاحية على المادة أو إذا كان صاحب الكورس
- **Student:** ❌ غير مسموح

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### Path Parameters
| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `subjectId` | number | ✅ | معرف المادة الدراسية |
| `courseId` | number | ✅ | معرف الكورس |

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/packages/subjects/1/courses/1 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم حذف الكورس بنجاح"
}
```

### مثال للاستجابة (400 Bad Request)
```json
{
  "error": "Invalid subject id or course id"
}
```

### مثال للاستجابة (400 Bad Request) - الكورس لا يخص المادة
```json
{
  "error": "الكورس لا يخص هذه المادة"
}
```

### مثال للاستجابة (403 Forbidden) - المدرس بدون صلاحية
```json
{
  "error": "ليس لديك صلاحية لحذف هذا الكورس"
}
```

### مثال للاستجابة (404 Not Found)
```json
{
  "error": "الكورس غير موجود"
}
```

---

## ملاحظات مهمة

### الفرق بين الكورسات العادية وكورسات المواد الدراسية

| الخاصية | الكورسات العادية | كورسات المواد الدراسية |
|---------|------------------|----------------------|
| **الربط** | مرتبطة بـ `grade_id` | مرتبطة بـ `package_subject_item_id` |
| **الجدول** | `courses` | `package_subject_item_courses` |
| **الوصول** | حسب الصف الدراسي | حسب تفعيل الباقة والصلاحيات |

### الخصائص المشتركة
- ✅ نفس الحقول: `title`, `description`, `price`, `avatar`, `is_visible`, `teacher_id`
- ✅ نفس نظام الصلاحيات للمدرسين
- ✅ نفس نظام العرض للطلاب

### نظام الصلاحيات للمدرسين
- المدرس يحتاج إلى صلاحية صريحة من الأدمن على المادة الدراسية
- يمكن للأدمن منح الصلاحية من خلال: `POST /api/packages/subjects/:id/permissions`
- يمكن للأدمن إزالة الصلاحية من خلال: `DELETE /api/packages/subjects/:id/permissions/:teacherId`

### للطلاب
- يجب أن يكون الطالب مشترك في الباقة (مفعل الباقة) لعرض الكورسات
- الطالب يرى فقط الكورسات المرئية (`is_visible = true`)
- الكورسات المخفية لا تظهر للطلاب حتى لو كانوا مشتركين في الباقة

---

## أمثلة استخدام

### إنشاء كورس جديد (Admin)
```javascript
const formData = new FormData();
formData.append('title', 'كورس الرياضيات المتقدمة');
formData.append('description', 'كورس شامل في الرياضيات');
formData.append('price', '199.99');
formData.append('is_visible', 'true');
formData.append('avatar', fileInput.files[0]);

fetch('/api/packages/subjects/1/courses', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  },
  body: formData
})
.then(response => response.json())
.then(data => {
  console.log('تم إنشاء الكورس:', data.course);
});
```

### عرض كورسات مادة (Student)
```javascript
fetch('/api/packages/subjects/1/courses', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer ' + studentToken
  }
})
.then(response => response.json())
.then(data => {
  console.log('عدد الكورسات:', data.total);
  console.log('الكورسات:', data.courses);
});
```

### تعديل كورس (Teacher)
```javascript
const formData = new FormData();
formData.append('title', 'عنوان محدث');
formData.append('price', '249.99');

fetch('/api/packages/subjects/1/courses/1', {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  },
  body: formData
})
.then(response => response.json())
.then(data => {
  console.log('تم التحديث:', data.message);
  console.log('الكورس المحدث:', data.course);
});
```

### حذف كورس (Admin)
```javascript
fetch('/api/packages/subjects/1/courses/1', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer ' + adminToken
  }
})
.then(response => response.json())
.then(data => {
  console.log('تم الحذف:', data.message);
});
```

---

## رموز الحالة HTTP

| الكود | الوصف |
|-------|-------|
| `200` | نجح الطلب |
| `201` | تم إنشاء الكورس بنجاح |
| `400` | بيانات غير صحيحة |
| `403` | ليس لديك صلاحية |
| `404` | الكورس أو المادة غير موجودة |
| `500` | خطأ في الخادم |

---

## الأخطاء الشائعة

### 1. المدرس يحاول إضافة كورس بدون صلاحية
```json
{
  "error": "ليس لديك صلاحية لإضافة كورسات لهذه المادة"
}
```
**الحل:** يجب أن يحصل المدرس على صلاحية من الأدمن أولاً.

### 2. الطالب يحاول عرض كورسات بدون تفعيل الباقة
```json
{
  "error": "يجب تفعيل الباقة أولاً للوصول إلى هذه المادة"
}
```
**الحل:** يجب أن يقوم الطالب بتفعيل الباقة أولاً باستخدام كود التفعيل.

### 3. الكورس لا يخص المادة المحددة
```json
{
  "error": "الكورس لا يخص هذه المادة"
}
```
**الحل:** تأكد من أن `courseId` و `subjectId` متطابقان.

