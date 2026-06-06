# نظام إدارة الموظفين - API Documentation

## نظرة عامة

نظام إدارة الموظفين يتيح للإدارة إنشاء موظفين جدد مع صلاحيات محددة، حيث يمكن للموظفين تسجيل الدخول والوصول للميزات حسب صلاحياتهم.

## الصلاحيات المتاحة

| الصلاحية | الوصف |
|----------|-------|
| `can_add_teachers` | إضافة مدرس جديد |
| `can_edit_teachers` | تعديل بيانات المدرسين |
| `can_delete_teachers` | حذف المدرسين |
| `can_manage_students` | إدارة الطلاب |
| `can_manage_courses` | إدارة الكورسات والمحتوى |
| `can_manage_accounting` | إدارة المحاسبة والإيرادات والمصروفات |
| `can_manage_study_groups` | إدارة المجموعات الدراسية |
| `can_view_reports` | عرض التقارير والإحصائيات |
| `can_manage_employees` | إدارة الموظفين الآخرين |
| `can_manage_tasks` | إدارة المهام (إنشاء، تعديل، حذف المهام) |

## Authentication

جميع APIs تتطلب token مصادقة في header:
```
Authorization: Bearer <token>
```

## APIs

### 1. إنشاء موظف جديد

**Endpoint:** `POST /api/employees`

**الصلاحيات المطلوبة:** `admin` فقط

**Request Body:**
```json
{
  "name": "أحمد محمد",
  "email": "ahmed@company.com",
  "password": "password123",
  "phone": "01234567890",
  "permissions": [
    "can_add_teachers",
    "can_edit_teachers",
    "can_manage_students",
    "can_view_reports"
  ]
}
```

**Response (201):**
```json
{
  "message": "تم إنشاء الموظف بنجاح",
  "employee": {
    "id": 1,
    "user_id": 15,
    "name": "أحمد محمد",
    "email": "ahmed@company.com",
    "phone": "01234567890",
    "avatar": null,
    "permissions": {
      "can_add_teachers": true,
      "can_edit_teachers": true
    },
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "user": {
      "id": 15,
      "email": "ahmed@company.com",
      "name": "أحمد محمد",
      "role": "admin"
    }
  }
}
```

### 2. جلب جميع الموظفين

**Endpoint:** `GET /api/employees`

**الصلاحيات المطلوبة:** `admin` فقط

**Response (200):**
```json
{
  "employees": [
    {
      "id": 1,
      "user_id": 15,
      "name": "أحمد محمد",
      "email": "ahmed@company.com",
      "phone": "01234567890",
      "avatar": "/uploads/avatars/employee-1234567890.jpg",
      "permissions": {
        "can_manage_teachers": true,
        "can_manage_students": true
      },
      "is_active": true,
      "created_by": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "user_name": "أحمد محمد",
      "user_email": "ahmed@company.com",
      "user_role": "admin"
    }
  ]
}
```

### 3. جلب موظف بواسطة ID

**Endpoint:** `GET /api/employees/:id`

**الصلاحيات المطلوبة:** `admin` فقط

**Response (200):**
```json
{
  "employee": {
    "id": 1,
    "user_id": 15,
    "name": "أحمد محمد",
    "email": "ahmed@company.com",
    "phone": "01234567890",
    "avatar": "/uploads/avatars/employee-1234567890.jpg",
    "permissions": {
      "can_manage_teachers": true,
      "can_manage_students": true
    },
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z",
    "user_name": "أحمد محمد",
    "user_email": "ahmed@company.com",
    "user_role": "admin"
  }
}
```

### 4. تحديث بيانات الموظف

**Endpoint:** `PUT /api/employees/:id`

**الصلاحيات المطلوبة:** `admin` فقط

**Request Body:**
```json
{
  "name": "أحمد محمد علي",
  "phone": "01234567891",
  "permissions": [
    "can_add_teachers",
    "can_edit_teachers",
    "can_manage_courses"
  ],
  "is_active": true
}
```

