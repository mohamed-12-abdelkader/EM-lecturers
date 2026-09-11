# نظام النقاط والترتيب — دليل الـ APIs التفصيلي

> **Base URL:** `/api`  
> **المصادقة:** `Authorization: Bearer <TOKEN>`  
> **النطاق:** Backend فقط — كل منح النقاط Server-side (الطالب لا يستطيع تعديل/منح نقاط لنفسه)

---

## فهرس سريع

| Method | Path | الدور | الوصف |
|--------|------|-------|--------|
| `GET` | `/teacher/points/settings` | teacher / academy / admin | جلب إعدادات نقاط المدرس |
| `PUT` | `/teacher/points/settings` | teacher / academy / admin | تحديث إعدادات النقاط |
| `GET` | `/teacher/points/leaderboard` | teacher / academy / admin | ترتيب طلاب المدرس (فلترة + بحث + صفحات) |
| `POST` | `/teacher/points/manual` | teacher / academy / admin | منح نقاط يدوية لطالب |
| `GET` | `/teacher/points/students/:studentId/transactions` | teacher / academy / admin | سجل معاملات طالب |
| `GET` | `/student/points/summary` | student | نقاط الطالب + رتبته + المتبقي للمركز التالي |
| `GET` | `/student/points/leaderboard` | student | أعلى 10 في صف الطالب |
| `GET` | `/student/my-points` | student | توافق قديم — إجمالي النقاط scoped |

---

## 1) فكرة النظام

### 1.1 فصل المدرسين والصفوف

- كل مدرس له **إعدادات نقاط مستقلة** (`teacher_points_settings`).
- رصيد الطالب وترتيبه داخل زوج: **`teacher_id` + `grade_id`** (الصف الدراسي).
- نقاط مدرس A في الصف 1 **لا تظهر** في ترتيب مدرس B أو صف 2.
- `study_groups` تُستخدم فقط **لفلترة عرض** قائمة الترتيب عند المدرس، وليست scope للرصيد.

### 1.2 أنواع الأحداث (`event_type`)

| القيمة | متى تُمنح | كيف تُحسب النقاط | قابل للتعطيل من إعدادات المدرس |
|--------|-----------|------------------|--------------------------------|
| `VIDEO_WATCH` | أول مشاهدة لفيديو معيّن | قيمة ثابتة من الإعدادات (افتراضي 5) | نعم `video_watch_*` |
| `EXAM_START` | إنشاء محاولة امتحان جديدة | قيمة ثابتة (افتراضي 5) | نعم `exam_start_*` |
| `ASSIGNMENT_START` | إنشاء محاولة واجب جديدة | قيمة ثابتة (افتراضي 3) | نعم `assignment_start_*` |
| `EXAM_SCORE` | تسليم امتحان | `floor(obtained_grade)` مثال: 15/20 → **+15** | نعم `exam_score_enabled` |
| `ASSIGNMENT_SCORE` | تسليم واجب | `floor(obtained_grade)` | نعم `assignment_score_enabled` |
| `MANUAL_REWARD` | منح يدوي من المدرس | الرقم الذي يدخله المدرس | دائمًا مسموح للمدرس |

أنواع محجوزة للتوسع المستقبلي في الـ DB (بدون hooks حاليًا):  
`LIVE_ATTENDANCE`, `COURSE_COMPLETION`, `DAILY_LOGIN`, `CONTEST_WIN`.

### 1.3 منع التكرار (Idempotency)

كل عملية تُدرج في `point_transactions` بمفتاح فريد `reference_key`:

| الحدث | مثال `reference_key` |
|-------|----------------------|
| مشاهدة فيديو | `VIDEO_WATCH:teacher:10:video:55:student:42` |
| بدء امتحان | `EXAM_START:attempt:1205` |
| نتيجة امتحان | `EXAM_SCORE:attempt:1205` |
| بدء واجب | `ASSIGNMENT_START:attempt:1206` |
| نتيجة واجب | `ASSIGNMENT_SCORE:attempt:1206` |
| يدوي | `MANUAL_REWARD:teacher:10:uuid:<uuid>` |

- `INSERT ... ON CONFLICT (reference_key) DO NOTHING`
- إعادة Refresh / إعادة استدعاء API / فتح النتيجة مرة أخرى → **لا تضاعف النقاط**
- محاولة امتحان جديدة (attempt جديد) → مفتاح جديد → يمكن منح start/score لهذه المحاولة فقط

