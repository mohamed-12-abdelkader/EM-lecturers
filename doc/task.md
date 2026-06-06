# نظام إدارة المهام - API Documentation

## نظرة عامة

نظام إدارة المهام يتيح للإدارة إنشاء مهام وتوزيعها على الموظفين، حيث يمكن لكل موظف رؤية مهامه الخاصة وتحديث حالتها وإضافة تعليقات وملفات.

## المميزات الرئيسية

- ✅ **إنشاء مهام** - الادمن ينشئ مهام ويوزعها على الموظفين
- ✅ **إدارة المهام** - كل موظف يرى مهامه فقط
- ✅ **تتبع الحالة** - pending, in_progress, completed, cancelled
- ✅ **نظام الأولوية** - low, medium, high, urgent
- ✅ **التعليقات** - إضافة تعليقات على المهام
- ✅ **الملفات** - رفع ملفات للمهام
- ✅ **الإحصائيات** - إحصائيات شاملة للمهام
- ✅ **تحديد الموظف** - اختيار موظف محدد لكل مهمة

## حالات المهام

| الحالة | الوصف |
|--------|-------|
| `pending` | في الانتظار |
| `in_progress` | قيد التنفيذ |
| `completed` | مكتملة |
| `cancelled` | ملغية |

## أولويات المهام

| الأولوية | الوصف |
|----------|-------|
| `low` | منخفضة |
| `medium` | متوسطة |
| `high` | عالية |
| `urgent` | عاجلة |

## Authentication

جميع APIs تتطلب token مصادقة في header:
```
Authorization: Bearer <token>
```

---

## 📋 APIs

### 1. إنشاء مهمة جديدة

**Endpoint:** `POST /api/tasks`

**الصلاحيات:** `admin` فقط

**Request Body:**
```json
{
  "title": "تحديث قاعدة البيانات",
  "description": "تحديث جداول المستخدمين والمدرسين وإضافة الميزات الجديدة",
  "priority": "high",
  "due_date": "2024-01-20",
  "assigned_to": 1
}
```

**الشرح:**
- `title` - عنوان المهمة (مطلوب)
- `description` - وصف المهمة (اختياري)
- `priority` - الأولوية (low, medium, high, urgent)
- `due_date` - تاريخ الاستحقاق (اختياري)
- `assigned_to` - **ID الموظف المكلف بالمهمة (مطلوب)**

**Response (201):**
```json
{
  "message": "تم إنشاء المهمة بنجاح",
  "task": {
    "id": 1,
    "title": "تحديث قاعدة البيانات",
    "description": "تحديث جداول المستخدمين والمدرسين وإضافة الميزات الجديدة",
    "priority": "high",
    "status": "pending",
    "due_date": "2024-01-20",
    "assigned_to": 1,
    "assigned_by": 1,
    "completed_at": null,
    "completed_by": null,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const createTask = async (taskData) => {
  const response = await fetch('/api/tasks', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(taskData)
  });
  
  return await response.json();
};

// استخدام
const newTask = await createTask({
  title: "تحديث قاعدة البيانات",
  description: "تحديث جداول المستخدمين والمدرسين",
  priority: "high",
  due_date: "2024-01-20",
  assigned_to: 1
});
```

---

### 2. جلب جميع المهام (للادمن)

**Endpoint:** `GET /api/tasks`

**الصلاحيات:** `admin` فقط

**Query Parameters:**
- `status` - حالة المهمة (pending, in_progress, completed, cancelled)
- `priority` - الأولوية (low, medium, high, urgent)
- `assigned_to` - ID الموظف المكلف
- `limit` - عدد النتائج (افتراضي: 10)
- `skip` - عدد النتائج للتخطي (افتراضي: 0)

**Example:** `GET /api/tasks?status=pending&priority=high&limit=5`

**Response (200):**
```json
{
  "tasks": [
    {
      "id": 1,
      "title": "تحديث قاعدة البيانات",
      "description": "تحديث جداول المستخدمين والمدرسين",
      "priority": "high",
      "status": "pending",
      "due_date": "2024-01-20",
      "assigned_to": 1,
      "assigned_by": 1,
      "completed_at": null,
      "completed_by": null,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "employee_name": "أحمد محمد",
      "employee_email": "ahmed@company.com",
      "assigned_by_name": "مدير النظام",
      "comments_count": 2,
      "attachments_count": 1
    }
  ]
}
```

