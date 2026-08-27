# نظام محاضرات الكورس (الوضع الحالي)

توثيق كامل لطريقة عمل المحاضرات في الكورسات العادية (`lectures`).

> **مهم:** وصول المحاضرة يُحدد **لكل محاضرة** عند الإضافة/التعديل عبر `access_mode`.  
> تم إلغاء `lecture_access_mode` على مستوى الكورس.

Base API: `/api/course`  
Auth: Bearer JWT

Migrations ذات الصلة:
- `1776700000000_available_course_lecture_access.sql` — أكواد التفعيل + جداول التفعيل
- `1776800000000_course_groups_system.sql` — مجموعات الكورس
- `1778400000000_lecture_per_lecture_access_mode.sql` — `lectures.access_mode`

```bash
npm run migrate up
```

---

## 1) الفكرة العامة

كل محاضرة لها:

| الحقل | الوصف |
|--------|--------|
| `title` / `description` / `position` | بيانات أساسية |
| `is_visible` | ظاهرة للطلاب أم مخفية |
| `access_mode` | كيف يُفتح المحتوى للطالب |
| `expires_at` | اختياري — موعد انتهاء إضافي إن وُجد |
| `group_ids` | عند `access_mode = groups` |

ثم تُضاف للفيديو/الملفات/الامتحانات على نفس المحاضرة.

---

## 2) أوضاع الوصول `access_mode`

يختارها المدرس **عند إنشاء المحاضرة** (أو يعدلها لاحقًا):

| `access_mode` | المعنى للطالب المشترك في الكورس |
|---------------|----------------------------------|
| `open` | مفتوحة للكل فورًا |
| `activation_code` | مقفولة للكل — لازم كود تفعيل للمحاضرة |
| `groups` | **مفتوحة بدون كود** لطلاب المجموعات المحددة، و**ظاهرة ومقفولة بكود** لباقي الطلاب |

```
                    ┌─────────────────┐
  إنشاء محاضرة ───► │  access_mode    │
                    └────────┬────────┘
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
           open      activation_code     groups
              │              │              │
         الكل يدخل      يحتاج كود     ┌─────┴──────┐
                                      ▼            ▼
                                 في المجموعة   خارج المجموعة
                                 مفتوحة        ظاهرة + كود
```

### ملاحظات

- الاشتراك في الكورس شرط أساسي في كل الحالات.
- محاضرات `groups` **تظهر لكل الطلاب** المشتركين.
- عضو المجموعة المحددة → يدخل مباشرة (`open` / `open_via_group: true`).
- طالب خارج المجموعة → نفس تجربة المحاضرة المغلقة: `requires_activation_code` حتى يدخل كودًا.
- لذلك مع `access_mode=groups` يجب إنشاء أكواد تفعيل لغير أعضاء المجموعة.

---

## 3) إنشاء محاضرة (مدرس)

```
POST /api/course/:courseId/lectures
Authorization: Bearer <teacher_token>
```

### أ) مفتوحة للكل

```json
{
  "title": "مقدمة الكورس",
  "description": "شرح البداية",
  "access_mode": "open"
}
```

### ج) لمجموعات محددة (+ أكواد لطلاب المجموعات الأخرى)

نفس خصائص المحاضرة بالكود: **لازم إنشاء كود تفعيل واحد على الأقل** لطلاب خارج المجموعة.

```json
{
  "title": "محاضرة مجموعة أ",
  "access_mode": "groups",
  "group_ids": [3, 7],
  "duration_hours": 48,
  "max_uses": 0
}
```

أو أكواد متعددة صراحة:

```json
{
  "title": "محاضرة مجموعة أ",
  "access_mode": "groups",
  "group_ids": [3, 7],
  "activation_codes": [
    { "duration_hours": 48, "max_uses": 20 },
    { "code": "GROUPB01", "duration_hours": 72, "max_uses": 10 }
  ]
}
```

Response:

```json
{
  "lecture": {
    "id": 55,
    "access_mode": "groups",
    "group_ids": [3, 7],
    "supports_activation_codes": true
  },
  "activation_codes": [
    { "id": 1, "code": "XK9P2Q", "duration_hours": 48, "max_uses": 0 }
  ],
  "note": "المجموعات المحددة تدخل بدون كود — باقي الطلاب يستخدمون أكواد التفعيل المُنشأة"
}
```

