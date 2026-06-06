# API صلاحيات المدرسين على المواد

## نظرة عامة
APIs لإدارة صلاحيات المدرسين على المواد الدراسية. تسمح للأدمن بمنح وإزالة وتحديث صلاحيات المدرسين على المواد المختلفة.

## الجداول في قاعدة البيانات
```sql
-- جدول صلاحيات المدرسين على المواد
CREATE TABLE teacher_subjects (
    id SERIAL PRIMARY KEY,
    teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    can_edit BOOLEAN DEFAULT FALSE,
    can_delete BOOLEAN DEFAULT FALSE,
    can_create_content BOOLEAN DEFAULT TRUE,
    can_view BOOLEAN DEFAULT TRUE,
    assigned_by INTEGER REFERENCES users(id),
    assigned_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(teacher_id, subject_id)
);
```

## أنواع الصلاحيات

| الصلاحية | الوصف |
|----------|-------|
| `can_view` | يمكن للمدرس رؤية المادة |
| `can_create_content` | يمكن للمدرس إنشاء محتوى للمادة |
| `can_edit` | يمكن للمدرس تعديل المادة |
| `can_delete` | يمكن للمدرس حذف المادة |

---

## 1. منح صلاحيات لمدرس على مادة

### Endpoint
```
POST /api/teacher-subjects/assign
```

### الوصف
منح صلاحيات لمدرس على مادة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Body
```json
{
  "teacher_id": 1,
  "subject_id": 2,
  "permissions": {
    "can_edit": true,
    "can_delete": false,
    "can_create_content": true,
    "can_view": true
  }
}
```

### مثال للطلب
```bash
curl -X POST http://localhost:8000/api/teacher-subjects/assign \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "teacher_id": 1,
    "subject_id": 2,
    "permissions": {
      "can_edit": true,
      "can_delete": false,
      "can_create_content": true,
      "can_view": true
    }
  }'
```

### مثال للاستجابة (201 Created)
```json
{
  "message": "تم منح الصلاحيات بنجاح",
  "assignment": {
    "id": 1,
    "teacher_id": 1,
    "subject_id": 2,
    "can_edit": true,
    "can_delete": false,
    "can_create_content": true,
    "can_view": true,
    "assigned_by": 1,
    "assigned_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 2. إزالة صلاحيات مدرس من مادة

### Endpoint
```
DELETE /api/teacher-subjects/remove/:teacherId/:subjectId
```

### الوصف
إزالة صلاحيات مدرس من مادة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
```

### مثال للطلب
```bash
curl -X DELETE http://localhost:8000/api/teacher-subjects/remove/1/2 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم إزالة الصلاحيات بنجاح"
}
```

---

## 3. جلب جميع المواد المخصصة لمدرس

### Endpoint
```
GET /api/teacher-subjects/teacher/:teacherId
```

### الوصف
جلب جميع المواد المخصصة لمدرس مع صلاحياته

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/teacher-subjects/teacher/1 \
  -H "Authorization: Bearer <token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "subjects": [
    {
      "id": 1,
      "teacher_id": 1,
      "subject_id": 2,
      "can_edit": true,
      "can_delete": false,
      "can_create_content": true,
      "can_view": true,
      "assigned_by": 1,
      "assigned_at": "2024-01-01T12:00:00Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات والجبر والهندسة",
      "subject_image": "/uploads/subject-1234567890.jpg",
      "assigned_by_name": "أحمد محمد"
    }
  ]
}
```

---

## 4. جلب جميع المدرسين المخصصين لمادة

### Endpoint
```
GET /api/teacher-subjects/subject/:subjectId
```

### الوصف
جلب جميع المدرسين المخصصين لمادة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/teacher-subjects/subject/2 \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "teachers": [
    {
      "id": 1,
      "teacher_id": 1,
      "subject_id": 2,
      "can_edit": true,
      "can_delete": false,
      "can_create_content": true,
      "can_view": true,
      "assigned_by": 1,
      "assigned_at": "2024-01-01T12:00:00Z",
      "teacher_name": "أحمد محمد",
      "teacher_email": "ahmed@example.com",
      "assigned_by_name": "أحمد محمد"
    }
  ]
}
```

---

