# نظام الأكاديميات — Academy API

يضيف المنصة نوعين من المنصات دون كسر منصة المدرس الحالية:

| `platform_type` | دور المالك | الوصف |
|-----------------|------------|--------|
| `teacher` (افتراضي) | `teacher` | منصة مدرس كما هي |
| `academy` | `academy` | منصة أكاديمية تدير مدرّسين وكورسات |

أدوار إضافية:

- `academy` — مالك الأكاديمية (صلاحيات إدارة المنصة + المحتوى)
- `academy_teacher` — مدرس تابع لأكاديمية؛ يدير **فقط** الكورسات المسندة إليه

---

## إنشاء منصة أكاديمية

نفس مسار التسجيل العام أو إنشاء المستأجر من الأدمن، مع:

```json
{
  "platform_type": "academy",
  "subdomain": "bright-academy",
  "display_name": "أكاديمية النور",
  "owner": {
    "name": "إدارة الأكاديمية",
    "email": "owner@academy.test",
    "password": "secret12"
  }
}
```

- Public: `POST /api/tenants/public/register`
- Admin: `POST /api/super/tenants` (نفس الحقل)

يُنشأ المستخدم المالك بـ `role = academy` و`tenants.platform_type = academy`.

---

## Academy Dashboard APIs

Base: `/api/academy`  
Auth: Bearer token — دور `academy` (ما لم يُذكر خلاف ذلك)

| Method | Path | الوصف |
|--------|------|--------|
| `GET` | `/overview` | إحصائيات: طلاب، مدرسون، كورسات، إسنادات |
| `GET` | `/teachers` | قائمة مدرسي الأكاديمية + كورساتهم المسندة |
| `POST` | `/teachers` | إضافة مدرس (`academy_teacher`) — يدعم `multipart` للصورة |
| `PATCH` | `/teachers/:userId` | تعديل بيانات / حالة المدرس |
| `DELETE` | `/teachers/:userId` | تعطيل وإلغاء الإسنادات |
| `GET` | `/courses` | كورسات الأكاديمية مع المدراء |
| `POST` | `/courses/:courseId/assign` | إسناد مدرس لكورس |
| `DELETE` | `/courses/:courseId/assign/:teacherUserId` | إلغاء الإسناد |

### إنشاء مدرس

`POST /api/academy/teachers`

```json
{
  "name": "أحمد",
  "email": "ahmed@academy.test",
  "password": "secret12",
  "phone": "0100...",
  "subject": "Chemistry",
  "grade_ids": [1, 2]
}
```

أو `multipart/form-data` مع حقل `avatar`.

### إسناد كورس

`POST /api/academy/courses/:courseId/assign`

```json
{
  "teacher_user_id": 42,
  "is_primary": true
}
```

العلاقة many-to-many في `course_managers` (قابلة لتعدد المدرسين لاحقاً).

---

## Academy Teacher Dashboard

Auth: دور `academy_teacher`

| Method | Path | الوصف |
|--------|------|--------|
| `GET` | `/api/academy/me/dashboard` | ملخص + الكورسات المسندة |
| `GET` | `/api/academy/me/courses` | قائمة الكورسات المسندة فقط |

إدارة المحتوى تتم عبر APIs الموجودة (`/api/course/...`, `/api/exams/...`, `/api/course-content/...`) بعد التحقق من الإسناد — نفس أدوات المدرس داخل الكورس الممنوح فقط.

`GET /api/course/my-courses` يعيد الكورسات المدارة حسب الدور (مدرس / أكاديمية / مسندة).

---

## إنشاء كورس من حساب الأكاديمية

`POST /api/course/` مع دور `academy` (وليس `academy_teacher`):

- يُسجَّل `teacher_id` = مالك الأكاديمية
- يُسجَّل `tenant_id` = منصة الأكاديمية
- حقل اختياري: `subject` (المادة)

ثم الإسناد عبر `/api/academy/courses/:id/assign`.

---

## قواعد الصلاحيات (Backend)

| العملية | teacher | academy | academy_teacher |
|---------|---------|---------|-----------------|
| إنشاء منصة / أكاديمية | نعم (منصته) | نعم (منصته) | لا |
| إنشاء كورس | نعم | نعم | لا |
| حذف كورس | نعم (ملكه) | نعم (منصته) | لا |
| إدارة محتوى كورس | ملكه | كورسات المنصة | المسند فقط |
| إضافة مدرسين | — | نعم | لا |
| إسناد كورسات | — | نعم | لا |

عند رفض الصلاحية: **403** مع رسالة واضحة / `COURSE_FORBIDDEN`.

---

## جداول قاعدة البيانات

- `tenants.platform_type` — `teacher` | `academy`
- `courses.subject`, `courses.tenant_id`
- `academy_teachers` — ربط `academy_teacher` بالمنصة
- `course_managers` — إسناد إدارة كورس لمستخدم (many-to-many)

Migrations:

- `1776400000000_add_academy_roles.sql`
- `1776500000000_create_academy_system.sql`

---

## Frontend توجيه مقترح

| Role | بعد الدخول |
|------|------------|
| `teacher` | Dashboard المدرس الحالي |
| `academy` | Academy Dashboard (`/academy/...`) |
| `academy_teacher` | Dashboard محدود بالكورسات المسندة (`/academy/me/...` + أدوات الكورس) |
