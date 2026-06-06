# وثائق API الكورسات العامة (General Courses)

الـ Base URL: `/api`

جميع الطلبات (ما لم يُذكر غير ذلك) تتطلب هيدر المصادقة:
```
Authorization: Bearer <access_token>
```

---

## 1. الكورسات العامة (General Courses)

**المسار الأساسي:** `/api/general-courses`

| Method | المسار | الصلاحية | الوصف |
|--------|--------|----------|--------|
| POST | `/` | admin | إنشاء كورس عام جديد |
| GET | `/` | admin | جلب كل الكورسات العامة |
| GET | `/available` | student | جلب الكورسات المتاحة للطالب (حسب الصف/التخصص) |
| GET | `/:id` | admin, student | جلب تفاصيل كورس (للطالب: محتوى مجموعته فقط) |
| PUT | `/:id` | admin | تحديث كورس عام |
| DELETE | `/:id` | admin | حذف كورس عام |
| POST | `/:id/codes` | admin | توليد أكواد تفعيل للكورس |
| GET | `/:id/codes` | admin | جلب أكواد تفعيل الكورس |
| GET | `/:id/students` | admin | جلب الطلاب المشتركين في الكورس |
| POST | `/activate` | student | تفعيل اشتراك بكود (للطالب) |

---

### 1.1 إنشاء كورس عام — `POST /api/general-courses/`

**الصلاحية:** admin  
**Body (multipart/form-data أو JSON):**
```json
{
  "title": "string (2+)",
  "description": "string (optional)",
  "price": 0,
  "category": "برمجة | لغات | إدارة وتسويق | بيزنس | مهارات متنوعة"
}
```
**صورة (اختياري):** حقل `image` (ملف).

**Response 201:**
```json
{
  "success": true,
  "message": "...",
  "course": { "id", "title", "description", "price", "image", "category", "created_by", "created_at", ... }
}
```

---

### 1.2 جلب كل الكورسات — `GET /api/general-courses/`

**الصلاحية:** admin  
**Response 200:** قائمة `courses` مع تفاصيل كل كورس.

---

### 1.3 الكورسات المتاحة للطالب — `GET /api/general-courses/available`

**الصلاحية:** student  
يرجع كورسات حسب صف الطالب أو تخصصه؛ مع حقل `is_enrolled` و`status` (enrolled | locked).

**Response 200:**
```json
{
  "success": true,
  "courses": [
    {
      "id", "title", "description", "price", "image", "category",
      "created_by", "created_by_name", "created_at", "updated_at",
      "is_enrolled": true | false,
      "status": "enrolled" | "locked"
    }
  ],
  "total": 0,
  "filter": "all" | "category_value"
}
```

---

### 1.4 تفاصيل كورس ومحتوى المجموعة (للطالب أو الأدمن) — `GET /api/general-courses/:id`

**الصلاحية:** admin | student  

- **طالب منضم لمجموعة:** يُرجع **المحتوى المتاح لمجموعته فقط**: محاضرات، امتحانات، حصص بث مباشر (`live_sessions`). مع `waitlist: false`.
- **طالب في قائمة الانتظار** (مشترك في الكورس لكن لم يُضمّ لمجموعة بعد): يُرجع `waitlist: true` و `waitlist_message: "أنت في قائمة الانتظار، سيتم إضافتك لمجموعة قريباً"` و `lectures: []`, `exams: []`, `live_sessions: []`.
- **أدمن:** يُرجع كل محاضرات الكورس (بدون فلترة مجموعة).

**Response 200 (طالب منضم لمجموعة):**
```json
{
  "success": true,
  "course": {
    "id", "title", "description", "price", "image", "category",
    "created_by", "created_by_name", "created_at", "updated_at",
    "lectures": [ { "id", "title", "description", "created_at", "updated_at", "group_id", "videos": [...] } ],
    "exams": [ { "id", "group_id", "title", "total_grade", "duration_minutes", "created_at" } ],
    "live_sessions": [
      { "id", "group_id", "title", "status", "allow_chat", "egress_url", "created_at", "updated_at", "creator_name" }
    ],
    "is_enrolled": true,
    "group_id": 1,
    "waitlist": false,
    "waitlist_message": null
  }
}
```