| من | النتيجة |
|----|---------|
| طالب في group 3 أو 7 | مفتوحة بدون كود |
| طالب من مجموعة أخرى | ظاهرة ومقفولة → يستخدم الكود |

إضافة كود لاحقًا (نفس API المحاضرة المغلقة):

```
POST /api/course/lecture/:lectureId/activation-codes
{ "duration_hours": 24, "max_uses": 5, "code": "EXTRA01" }
```

### ب) مقفولة بكود للجميع

```json
{
  "title": "محاضرة مدفوعة بالمحتوى",
  "access_mode": "activation_code",
  "duration_hours": 48
}
```

أو:

```json
{
  "title": "محاضرة مدفوعة بالمحتوى",
  "access_mode": "activation_code",
  "activation_codes": [{ "duration_hours": 48, "max_uses": 0 }]
}
```

> بدون `duration_hours` أو `activation_codes` يرجع Validation Error.
---

## 4) تعديل محاضرة

```
PATCH /api/course/lecture/:lectureId
```

يمكن تغيير العنوان، الوصف، الظهور، ووضع الوصول:

```json
{
  "title": "عنوان جديد",
  "is_visible": true,
  "access_mode": "open"
}
```

أو التحويل لمجموعات:

```json
{
  "access_mode": "groups",
  "group_ids": [1, 2]
}
```

أو لكود تفعيل:

```json
{
  "access_mode": "activation_code"
}
```

### إظهار / إخفاء فقط

```
PATCH /api/course/lecture/:lectureId/visibility
{ "is_visible": false }
```

---

## 5) أكواد تفعيل المحاضرة

تعمل إذا كانت المحاضرة `access_mode = activation_code` **أو** `groups` (لغير أعضاء المجموعة).

| Method | URL | من |
|--------|-----|-----|
| POST | `/api/course/lecture/:lectureId/activation-codes` | مدرس |
| GET | `/api/course/lecture/:lectureId/activation-codes` | مدرس |
| PATCH | `/api/course/lecture/:lectureId/activation-codes/:codeId/deactivate` | مدرس |
| GET | `/api/course/lecture/:lectureId/activations` | مدرس (من فعّل) |
| POST | `/api/course/lecture/activate-by-code` | طالب |

تفعيل الطالب:

```json
POST /api/course/lecture/activate-by-code
{ "code": "ABC12XYZ" }
```

بعد التفعيل يحصل على نافذة زمنية حسب `duration_hours`. عند انتهائها: `activation_expired`.

---

## 6) مجموعات الكورس وعلاقتها بالمحاضرات

- المجموعات من نظام `/api/teacher/course-groups`
- عند اختيار `access_mode=groups` يُفعَّل نظام المجموعات للمدرس تلقائيًا إن لم يكن مفعّلًا
- الطالب يرى المحاضرة فقط إذا كان عضوًا في إحدى `group_ids` المرتبطة

---

## 7) ماذا يرى الطالب؟

### تفاصيل الكورس

```
GET /api/course/:courseId/details
```

لكل محاضرة ظاهرة (`is_visible`) وبما يسمح به وضع الوصول يظهر تقريبًا:

```json
{
  "id": 55,
  "title": "...",
  "access_mode": "activation_code",
  "lecture_access_mode": "activation_code",
  "locked": true,
  "access_status": "requires_activation_code",
  "can_access": false,
  "activation": null
}
```

| `access_status` / `status` | المعنى |
|----------------------------|--------|
| `open` | متاحة |
| `requires_activation_code` | محتاج كود (محاضرة مغلقة، أو groups وهو خارج المجموعة) |
| `activated` | مفعّلة وبها وقت متبقٍ |
| `activation_expired` | انتهت مدة التفعيل |
| `group_restricted` | نادرًا — لم يعد يُستخدم لإخفاء محاضرات المجموعات |
| `not_enrolled` | غير مشترك في الكورس |

حقل إضافي في وضع `groups`:
- `open_via_group: true` → فُتحت لأنه ضمن المجموعة
- `open_via_group: false` → يراها بالكود / مقفولة بالكود

عند القفل: لا تُرسل روابط الفيديو/الملفات.

### فحص وصول محاضرة

```
GET /api/course/lecture/:lectureId/access-check
GET /api/course/lecture/:lectureId/availability
```

