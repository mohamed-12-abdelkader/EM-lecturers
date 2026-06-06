# Educational Intelligence System

توثيق تفصيلي للنظام التحليلي الجديد داخل المنصة التعليمية.

هذا المستند يشرح:
- الهدف المعماري للنظام.
- تصميم قاعدة البيانات.
- تدفق البيانات من الـPlayer إلى الـDashboard.
- كل الـAPIs المتاحة حاليًا.
- تعريف المؤشرات الأساسية (KPIs).
- طريقة الربط من الفرونت.
- أفضل ممارسات الأداء والتشغيل.

---

## 1) الهدف من النظام

النظام مصمم ليحوّل البيانات الخام (مشاهدة فيديو، نشاط طالب، امتحانات) إلى معلومات تشغيلية تساعد المدرس على:

- اكتشاف الطلاب المعرضين للتراجع مبكرًا.
- معرفة المحاضرات الصعبة أو التي يحدث عندها Drop-off.
- متابعة الالتزام الأسبوعي للطلاب.
- تحسين القرارات التعليمية (إعادة شرح، واجبات إضافية، مراجعات مستهدفة).

---

## 2) المعمارية العامة (High-Level)

النظام يعمل بطبقتين:

1. **Tracking Layer**: تستقبل أحداث لحظية من الفرونت.
2. **Intelligence Layer**: تحلل البيانات وترجع KPIs وتقارير جاهزة للداشبورد.

### تدفق البيانات

1. الطالب يشغل فيديو.
2. الفرونت يفتح Session.
3. الفرونت يرسل Events (`play`, `progress`, `seek`, ...).
4. النظام يخزن الجلسات والأحداث.
5. APIs التحليلية تجمع الإحصائيات وتعيد النتائج للمدرس/الأدمن.

---

## 3) قاعدة البيانات (Analytics Schema)

تمت الإضافة عبر Migration:

- `migrations/1772108400000_create_analytics_intelligence_tables.sql`

### الجداول الجديدة

#### A) `analytics_video_sessions`
جلسة مشاهدة فيديو واحدة لطالب.

أهم الحقول:
- `tenant_id`
- `student_id`
- `teacher_id`
- `course_id`
- `lecture_id`
- `video_id`
- `session_key`
- `started_at`, `ended_at`
- `total_watch_seconds`
- `completion_percentage`
- `is_completed`

#### B) `analytics_watch_events`
كل حدث داخل الجلسة (Event stream).

أهم الحقول:
- `session_id`
- `event_type` (`play`, `pause`, `progress`, `seek`, `complete`, `heartbeat`)
- `video_second`
- `from_second`, `to_second` (خاصة `seek`)
- `playback_rate`
- `metadata`
- `event_at`

#### C) `analytics_student_activity_logs`
سجل نشاط الطالب (عام، ليس فيديو فقط).

أمثلة `action_type`:
- `video_start`
- `video_complete`
- `exam_start`
- `exam_submit`
- `live_join`
- `live_leave`
- `login`

#### D) `analytics_exam_attempt_facts`
Fact table لمحاولات الامتحانات (موحد متعدد المصادر).

أهم الحقول:
- `exam_source`  
  (`lecture_exam`, `course_level_exam`, `course_exam`, `general_course_exam`, `package_subject_exam`, `group_exam`)
- `exam_entity_id`
- `score`, `total_grade`, `percentage`
- `passed`
- `attempt_number`
- `duration_seconds`

#### E) `analytics_question_attempt_facts`
تحليل على مستوى السؤال (item-level analytics).

أهم الحقول:
- `question_entity_id`
- `is_correct`
- `obtained_grade`, `max_grade`
- `response_time_seconds`

#### F) `analytics_progress_tracking_daily`
Daily snapshot لتقدم كل طالب في كل كورس.

أهم الحقول:
- `day`
- `lectures_viewed`
- `videos_completed`
- `watch_seconds`
- `completion_percentage`
- `engagement_score`

#### G) `analytics_engagement_metrics_daily`
Daily snapshot على مستوى الكورس/المحاضرة.

أهم الحقول:
- `active_students`
- `total_watch_seconds`
- `average_watch_seconds`
- `average_completion_percentage`
- `retention_rate`
- `drop_off_rate`

