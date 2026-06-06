# وثائق API نظام المهام (Tasks)

جميع المسارات المذكورة تُبنى تحت البادئة **`/api/tasks`** (مثال: `GET /api/tasks` → `http://localhost:8000/api/tasks`).

## المصادقة

- تمرير رمز **JWT** في الهيدر: `Authorization: Bearer <token>`
- الأدوار المستخدمة: **`admin`**, **`employee`**
- الموظف يجب أن يكون مرتبطًا بسجل في جدول `employees` (عبر `user_id`) لاستخدام مسارات "مهامي".

## حالات المهمة (`status`)

| القيمة | الوصف |
|--------|--------|
| `pending` | في الانتظار |
| `in_progress` | قيد التنفيذ |
| `completed_by_employee` | انتهى تنفيذها من الموظف — بانتظار مراجعة الأدمن |
| `approved` | معتمدة من الأدمن |
| `rejected` | مرفوضة — تحتاج إعادة تنفيذ |
| `overdue` | تجاوزت الموعد (`deadline`) ولم تُعتمد/تُلغَ حسب قواعد الخادم |
| `completed` / `cancelled` | قيم قديمة/إضافية محفوظة في قاعدة البيانات إن وُجدت |

## الأولوية (`priority`)

`low` | `medium` | `high` | `urgent`

## الحقول المهمة في كائن المهمة

| الحقل في الاستجابة | ملاحظة |
|---------------------|--------|
| `deadline` | نفس قيمة عمود قاعدة البيانات `due_date` (موعد التسليم) |
| `start_date` | بداية المهمة |
| `assigned_to` | معرف سجل **الموظف** في جدول `employees` (ليس `user_id`) |
| `assigned_by` | معرف **المستخدم** (الأدمن) الذي أنشأ المهمة |
| `employee_notes` / `employee_message` | رسالة الموظف عند الإكمال (تظهر للأدمن في قوائم وتفاصيل المهام) |
| `admin_notes` | ملاحظات الأدمن (اعتماد/رفض) |
| `completed_at` / `approved_at` | طوابع زمنية عند التسليم والاعتماد |

## دورة الحياة (ملخص)

1. الأدمن ينشئ مهمة → `pending`
2. الموظف `PATCH .../start` → `in_progress` (من `pending` أو `rejected` أو `overdue`)
3. الموظف `PATCH .../complete` → `completed_by_employee`
4. الأدمن `PATCH .../approve` → `approved` أو `PATCH .../reject` → `rejected` (مع `admin_notes`)

الخادم يحدّث المهام المتأخرة إلى `overdue` دوريًا، ويرسل تذكيرًا قبل يوم من الموعد (إن وُفِّرت الأعمدة والإشعارات بعد تشغيل المايجريشن).

---

## مسارات الأدمن — إدارة المهام

### إنشاء مهمة

- **POST** `/api/tasks`
- **صلاحية:** `admin`
- **Body (JSON):**

```json
{
  "title": "عنوان المهمة",
  "description": "وصف اختياري",
  "priority": "medium",
  "start_date": "2026-03-01T00:00:00.000Z",
  "deadline": "2026-03-15",
  "assigned_to": 12
}
```

أو تعيين الموظف بمعرف المستخدم (مفيد للموبايل):

```json
{
  "title": "عنوان المهمة",
  "deadline": "2026-03-15",
  "assigned_user_id": 42
}
```

- **`assigned_to`**: معرف سجل الموظف في جدول **`employees`** (الأفضل صراحةً).
- **`assigned_user_id`**: معرف **`users.id`** للموظف؛ إن وُجد يُحلّ تلقائياً إلى `employees.id`.
- إذا أرسلت فقط **`assigned_to`** وكان الرقم لا يطابق `employees.id`، يُجرّب الخادم أيضاً كأنه **`users.id`** (للتوافق مع تطبيقات أرسلت user id بالخطأ).
- عدم العثور على موظف نشط يعيد **`400`** مع `code: "ASSIGNEE_NOT_FOUND"` وليس خطأ مسار.
- يمكن استخدام **`due_date`** بدل **`deadline`** (نفس المعنى).
- الحالة عند الإنشاء دائمًا **`pending`** (لا يُقبل تعيين حالة أخرى من الطلب).

**استجابة ناجحة:** `201` — `{ message, task }`

---

### قائمة كل المهام (فلترة)

- **GET** `/api/tasks`
- **صلاحية:** `admin`
- **Query (اختياري):**

| المعامل | الوصف |
|---------|--------|
| `status` | فلترة بالحالة |
| `priority` | فلترة بالأولوية |
| `assigned_to` | معرف `employees.id` |
| `deadline_from` / `deadline_to` | نطاق موعد التسليم |
| `created_from` / `created_to` | نطاق تاريخ الإنشاء |
| `limit` / `skip` | ترقيم صفحات |

**استجابة:** `200` — `{ tasks, message }`

---

### تفاصيل مهمة

- **GET** `/api/tasks/:id`
- **صلاحية:** `admin` أو `employee` (الموظف: مهامه فقط)

**استجابة:** `200` — `{ task }` — أو `403` / `404`

---

### تعديل مهمة

- **PUT** `/api/tasks/:id`
- **صلاحية:** `admin`
- **Body:** حقول جزئية مثل `title`, `description`, `priority`, `status`, `deadline` أو `due_date`, `start_date`, `assigned_to`, `admin_notes`

**استجابة:** `200` — `{ message, task }`

---

### حذف مهمة

