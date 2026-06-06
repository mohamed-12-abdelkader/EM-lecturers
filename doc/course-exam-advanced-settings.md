# توثيق دعم إعدادات Exam Flow لامتحانات الكورس الشاملة

## 1. نظرة عامة
- تم توحيد إعدادات التحكم في امتحانات المحاضرات (Exam Flow) مع امتحانات الكورس الشاملة.
- نفس الخيارات (`showAnswersImmediately`, النوافذ الزمنية، المؤقت، ...إلخ) أصبحت متاحة عند إنشاء أو تعديل الامتحان الشامل.
- الهدف: يمنح المدرس واجهة موحدة بغض النظر عن نوع الامتحان.

## 2. المسارات المتأثرة
| المسار | الوصف | الحالة |
|--------|-------|---------|
| `POST /api/course/:courseId/course-exam` | إنشاء امتحان شامل | تمكين الحقول الجديدة في form-data |
| `PATCH /api/course/course-exam/:examId` | تعديل امتحان شامل | يدعم نفس الحقول (camelCase أو snake_case) |

> **مهم:** الواجهات ما تزال تعتمد على `multipart/form-data` (لإمكانية رفع صورة)، لذا يجب إرسال الحقول كنصوص داخل FormData.

## 3. الحقول المدعومة

| الحقل | الشرح | نوعه |
|-------|-------|------|
| `showAnswersImmediately` / `show_answers_immediately` | إظهار التصحيح فور التسليم | boolean |
| `showAnswersAfterHours` / `show_answers_after_hours` | تأخير التصحيح X ساعة | رقم ≥ 0 |
| `allowMultipleAttempts` / `allow_multiple_attempts` | السماح بمحاولات متعددة | boolean |
| `showAnswersLater` / `show_answers_later` | جدول إصدار لاحق | boolean (يتطلب تاريخ) |
| `answersReleaseDate` / `answers_release_date` | تاريخ الإصدار المؤجل | ISO Date |
| `timeLimitEnabled` / `time_limit_enabled` | تفعيل العدّاد الزمني | boolean |
| `timeLimitMinutes` / `time_limit_minutes` | مدة الامتحان عند تفعيل المؤقت | رقم > 0 |
| `lockNextLectures` / `lock_next_lectures` | قفل المحاضرات التالية حتى النجاح | boolean |
| `showAt` / `show_at` | موعد إظهار الامتحان | ISO Date |
| `hideAt` / `hide_at` | موعد إخفائه | ISO Date |
| `startWindow` / `start_window` | وقت بدء نافذة المحاولات | ISO Date |
| `endWindow` / `end_window` | نهاية نافذة المحاولات | ISO Date |

## 4. قواعد التحقق (Mirrors Exam Flow)
1. عند تفعيل `showAnswersLater` يجب إرسال `answersReleaseDate`.
2. عند تفعيل `timeLimitEnabled` يجب توفير `timeLimitMinutes > 0`.
3. عند إرسال `startWindow` و `endWindow` يجب أن يكون `start < end`.
4. أي تاريخ يُرسل يجب أن يكون بصيغة ISO قابلة للتحويل إلى `Date`.
5. الحقول تقبل كلٍ من camelCase و snake_case (يتم تطبيعها داخلياً بواسطة `pickBodyValue` + parsers).

## 5. مثال عملي (form-data)
```
title = امتحان نهاية الكورس
questions_count = 20
duration = 60
total_grade = 100
is_visible = true
show_answers_immediately = false
show_answers_later = true
answers_release_date = 2025-01-12T10:00:00Z
allow_multiple_attempts = false
time_limit_enabled = true
time_limit_minutes = 45
start_window = 2025-01-10T17:00:00Z
end_window = 2025-01-10T19:00:00Z
lock_next_lectures = true
```

## 6. نقاط اختبار سريعة
1. **إنشاء** امتحان شامل بالحقول أعلاه ⇒ يجب أن ينجح بدون أخطاء.
2. **ترك `answersReleaseDate` مع `showAnswersLater = true`** ⇒ يتوقع خطأ 400.
3. **`timeLimitEnabled = true` بدون مدة** ⇒ خطأ 400.
4. **`startWindow > endWindow`** ⇒ خطأ 400.
5. **قراءة الامتحان** عبر `GET /api/course/:courseId/course-exams` للتاكد من تخزين القيم.

## 7. ملاحظات إضافية
- لا توجد تغييرات مطلوبة على قاعدة البيانات (الأعمدة موجودة مسبقاً).
- تم تحديث `doc/exam.md` لتوضيح الحقول الجديدة ولإضافة مثال كامل.
- يمكن إعادة استخدام نفس منطق Exam Flow في الواجهات الأمامية (نفس مفاتيح الـ UI).

> آخر تحديث: 2025-11-25