### 1.4 حساب الترتيب (Tie)

PostgreSQL `RANK()`:

| طالب | نقاط | Rank |
|------|------|------|
| Ahmed | 500 | 1 |
| Mohamed | 500 | 1 |
| Ali | 450 | **3** |

نفس النقاط = نفس الرتبة، والرتبة التالية تقفز.

### 1.5 كيف يُحدَّد المدرس والصف للطالب؟

**المدرس (`teacherId`):**

1. `users.managed_by_teacher_id` إن وُجد  
2. وإلا مالك المنصة: `tenants.owner_user_id` عبر `users.tenant_id`

**الصف (`gradeId`):**

1. أول صف في `user_grades` ضمن صفوف المدرس (`teacher_grades`)  
2. وإلا `courses.grade_id` عند المنح من سياق كورس

لو تعذّر تحديد المدرس أو الصف لـ APIs الطالب → `400` مع رسالة: `تعذر تحديد المدرس أو الصف للطالب`.

---

## 2) قاعدة البيانات

**Migration:** `migrations/1779000000000_teacher_points_ranking.sql`

```bash
npm run migrate
```

| الجدول | الغرض |
|--------|--------|
| `teacher_points_settings` | إعدادات كل مدرس (UNIQUE `teacher_id`) |
| `student_point_balances` | رصيد مجمّع `(student_id, teacher_id, grade_id)` |
| `point_transactions` | سجل كل عملية منح + UNIQUE `reference_key` |

الجداول القديمة `student_points` / `student_points_history` تبقى للقراءة التاريخية؛ المنح الجديد **لا يكتب عليها** (ما عدا daily-quiz القديم إن وُجد).

---

## 3) APIs المدرس

> Roles: `teacher` | `academy` | `admin`  
> للأدمن: أرسل `teacherId` كـ query (أو في body لـ POST) لتحديد المدرس المستهدف.

---

### 3.1 جلب إعدادات النقاط

```http
GET /api/teacher/points/settings
Authorization: Bearer <TEACHER_TOKEN>
```

**Admin:**

```http
GET /api/teacher/points/settings?teacherId=10
```

**سلوك:** إن لم يكن للمدرس سجل إعدادات، يُنشأ تلقائيًا بالقيم الافتراضية.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "teacher_id": 10,
    "video_watch_enabled": true,
    "video_watch_points": 5,
    "exam_start_enabled": true,
    "exam_start_points": 5,
    "assignment_start_enabled": true,
    "assignment_start_points": 3,
    "exam_score_enabled": true,
    "assignment_score_enabled": true,
    "created_at": "2026-09-11T12:00:00.000Z",
    "updated_at": "2026-09-11T12:00:00.000Z"
  }
}
```

| الحقل | النوع | الوصف |
|-------|-------|--------|
| `video_watch_enabled` | boolean | تفعيل نقاط مشاهدة الفيديو |
| `video_watch_points` | int ≥ 0 | عدد النقاط لكل فيديو (مرة واحدة) |
| `exam_start_enabled` | boolean | تفعيل نقاط بدء الامتحان |
| `exam_start_points` | int ≥ 0 | نقاط بدء الامتحان |
| `assignment_start_enabled` | boolean | تفعيل نقاط بدء الواجب |
| `assignment_start_points` | int ≥ 0 | نقاط بدء الواجب |
| `exam_score_enabled` | boolean | إضافة الدرجة كـ نقاط عند التسليم |
| `assignment_score_enabled` | boolean | نفس الشيء للواجب |

**أخطاء**

| Status | متى |
|--------|-----|
| `400` | أدمن بدون `teacherId` |
| `401` | بدون توكن |
| `403` | دور غير مصرح |

---

### 3.2 تحديث إعدادات النقاط

```http
PUT /api/teacher/points/settings
Authorization: Bearer <TEACHER_TOKEN>
Content-Type: application/json
```

**Body** — كل الحقول اختيارية (يُحدَّث المرسل فقط):

```json
{
  "video_watch_enabled": true,
  "video_watch_points": 5,
  "exam_start_enabled": true,
  "exam_start_points": 5,
  "assignment_start_enabled": true,
  "assignment_start_points": 3,
  "exam_score_enabled": true,
  "assignment_score_enabled": false
}
```

**Response `200`:** نفس شكل `data` في GET settings بعد التحديث.

**أخطاء**

| Status | Body |
|--------|------|
| `400` | `{ "success": false, "message": "Invalid settings payload", "errors": [...] }` |
| `400` | أدمن بدون `teacherId` |

**مثال UI (Points Settings):**

```text
☑ Enable Video Points          Points: [5]
☑ Enable Exam Start Points     Points: [5]
☑ Enable Assignment Start      Points: [3]
☑ Enable Exam Score Points
☑ Enable Assignment Score Points
```

---

### 3.3 ترتيب الطلاب (لوحة المدرس)

```http
GET /api/teacher/points/leaderboard?gradeId=1&groupId=5&search=أحمد&page=1&limit=50
Authorization: Bearer <TEACHER_TOKEN>
```

**Query Parameters**

| Param | مطلوب؟ | افتراضي | الوصف |
|-------|--------|---------|--------|
| `gradeId` | لا | الكل | فلترة صف دراسي |
| `groupId` | لا | — | فلترة مجموعة دراسية (`study_groups` التابعة للمدرس) |
| `search` | لا | — | بحث في الاسم / الإيميل / الهاتف |
| `page` | لا | `1` | رقم الصفحة |
| `limit` | لا | `50` | حجم الصفحة (أقصى 200) |
| `teacherId` | للأدمن | — | معرف المدرس |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "page": 1,
    "limit": 50,
    "total": 120,
    "students": [
      {
        "rank": 1,
        "studentId": 1,
        "name": "Ahmed",
        "email": "ahmed@example.com",
        "avatar": null,
        "gradeId": 1,
        "gradeName": "الصف الثالث الثانوي",
        "points": 500
      },
      {
        "rank": 2,
        "studentId": 2,
        "name": "Mohamed",
        "email": "m@example.com",
        "avatar": "https://...",
        "gradeId": 1,
        "gradeName": "الصف الثالث الثانوي",
        "points": 450
      }
    ]
  }
}
```