- **DELETE** `/api/tasks/:id`
- **صلاحية:** `admin`

**استجابة:** `200` — `{ message, task }` — أو `404`

---

### اعتماد مهمة

- **PATCH** `/api/tasks/:id/approve`
- **صلاحية:** `admin`
- **Body (اختياري):** `{ "admin_notes": "ملاحظات" }`

**شرط:** المهمة في حالة `completed_by_employee`.

**استجابة:** `200` — `{ message, task }`

---

### رفض مهمة

- **PATCH** `/api/tasks/:id/reject`
- **صلاحية:** `admin`
- **Body (مطلوب):** `{ "admin_notes": "سبب الرفض" }`

**استجابة:** `200` — `{ message, task }`

---

## مسارات الأدمن — إحصائيات

### نظرة عامة على كل المهام

- **GET** `/api/tasks/stats/overview`
- **صلاحية:** `admin`

**استجابة:** `200` — `{ stats, message }`  
يحتوي `stats` على معلومات مثل: `total_tasks`, `pending_tasks`, `in_progress_tasks`, `approved_tasks`, `rejected_tasks`, `overdue_tasks`, إلخ.

---

### أداء الموظفين حسب المهام

- **GET** `/api/tasks/stats/by-employee`
- **صلاحية:** `admin`

**استجابة:** `200` — `{ employees, message }`

---

## مسارات الموظف — مهامي وسير العمل

### قائمة مهامي

- **GET** `/api/tasks/my-tasks`
- **صلاحية:** `admin` أو `employee` (عمليًا يحتاج سجل `employees`؛ الأدمن بدون سجل قد يحصل على `404`)
- **Query:** `status`, `priority`, `limit`, `skip`

**استجابة:** `200` — `{ tasks, employee }`

---

### لوحة موظف (نشطة / متأخرة / مكتملة)

- **GET** `/api/tasks/my-tasks/dashboard`
- **صلاحية:** `employee`

**استجابة:** `200` — تتضمن أقسامًا مثل `active`, `overdue`, `completed_history`, `counts`

---

### سجل المهام (History)

- **GET** `/api/tasks/my-tasks/history`
- **صلاحية:** `employee`

**استجابة:** `200` — `{ history, total }`

---

### إحصائياتي

- **GET** `/api/tasks/stats/my-stats`
- **صلاحية:** `admin` أو `employee` (يحتاج سجل موظف)

**استجابة:** `200` — `{ stats, employee, message }`

---

### بدء التنفيذ

- **PATCH** `/api/tasks/:id/start`
- **صلاحية:** `employee` فقط (الموظف المكلف)

**استجابة:** `200` — `{ message, task }` — أو `400` / `403`

---

### إتمام التنفيذ (بانتظار الأدمن)

- **PATCH** `/api/tasks/:id/complete`
- **صلاحية:** `employee` فقط

**شرط:** المهمة `in_progress`.

**استجابة:** `200` — `{ message, task }`

---

## تعليقات ومرفقات وسجل (أدمن + موظف مكلف)

الموظف يرى ويعدّل فقط المهام المعيّنة له (`assigned_to`).

### تعليقات

- **POST** `/api/tasks/:id/comments` — Body: `{ "comment": "نص" }`
- **GET** `/api/tasks/:id/comments`
- **صلاحية:** `admin` أو `employee` (مع التحقق من التعيين للموظف)

### مرفقات

- **POST** `/api/tasks/:id/attachments` — `multipart/form-data`، الحقل **`file`**
- حد أقصى للملف في الكود الحالي: **10 ميغابايت**
- **GET** `/api/tasks/:id/attachments`
- **صلاحية:** `admin` أو `employee` (مع التحقق من التعيين)

مسار الملف في الاستجابة يكون مثل: `/uploads/task-....ext`

### سجل الإجراءات (task_logs)

- **GET** `/api/tasks/:id/logs`
- **صلاحية:** `admin` أو `employee` (مع التحقق من التعيين)

---

## مسارات مساعدة (موظفين) — تحت نفس الراوتر

> هذه المسارات لإدارة حسابات الموظفين وليست مهامًا صريحة، لكنها مُعرَّفة داخل `tasks` router:

| الطلب | المسار | الصلاحية | الوظيفة |
|--------|--------|----------|---------|
| POST | `/api/tasks/create-employee-record` | `admin` | تحويل المستخدم الحالي إلى `employee` وإنشاء سجل |
| POST | `/api/tasks/register-employee` | `admin` | إنشاء مستخدم + سجل موظف |

لإدارة الموظفين بالكامل راجع أيضًا مسارات **`/api/employees`** إن وُجدت في المشروع.

---

## رموز أخطاء شائعة

| HTTP | معنى تقريبي |
|------|-------------|
| `400` | بيانات ناقصة، أو موظف غير موجود (`ASSIGNEE_NOT_FOUND`)، أو انتقال حالة غير مسموح |
| `403` | المستخدم ليس مكلفًا بهذه المهمة أو غير مصرح (مثلاً ليس `admin`) |
| `404` | مهمة غير موجودة |
| `500` | خطأ خادم |

---

## ملاحظة للفرونت إند

- استخدم **`deadline`** في الطلبات والاستجابات؛ القيمة تُخزَّن كـ `due_date` في قاعدة البيانات.
- **`assigned_to`** هو **`employees.id`** وليس `users.id`.
- رتّب استدعاءات التنفيذ حسب دورة الحياة أعلاه لتفادي أخطاء `400` من قواعد الخادم.