#### H) `analytics_performance_reports`
تقارير جاهزة يومية/أسبوعية/شهرية.

#### I) `analytics_alerts`
تنبيهات ذكية (خمول، انخفاض أداء، خطورة مرتفعة).

#### J) `analytics_recommendations`
توصيات تعليمية قابلة للعرض للمدرس.

---

## 4) APIs - Tracking Layer

Base:
- `/api/analytics/tracking`

Auth:
- `student`, `teacher`, `admin` (حسب السيناريو)

### 4.1 Start Video Session

- `POST /api/analytics/tracking/video/session/start`

```json
{
  "course_id": 12,
  "lecture_id": 50,
  "video_id": 111,
  "session_key": "session-abc-001",
  "source": "mobile_player",
  "device_id": "android-xyz"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": 1,
    "started_at": "2026-05-09T13:30:00.000Z"
  }
}
```

### 4.2 Track Watch Event

- `POST /api/analytics/tracking/video/event`

```json
{
  "session_id": 1,
  "event_type": "seek",
  "video_second": 240,
  "from_second": 260,
  "to_second": 200,
  "playback_rate": 1,
  "metadata": {
    "completionPercentage": 45.5,
    "totalWatchSeconds": 530
  }
}
```

Response:

```json
{
  "success": true,
  "message": "Event tracked"
}
```

### 4.3 End Video Session

- `POST /api/analytics/tracking/video/session/end`

```json
{
  "session_id": 1,
  "total_watch_seconds": 950,
  "completion_percentage": 88.2,
  "is_completed": true
}
```

### 4.4 Log Student Activity

- `POST /api/analytics/tracking/activity`

```json
{
  "action_type": "exam_submit",
  "course_id": 12,
  "lecture_id": 50,
  "exam_id": 7,
  "duration_seconds": 1800,
  "metadata": {
    "device": "android"
  }
}
```

---

## 5) APIs - Intelligence Layer

Base:
- `/api/analytics`

Auth:
- `teacher`, `admin`

### 5.1 Course Analytics
- `GET /api/analytics/course/:courseId`

المخرجات تشمل:
- إجمالي الطلاب.
- متوسط/إجمالي وقت الدراسة.
- متوسط الإكمال.
- معدل إكمال الكورس.
- Drop-off rate.
- إكمال كل محاضرة.
- ترتيب أفضل الطلاب.

### 5.2 Lecture Analytics
- `GET /api/analytics/lecture/:lectureId`

المخرجات تشمل:
- Total views
- Unique views
- Average watch seconds
- Completion percentage
- Replay heatmap
- Skip analytics

### 5.3 Student Analytics
- `GET /api/analytics/student/:studentId`

المخرجات تشمل:
- المحاضرات التي شاهدها الطالب.
- عدد المشاهدات لكل محاضرة.
- زمن المشاهدة.
- إكمال المحاضرة.
- آخر نشاط.
- الالتزام الأسبوعي (`active_days`, `absence_days`, `attendance_rate`).
- ملخص أداء الامتحانات.

### 5.4 Exam Analytics
- `GET /api/analytics/exam/:examId`

المخرجات تشمل:
- عدد المحاولات.
- متوسط/أعلى/أقل درجة.
- النجاح/الرسوب.
- متوسط زمن الحل.

### 5.5 Difficult Questions
- `GET /api/analytics/questions/difficult?limit=20`

المخرجات:
- أكثر الأسئلة خطأً.
- نسبة الخطأ.
- عدد المحاولات.

### 5.6 Top Students
- `GET /api/analytics/students/top?limit=20`

المخرجات:
- ترتيب الطلاب.
- نسبة الإكمال.
- متوسط أداء الامتحانات.
- إجمالي زمن الدراسة.

### 5.7 At Risk Students
- `GET /api/analytics/students/at-risk?limit=20`

المخرجات:
- الطلاب المعرضون للتراجع.
- `risk_score` مركب من:
  - الخمول (inactivity)
  - ضعف الإكمال
  - ضعف نتائج الامتحانات

### 5.8 Performance Summary
- `GET /api/analytics/performance-summary`

ملخص تنفيذي سريع للداشبورد:
- إجمالي الطلاب.
- النشطون أسبوعيًا.
- weekly engagement rate.
- متوسط الإكمال.
- أصعب 5 أسئلة.

