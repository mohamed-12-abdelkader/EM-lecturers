# Employee Work Management API

نظام إدارة دوام الموظفين والمهام اليومية. **لا يستبدل** نظام `/api/tasks` العام الحالي.

- Auth: نفس JWT الموجود (`authMiddleware`)
- Admin: `role = admin`
- Employee: `role = employee` — يصل فقط لبياناته عبر `user_id`
- توقيت المنصة: `PLATFORM_TIMEZONE` (افتراضي `Africa/Cairo`) — بداية/نهاية العمل وحالات التأخير تُحسب من **وقت السيرفر** فقط

## Migration

```bash
npm run migrate up
```

ملف: `migrations/1778200000000_employee_work_management.sql`

عند التشغيل لأول مرة بدون migration، الخدمات تنفّذ `ensureSchema` تلقائيًا (أعمدة/جداول أساسية). يُفضّل تشغيل الـ migration لضمان الفهارس والـ CHECK constraints.

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PLATFORM_TIMEZONE` | `Africa/Cairo` | تاريخ/وقت اليوم للمنصة |

## Database Schema

### `employees` (امتداد)

| Column | Type | Notes |
|--------|------|-------|
| `employee_code` | VARCHAR(32) UNIQUE (partial) | يُولَّد تلقائيًا إن لم يُرسل |
| `department` | TEXT | اختياري |
| `job_title` | TEXT | اختياري |
| `work_start_time` | TIME | افتراضي 09:00 |
| `work_end_time` | TIME | افتراضي 17:00 |
| `is_active` | boolean | status: active/inactive |

### `employee_work_sessions`

سجل حضور يومي — `UNIQUE (employee_id, work_date)`

- `start_status`: early | on_time | late
- `end_status`: early_leave | on_time | overtime
- `status`: not_started | working | completed | absent

### `employee_daily_tasks`

مهام يومية مرتبة (`sort_order` → `order` في الـ JSON)

- `priority`: low | medium | high | urgent
- `status`: pending | in_progress | completed | cancelled

---

## Employee APIs (`Authorization: Bearer` + role employee)

Base: `/api/employee`

### `GET /today`

لوحة يوم العمل الحالي.

```json
{
  "success": true,
  "data": {
    "employee": { "id": 1, "employee_code": "EMP01001", "work_start_time": "09:00", "work_end_time": "17:00", "status": "active" },
    "work_session": null,
    "tasks": [],
    "statistics": {
      "total": 0,
      "completed": 0,
      "in_progress": 0,
      "pending": 0,
      "cancelled": 0,
      "completion_percentage": 0
    },
    "in_progress_task": null,
    "date": "2026-08-25"
  }
}
```

### `GET /me`

بيانات الموظف + جدول العمل فقط.

### `POST /work/start`

يبدأ جلسة اليوم (server time). يمنع التكرار (409).

Response:

```json
{
  "success": true,
  "data": {
    "work_session": { "status": "working", "actual_start_time": "...", "start_status": "on_time", "scheduled_end_time": "17:00" },
    "tasks": [{ "id": 1, "title": "...", "order": 1, "status": "pending" }]
  }
}
```

### `POST /work/end`

ينهي جلسة اليوم ويحسب `worked_minutes` و `end_status`.

### `GET /tasks`

Query: `date`, `startDate`, `endDate`, `status`, `priority`, `page`, `limit`

### `GET /tasks/:taskId`

تفاصيل مهمة واحدة تخص الموظف الحالي. إذا كانت `completed` يظهر تقرير الإنجاز داخل `execution`.

```json
{
  "success": true,
  "data": {
    "id": 4,
    "title": "مراجعة الطلبات",
    "description": "...",
    "task_date": "2026-08-26",
    "priority": "high",
    "order": 1,
    "status": "completed",
    "employee": { "id": 2, "name": "أحمد", "employee_code": "EMP01001" },
    "execution": {
      "started_at": "...",
      "completed_at": "...",
      "duration_minutes": 45,
      "duration": "0h 45m",
      "completion_report": "تم مراجعة جميع الطلبات...",
      "has_report": true
    },
    "created_by_admin": { "id": 1, "name": "Admin" }
  }
}
```

### `POST /tasks/:taskId/start`

يبدأ مهمة اليوم الحالي الخاصة بالموظف فقط.

### `POST /tasks/:taskId/complete`

Body:

```json
{ "completion_report": "تم تنفيذ المهمة..." }
```

(يدعم أيضًا `completionReport`)

### `GET /attendance`

سجل حضور الموظف الحالي — pagination + `startDate` / `endDate`

---

## Admin APIs (`role = admin`)

Base: `/api/admin/employees`

### `GET /work-status?date=YYYY-MM-DD`

لوحة حالة جميع الموظفين النشطين لليوم.

### `GET /performance-report?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

تقرير أداء **كل الموظفين** لفترة زمنية (Admin فقط).

Query اختياري: `status=active|inactive|all` (افتراضي active), `search`