- الترتيب تنازلي حسب `points`.
- الـ `rank` محسوب داخل كل `gradeId` (`PARTITION BY grade_id`).
- يظهر فقط من لديهم صف في `student_point_balances` (حصلوا على نقاط مرة واحدة على الأقل).

---

### 3.4 منح نقاط يدوية (`MANUAL_REWARD`)

```http
POST /api/teacher/points/manual
Authorization: Bearer <TEACHER_TOKEN>
Content-Type: application/json
```

**Body**

```json
{
  "studentId": 42,
  "points": 20,
  "reason": "Excellent participation",
  "gradeId": 1
}
```

| الحقل | مطلوب؟ | القيود |
|-------|--------|--------|
| `studentId` | نعم | integer > 0 |
| `points` | نعم | integer > 0 |
| `reason` | نعم | نص 1–500 حرف |
| `gradeId` | لا | إن لم يُرسل يُستنتج من صفوف الطالب عند المدرس |

**شروط النجاح**

- الطالب مرتبط بالمدرس: `managed_by_teacher_id` **أو** مشترك في كورس للمدرس (`enrollments` → `courses.teacher_id`).
- يمكن تحديد `gradeId` صالح ضمن `teacher_grades`.

**Response `200`**

```json
{
  "success": true,
  "data": {
    "awarded": true,
    "points": 20,
    "totalPoints": 370,
    "transactionId": 99
  }
}
```

**أخطاء**

| Status | الرسالة التقريبية |
|--------|-------------------|
| `400` | `Invalid body: studentId, points, reason required` |
| `400` | `points must be a positive integer` |
| `400` | `reason is required` |
| `400` | `Could not resolve student grade for this teacher` |
| `403` | `Student is not linked to this teacher` |

> ملاحظة: كل منح يدوي ينشئ `reference_key` بـ UUID جديد → يمكن منح نقاط يدوية متعددة لنفس الطالب.

---

### 3.5 سجل معاملات طالب

```http
GET /api/teacher/points/students/42/transactions?gradeId=1&limit=100
Authorization: Bearer <TEACHER_TOKEN>
```