## 5. تحديث صلاحيات مدرس على مادة

### Endpoint
```
PUT /api/teacher-subjects/update/:teacherId/:subjectId
```

### الوصف
تحديث صلاحيات مدرس على مادة محددة (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

### Body
```json
{
  "permissions": {
    "can_edit": false,
    "can_create_content": true
  }
}
```

### مثال للطلب
```bash
curl -X PUT http://localhost:8000/api/teacher-subjects/update/1/2 \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": {
      "can_edit": false,
      "can_create_content": true
    }
  }'
```

### مثال للاستجابة (200 OK)
```json
{
  "message": "تم تحديث الصلاحيات بنجاح",
  "assignment": {
    "id": 1,
    "teacher_id": 1,
    "subject_id": 2,
    "can_edit": false,
    "can_delete": false,
    "can_create_content": true,
    "can_view": true,
    "assigned_by": 1,
    "assigned_at": "2024-01-01T12:00:00Z"
  }
}
```

---

## 6. جلب إحصائيات المواد للمدرس

### Endpoint
```
GET /api/teacher-subjects/stats/:teacherId
```

### الوصف
جلب إحصائيات المواد المخصصة لمدرس

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/teacher-subjects/stats/1 \
  -H "Authorization: Bearer <token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "stats": {
    "total_subjects": 5,
    "editable_subjects": 3,
    "deletable_subjects": 1,
    "content_creation_subjects": 5
  }
}
```

---

## 7. التحقق من صلاحيات مدرس على مادة

### Endpoint
```
GET /api/teacher-subjects/check/:teacherId/:subjectId/:permission
```

### الوصف
التحقق من صلاحية محددة لمدرس على مادة

### Headers
```
Authorization: Bearer <admin_token> أو <teacher_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/teacher-subjects/check/1/2/can_edit \
  -H "Authorization: Bearer <token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "hasPermission": true
}
```

---

## 8. جلب جميع المدرسين

### Endpoint
```
GET /api/teacher-subjects/teachers
```

### الوصف
جلب قائمة جميع المدرسين (للأدمن فقط)

### Headers
```
Authorization: Bearer <admin_token>
```

### مثال للطلب
```bash
curl -X GET http://localhost:8000/api/teacher-subjects/teachers \
  -H "Authorization: Bearer <admin_token>"
```

### مثال للاستجابة (200 OK)
```json
{
  "teachers": [
    {
      "id": 1,
      "name": "أحمد محمد",
      "email": "ahmed@example.com"
    },
    {
      "id": 2,
      "name": "فاطمة علي",
      "email": "fatima@example.com"
    }
  ]
}
```

---

## أمثلة على الاستخدام

### JavaScript (Fetch API)

#### منح صلاحيات لمدرس
```javascript
const response = await fetch('/api/teacher-subjects/assign', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + adminToken,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    teacher_id: 1,
    subject_id: 2,
    permissions: {
      can_edit: true,
      can_delete: false,
      can_create_content: true,
      can_view: true
    }
  })
});

const result = await response.json();
console.log(result);
```

#### جلب مواد المدرس
```javascript
const response = await fetch('/api/teacher-subjects/teacher/1', {
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  }
});

const result = await response.json();
console.log(result.subjects);
```

#### التحقق من صلاحية
```javascript
const response = await fetch('/api/teacher-subjects/check/1/2/can_edit', {
  headers: {
    'Authorization': 'Bearer ' + teacherToken
  }
});

const result = await response.json();
if (result.hasPermission) {
  console.log('يمكن للمدرس تعديل المادة');
}
```

---

## ملاحظات مهمة

1. **الصلاحيات**: جميع عمليات التعديل تتطلب صلاحيات أدمن
2. **الصلاحيات الافتراضية**: 
   - `can_view`: true
   - `can_create_content`: true
   - `can_edit`: false
   - `can_delete`: false
3. **الأمان**: المدرسين يمكنهم رؤية صلاحياتهم فقط
4. **التحديث**: يمكن تحديث صلاحيات جزئية دون الحاجة لتحديد جميع الصلاحيات
5. **التكرار**: لا يمكن منح نفس المادة لنفس المدرس مرتين
6. **التتبع**: يتم تسجيل الأدمن الذي منح الصلاحية 