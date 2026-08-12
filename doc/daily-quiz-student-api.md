# المسابقة اليومية — APIs الطالب

Base URL: `/api/daily-quizzes`  
Auth: `Authorization: Bearer <access_token>` (role = `student`)  
Tenant: Host المنصة أو header `X-Tenant-Subdomain`

صيغة الرد العامة:

```json
{ "success": true, "data": { } }
```

عند الخطأ:

```json
{ "success": false, "message": "..." }
```

---

## تدفق الواجهة المقترح

```
Home → Start → (Autosave أثناء الحل) → Submit → Result / Leaderboard اليوم
                                              → ترتيب الشهر / الإنجازات
```

| الخطوة | Endpoint |
|--------|----------|
| بطاقة الصفحة الرئيسية | `GET /student/home` |
| ابدأ الآن | `POST /:id/start` |
| استكمال محاولة مفتوحة | `GET /attempts/:attemptId` |
| حفظ إجابات دوري | `PATCH /attempts/:attemptId/answers` |
| إرسال الحل | `POST /attempts/:attemptId/submit` |
| النتيجة | `GET /:id/result` |
| ترتيب اليوم | `GET /:id/leaderboard` |
| ترتيب الشهر | `GET /leaderboard/monthly?grade_id=` |
| أرشيف شهر | `GET /leaderboard/monthly/archive?...` |
| الإنجازات | `GET /student/achievements` |

---

## 1) الصفحة الرئيسية — بطاقة المسابقة

`GET /api/daily-quizzes/student/home`

يعرض مسابقات الصف الدراسي للطالب (منشورة وظاهرة).

### Response

```json
{
  "success": true,
  "data": {
    "section_title": "🔥 المسابقة اليومية",
    "quizzes": [
      {
        "id": 12,
        "title": "مسابقة يومية — التيار الكهربي",
        "teacher_name": "أ. أحمد",
        "teacher_avatar": "https://...",
        "grade_name": "الصف الثالث الثانوي",
        "questions_count": 10,
        "duration_seconds": 600,
        "max_points": 100,
        "starts_at": "2026-08-04T16:00:00.000Z",
        "ends_at": "2026-08-04T22:00:00.000Z",
        "availability": "live",
        "seconds_to_start": 0,
        "seconds_to_end": 5400,
        "already_submitted": false,
        "active_attempt_id": null,
        "can_start": true,
        "show_countdown": false
      }
    ]
  }
}
```

### حقول مهمة للـ UI

| حقل | الاستخدام |
|-----|-----------|
| `availability` | `upcoming` \| `live` \| `ended` |
| `show_countdown` | `true` → اعرض عدّاد حتى البدء (`seconds_to_start`) |
| `can_start` | `true` → أظهر زر **ابدأ الآن** |
| `already_submitted` | شارك من قبل → لا يبدأ من جديد |
| `active_attempt_id` | محاولة مفتوحة → اذهب لـ `GET /attempts/:id` بدل start جديد |
| `seconds_to_end` | عدّاد حتى إغلاق نافذة المسابقة |

---

## 2) بدء الحل

`POST /api/daily-quizzes/:id/start`

### Body (اختياري)

```json
{
  "device_info": {
    "platform": "android",
    "app_version": "1.2.0"
  }
}
```

### Response `201`

```json
{
  "success": true,
  "data": {
    "attempt": {
      "id": 55,
      "quiz_id": 12,
      "status": "in_progress",
      "started_at": "2026-08-04T16:05:00.000Z",
      "expires_at": "2026-08-04T16:15:00.000Z",
      "remaining_ms": 600000,
      "submit_token": "a1b2c3d4e5f6...",
      "allow_navigation": true,
      "last_autosave_at": null
    },
    "quiz": {
      "id": 12,
      "title": "مسابقة يومية — التيار الكهربي",
      "duration_seconds": 600,
      "max_points": 100,
      "questions_count": 10,
      "ends_at": "2026-08-04T22:00:00.000Z",
      "teacher_name": "أ. أحمد"
    },
    "questions": [
      {
        "id": 101,
        "question_text": "شدة التيار تساوي …",
        "question_image_url": null,
        "points": 100,
        "options": [
          { "key": "B", "text": "10 A", "image_url": null },
          { "key": "A", "text": "2 A", "image_url": null },
          { "key": "D", "text": "250 A", "image_url": null },
          { "key": "C", "text": "50 A", "image_url": null }
        ]
      }
    ],
    "saved_answers": []
  }
}
```

### ملاحظات

