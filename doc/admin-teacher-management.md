# Admin Teacher Management APIs

هذا المستند يوضح APIs الجديدة لإدارة المدرسين من لوحة الأدمن مع دعم:
- تحديث بيانات المدرس (جزئي/كامل) مع مزامنة الصفوف الدراسية.
- حذف المدرس نهائياً مع تنظيف العلاقات الأساسية.
- تفعيل/تعطيل/إيقاف حساب المدرس.

> Base path: `http://localhost:8000/api/admin/teachers`

---

## 1) Get Teacher Details

**Endpoint:** `GET /api/admin/teachers/:id`  
**Auth:** `Bearer <admin_token>`

يرجع بيانات المدرس مع الصفوف الدراسية المرتبطة به.

### Example request

```bash
curl -X GET "http://localhost:8000/api/admin/teachers/25" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader"
```

### Success response (200)

```json
{
  "success": true,
  "data": {
    "id": 25,
    "name": "محمد عبدالقادر",
    "email": "teacher@example.com",
    "phone": null,
    "avatar": "https://res.cloudinary.com/.../avatar.jpg",
    "subject": "رياضيات",
    "description": "مدرس خبرة 10 سنوات",
    "account_status": "active",
    "created_at": "2026-05-05T10:00:00.000Z",
    "grades": [
      { "id": 1, "name": "الصف الأول الإعدادي", "slug": "prep-1", "stage": "prep", "status": "active" }
    ]
  }
}
```

---

## 2) Update Teacher

**Endpoint:** `PUT /api/admin/teachers/:id`  
**Auth:** `Bearer <admin_token>`  
**Tenant:** يعتمد على Host أو `X-Tenant-Subdomain`.

يدعم:
- `application/json`
- `multipart/form-data` (لرفع `avatar`)

### Request fields

| Field | Type | Required | Notes |
|------|------|----------|------|
| `name` | string | no | min 2 |
| `email` | string | no | unique داخل نفس tenant |
| `phone` | string | no | رقم هاتف صحيح + unique داخل tenant |
| `password` | string | no | min 6 |
| `subject` | string | no | المادة |
| `description` | string | no | نبذة |
| `account_status` | enum | no | `active` / `inactive` / `suspended` |
| `grade_ids` | number[] | no | sync كامل لعلاقة المدرس-الصفوف |
| `avatar` | file | no | صورة جديدة (multipart فقط) |

`grade_ids` في multipart يمكن إرساله كـ:
- JSON string: `"[1,2,3]"`
- CSV string: `"1,2,3"`

### Example JSON request

```bash
curl -X PUT "http://localhost:8000/api/admin/teachers/25" ^
  -H "Content-Type: application/json" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader" ^
  -d "{\"name\":\"محمد عبدالقادر\",\"subject\":\"رياضيات\",\"description\":\"مدرس خبرة 10 سنوات\",\"grade_ids\":[1,2,4],\"account_status\":\"active\"}"
```

### Example multipart request

```bash
curl -X PUT "http://localhost:8000/api/admin/teachers/25" ^
  -H "Authorization: Bearer YOUR_ADMIN_JWT" ^
  -H "X-Tenant-Subdomain: mohamed-abdelkader" ^
  -F "name=محمد عبدالقادر" ^
  -F "grade_ids=[1,2,4]" ^
  -F "avatar=@C:\path\to\new-avatar.jpg"
```

### Success response (200)

```json
{
  "success": true,
  "message": "Teacher updated successfully",
  "data": {
    "id": 25,
    "name": "محمد عبدالقادر",
    "email": "teacher@example.com",
    "phone": null,
    "avatar": "https://res.cloudinary.com/.../new-avatar.jpg",
    "subject": "رياضيات",
    "description": "مدرس خبرة 10 سنوات",
    "account_status": "active",
    "created_at": "2026-05-05T10:00:00.000Z",
    "grades": [
      { "id": 1, "name": "الصف الأول الإعدادي", "slug": "prep-1", "stage": "prep", "status": "active" }
    ]
  }
}
```

---

## 3) Update Teacher Status

**Endpoint:** `PATCH /api/admin/teachers/:id/status`  
**Auth:** `Bearer <admin_token>`

### Request body

```json
{
  "status": "inactive"
}
```

القيم المتاحة:
- `active`
- `inactive`
- `suspended`

### Success response

```json
{
  "success": true,
  "message": "Teacher status updated"
}
```

---

## 4) Delete Teacher

**Endpoint:** `DELETE /api/admin/teachers/:id`  
**Auth:** `Bearer <admin_token>`

### Behaviour

- يحذف المستخدم المدرس نهائياً من `users`.
- يحذف علاقات `teacher_grades`.
- يحذف بيانات النشاط الأساسية (`teacher_activities`, `teacher_activity_log`).
- يحذف كورسات المدرس وسجلات الاشتراك المرتبطة بها (enrollments).
- يحاول حذف صورة المدرس من Cloudinary (best effort).

### Success response

```json
{
  "success": true,
  "message": "Teacher deleted successfully"
}
```

---

## 5) Notes About Login / Visibility

- المدرس الذي `account_status != active` لا يستطيع تسجيل الدخول (`/api/login` يعيد 403).
- استعلامات عرض المدرسين للطلاب تعتمد فقط على المدرسين `active`.

---

## 6) Related Migration

تمت إضافة Migration:
- `1772108100000_enhance_grades_and_teacher_account_status.sql`

وتشمل:
- تطوير جدول `grades` (`slug`, `stage`, `status`) + seed للصفوف المطلوبة.
- إضافة `users.account_status` بقيم (`active`, `inactive`, `suspended`).
