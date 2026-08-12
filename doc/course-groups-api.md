# مجموعات الكورسات — Course Groups API

نظام **مستقل تمامًا** عن `centerMgmt` / `study_groups` / الحضور / الجداول.

Base teacher: `/api/teacher/course-groups`  
Public: `/api/tenants/public/:subdomain/course-groups`

Migration: `1776800000000_course_groups_system.sql`

---

## 1. إعدادات المدرس

| Field | Default | المعنى |
|-------|---------|--------|
| `course_group_access_enabled` | `false` | تعطيل = النظام الحالي بدون تغيير |

### GET `/api/teacher/course-groups/settings`

```json
{
  "success": true,
  "teacher_id": 5,
  "course_group_access_enabled": false
}
```

### PATCH `/api/teacher/course-groups/settings`

```json
{ "course_group_access_enabled": true }
```

---

## 2. إدارة المجموعات

### GET `/api/teacher/course-groups?grade_id=3`

```json
{
  "success": true,
  "groups": [
    {
      "id": 1,
      "teacher_id": 5,
      "grade_id": 3,
      "name": "مجموعة السبت",
      "description": null,
      "status": "active",
      "grade_name": "الصف الثالث الثانوي",
      "students_count": 12
    }
  ]
}
```

### POST `/api/teacher/course-groups`

```json
{
  "grade_id": 3,
  "name": "مجموعة الأحد",
  "description": "اختياري"
}
```

### PATCH `/api/teacher/course-groups/:groupId`

### DELETE `/api/teacher/course-groups/:groupId`

تعطيل soft (`status = inactive`) — `lecture_course_groups` تُحذف تلقائيًا عند حذف المجموعة (CASCADE).

---

## 3. طلاب المجموعة

### GET `/api/teacher/course-groups/:groupId/students`

### POST `/api/teacher/course-groups/:groupId/students`

```json
{ "student_id": 42 }
```

### DELETE `/api/teacher/course-groups/:groupId/students/:studentId`

**قاعدة:** طالب واحد = مجموعة واحدة نشطة لكل مدرس (يُستبدل العضوية السابقة تلقائيًا).

---

## 4. تسجيل الطالب / اختيار المجموعة

### GET `/api/tenants/public/:subdomain/registration-settings`

```json
{
  "data": {
    "course_group_access_enabled": true,
    "requires_course_group_selection": true
  }
}
```

### GET `/api/tenants/public/:subdomain/course-groups?grade_id=3`

```json
{
  "data": {
    "course_group_access_enabled": true,
    "grade_id": 3,
    "groups": [{ "id": 1, "name": "مجموعة السبت", "grade_id": 3 }]
  }
}
```

### POST `/api/user/register`

```json
{
  "phone": "+201234567890",
  "password": "secret",
  "name": "أحمد",
  "parent_phone": "+201098765432",
  "grade_id": 3,
  "course_group_id": 1,
  "subdomain": "teacher-slug"
}
```

### POST `/api/teacher/course-groups/me/membership` (طالب)

```json
{ "course_group_id": 1, "grade_id": 3 }
```

### GET `/api/teacher/course-groups/me/membership`

---

## 5. استهداف المحاضرات

| `access_type` | السلوك |
|---------------|--------|
| `all` | كل المشتركين (default) |
| `groups` | مجموعات محددة فقط |

### إنشاء محاضرة

`POST /api/course/:courseId/lectures`

```json
{
  "title": "محاضرة 1",
  "access_type": "groups",
  "group_ids": [1, 2, 3]
}
```

### تحديث

`PATCH /api/course/lecture/:lectureId`

```json
{
  "access_type": "groups",
  "group_ids": [1, 2]
}
```

أو:

`PUT /api/teacher/course-groups/lectures/:lectureId/groups`

```json
{
  "access_type": "groups",
  "group_ids": [1, 2, 3]
}
```

---

## 6. Authorization (Backend enforced)

عند وصول الطالب لمحاضرة / فيديو / محتوى:

1. مشترك في الكورس؟
2. `course_group_access_enabled` للمدرس؟
3. `access_type = all` → ✅
4. `access_type = groups` → مجموعة الطالب ضمن `lecture_course_groups`؟
5. ثم باقي قواعد `LectureAccessService` (time_limited / activation_code)

**403** + `status: "group_restricted"` عند المنع.

**قائمة المحاضرات:** SQL filter في `GET /api/course/:courseId/details` — لا تُرجع محاضرات خارج مجموعة الطالب.

---

## 7. Database

| Table | Purpose |
|-------|---------|
| `teacher_course_settings` | toggle per teacher |
| `course_groups` | مجموعات المدرس + grade |
| `student_course_group_memberships` | عضوية الطالب |
| `lectures.access_type` | `all` \| `groups` |
| `lecture_course_groups` | pivot |

---

## 8. Backward Compatibility

- `course_group_access_enabled = false` → zero behavior change
- `lectures.access_type` default = `all`
- لا Group membership مطلوب للاشتراك في الكورس

---

## 9. Frontend

1. إعدادات المدرس: toggle + CRUD groups
2. عند التسجيل: إذا `requires_course_group_selection` → اختيار grade ثم group
3. إنشاء محاضرة: `access_type` + multi-select groups
4. للطالب: لا UI للمحاضرات المخفية؛ handle `403 group_restricted`