- Timer الواجهة يعتمد على `remaining_ms` / `expires_at` من السيرفر.
- ترتيب الأسئلة والاختيارات قد يكون عشوائياً — استخدم `options[].key` عند الإرسال (`A`/`B`/`C`/`D`).
- **لا** توجد إجابة صحيحة في الرد أثناء الحل.
- احفظ `submit_token` لإرساله مع الـ submit.
- إن وُجدت محاولة `in_progress` لنفس المسابقة، يُعاد نفس الـ payload (بدون إنشاء محاولة جديدة).

### أخطاء شائعة

| Status | المعنى |
|--------|--------|
| `400` | لم تبدأ بعد / انتهت / لا أسئلة |
| `403` | ليست لصف الطالب |
| `404` | المسابقة غير متاحة |
| `409` | شارك مسبقاً أو تعارض بدء |

---

## 3) استكمال محاولة

`GET /api/daily-quizzes/attempts/:attemptId`

نفس شكل `start`. استخدمه عند:
- رجوع التطبيق وموجود `active_attempt_id`
- فتح شاشة الحل من إشعار

إذا انتهى الوقت، السيرفر يغلق المحاولة تلقائياً ويحسب النتيجة.

---

## 4) حفظ الإجابات (Autosave)

`PATCH /api/daily-quizzes/attempts/:attemptId/answers`

يُفضَّل كل 5–10 ثوانٍ أو بعد كل اختيار.

### Request

```json
{
  "answers": [
    { "question_id": 101, "selected_answer": "B" },
    { "question_id": 102, "selected_answer": null }
  ]
}
```

`selected_answer`: `"A"` \| `"B"` \| `"C"` \| `"D"` \| `null`

### Response

```json
{
  "success": true,
  "data": {
    "success": true,
    "saved_at": "2026-08-04T16:07:12.345Z"
  }
}
```

بعد الإرسال النهائي → `400` (لا يمكن الحفظ).

---

## 5) إرسال الحل

`POST /api/daily-quizzes/attempts/:attemptId/submit`

يُستدعى عند: زر إنهاء، أو `remaining_ms === 0`.

### Request

```json
{
  "answers": [
    { "question_id": 101, "selected_answer": "B" },
    { "question_id": 102, "selected_answer": "A" }
  ],
  "submit_token": "a1b2c3d4e5f6..."
}
```

- `answers` اختياري (يُدمج مع آخر autosave).
- `submit_token` مُستحسن لمنع تكرار الطلبات الخاطئة.

### Response

```json
{
  "success": true,
  "data": {
    "result": {
      "id": 77,
      "quiz_id": 12,
      "attempt_id": 55,
      "student_id": 200,
      "correct_count": 8,
      "wrong_count": 2,
      "unanswered_count": 0,
      "base_points": 800,
      "speed_bonus": 45,
      "total_points": 845,
      "score_percent": 80,
      "duration_ms": 312000,
      "finish_rank": 2
    },
    "reveal_answers": false,
    "answers": [
      {
        "question_id": 101,
        "selected_answer": "B",
        "is_correct": true,
        "points_awarded": 100
      }
    ],
    "leaderboard_preview": {
      "items": [],
      "me": { "rank": 2, "total_points": 845 },
      "total_participants": 15
    }
  }
}
```

### قواعد مهمة

- إرسال مكرر لنفس المحاولة = نفس النتيجة (آمن).
- بعد الإرسال لا رجوع ولا تعديل.
- احتساب النقاط **على السيرفر فقط**.
- `reveal_answers`: حسب إعداد المدرس (`never` / `after_submit` / `after_end`).

---

## 6) نتيجة الطالب

`GET /api/daily-quizzes/:id/result`

```json
{
  "success": true,
  "data": {
    "result": {
      "correct_count": 8,
      "wrong_count": 2,
      "base_points": 800,
      "speed_bonus": 45,
      "total_points": 845,
      "duration_ms": 312000,
      "finish_rank": 2,
      "student_name": "محمد",
      "student_avatar": "https://..."
    },
    "reveal_answers": true,
    "review": [
      {
        "question_id": 101,
        "question_text": "...",
        "selected_answer": "B",
        "correct_answer": "B",
        "is_correct": true,
        "points_awarded": 100,
        "points": 100
      }
    ],
    "leaderboard": { "items": [], "me": {}, "total_participants": 15 }
  }
}
```

`review` يظهر فقط إذا `reveal_answers = true`.

---

## 7) ترتيب اليوم 🏆

`GET /api/daily-quizzes/:id/leaderboard?limit=50`

`limit` اختياري (افتراضي 50، أقصى 100).