**Response 200 (طالب في قائمة الانتظار):**
```json
{
  "success": true,
  "course": {
    "id", "title", "description", "price", "image", "category",
    "created_by", "created_by_name", "created_at", "updated_at",
    "lectures": [],
    "exams": [],
    "live_sessions": [],
    "is_enrolled": true,
    "group_id": null,
    "waitlist": true,
    "waitlist_message": "أنت في قائمة الانتظار، سيتم إضافتك لمجموعة قريباً"
  }
}
```
`live_sessions`, `waitlist`, `waitlist_message` و `group_id` تظهر للطالب فقط.

---

### 1.5 تفعيل الكورس بكود — `POST /api/general-courses/activate`

**الصلاحية:** student  
**Body:**
```json
{
  "courseId": 1,
  "code": "12345678"
}
```
الكود 8 أحرف. يمنع الاشتراك المزدوج.

**Response 200:** `{ "success": true, "message": "تم تفعيل الكورس بنجاح" }`

---

### 1.6 توليد أكواد تفعيل — `POST /api/general-courses/:id/codes`

**الصلاحية:** admin  
**Body:** `{ "count": 1 }` (1–1000)

**Response:** قائمة الأكواد المُولَّدة.

---

### 1.7 جلب أكواد التفعيل — `GET /api/general-courses/:id/codes`

**الصلاحية:** admin  
**Response:** قائمة أكواد الكورس مع حالة الاستخدام.

---

### 1.8 جلب الطلاب المشتركين — `GET /api/general-courses/:id/students`

**الصلاحية:** admin  
**Response:** قائمة الطلاب المشتركين في الكورس.

---

## 2. المجموعات (Groups)

**نفس المسار الأساسي:** `/api/general-courses` (يُطابق مسارات المجموعات قبل `/:id`).

| Method | المسار | الصلاحية | الوصف |
|--------|--------|----------|--------|
| GET | `/my-groups` | teacher, admin | مجموعات المدرس (التي له صلاحية عليها) |
| POST | `/:courseId/groups` | admin | إنشاء مجموعة في كورس |
| GET | `/:courseId/groups` | admin | جلب مجموعات كورس |
| PUT | `/groups/:groupId` | admin | تحديث مجموعة |
| DELETE | `/groups/:groupId` | admin | حذف مجموعة |
| GET | `/:courseId/waitlist` | admin | قائمة الانتظار (طلاب بدون مجموعة) |
| POST | `/groups/:groupId/assign` | admin | تعيين طلاب لمجموعة |
| POST | `/groups/:groupId/remove` | admin | إزالة طلاب من مجموعة |
| GET | `/groups/:groupId` | admin, teacher | تفاصيل مجموعة (المدرس لمجموعته فقط) |
| POST | `/groups/:groupId/schedules` | admin | إضافة مواعيد للمجموعة |
| DELETE | `/schedules/:scheduleId` | admin | حذف موعد |
| GET | `/groups/:groupId/students` | admin, teacher | طلاب المجموعة |
| POST | `/groups/:groupId/exams` | admin, teacher | إنشاء امتحان للمجموعة |
| GET | `/groups/:groupId/exams` | admin, teacher | جلب امتحانات المجموعة |
| PUT | `/exams/:examId` | admin, teacher | تحديث امتحان |
| DELETE | `/exams/:examId` | admin, teacher | حذف امتحان |

---

### 2.1 مجموعات المدرس — `GET /api/general-courses/my-groups`

**الصلاحية:** teacher | admin  
يرجع المجموعات التي `teacher_id = المستخدم` (للأدمن نفس المنطق إذا مُسند كمدرس).

**Response 200:**
```json
{
  "success": true,
  "groups": [
    {
      "group_id", "general_course_id", "group_name", "max_students",
      "student_count", "group_created_at",
      "course": { "id", "title", "description", "image" },
      "schedules": [ { "id", "day_of_week", "start_time", "duration_minutes" } ]
    }
  ],
  "total": 0
}
```

---

### 2.2 إنشاء مجموعة — `POST /api/general-courses/:courseId/groups`

**الصلاحية:** admin  
**Body:**
```json
{
  "name": "string",
  "max_students": 0,
  "teacher_id": 1
}
```
`teacher_id` اختياري (ربط المدرس بالمجموعة).

---

### 2.3 تحديث مجموعة — `PUT /api/general-courses/groups/:groupId`

**الصلاحية:** admin  
**Body (جميع الحقول اختيارية):**
```json
{
  "name": "string",
  "max_students": 0,
  "teacher_id": 1
}
```
`teacher_id: null` لإزالة المدرس من المجموعة.

---

### 2.4 تعيين طلاب لمجموعة — `POST /api/general-courses/groups/:groupId/assign`