مثال:
```
GET /api/admin/employees/performance-report?startDate=2026-08-01&endDate=2026-08-26
```

Response (مختصر):
```json
{
  "success": true,
  "data": {
    "period": { "start_date": "2026-08-01", "end_date": "2026-08-26" },
    "summary": {
      "employees_count": 10,
      "avg_late_percentage": 18.5,
      "avg_completion_percentage": 72.0,
      "avg_delivery_percentage": 90.0,
      "total_tasks": 120,
      "total_completed_tasks": 86,
      "total_late_days": 15
    },
    "employees": [
      {
        "employee": { "id": 2, "name": "أحمد", "employee_code": "EMP01001" },
        "attendance": {
          "sessions_count": 20,
          "late_days": 4,
          "on_time_days": 14,
          "early_days": 2,
          "early_leave_days": 1,
          "overtime_days": 3,
          "late_percentage": 20,
          "on_time_percentage": 70,
          "avg_worked_minutes": 480
        },
        "tasks": {
          "total": 40,
          "completed": 32,
          "pending": 5,
          "in_progress": 2,
          "cancelled": 1,
          "delivered_on_time": 28,
          "completion_percentage": 82.1,
          "delivery_percentage": 87.5,
          "avg_completion_minutes": 55
        }
      }
    ]
  }
}
```

معاني النسب:
- **late_percentage**: نسبة أيام الحضور التي بدأ فيها متأخرًا
- **completion_percentage**: نسبة المهام المكتملة (من غير الملغاة)
- **delivery_percentage**: من المهام المكتملة، نسبة ما أُنجز في نفس يوم المهمة أو قبله

### `GET /`

قائمة موظفين. Query: `search`, `status=active|inactive|all`, `page`, `limit`

### `POST /`

إنشاء موظف (يستخدم نفس إنشاء المستخدم بدور `employee`).

```json
{
  "name": "أحمد",
  "email": "emp@example.com",
  "password": "secret12",
  "phone": "01000000000",
  "permissions": [],
  "department": "Support",
  "job_title": "Agent",
  "employee_code": "EMP01050",
  "work_start_time": "09:00",
  "work_end_time": "17:00"
}
```

### `GET /:employeeId`

تفاصيل + جدول عمل + اليوم + حضور حديث + مهام.

Query pagination للحضور: `page`, `limit`

### `PUT|PATCH /:employeeId`

تعديل إداري (بما فيه `work_start_time`, `work_end_time`, `status` / `is_active`, `employee_code`).

### `DELETE /:employeeId`

تعطيل الموظف (`is_active = false`) — لا يحذف السجلات التاريخية.

### `GET /:employeeId/tasks`

### `POST /:employeeId/tasks`

```json
{
  "title": "مراجعة الطلبات",
  "description": "...",
  "task_date": "2026-08-25",
  "priority": "high",
  "order": 1
}
```

### `PATCH /:employeeId/tasks/reorder`

```json
{
  "task_date": "2026-08-25",
  "ordered_ids": [12, 15, 9, 3]
}
```

### `PATCH /:employeeId/tasks/:taskId`

### `DELETE /:employeeId/tasks/:taskId`

### `GET /:employeeId/attendance?startDate=&endDate=&page=&limit=`

### `GET /:employeeId/tasks/report?startDate=&endDate=&status=&priority=`

إحصائيات + متوسط مدة الإنجاز + قائمة المهام.

### `GET /:employeeId/tasks/:taskId`

تفاصيل مهمة موظف (نفس شكل Response الموظف) — يتضمن `execution.completion_report` عند الإنجاز.

### `GET /:employeeId/daily-report?date=2026-08-25`

تقرير يوم واحد (حضور + مهام + نسبة الإنجاز).

### `GET /:employeeId/reports?startDate=&endDate=`

حضور + تقرير مهام مجمّع.

---

## توافق مع الـ APIs القديمة

| Path | Notes |
|------|--------|
| `/api/employees/*` | CRUD القديم (avatar/password) ما زال يعمل |
| `/api/admin/employees` (list/create/detail) | يُخدم الآن عبر الموديول الجديد أولًا |
| `/api/admin/employees/:id/avatar` و `.../password` | تبقى عبر الراوتر القديم (fallthrough) |
| `/api/tasks` | نظام المهام العام — **منفصل** تمامًا عن `employee_daily_tasks` |

## ملاحظات للـ Frontend

1. استخدم وقت السيرفر فقط — لا ترسل `actualStartTime` من العميل.
2. بعد `POST /work/start` اعرض `data.tasks` مرتبة حسب `order`.
3. أكمل المهمة عبر `completion_report` نصي إلزامي.
4. لوحة الأدمن: `GET /api/admin/employees/work-status`.
5. لوحة الموظف: `GET /api/employee/today` كـ single request.
6. الحذف = تعطيل؛ استخدم `PATCH` مع `status: "active"` لإعادة التفعيل.
7. تأكد أن توكن الموظف يحمل `role: "employee"`.
