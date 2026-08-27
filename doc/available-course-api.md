# الكورس المتاح — Lecture Access & Assignment Modes

> ⚠️ **تحديث مهم:** وصول المحاضرات لم يعد على مستوى الكورس.  
> النظام الحالي موثّق هنا: **[course-lectures-system.md](./course-lectures-system.md)**  
> الأقسام أدناه عن `lecture_access_mode` على الكورس **قديمة** وتُتجاهل — استخدم `access_mode` عند إضافة المحاضرة.

إعدادات مرنة على مستوى الكورس للتحكم في **فتح المحاضرات** و**مكان الواجبات**، مع توافق خلفي كامل للكورسات الحالية.

Base: `/api/course`  
Auth: Bearer Token

**Migration:** `1776700000000_available_course_lecture_access.sql`

---

## إعدادات الكورس (Defaults للكورسات القديمة)

| Field | القيم | الافتراضي |
|-------|--------|-----------|
| `lecture_access_mode` | `always_open` \| `time_limited` \| `activation_code` | `always_open` |
| `assignment_mode` | `lecture_based` \| `course_based` | `lecture_based` |

### قراءة الإعدادات

`GET /api/course/:courseId/access-settings`

### تحديث الإعدادات (مدرس / أكاديمية)

`PATCH /api/course/:courseId/access-settings`

```json
{
  "lecture_access_mode": "time_limited",
  "assignment_mode": "course_based"
}
```

---

## أوضاع فتح المحاضرات

### 1) `always_open` (الحالي / الافتراضي)

- كل الطلاب المشتركين يدخلون كل المحاضرات.
- لا `expires_at` إلزامي.
- لا كود تفعيل محاضرة.

### 2) `time_limited`

- عند إنشاء محاضرة: **`expires_at` مطلوب**.
- بعد الموعد: Backend يرفض الدخول بحالة `expired`.

```http
POST /api/course/:courseId/lectures
```

```json
{
  "title": "محاضرة 1",
  "description": "...",
  "expires_at": "2026-08-15T23:59:00.000Z"
}
```

تحديث الموعد:

```http
PATCH /api/course/lecture/:lectureId
```

```json
{ "expires_at": "2026-08-20T23:59:00.000Z" }
```

### 3) `activation_code`

- **كل المحاضرات مقفولة** للطالب (بما فيها الأولى) حتى يدخل كود تفعيل صالح.
- في `GET /api/course/:courseId/details`: `locked: true` و `access_status: "requires_activation_code"` بدون روابط فيديو/ملفات.
- محاولة فتح فيديو أو محتوى المحاضرة بدون تفعيل → `403`.
- الطالب يفعّل بكود؛ المدة تُحسب **من لحظة استخدامه** لكل طالب على حدة.

#### إنشاء كود (مدرس)

`POST /api/course/lecture/:lectureId/activation-codes`

```json
{
  "code": "ABC123",
  "duration_hours": 2,
  "max_uses": 0
}
```

| Field | الوصف |
|-------|--------|
| `code` | اختياري — يُولَّد تلقائيًا إن لم يُرسل |
| `duration_hours` | مطلوب — مثل 1, 2, 6, 12, 24 أو أي رقم عشري |
| `max_uses` | `0` = غير محدود |

#### قائمة الأكواد / التفعيلات

- `GET /api/course/lecture/:lectureId/activation-codes`
- `GET /api/course/lecture/:lectureId/activations`
- `PATCH /api/course/lecture/:lectureId/activation-codes/:codeId/deactivate`

#### تفعيل من الطالب

`POST /api/course/lecture/activate-by-code`

```json
{ "code": "ABC123" }
```

```json
{
  "success": true,
  "message": "تم تفعيل المحاضرة بنجاح",
  "lecture": { "id": 10, "title": "...", "course_id": 15 },
  "activation": {
    "activated_at": "...",
    "expires_at": "...",
    "duration_hours": 2,
    "remaining_seconds": 7200
  }
}
```

---

## حالة وصول الطالب للمحاضرة

`GET /api/course/lecture/:lectureId/access-check`  
أو `GET /api/course/lecture/:lectureId/availability`

```json
{
  "can_access": false,
  "status": "requires_activation_code",
  "lecture_access_mode": "activation_code",
  "message": "يجب إدخال كود تفعيل لفتح هذه المحاضرة",
  "blocking_exams": [],
  "assignment_locked": false
}
```

| `status` | المعنى |
|----------|--------|
| `open` | متاحة |
| `locked` | مقفولة بسبب واجب/امتحان سابق |
| `expired` | انتهت مدة `expires_at` |
| `requires_activation_code` | يحتاج كود |
| `activated` | مفعّلة للطالب وضمن المدة |
| `activation_expired` | انتهت مدة تفعيله |
| `group_restricted` | المحاضرة لمجموعات محددة والطالب خارجها |
| `not_enrolled` | غير مشترك |

التحقق يُطبَّق أيضًا على:
- `GET /api/course/:courseId/details` (`locked` + `access_status`)
- `GET /api/course/video/:videoId`
- `canAccessLecture` في `/api/course-content`

---

## أوضاع الواجبات

### `lecture_based` (الافتراضي)

الواجبات كما هي عبر محاضرة:

`POST /api/course/lecture/:lectureId/exam` مع `type: "assignment"`

### `course_based`

نفس إعدادات وشكل واجب المحاضرة تمامًا، والفرق فقط أنه **مش جوه محاضرة** (قسم «واجب الكورس»).

بعد الإنشاء تستخدم **نفس APIs** الخاصة بالامتحان/الواجب عبر `examId`:
- أسئلة / تعديل / حذف / ظهور / إعدادات متقدمة
- بدء المحاولة والتسليم والتقارير عبر `/api/exams/...` و`ExamFlow`

#### إنشاء (نفس body واجب المحاضرة)

```http
POST /api/course/:courseId/exam
```

أو alias:

```http
POST /api/course/:courseId/assignments
```

```json
{
  "title": "واجب الوحدة الأولى",
  "type": "assignment",
  "total_grade": 20,
  "duration": 60,
  "is_visible": true,
  "show_at": null,
  "hide_at": null,
  "show_answers_immediately": true,
  "show_answers_after_hours": 0
}
```

Response (نفس شكل واجب المحاضرة):

```json
{ "exam": { "id": 12, "lecture_id": null, "course_id": 15, "type": "assignment", "...": "..." } }
```

#### قائمة

```http
GET /api/course/:courseId/exam?type=assignment
GET /api/course/:courseId/assignments
```

في `GET /api/course/:courseId/details` تظهر تحت:

- `course_assignments` / `assignments`
- `course.assignment_mode`

يتطلب `assignment_mode = course_based` وإلا إنشاء الواجب على مستوى الكورس يرجع `400`.

---

## Database

| Object | التغيير |
|--------|---------|
| `courses.lecture_access_mode` | نص + check |
| `courses.assignment_mode` | نص + check |
| `lectures.expires_at` | timestamptz nullable |
| `exams.course_id` | nullable FK؛ `lecture_id` أصبح nullable |
| `lecture_activation_codes` | أكواد المحاضرة |
| `lecture_activations` | تفعيل لكل طالب (unique lecture+user) |

---

## Breaking Changes

لا يوجد للكورسات القديمة: الافتراضيات = السلوك الحالي.  
الكورسات الجديدة فقط تحتاج ضبط الـ modes عند الرغبة في الأنظمة الجديدة.