**Response (200):**
```json
{
  "message": "تم تحديث بيانات الموظف بنجاح",
  "employee": {
    "id": 1,
    "user_id": 15,
    "name": "أحمد محمد علي",
    "email": "ahmed@company.com",
    "phone": "01234567891",
    "avatar": "/uploads/avatars/employee-1234567890.jpg",
    "permissions": {
      "can_manage_teachers": true,
      "can_manage_students": true,
      "can_manage_courses": true
    },
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

### 5. رفع صورة الموظف

**Endpoint:** `POST /api/employees/:id/avatar`

**الصلاحيات المطلوبة:** `admin` فقط

**Request:** Form Data
- `avatar`: ملف صورة (jpeg, jpg, png, gif) - الحد الأقصى 5MB

**Response (200):**
```json
{
  "message": "تم رفع الصورة بنجاح",
  "employee": {
    "id": 1,
    "user_id": 15,
    "name": "أحمد محمد",
    "email": "ahmed@company.com",
    "phone": "01234567890",
    "avatar": "/uploads/avatars/employee-1234567890.jpg",
    "permissions": {
      "can_manage_teachers": true,
      "can_manage_students": true
    },
    "is_active": true,
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:30:00Z"
  }
}
```

### 6. تحديث كلمة مرور الموظف

**Endpoint:** `PUT /api/employees/:id/password`

**الصلاحيات المطلوبة:** `admin` فقط

**Request Body:**
```json
{
  "new_password": "newpassword123"
}
```

**Response (200):**
```json
{
  "message": "تم تحديث كلمة المرور بنجاح",
  "user": {
    "id": 15,
    "email": "ahmed@company.com",
    "name": "أحمد محمد"
  }
}
```

### 7. حذف/تعطيل موظف

**Endpoint:** `DELETE /api/employees/:id`

**الصلاحيات المطلوبة:** `admin` فقط

**Response (200):**
```json
{
  "message": "تم حذف الموظف بنجاح",
  "employee": {
    "id": 1,
    "user_id": 15,
    "name": "أحمد محمد",
    "email": "ahmed@company.com",
    "is_active": false,
    "updated_at": "2024-01-15T12:00:00Z"
  }
}
```

### 8. جلب صلاحيات الموظف الحالي

**Endpoint:** `GET /api/employees/me/permissions`

**الصلاحيات المطلوبة:** `admin` فقط

**Response (200):**
```json
{
  "permissions": {
    "can_manage_teachers": true,
    "can_manage_students": true,
    "can_view_reports": true
  }
}
```

## تسجيل دخول الموظفين

### تسجيل الدخول

**Endpoint:** `POST /api/login`

**Request Body:**
```json
{
  "email": "ahmed@company.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": 15,
    "name": "أحمد محمد",
    "email": "ahmed@company.com",
    "phone": "01234567890",
    "role": "admin"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "employee_permissions": {
    "can_add_teachers": true,
    "can_edit_teachers": true,
    "can_view_reports": true
  }
}
```

## أمثلة JavaScript

### إنشاء موظف جديد
```javascript
const createEmployee = async (employeeData) => {
  const response = await fetch('/api/employees', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(employeeData)
  });
  
  return await response.json();
};

// استخدام
const newEmployee = await createEmployee({
  name: "أحمد محمد",
  email: "ahmed@company.com",
  password: "password123",
  phone: "01234567890",
  permissions: ["can_add_teachers", "can_edit_teachers"]
});
```

### رفع صورة الموظف
```javascript
const uploadEmployeeAvatar = async (employeeId, file) => {
  const formData = new FormData();
  formData.append('avatar', file);
  
  const response = await fetch(`/api/employees/${employeeId}/avatar`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};
```

### تسجيل دخول الموظف
```javascript
const loginEmployee = async (email, password) => {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  
  // حفظ البيانات
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  localStorage.setItem('permissions', JSON.stringify(data.employee_permissions));
  
  return data;
};
```

### التحقق من الصلاحيات
```javascript
const checkPermission = (permission) => {
  const permissions = JSON.parse(localStorage.getItem('permissions') || '{}');
  return permissions[permission] === true;
};

// استخدام
if (checkPermission('can_add_teachers')) {
  // عرض زر إضافة مدرس جديد
  showAddTeacherButton();
}

if (checkPermission('can_edit_teachers')) {
  // عرض زر تعديل بيانات المدرسين
  showEditTeachersButton();
}

if (checkPermission('can_delete_teachers')) {
  // عرض زر حذف المدرسين
  showDeleteTeachersButton();
}

if (checkPermission('can_manage_tasks')) {
  // عرض زر إدارة المهام
  showManageTasksButton();
}
```

## ملاحظات مهمة

1. **الصلاحيات**: يتم تخزين الصلاحيات كـ JSON في قاعدة البيانات
2. **الأمان**: جميع APIs تتطلب مصادقة admin
3. **الصور**: يتم حفظ الصور في مجلد `uploads/avatars/`
4. **التعطيل**: عند حذف موظف يتم تعطيله فقط (soft delete)
5. **كلمات المرور**: يتم تشفيرها باستخدام bcrypt
6. **التوافق**: النظام متوافق مع نظام المستخدمين الحالي

## أخطاء شائعة

### 400 - بيانات غير صحيحة
```json
{
  "error": "الاسم والإيميل وكلمة المرور والصلاحيات مطلوبة"
}
```

### 400 - إيميل مكرر
```json
{
  "error": "الإيميل مستخدم بالفعل"
}
```

### 404 - موظف غير موجود
```json
{
  "error": "الموظف غير موجود"
}
```

### 500 - خطأ في الخادم
```json
{
  "error": "خطأ في إنشاء الموظف",
  "details": "تفاصيل الخطأ"
}
```