---

## 6) فلاتر التاريخ

يمكن تمرير:
- `from=2026-05-01`
- `to=2026-05-31`

مثال:
- `GET /api/analytics/course/12?from=2026-05-01&to=2026-05-31`

في حالة عدم التمرير:
- النظام يستخدم آخر 30 يوم كافتراضي.

---

## 7) تعريفات المؤشرات (KPI Definitions)

- **Completion Percentage**: متوسط `completion_percentage` للفيديوهات.
- **Course Completion Rate**: نسبة الطلاب الذين تخطوا عتبة إكمال (80% حاليًا).
- **Drop-off Rate**: `100 - average_completion_percentage`.
- **Unique Views**: عدد الطلاب المختلفين الذين شاهدوا المحاضرة.
- **Replay Heatmap**: عدد `seek` للخلف لكل مقطع زمني.
- **Skip Analytics**: عدد `seek` للأمام لكل مقطع زمني.
- **Risk Score**: معادلة مركبة للخمول + انخفاض الإكمال + انخفاض أداء الامتحان.

---

## 8) ربط الفرونت (Integration Guide)

### الحد الأدنى المطلوب من الـPlayer

1. عند فتح الفيديو:
   - call `video/session/start`
2. أثناء التشغيل:
   - call `video/event` كل 10-20 ثانية (`progress`/`heartbeat`)
3. عند Seek:
   - call `video/event` بنوع `seek` مع `from_second` و `to_second`
4. عند إنهاء الفيديو أو الخروج:
   - call `video/session/end`

### نصائح مهمة

- استخدم `session_key` فريد لكل جلسة من الفرونت.
- أرسل `completionPercentage` و `totalWatchSeconds` داخل `metadata` في progress events.
- لا ترسل events بسرعة عالية جدًا (يكفي heartbeat كل 10-20 ثانية).

---

## 9) الأمان والصلاحيات

- endpoints التحليلية محمية بـ `authMiddleware(['admin', 'teacher'])`.
- endpoints التتبع تسمح بـ`student` (وأيضًا admin/teacher عند الحاجة التشغيلية).
- جميع البيانات مربوطة بـ`tenant_id` لضمان العزل بين المنصات.

---

## 10) الأداء والقابلية للتوسع

- تم إنشاء فهارس متعددة على (`tenant`, `student`, `course`, `lecture`, `time`).
- التصميم Fact-based ومناسب للتوسع الأفقي.
- يدعم التحول لاحقًا إلى:
  - Materialized Views
  - Incremental Aggregation Jobs
  - Cache Layer للـDashboard

---

## 11) حالات الأخطاء الشائعة

- `400` Invalid payload:
  - نقص أو خطأ في الحقول المطلوبة.
- `404` Video session not found:
  - `session_id` غير صحيح أو لا يخص الطالب/المنصة.
- `401/403`:
  - مشكلة مصادقة أو صلاحيات.

---

## 12) ملفات النظام (Code Map)

- Migration:
  - `migrations/1772108400000_create_analytics_intelligence_tables.sql`
- Tracking Service:
  - `src/services/analyticsTracking.ts`
- Intelligence Service:
  - `src/services/analyticsIntelligence.ts`
- Tracking Controller:
  - `src/controllers/analyticsTracking.ts`
- Analytics Controller:
  - `src/controllers/analytics.ts`
- Route Mounting:
  - `src/routes.ts`

---

## 13) Roadmap التوسعة المقترحة

### المرحلة التالية (موصى بها)

1. Jobs دورية لتعبئة:
   - `analytics_exam_attempt_facts`
   - `analytics_question_attempt_facts`
2. بناء Daily/Weekly/Monthly report generator تلقائي.
3. تفعيل `analytics_alerts`:
   - خمول الطالب
   - هبوط مفاجئ في الأداء
4. تفعيل `analytics_recommendations`:
   - توصيات تعليمية مخصصة لكل مدرس.

---

## 14) ملخص

النظام الحالي جاهز إنتاجيًا كنواة قوية لـ:
- تتبع الفيديو والنشاط.
- استخراج مؤشرات أداء للمدرس.
- اكتشاف الطلاب المتميزين والمعرضين للتراجع.
- تجهيز بيانات دقيقة للـDashboard والـBI مستقبلًا.
