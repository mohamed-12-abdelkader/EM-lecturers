# ملف الطالب — Student Profile API

Base: `/api/student`

Auth: `Authorization: Bearer <student_jwt>` + سياق المنصة (subdomain / tenant)

---

## 1. جلب كل بيانات الطالب

### `GET /api/student/me`

يرجع بيانات الطالب + المجموعة الدراسية + مجموعة الكورس (إن وُجدت) + هل مسموح له يختار بنفسه.

```json
{
  "success": true,
  "id": 42,
  "name": "أحمد",
  "phone": "0100...",
  "email": null,
  "parent_phone": "0109...",
  "avatar": "https://...",
  "role": "student",
  "student_code": "10021",
  "account_status": "active",
  "must_change_password": false,
  "created_at": "...",
  "grades": [{ "id": 3, "name": "الصف الثالث الثانوي" }],

  "study_group": {
    "id": 5,
    "name": "مجموعة السبت",
    "teacher_id": 12,
    "start_time": "16:00",
    "end_time": "18:00",
    "days": "السبت,الثلاثاء",
    "grade_id": 3,
    "grade_name": "الصف الثالث الثانوي",
    "number_in_group": 7,
    "joined_at": "..."
  },
  "can_choose_study_group": true,
  "available_study_groups": [
    {
      "id": 5,
      "name": "مجموعة السبت",
      "start_time": "16:00",
      "end_time": "18:00",
      "days": "السبت,الثلاثاء",
      "grade_id": 3,
      "grade_name": "الصف الثالث الثانوي",
      "students_count": 18
    }
  ],

  "course_group": {
    "id": 2,
    "name": "مجموعة أ",
    "grade_id": 3,
    "grade_name": "الصف الثالث الثانوي",
    "status": "active",
    "joined_at": "..."
  },
  "can_choose_course_group": true,
  "available_course_groups": []
}
```

| حقل | المعنى |
|-----|--------|
| `study_group` | المجموعة الدراسية الحالية (`study_groups` عبر `group_students`) أو `null` |
| `can_choose_study_group` | من إعداد المنصة `students_can_choose_study_group` |
| `available_study_groups` | تظهر فقط إذا `can_choose_study_group = true` |
| `course_group` | مجموعة الكورس الحالية إن وُجدت |
| `can_choose_course_group` | من `course_group_access_enabled` للمدرس |
| `available_course_groups` | تظهر فقط إذا الاختيار مفعّل |

---

## 2. تعديل بيانات الطالب (ومجموعته)

### `PUT /api/student/me`

```json
{
  "name": "أحمد محمد",
  "phone": "01001234567",
  "parent_phone": "01099887766",
  "email": null,
  "password": "new-pass",
  "group_id": 5,
  "course_group_id": 2
}
```

- كل الحقول اختيارية؛ أرسل ما تريد تغييره فقط.
- `group_id` يعمل افتراضيًا من تعديل البروفايل؛ يُرفض بـ `403` فقط إذا المدرس قفل الاختيار (`students_can_choose_study_group: false`).
- `course_group_id` يعمل فقط إذا `course_group_access_enabled = true` وإلا → `403`.
- استجابة النجاح: نفس شكل `GET /me` بعد التحديث + `message`.

---

## 3. تفعيل اختيار المجموعة الدراسية (المدرس)

### `PUT /api/teacher/students/registration-settings`

```json
{
  "students_can_choose_study_group": true
}
```

يُقرأ أيضًا من:

- `GET /api/teacher/students/registration-settings`
- `GET /api/tenants/public/:subdomain/registration-settings`

القيمة الافتراضية: `true` (الطالب يقدر يغيّر مجموعته من البروفايل).  
لقفل الاختيار: أرسل `students_can_choose_study_group: false`.