**الصلاحية:** admin  
**Body:** `{ "studentIds": [1, 2, 3] }`  
الطلاب يجب أن يكونوا مشتركين في نفس الكورس وفي قائمة الانتظار.

---

### 2.5 إزالة طلاب من مجموعة — `POST /api/general-courses/groups/:groupId/remove`

**الصلاحية:** admin  
**Body:** `{ "studentIds": [1, 2] }`  
يعود الطلاب لقائمة الانتظار (بدون حذف الاشتراك).

---

### 2.6 تفاصيل مجموعة — `GET /api/general-courses/groups/:groupId`

**الصلاحية:** admin | teacher (المدرس لمجموعته فقط)  
**Response:** تفاصيل المجموعة مع `schedules` و`student_count`.

---

### 2.7 إضافة مواعيد — `POST /api/general-courses/groups/:groupId/schedules`

**الصلاحية:** admin  
**Body:**
```json
{
  "schedules": [
    {
      "day_of_week": 0,
      "start_time": "10:00",
      "duration_minutes": 60
    }
  ]
}
```
`day_of_week`: 0–6 (أحد–سبت). `start_time`: HH:MM.

---

### 2.8 اختبارات المجموعة

**إنشاء امتحان — `POST /api/general-courses/groups/:groupId/exams`**  
**الصلاحية:** admin | teacher (صاحب المجموعة)

**Body:**
```json
{
  "title": "string",
  "total_grade": 100,
  "duration_minutes": 60
}
```

**جلب الامتحانات — `GET /api/general-courses/groups/:groupId/exams`**  
**Response:** `{ "success": true, "exams": [ { ..., "questions_count": 0 } ] }`

**تحديث امتحان — `PUT /api/general-courses/exams/:examId`**  
**Body (اختياري):** `{ "title", "total_grade", "duration_minutes" }`

**حذف امتحان — `DELETE /api/general-courses/exams/:examId`**

---

## 3. محاضرات الكورسات العامة (Lectures)

**المسار الأساسي:** `/api/general-course-lectures`

المحاضرات مرتبطة بمجموعة (`group_id`). الصلاحية: مدرس المجموعة أو أدمن.

| Method | المسار | الصلاحية | الوصف |
|--------|--------|----------|--------|
| GET | `/by-group/:groupId` | admin, teacher | محاضرات مجموعة معينة |
| POST | `/` | admin, teacher | إنشاء محاضرة لمجموعة |
| PUT | `/:id` | admin, teacher | تحديث محاضرة |
| DELETE | `/:id` | admin, teacher | حذف محاضرة |
| POST | `/video` | admin, teacher | إضافة فيديو لمحاضرة |

---

### 3.1 محاضرات مجموعة — `GET /api/general-course-lectures/by-group/:groupId`

**الصلاحية:** admin | teacher (صاحب المجموعة)  
**Response 200:** `{ "success": true, "lectures": [ { "id", "group_id", "title", "description", "videos": [...] } ] }`

---

### 3.2 إنشاء محاضرة — `POST /api/general-course-lectures/`

**الصلاحية:** admin | teacher (صاحب المجموعة)  
**Body:**
```json
{
  "group_id": 1,
  "title": "string",
  "description": "string"
}
```

---

### 3.3 تحديث محاضرة — `PUT /api/general-course-lectures/:id`

**Body (اختياري):** `{ "title", "description" }`

---

### 3.4 إضافة فيديو — `POST /api/general-course-lectures/video`

**Body:**
```json
{
  "lecture_id": 1,
  "name": "string",
  "url": "https://..."
}
```

---

## 4. جلسات البث المباشر لمجموعات الكورس العام (LiveKit)

نفس آلية البث المباشر للكورس العادي: إنشاء جلسة، دخول المدرس/الطالب، إنهاء الجلسة. الصلاحية: أدمن أو المدرس صاحب المجموعة (`teacher_id`) يمكنه إنشاء وإدارة الجلسات؛ الطالب المسجل في المجموعة فقط يمكنه الدخول.

**Base:** `/api/general-courses`