**مثال JavaScript:**
```javascript
const getAllTasks = async (filters = {}) => {
  const params = new URLSearchParams(filters);
  const response = await fetch(`/api/tasks?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const tasks = await getAllTasks({
  status: 'pending',
  priority: 'high',
  limit: 10
});
```

---

### 3. جلب مهام الموظف الحالي

**Endpoint:** `GET /api/tasks/my-tasks`

**الصلاحيات:** `admin` (موظف)

**Query Parameters:**
- `status` - حالة المهمة
- `priority` - الأولوية
- `limit` - عدد النتائج
- `skip` - عدد النتائج للتخطي

**Response (200):**
```json
{
  "tasks": [
    {
      "id": 1,
      "title": "تحديث قاعدة البيانات",
      "description": "تحديث جداول المستخدمين والمدرسين",
      "priority": "high",
      "status": "in_progress",
      "due_date": "2024-01-20",
      "assigned_to": 1,
      "assigned_by": 1,
      "completed_at": null,
      "completed_by": null,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T11:00:00Z",
      "employee_name": "أحمد محمد",
      "employee_email": "ahmed@company.com",
      "assigned_by_name": "مدير النظام",
      "comments_count": 2,
      "attachments_count": 1
    }
  ]
}
```

**مثال JavaScript:**
```javascript
const getMyTasks = async (filters = {}) => {
  const params = new URLSearchParams(filters);
  const response = await fetch(`/api/tasks/my-tasks?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const myTasks = await getMyTasks({
  status: 'pending',
  priority: 'high',
  limit: 10
});
```

---

### 4. جلب مهمة واحدة

**Endpoint:** `GET /api/tasks/:id`

**الصلاحيات:** `admin` فقط

**Response (200):**
```json
{
  "task": {
    "id": 1,
    "title": "تحديث قاعدة البيانات",
    "description": "تحديث جداول المستخدمين والمدرسين",
    "priority": "high",
    "status": "in_progress",
    "due_date": "2024-01-20",
    "assigned_to": 1,
    "assigned_by": 1,
    "completed_at": null,
    "completed_by": null,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T11:00:00Z",
    "employee_name": "أحمد محمد",
    "employee_email": "ahmed@company.com",
    "assigned_by_name": "مدير النظام",
    "completed_by_name": null
  }
}
```

**مثال JavaScript:**
```javascript
const getTask = async (taskId) => {
  const response = await fetch(`/api/tasks/${taskId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const task = await getTask(1);
```

---

### 5. تحديث مهمة

**Endpoint:** `PUT /api/tasks/:id`

**الصلاحيات:** `admin` فقط

**Request Body:**
```json
{
  "title": "تحديث قاعدة البيانات - محدث",
  "description": "تحديث شامل لقاعدة البيانات",
  "status": "in_progress",
  "priority": "urgent",
  "due_date": "2024-01-18",
  "assigned_to": 2
}
```

**Response (200):**
```json
{
  "message": "تم تحديث المهمة بنجاح",
  "task": {
    "id": 1,
    "title": "تحديث قاعدة البيانات - محدث",
    "description": "تحديث شامل لقاعدة البيانات",
    "priority": "urgent",
    "status": "in_progress",
    "due_date": "2024-01-18",
    "assigned_to": 2,
    "assigned_by": 1,
    "completed_at": null,
    "completed_by": null,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T12:00:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const updateTask = async (taskId, taskData) => {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(taskData)
  });
  
  return await response.json();
};

// استخدام
await updateTask(1, {
  title: "تحديث قاعدة البيانات - محدث",
  status: "in_progress",
  priority: "urgent"
});
```

---

### 6. إكمال مهمة

**Endpoint:** `POST /api/tasks/:id/complete`

**الصلاحيات:** `admin` (الموظف المكلف)

**Response (200):**
```json
{
  "message": "تم إكمال المهمة بنجاح",
  "task": {
    "id": 1,
    "title": "تحديث قاعدة البيانات",
    "description": "تحديث جداول المستخدمين والمدرسين",
    "priority": "high",
    "status": "completed",
    "due_date": "2024-01-20",
    "assigned_to": 1,
    "assigned_by": 1,
    "completed_at": "2024-01-15T14:30:00Z",
    "completed_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T14:30:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const completeTask = async (taskId) => {
  const response = await fetch(`/api/tasks/${taskId}/complete`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
await completeTask(1);
```

---

### 7. حذف مهمة

**Endpoint:** `DELETE /api/tasks/:id`

**الصلاحيات:** `admin` فقط

**Response (200):**
```json
{
  "message": "تم حذف المهمة بنجاح",
  "task": {
    "id": 1,
    "title": "تحديث قاعدة البيانات",
    "description": "تحديث جداول المستخدمين والمدرسين",
    "priority": "high",
    "status": "completed",
    "due_date": "2024-01-20",
    "assigned_to": 1,
    "assigned_by": 1,
    "completed_at": "2024-01-15T14:30:00Z",
    "completed_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T14:30:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const deleteTask = async (taskId) => {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
await deleteTask(1);
```

---

### 8. إضافة تعليق على مهمة

**Endpoint:** `POST /api/tasks/:id/comments`

**الصلاحيات:** `admin` (موظف)

**Request Body:**
```json
{
  "comment": "تم البدء في العمل على المهمة وتم إنجاز 50% منها"
}
```

**Response (201):**
```json
{
  "message": "تم إضافة التعليق بنجاح",
  "comment": {
    "id": 1,
    "task_id": 1,
    "employee_id": 1,
    "comment": "تم البدء في العمل على المهمة وتم إنجاز 50% منها",
    "created_at": "2024-01-15T11:30:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const addTaskComment = async (taskId, comment) => {
  const response = await fetch(`/api/tasks/${taskId}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ comment })
  });
  
  return await response.json();
};

// استخدام
await addTaskComment(1, "تم البدء في العمل على المهمة");
```

---

### 9. جلب تعليقات مهمة

**Endpoint:** `GET /api/tasks/:id/comments`

**الصلاحيات:** `admin` فقط

**Response (200):**
```json
{
  "comments": [
    {
      "id": 1,
      "task_id": 1,
      "employee_id": 1,
      "comment": "تم البدء في العمل على المهمة",
      "created_at": "2024-01-15T11:30:00Z",
      "employee_name": "أحمد محمد",
      "employee_email": "ahmed@company.com"
    },
    {
      "id": 2,
      "task_id": 1,
      "employee_id": 1,
      "comment": "تم إنجاز 50% من المهمة",
      "created_at": "2024-01-15T12:30:00Z",
      "employee_name": "أحمد محمد",
      "employee_email": "ahmed@company.com"
    }
  ]
}
```

**مثال JavaScript:**
```javascript
const getTaskComments = async (taskId) => {
  const response = await fetch(`/api/tasks/${taskId}/comments`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const comments = await getTaskComments(1);
```

---

### 10. رفع ملف لمهمة

**Endpoint:** `POST /api/tasks/:id/attachments`

**الصلاحيات:** `admin` (موظف)

**Request:** Form Data
- `file`: ملف (الحد الأقصى 10MB)

**Response (201):**
```json
{
  "message": "تم رفع الملف بنجاح",
  "attachment": {
    "id": 1,
    "task_id": 1,
    "file_name": "document.pdf",
    "file_path": "/uploads/tasks/task-1234567890.pdf",
    "file_size": 1024000,
    "uploaded_by": 1,
    "created_at": "2024-01-15T13:30:00Z"
  }
}
```

**مثال JavaScript:**
```javascript
const uploadTaskFile = async (taskId, file) => {
  const formData = new FormData();
  formData.append('file', file);
  
  const response = await fetch(`/api/tasks/${taskId}/attachments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};

// استخدام
const fileInput = document.getElementById('fileInput');
await uploadTaskFile(1, fileInput.files[0]);
```

---

### 11. جلب ملفات مهمة

**Endpoint:** `GET /api/tasks/:id/attachments`

**الصلاحيات:** `admin` فقط

**Response (200):**
```json
{
  "attachments": [
    {
      "id": 1,
      "task_id": 1,
      "file_name": "document.pdf",
      "file_path": "/uploads/tasks/task-1234567890.pdf",
      "file_size": 1024000,
      "uploaded_by": 1,
      "created_at": "2024-01-15T13:30:00Z",
      "uploaded_by_name": "أحمد محمد"
    }
  ]
}
```

**مثال JavaScript:**
```javascript
const getTaskAttachments = async (taskId) => {
  const response = await fetch(`/api/tasks/${taskId}/attachments`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const attachments = await getTaskAttachments(1);
```

---

### 12. إحصائيات المهام

**Endpoint:** `GET /api/tasks/stats/overview`

**الصلاحيات:** `admin` فقط

**Response (200):**
```json
{
  "stats": {
    "total_tasks": 25,
    "pending_tasks": 8,
    "in_progress_tasks": 5,
    "completed_tasks": 10,
    "cancelled_tasks": 2,
    "urgent_tasks": 3,
    "overdue_tasks": 1
  }
}
```

**مثال JavaScript:**
```javascript
const getTaskStats = async () => {
  const response = await fetch('/api/tasks/stats/overview', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const stats = await getTaskStats();
console.log(`إجمالي المهام: ${stats.stats.total_tasks}`);
console.log(`المهام المكتملة: ${stats.stats.completed_tasks}`);
```

---

## 🔧 كيفية تحديد الموظف عند إنشاء المهمة

### 1. جلب قائمة الموظفين أولاً

**Endpoint:** `GET /api/employees`

**Response:**
```json
{
  "employees": [
    {
      "id": 1,
      "name": "أحمد محمد",
      "email": "ahmed@company.com",
      "phone": "01234567890",
      "permissions": {
        "can_add_teachers": true,
        "can_manage_students": true
      }
    },
    {
      "id": 2,
      "name": "سارة أحمد",
      "email": "sara@company.com",
      "phone": "01234567891",
      "permissions": {
        "can_manage_courses": true,
        "can_view_reports": true
      }
    }
  ]
}
```

**مثال JavaScript:**
```javascript
const getEmployees = async () => {
  const response = await fetch('/api/employees', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const employees = await getEmployees();
console.log('الموظفون المتاحون:', employees.employees);
```

### 2. إنشاء المهمة مع تحديد الموظف

```json
{
  "title": "تطوير ميزة جديدة",
  "description": "إضافة نظام إشعارات للمستخدمين",
  "priority": "high",
  "due_date": "2024-01-25",
  "assigned_to": 1
}
```

**مثال كامل لإنشاء مهمة مع اختيار الموظف:**
```javascript
// 1. جلب قائمة الموظفين
const employees = await getEmployees();

// 2. عرض قائمة الموظفين في select
const employeeSelect = document.getElementById('employeeSelect');
employees.employees.forEach(employee => {
  const option = document.createElement('option');
  option.value = employee.id;
  option.textContent = employee.name;
  employeeSelect.appendChild(option);
});

// 3. إنشاء المهمة عند submit النموذج
document.getElementById('taskForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const taskData = {
    title: document.getElementById('taskTitle').value,
    description: document.getElementById('taskDescription').value,
    priority: document.getElementById('taskPriority').value,
    due_date: document.getElementById('taskDueDate').value,
    assigned_to: parseInt(document.getElementById('employeeSelect').value)
  };
  
  try {
    const result = await createTask(taskData);
    alert('تم إنشاء المهمة بنجاح!');
  } catch (error) {
    alert('خطأ في إنشاء المهمة');
  }
});
```

---

## ⚠️ أخطاء شائعة

### 400 - بيانات غير صحيحة
```json
{
  "error": "العنوان والموظف المكلف مطلوبان"
}
```

### 404 - مهمة غير موجودة
```json
{
  "error": "المهمة غير موجودة"
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
  "error": "خطأ في إنشاء المهمة",
  "details": "تفاصيل الخطأ"
}
```

---

## 📋 سير العمل (Workflow)

### للادمن:
1. جلب قائمة الموظفين المتاحين
2. إنشاء مهمة جديدة
3. تعيين موظف للمهمة (assigned_to)
4. تحديد الأولوية والتاريخ
5. متابعة تقدم المهام
6. حذف المهام عند الحاجة

### للموظف:
1. رؤية مهامه المكلف بها
2. تحديث حالة المهمة
3. إضافة تعليقات
4. رفع ملفات
5. إكمال المهمة عند الانتهاء

---

## ملاحظات مهمة

1. **الصلاحيات**: جميع APIs تتطلب صلاحية admin
2. **الأمان**: يتم التحقق من أن الموظف يرى مهامه فقط
3. **الملفات**: يتم حفظ الملفات في مجلد `uploads/tasks/`
4. **التعليقات**: يمكن للموظفين إضافة تعليقات على مهامهم
5. **الإحصائيات**: إحصائيات مختلفة للموظف والادمن
6. **التواريخ**: يتم استخدام تنسيق ISO للتواريخ
7. **تحديد الموظف**: يجب تحديد `assigned_to` عند إنشاء المهمة