| Query | افتراضي | الوصف |
|-------|---------|--------|
| `gradeId` | الكل | فلترة صف |
| `limit` | `100` | أقصى 500 |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "studentId": 42,
    "transactions": [
      {
        "id": 99,
        "points": 20,
        "eventType": "MANUAL_REWARD",
        "referenceType": "manual",
        "referenceId": null,
        "referenceKey": "MANUAL_REWARD:teacher:10:uuid:...",
        "metadata": { "reason": "Excellent participation" },
        "gradeId": 1,
        "createdAt": "2026-09-11T15:00:00.000Z"
      },
      {
        "id": 88,
        "points": 15,
        "eventType": "EXAM_SCORE",
        "referenceType": "exam_attempt",
        "referenceId": 1205,
        "referenceKey": "EXAM_SCORE:attempt:1205",
        "metadata": {
          "examId": 13,
          "obtainedGrade": 15,
          "totalGrade": 20,
          "title": "امتحان شامل"
        },
        "gradeId": 1,
        "createdAt": "2026-09-10T12:00:00.000Z"
      },
      {
        "id": 77,
        "points": 5,
        "eventType": "VIDEO_WATCH",
        "referenceType": "video",
        "referenceId": 55,
        "referenceKey": "VIDEO_WATCH:teacher:10:video:55:student:42",
        "metadata": {
          "lectureId": 9,
          "courseId": 3,
          "lectureTitle": "المحاضرة 1"
        },
        "gradeId": 1,
        "createdAt": "2026-09-09T10:00:00.000Z"
      }
    ]
  }
}
```

---

## 4) APIs الطالب

> Role: `student` فقط  
> الـ `teacherId` / `gradeId` يُستنتجان من السيرفر — **لا يُرسلان من الفرونت** (أمان).

---

### 4.1 ملخص النقاط والترتيب

```http
GET /api/student/points/summary
Authorization: Bearer <STUDENT_TOKEN>
```

**Response `200`**

```json
{
  "success": true,
  "data": {
    "totalPoints": 350,
    "rank": 4,
    "totalStudents": 120,
    "pointsToNextRank": 20,
    "gradeId": 1,
    "teacherId": 10
  }
}
```

| الحقل | الوصف |
|-------|--------|
| `totalPoints` | إجمالي نقاط الطالب في هذا المدرس+الصف |
| `rank` | ترتيبه الحالي (`RANK` logic) |
| `totalStudents` | عدد الطلاب الظاهرين في الترتيب لهذا الـ scope |
| `pointsToNextRank` | الفرق للنقاط التي تفصل عن صاحب الرتبة الأعلى مباشرة؛ **`0` لو كان الأول** |
| `gradeId` / `teacherId` | السياق المستخدم |

**أخطاء**

| Status | الرسالة |
|--------|---------|
| `400` | `تعذر تحديد المدرس أو الصف للطالب` |
| `401` | بدون توكن طالب |

**عرض مقترح في Student Dashboard:**

```text
My Points: 350
My Rank: #4
You are ranked #4 among 120 students in your class.
Points to next rank: 20
```

---

### 4.2 أعلى 10 طلاب في الصف

```http
GET /api/student/points/leaderboard
Authorization: Bearer <STUDENT_TOKEN>
```

**Query (اختياري)**

| Param | افتراضي | الحد |
|-------|---------|------|
| `limit` | `10` | 1–10 فقط (لا يرجع أكثر من Top 10) |

**Response `200`**

```json
{
  "success": true,
  "data": {
    "classId": 1,
    "teacherId": 10,
    "topStudents": [
      {
        "rank": 1,
        "studentId": 1,
        "name": "Ahmed",
        "avatar": null,
        "points": 500
      },
      {
        "rank": 2,
        "studentId": 2,
        "name": "Mohamed",
        "avatar": null,
        "points": 450
      }
    ]
  }
}
```

`classId` = `gradeId` للصف الدراسي.

---

### 4.3 توافق قديم — إجمالي النقاط

```http
GET /api/student/my-points
Authorization: Bearer <STUDENT_TOKEN>
```

**Response `200`**

```json
{
  "success": true,
  "points": {
    "total_points": 350,
    "last_reset_at": null,
    "created_at": "2026-09-11T12:00:00.000Z",
    "updated_at": "2026-09-11T12:00:00.000Z",
    "teacher_id": 10,
    "grade_id": 1
  }
}
```

- يقرأ من `student_point_balances` (النظام الجديد).
- إن تعذّر السياق scoped → fallback للمحفظة القديمة `student_points` إن وُجدت.

---

## 5) المنح التلقائي (بدون API للطالب)

الطالب **لا يستدعي** endpoint لمنح نقاط. المنح يحدث داخل السيرفر عند:

| الحدث | الملف / الخدمة | الشروط |
|-------|----------------|--------|
| أول مشاهدة فيديو | `VideoViewTrackingService.trackStudentVideoView` | `isFirstVideoView` + إعداد مفعّل |
| بدء امتحان/واجب محاضرة | `ExamFlowService.startAttempt` | نوع `exam` أو `assignment` |
| تسليم امتحان/واجب محاضرة | `ExamFlowService` عند finalize | الدرجة → نقاط إن مفعّل |
| بدء امتحان شامل | `CourseLevelExamsService.startExamAttempt` | `EXAM_START` |
| تسليم امتحان شامل | `CourseLevelExamsService.finalizeInProgressAttempt` | `EXAM_SCORE` |
| امتحان كورس قديم | `ExamsService` (legacy `course_exams`) | score عند أول submission |

**عند التعطيل / التكرار / صفر نقاط:** الـ hook يتخطى بهدوء (`awarded: false`) ولا يفشل عملية المشاهدة أو التسليم.

### مثال تدفق كامل

إعدادات المدرس:

```text
Video Watch = 5 (on)
Exam Start = 5 (on)
Exam Score = on
```

1. يشاهد فيديو لأول مرة → **+5** (`VIDEO_WATCH`)  
2. يفتح نفس الفيديو مرة أخرى → **+0** (duplicate key)  
3. يبدأ امتحان → **+5** (`EXAM_START`)  
4. يسلّم بدرجة 15/20 → **+15** (`EXAM_SCORE`)  
5. يفتح صفحة النتيجة / Refresh → **+0**  
6. **الإجمالي = 25**

---

## 6) الأمان

| ممنوع على الطالب | الحماية |
|------------------|---------|
| تعديل نقاطه | لا يوجد endpoint كتابة للطالب |
| إرسال `studentId` / `points` لمنح نفسه | غير موجود |
| اختيار `classId` للتلاعب بالترتيب | السياق من السيرفر فقط |
| Fake transactions | الإدراج فقط عبر `TeacherPointsService.award` من hooks/مدرس |

المدرس يرى ويعدّل إعداداته وleaderboard طلابه فقط (أو أدمن يحدد `teacherId`).

---

## 7) إرشادات الفرونت

### صفحة المدرس — Points Settings

1. `GET /api/teacher/points/settings` عند فتح الصفحة  
2. عرض Switches + Inputs  
3. `PUT /api/teacher/points/settings` عند الحفظ  

### صفحة المدرس — Student Ranking

1. قائمة صفوف المدرس → اختيار `gradeId`  
2. اختياري: مجموعة `groupId` + بحث  
3. `GET /api/teacher/points/leaderboard?...`  
4. جدول: Rank | Student | Points  

### لوحة الطالب

1. `GET /api/student/points/summary` → النقاط + الرتبة  
2. `GET /api/student/points/leaderboard` → Top 10  
3. **لا تحسب الترتيب أو المجموع في الفرونت**

---

## 8) أكواد الملفات المرجعية

| الملف | الدور |
|-------|--------|
| `src/services/teacherPoints.ts` | المحرك: إعدادات، منح، ترتيب، يدوي |
| `src/controllers/teacherPoints.ts` | مسارات المدرس |
| `src/controllers/studentPoints.ts` | مسارات الطالب |
| `src/services/videoViewTracking.ts` | hook فيديو |
| `src/services/examFlow.ts` | hook امتحان/واجب محاضرة |
| `src/services/courseLevelExams.ts` | hook امتحان شامل |
| `src/routes.ts` | `/teacher/points` و `/student/points` |
| `migrations/1779000000000_teacher_points_ranking.sql` | الجداول |
| `doc/teacher-points-ranking-api-ar.md` | هذا الدليل |

---

## 9) تشغيل الـ Migration

```bash
npm run migrate
```

لا Environment Variables جديدة مطلوبة.

---

## 10) Checklist اختبار سريع

1. مدرس A يضبط فيديو = 5، مدرس B يضبط = 2 → كل طالب يحصل حسب مدرسه  
2. مشاهدة فيديو مرتين → نقاط مرة واحدة  
3. بدء امتحان مرتين لنفس الـ attempt (resume) → start مرة واحدة  
4. تسليم + فتح نتيجة + refresh → score مرة واحدة  
5. Attempt جديد → start/score جديدين مسموحان  
6. `summary` و Top 10 يعكسان نفس الـ scope  
7. Leaderboard المدرس يفلتر بالصف والمجموعة  
8. Manual reward يزيد الرصيد ويظهر في transactions  
9. طالب بدون توكن مدرس لا يصل لـ `/teacher/points/*`  
10. تعادل نقاط → نفس الرتبة + قفزة للرتبة التالية  
