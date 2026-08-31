# نظام إدارة المهام المتكررة — Task Management API

> **Admin:** `/api/admin/task-management`  
> **Employee:** `/api/employee/my-tasks`  
> **ملاحظة:** لا يستبدل `/api/tasks` (المهام الرسمية) ولا `employee_daily_tasks` — يعمل بجانبهما.

---

## Architecture

```
Task Template (Master)
    └── Task Assignment (لكل موظف)
            └── Task Instance (يومي / أسبوعي)
                    ├── Notes
                    ├── Attachments
                    └── Activity Log
```

| الجدول | الوصف |
|--------|--------|
| `task_templates` | القالب — Daily / Weekly |
| `task_assignments` | ربط المهمة بموظف |
| `task_instances` | نسخة اليوم أو الأسبوع |
| `task_activity_logs` | سجل تدقيق |

**Migration:** `migrations/1778600000000_task_management_recurring.sql`

---

## Admin — إنشاء مهمة

```http
POST /api/admin/task-management/tasks
Authorization: Bearer <admin_token>
```

```json
{
  "title": "متابعة رسائل العملاء",
  "description": "الرد على جميع الرسائل الواردة",
  "task_type": "daily",
  "priority": "high",
  "start_date": "2026-08-28",
  "end_date": null,
  "scheduled_time": "17:00",
  "admin_notes": "أولوية قصوى"
}
```

| الحقل | مطلوب | القيم |
|-------|--------|-------|
| `task_type` | نعم | `daily` \| `weekly` |
| `priority` | لا | `low` \| `medium` \| `high` |
| `start_date` | نعم | YYYY-MM-DD |
| `scheduled_time` | لا | HH:mm |

---

## Admin — توزيع المهمة

```http
POST /api/admin/task-management/tasks/:taskId/assign
```

موظف واحد أو أكثر:

```json
{ "employee_ids": [3, 5, 7] }
```

جميع الموظفين:

```json
{ "assign_all": true }
```

---

## Admin — Dashboard

```http
GET /api/admin/task-management/dashboard
GET /api/admin/task-management/performance?startDate=2026-08-01&endDate=2026-08-31
GET /api/admin/task-management/tasks?search=&taskType=daily&status=active
GET /api/admin/task-management/tasks/:taskId
```

**إجراءات:** `PATCH` تعديل · `POST .../cancel` · `POST .../duplicate` · `DELETE` · `POST .../attachments`

---

## Employee — مهامي

```http
GET /api/employee/my-tasks
```

يرجع: مهام اليوم، مهام الأسبوع، المتأخرة، المكتملة، نسبة الإنجاز.

```http
GET /api/employee/my-tasks/daily?date=2026-08-28
GET /api/employee/my-tasks/weekly
GET /api/employee/my-tasks/overdue
GET /api/employee/my-tasks/completed
GET /api/employee/my-tasks/instances/:instanceId
POST /api/employee/my-tasks/instances/:instanceId/start
POST /api/employee/my-tasks/instances/:instanceId/complete
POST /api/employee/my-tasks/instances/:instanceId/notes
POST /api/employee/my-tasks/instances/:instanceId/attachments
```

**حالات Instance:** `pending` · `in_progress` · `completed` · `overdue` · `missed` · `cancelled`

---

## Cron (كل ساعة)

- إنشاء instances لليوم/الأسبوع الحالي
- إغلاق مهام الأمس غير المكتملة → `missed` / `overdue`
- تذكير قبل الموعد بساعة
- إشعار عند التوزيع

---

## Frontend (خارج هذا الـ repo)

واجهات مقترحة للـ React:

| Admin | Employee |
|-------|----------|
| Task Management | My Tasks |
| Create Task | Daily / Weekly tabs |
| Assign Employees | Overdue / Completed |
| Task Details + جدول الموظفين | Task Detail + Start/Complete |
| Dashboard + Performance | Progress % |

استخدم نفس تصميم `employeeWork` الحالي للاتساق.