| Method | المسار | الصلاحية | الوصف |
|--------|--------|----------|--------|
| POST | `/groups/:groupId/meeting` | admin, teacher (صاحب المجموعة) | إنشاء جلسة بث مباشر للمجموعة |
| GET | `/groups/:groupId/meetings` | admin, teacher (صاحب المجموعة) | قائمة جلسات البث للمجموعة |
| GET | `/groups/:groupId/meetings/student` | student (مسجل في المجموعة) | قائمة جلسات البث للطالب |
| PUT | `/meeting/:id` | admin, teacher (صاحب المجموعة) | تحديث عنوان الجلسة و/أو حفظ رابط التسجيل (`egress_url`) |
| DELETE | `/meeting/:id` | admin, teacher | حذف جلسة بث |
| POST | `/meeting/:id/close` | admin, teacher | إنهاء غرفة البث |
| PATCH | `/meeting/:id/participant/:participantId` | admin, teacher (صاحب المجموعة) | تحديث صلاحيات مشارك (نفس الكورس العادي) |
| PATCH | `/meeting/:id/wavehand` | admin, teacher | إظهار/إخفاء زر رفع اليد (body: `{ "visible": true \| false }`) |
| POST | `/meeting/:id/participant/:participantId/kick` | admin, teacher | إخراج مشارك (participantId = user_id رقمياً) |
| GET | `/meeting/:id/pre-join` | admin, teacher, student (مسجل في المجموعة) | بيانات قبل الدخول — نفس شكل الكورس العادي: `meeting`, `user: { id, isOwner, username, avatar }` |
| GET | `/meeting/:id/connection` | نفس pre-join | توكن LiveKit (participantToken, screenShareToken, serverUrl, roomName, participantName, isOwner) مع دعم allow_chat |
| GET | `/meeting/me/current` | admin, teacher | الجلسة النشطة الحالية (كورس عادي أو مجموعة) |

**إنشاء جلسة — POST `/groups/:groupId/meeting`**

Body:
```json
{ "title": "عنوان الجلسة (3 أحرف على الأقل)" }
```

Response 201:
```json
{
  "success": true,
  "message": "تم إنشاء جلسة البث بنجاح",
  "meeting": { "id", "group_id", "title", "allow_chat", "status", "created_by", "created_at", ... }
}
```

- **قيد:** لا يمكن للمدرس إنشاء أكثر من جلسة بث نشطة واحدة (سواء في كورس عادي أو مجموعة) في نفس الوقت.
- عند بدء البث فعلياً (LiveKit room_started) يُرسل إشعار لطلاب المجموعة فقط.
- **تسجيل البث (Egress):** يُسجَّل البث تلقائياً ويُرفع على YouTube (نفس الكورس العادي)، ويُحفظ الرابط في `egress_url`.
- **خصائص مطابقة للكورس العادي:** رفع اليد (wavehand)، إخراج مشارك (kick)، تحديث صلاحيات المشارك، الدردشة (allow_chat)، نفس شكل استجابة pre-join و connection للتوافق مع الفرونتند.
- **حفظ رابط البث (التسجيل):** مثل الكورس العادي، يمكن تحديث رابط التسجيل عبر **PUT** `/api/general-courses/meeting/:id` مع Body: `{ "egress_url": "https://www.youtube.com/watch?v=..." }` أو `{ "egress_url": null }` لمسح الرابط. (التسجيل التلقائي يملأ `egress_url` عند انتهاء Egress؛ هذا الـ API يسمح بحفظ الرابط يدوياً إن لزم.)

---

## 5. ملخص العزل والصلاحيات

- **المحاضرات:** كل محاضرة لها `group_id`؛ الطالب يرى فقط محاضرات مجموعته في `GET /api/general-courses/:id`.
- **الاختبارات:** كل امتحان مرتبط بمجموعة (`general_course_exams.group_id`)؛ الطالب يرى فقط امتحانات مجموعته في نفس الـ endpoint.
- **المدرس:** يضيف محاضرات/امتحانات للمجموعات التي `teacher_id = id` فقط (أو أي مجموعة للأدمن).
- **الطالب:** مرتبط بمجموعة واحدة عبر `general_course_enrollments.group_id`؛ إن كان `group_id` null (قائمة انتظار) قد يرى محتوى قديم بدون مجموعة أو لا محتوى حسب المنطق الحالي.

---

## 6. رموز الأخطاء الشائعة

| Status | المعنى |
|--------|--------|
| 400 | بيانات غير صحيحة أو معرف غير صحيح |
| 403 | غير مصرح (دور أو صلاحية مجموعة) |
| 404 | الكورس / المجموعة / المحاضرة / الامتحان غير موجود |

جميع استجابات الخطأ تأتي عادة بالشكل:  
`{ "success": false, "message": "..." }` أو `{ "message": "...", "details": { ... } }`.
