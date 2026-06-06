# Employee Tasks API

توثيق مسارات المهام الخاصة بالموظف فقط.

Base URL: `http://localhost:8000/api/tasks`

## Authentication

- كل الطلبات تحتاج JWT:
  - `Authorization: Bearer <token>`
- الدور المطلوب لمعظم المسارات هنا: `employee`
- لازم يكون للمستخدم سجل نشط في جدول `employees` مرتبط بـ `user_id`.

## Task Lifecycle (Employee Side)

1. المهمة تبدأ غالبا بحالة `pending` (يُنشئها الأدمن).
2. الموظف يبدأ التنفيذ: `PATCH /:id/start` -> `in_progress`
3. الموظف يعلن الانتهاء: `PATCH /:id/complete` -> `completed_by_employee`
4. بعدها ينتظر اعتماد/رفض الأدمن.

## Task Status Values

- `pending`
- `in_progress`
- `completed_by_employee`
- `approved`
- `rejected`
- `overdue`

---

## 1) Get My Tasks

- **GET** `/my-tasks`
- **Role:** `employee` (أو `admin` لكن عمليًا يحتاج employee record)
- **Query params (optional):**
  - `status`
  - `priority`
  - `limit`
  - `skip`

### Example

`GET /api/tasks/my-tasks?status=in_progress&limit=20&skip=0`

### Success Response

```json
{
  "tasks": [
    {
      "id": 101,
      "title": "متابعة كشف الحضور",
      "status": "in_progress",
      "priority": "high",
      "deadline": "2026-03-31",
      "assigned_to": 12
    }
  ],
  "employee": {
    "id": 12,
    "name": "Ahmed",
    "email": "ahmed@example.com",
    "permissions": ["can_manage_tasks"]
  }
}
```

---

## 2) Get My Dashboard

- **GET** `/my-tasks/dashboard`
- **Role:** `employee`
- يرجع تقسيم المهام إلى:
  - `active`
  - `overdue`
  - `completed_history`
  - `counts`

### Example

`GET /api/tasks/my-tasks/dashboard`

---

## 3) Get My Task History

- **GET** `/my-tasks/history`
- **Role:** `employee`
- يرجع سجل تاريخي مع معلومات مثل:
  - `created_at`
  - `completed_at`
  - `approved_at`
  - `duration_hours_until_submit`
  - `was_approved`

### Example

`GET /api/tasks/my-tasks/history`

---

## 4) Get My Stats

- **GET** `/stats/my-stats`
- **Role:** `employee` (ومدعوم أيضًا للأدمن بشرط وجود employee record)

### Success Response (shape)

```json
{
  "stats": {
    "total_tasks": 25,
    "pending_tasks": 4,
    "in_progress_tasks": 5,
    "completed_by_employee_tasks": 3,
    "approved_tasks": 10,
    "rejected_tasks": 2,
    "overdue_tasks": 1
  },
  "employee": {
    "id": 12,
    "name": "Ahmed",
    "email": "ahmed@example.com",
    "permissions": ["can_manage_tasks"]
  },
  "message": "إحصائيات الموظف الحالي"
}
```

---

## 5) Start Task

- **PATCH** `/:id/start`
- **Role:** `employee`
- الموظف لازم يكون هو المكلّف بالمهمة.
- الحالات المسموح البدء منها: `pending`, `rejected`, `overdue`.

### Example

`PATCH /api/tasks/101/start`

### Success Response

```json
{
  "message": "تم البدء في تنفيذ المهمة",
  "task": {
    "id": 101,
    "status": "in_progress"
  }
}
```

---

## 6) Complete Task

- **PATCH** `/:id/complete`
- **Role:** `employee`
- شرط أساسي: الحالة الحالية `in_progress`.
- النتيجة: `completed_by_employee` (في انتظار مراجعة الأدمن).
- يمكن إرسال رسالة من الموظف للأدمن قبل الاعتماد/الرفض عبر `message`.

### Example

`PATCH /api/tasks/101/complete`

Body (optional):

```json
{
  "message": "خلصت المهمة وتم رفع الملف النهائي في المرفقات."
}
```

### Success Response

```json
{
  "message": "تم إكمال المهمة مؤقتاً في انتظار المراجعة",
  "task": {
    "id": 101,
    "status": "completed_by_employee",
    "employee_notes": "خلصت المهمة وتم رفع الملف النهائي في المرفقات.",
    "completed_at": "2026-03-31T08:30:00.000Z"
  }
}
```

---

## 7) Task Details (Assigned Employee Only)

- **GET** `/:id`
- **Role:** `employee` أو `admin`
- الموظف يقدر يجلب تفاصيل المهمة فقط لو مكلّف بها.

---

## 8) Comments (Employee + Admin)

### Add Comment

- **POST** `/:id/comments`
- **Body:**

```json
{
  "comment": "تم الانتهاء من الجزء الأول"
}
```

### Get Comments

- **GET** `/:id/comments`

> نفس قاعدة الصلاحية: الموظف يرى/يعلّق فقط على المهام المكلّف بها.

---

## 9) Attachments (Employee + Admin)

### Upload Attachment

- **POST** `/:id/attachments`
- **Content-Type:** `multipart/form-data`
- **Field name:** `file`
- حد الحجم الحالي: 10MB

### Get Attachments

- **GET** `/:id/attachments`

---

## 10) Task Logs (Employee + Admin)

- **GET** `/:id/logs`
- يرجع سجل الإجراءات (`task_logs`) مثل:
  - `created`
  - `started`
  - `completed`
  - `approved`
  - `rejected`

---

## Common Errors

- `400`:
  - بيانات ناقصة
  - انتقال حالة غير مسموح
- `403`:
  - المستخدم ليس صاحب المهمة
  - أو غير مصرح
- `404`:
  - المهمة غير موجودة
  - أو لا يوجد employee record للمستخدم
- `500`:
  - خطأ داخلي بالخادم

## Notes For Mobile Team

- استخدم `deadline` في الاستجابة لعرض موعد التسليم (مخزن داخليا باسم `due_date`).
- لا تفترض أن الموظف يقدر يغيّر الحالة مباشرة لأي قيمة؛ استخدم فقط:
  - `PATCH /:id/start`
  - `PATCH /:id/complete`
