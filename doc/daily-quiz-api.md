# Daily Quiz API — المسابقة اليومية

Backend: **Node.js / Express** (هذا المشروع)، وليس Laravel. الواجهة React تستهلك هذه الـ endpoints.

Base path: `/api/daily-quizzes`  
Auth: Bearer JWT + Tenant host / `X-Tenant-Subdomain`

---

## Teacher

| Method | Path | الوصف |
|--------|------|--------|
| `POST` | `/` | إنشاء مسابقة (draft) |
| `GET` | `/teacher` | قائمة مسابقات المدرس `?grade_id&status&page&limit` |
| `GET` | `/teacher/:id` | تفاصيل + أسئلة (مع الإجابة الصحيحة) |
| `PATCH` | `/teacher/:id` | تحديث إعدادات |
| `POST` | `/teacher/:id/publish` | نشر |
| `DELETE` | `/teacher/:id` | حذف |
| `POST` | `/teacher/:id/questions` | إضافة سؤال |
| `POST` | `/teacher/:id/questions/bulk` | إضافة دفعة أسئلة |
| `PATCH` | `/teacher/:id/questions/:questionId` | تعديل سؤال |
| `DELETE` | `/teacher/:id/questions/:questionId` | حذف سؤال |
| `GET` | `/teacher/:id/stats` | إحصائيات + توزيع إجابات |
| `GET` | `/teacher/:id/export.csv` | تصدير Excel/CSV |
| `GET` | `/teacher/:id/export.pdf-data` | بيانات لتوليد PDF من الواجهة |

### إنشاء مسابقة — body مثال

```json
{
  "title": "مسابقة يومية — التيار الكهربي",
  "grade_id": 3,
  "starts_at": "2026-08-03T16:00:00+03:00",
  "ends_at": "2026-08-03T22:00:00+03:00",
  "duration_seconds": 600,
  "max_points": 100,
  "allow_one_attempt": true,
  "shuffle_questions": true,
  "shuffle_options": true,
  "allow_navigation": true,
  "show_answers_mode": "after_end",
  "scoring_mode": "rank_bonus",
  "rank_bonus_start": 50,
  "rank_bonus_step": 5,
  "status": "draft"
}
```

### سؤال — body مثال

```json
{
  "question_text": "شدة التيار تساوي …",
  "question_image_url": null,
  "option_a": "2 A",
  "option_b": "10 A",
  "option_c": "50 A",
  "option_d": "250 A",
  "option_a_image_url": null,
  "option_b_image_url": null,
  "option_c_image_url": null,
  "option_d_image_url": null,
  "correct_answer": "B",
  "points": 100
}
```

---

## Student

| Method | Path | الوصف |
|--------|------|--------|
| `GET` | `/student/home` | بطاقات 🔥 المسابقة اليومية للصفحة الرئيسية |
| `POST` | `/:id/start` | بدء المحاولة + Timer + ترتيب عشوائي |
| `GET` | `/attempts/:attemptId` | استكمال محاولة |
| `PATCH` | `/attempts/:attemptId/answers` | Autosave دوري |
| `POST` | `/attempts/:attemptId/submit` | إرسال نهائي (أو عند انتهاء الوقت) |
| `GET` | `/:id/result` | نتيجة الطالب + مراجعة إن مسموح |
| `GET` | `/:id/leaderboard` | 🏆 ترتيب اليوم |
| `GET` | `/leaderboard/monthly?grade_id=` | 🏆 ترتيب الشهر (أفضل 100) |
| `GET` | `/leaderboard/monthly/archive?grade_id=&year_month=YYYY-MM` | أرشيف شهر سابق |
| `GET` | `/student/achievements` | إنجازات / XP / Levels / Badges / Streak |

### Autosave

```json
{
  "answers": [
    { "question_id": 12, "selected_answer": "B" },
    { "question_id": 13, "selected_answer": null }
  ]
}
```

يُفضَّل استدعاؤه كل 5–10 ثوانٍ أو عند كل اختيار.

### Submit

```json
{
  "answers": [{ "question_id": 12, "selected_answer": "B" }],
  "submit_token": "<من start response>"
}
```

- إرسال مكرر آمن (idempotent).
- بعد الإرسال لا يمكن التعديل.
- عند انتهاء `expires_at` يُغلق السيرفر المحاولة تلقائياً عند أي طلب.

---

## Scoring (سيرفر فقط)

1. كل إجابة صحيحة = `points` للسؤال، خاطئة/فارغة = 0.
2. **Speed bonus**:
   - `rank_bonus` (افتراضي): الأول +50 ثم −5 لكل مركز (`rank_bonus_start` / `step` / `min`).
   - `time_ratio`: نسبة الزمن المتبقي × `time_ratio_max_bonus`.
3. `total_points = base_points + speed_bonus`.
4. يُحدَّث ترتيب اليوم فوراً، والترتيب الشهري مادياً في `daily_quiz_monthly_scores`.

---

## Gamification

- **XP / Level / Coins / Streak** في `daily_quiz_student_profiles`.
- شارات جاهزة: أول مركز ×5، streak 7/30، perfect ×10، …  
- Job كل دقيقة: إشعار بدء / قبل الانتهاء بـ10 دقائق / النتائج + أرشفة الشهر في أول يوم UTC.

---

## أمان

- محاولة واحدة لكل طالب (`UNIQUE quiz_id, student_id`).
- احتساب النقاط على السيرفر فقط — لا تُرسل الإجابة الصحيحة أثناء الحل.
- تسجيل `started_at` / `submitted_at` / `ip` / `user_agent`.
- `submit_token` + قفل صف المحاولة (`FOR UPDATE`) ضد السباقات.
- التحقق من نافذة المسابقة وصف الطالب قبل البدء/الإرسال.

---

## Migration

```bash
npm run migrate
# أو حسب سكربت المشروع: node-pg-migrate up
```

ملف: `migrations/1776300000000_create_daily_quiz_system.sql`

---

## ملاحظات الواجهة (React)

1. Home: استدعِ `GET /student/home` — أظهر Countdown إن `show_countdown`، وأخفِ زر البدء إن `!can_start`.
2. Play: Timer من `remaining_ms`؛ Autosave؛ عند `remaining_ms === 0` نادِ submit تلقائياً.
3. بعد submit: صفحة ترتيب اليوم من `leaderboard_preview` أو `GET /:id/leaderboard`.
4. صفحة مستقلة لترتيب الشهر + صفحة الإنجازات.
5. تصدير PDF: استخدم `/export.pdf-data` ثم ولّد PDF في الواجهة (أو خدمة طباعة).