### Response

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "rank": 1,
        "student_id": 199,
        "student_name": "سارة",
        "student_avatar": "https://...",
        "total_points": 850,
        "base_points": 800,
        "speed_bonus": 50,
        "duration_ms": 280000,
        "correct_count": 8,
        "wrong_count": 2,
        "finish_rank": 1,
        "submitted_at": "2026-08-04T16:10:00.000Z",
        "is_current_user": false
      }
    ],
    "me": {
      "rank": 2,
      "student_id": 200,
      "student_name": "محمد",
      "student_avatar": "https://...",
      "total_points": 845,
      "duration_ms": 312000,
      "correct_count": 8
    },
    "total_participants": 15
  }
}
```

ميّز صف الطالب عبر `is_current_user` أو قارن مع `me`.

---

## 8) ترتيب الشهر 🏆

`GET /api/daily-quizzes/leaderboard/monthly?grade_id=3&year_month=2026-08&limit=100`

| Query | مطلوب | الوصف |
|-------|--------|--------|
| `grade_id` | نعم | صف الطالب |
| `year_month` | لا | `YYYY-MM` — الافتراضي الشهر الحالي |
| `limit` | لا | افتراضي 100 |

### Response

```json
{
  "success": true,
  "data": {
    "year_month": "2026-08",
    "items": [
      {
        "rank": 1,
        "student_id": 199,
        "student_name": "سارة",
        "student_avatar": "https://...",
        "total_points": 4200,
        "quizzes_participated": 12,
        "first_place_count": 3,
        "total_correct": 95,
        "total_duration_ms": 3600000,
        "avg_duration_ms": 300000,
        "is_current_user": false
      }
    ],
    "me": {
      "rank": 8,
      "total_points": 2100,
      "quizzes_participated": 10,
      "first_place_count": 1
    }
  }
}
```

---

## 9) أرشيف شهر سابق

`GET /api/daily-quizzes/leaderboard/monthly/archive?grade_id=3&year_month=2026-07`

كلا الـ query مطلوبان. يعيد أفضل 100 من الأرشيف بعد تصفير الشهر.

---

## 10) صفحة الإنجازات

`GET /api/daily-quizzes/student/achievements`

```json
{
  "success": true,
  "data": {
    "total_points": 12500,
    "xp": 3400,
    "level": 12,
    "coins": 420,
    "level_progress": {
      "level": 12,
      "xp_into_level": 150,
      "xp_for_next": 375,
      "progress": 0.4
    },
    "current_streak": 7,
    "longest_streak": 14,
    "total_quizzes": 40,
    "best_daily_rank": 1,
    "total_first_places": 5,
    "perfect_quizzes": 3,
    "badges": [
      {
        "code": "streak_7",
        "title_ar": "أسبوع ناري",
        "icon": "🔥",
        "earned_at": "2026-08-01T12:00:00.000Z"
      }
    ],
    "medals": {
      "gold": 5,
      "cups": 1
    }
  }
}
```

شريط المستوى: `level_progress.progress` من `0` إلى `1`.

---

## احتساب النقاط (مرجع للعرض فقط)

| البند | الحساب |
|-------|--------|
| إجابة صحيحة | نقاط السؤال |
| إجابة خاطئة / فارغة | `0` |
| Speed bonus | حسب ترتيب الإنهاء (+50 ثم −5) أو نسبة الزمن |
| الإجمالي | `base_points + speed_bonus` |

الواجهة **لا** تحسب النقاط محلياً — تعتمد على رد السيرفر.

---

## أكواد الحالة السريعة

| Code | متى |
|------|-----|
| `200` / `201` | نجاح |
| `400` | وقت غير صالح / validation / لا يمكن الحفظ بعد الإرسال |
| `401` | غير مسجّل |
| `403` | ليس صف الطالب |
| `404` | مسابقة/محاولة/نتيجة غير موجودة |
| `409` | مشاركة مكررة / رمز إرسال غير صالح |

---

## نصائح تكامل React / App

1. Home: إن `active_attempt_id` → افتح المحاولة مباشرة بدون `start` جديد.
2. Timer: مزامنة من `expires_at` عند فتح الشاشة (تجنّب الاعتماد على عدّاد محلي فقط).
3. Autosave عند كل اختيار + interval احتياطي.
4. عند انتهاء الوقت: نادِ `submit` فوراً حتى لو فشل الشبكة — أعد المحاولة.
5. بعد submit: اعرض `result` ثم `leaderboard`؛ راجع الإجابات فقط إذا `reveal_answers`.
6. الإشعارات المتوقعة: بدء المسابقة، قبل الانتهاء بـ 10 دقائق، جاهزية النتائج، صعود الترتيب.