---

## 8) طبقات الحماية (ترتيب التحقق)

1. **اشتراك الكورس** — لازم enrolled ونشط  
2. **`access_mode` للمحاضرة**
   - `open` → مسموح  
   - `groups` → إن كان في المجموعة المسموحة → مسموح؛ وإلا → يحتاج كود تفعيل  
   - `activation_code` → تفعيل ساري  
3. **`is_visible`** — المخفي لا يظهر للطالب  
4. **قفل الواجبات المتسلسل** (إن وُجد امتحان/واجب بقفل المحاضرات التالية) — منفصل عن `access_mode`

---

## 9) إعدادات الكورس المتبقية

```
GET  /api/course/:courseId/access-settings
PATCH /api/course/:courseId/access-settings
```

| الحقل | الحالة |
|--------|--------|
| `lecture_access_mode` | **ملغى** — إرساله في PATCH يرجع `400` |
| `assignment_mode` | ما زال يعمل: `lecture_based` \| `course_based` |

`GET` يرجع تقريبًا:

```json
{
  "success": true,
  "course_id": 10,
  "lecture_access_mode": "per_lecture",
  "assignment_mode": "lecture_based",
  "note": "يتم تحديد وصول كل محاضرة عند إضافتها: open | activation_code | groups"
}
```

`assignment_mode`:
- `lecture_based` — الواجبات مرتبطة بالمحاضرة  
- `course_based` — واجبات على مستوى الكورس  

---

## 10) APIs سريعة للمدرس

| العملية | Method + URL |
|---------|----------------|
| إضافة محاضرة | `POST /api/course/:courseId/lectures` |
| تعديل محاضرة / الوصول | `PATCH /api/course/lecture/:lectureId` |
| إظهار/إخفاء | `PATCH /api/course/lecture/:lectureId/visibility` |
| إنشاء كود تفعيل | `POST /api/course/lecture/:lectureId/activation-codes` |
| قائمة الأكواد | `GET /api/course/lecture/:lectureId/activation-codes` |
| تعطيل كود | `PATCH .../activation-codes/:codeId/deactivate` |
| من فعّل المحاضرة | `GET /api/course/lecture/:lectureId/activations` |
| إضافة فيديو | `POST /api/course/lecture/:lectureId/videos` (حسب الراوتر الحالي) |

## APIs سريعة للطالب

| العملية | Method + URL |
|---------|----------------|
| تفاصيل الكورس + المحاضرات | `GET /api/course/:courseId/details` |
| فحص الوصول | `GET /api/course/lecture/:lectureId/access-check` |
| تفعيل بكود | `POST /api/course/lecture/activate-by-code` |

---

## 11) ملاحظات للـ Frontend

1. في فورم إضافة محاضرة: اختيار واحد من ثلاثة — `open` / `activation_code` / `groups`.
2. إذا اختار `groups`:
   - multi-select للمجموعات + **حقل مدة الكود أو قائمة أكواد** (إلزامي)
   - أعضاء المجموعة يدخلون مباشرة؛ باقي الطلاب بالكود
3. إذا اختار `activation_code`: نفس حقول الأكواد إلزاميًا.
4. يمكن إضافة أكواد لاحقًا من `POST .../activation-codes` لأي محاضرة `groups` أو `activation_code`.
5. لا تعتمد على إعداد كورس قديم `lecture_access_mode`.
6. للطالب:
   - `open_via_group === true` → يدخل مباشرة
   - `access_status === requires_activation_code` → زر «أدخل كود التفعيل»
7. الحقل `lecture_access_mode` في ردود الطالب ما زال موجودًا للتوافق ويساوي `access_mode` الجديد.

---

## 12) ما ليس جزءًا من هذا النظام

- محاضرات المواد الدراسية (`course_lectures`) — جدول وقواعد مختلفة  
- المحاضرات العامة / السنتر (`general_course_lectures`)  
- كود تفعيل **الكورس** نفسه (اشتراك الكورس) — منفصل عن كود تفعيل **المحاضرة**

---

## ملخص جملة واحدة

**المدرس وهو بيضيف المحاضرة يختار: مفتوحة للكل، أو مقفولة بكود للجميع، أو مفتوحة لمجموعات معيّنة (ولباقي الطلاب ظاهرة ومقفولة بكود).**
