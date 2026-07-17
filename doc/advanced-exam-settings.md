# إعدادات الامتحانات المتقدمة - امتحانات MCQ للمحاضرات

## نظرة عامة

تم إضافة إعدادات متقدمة لامتحانات MCQ للمحاضرات لتوفير تحكم أكبر في توقيت ظهور الامتحانات وإدارة المحاضرات التالية.

## الإعدادات الجديدة

### 1. جدولة ظهور الامتحان
- **`show_at`**: موعد ظهور الامتحان للطلاب (TIMESTAMP)
- **`hide_at`**: موعد إخفاء الامتحان عن الطلاب (TIMESTAMP)

### 2. قفل المحاضرات التالية
- **`lock_next_lectures`**: إذا كان `true`، لا يمكن للطلاب الوصول للمحاضرات التالية حتى ينجحوا في الامتحان

### واجبات متعددة لنفس المحاضرة
- يمكن إنشاء **أكثر من واجب** (`type: "assignment"`) لنفس المحاضرة — لا يوجد قيد uniqueness.
- **المحاضرة التالية تفتح فقط** بعد نجاح الطالب في **كل واجبات المحاضرات السابقة الظاهرة** (وأي امتحان بـ `lock_next_lectures: true`).
- عند إنشاء واجب بدون تحديد `lock_next_lectures` يكون الافتراضي **`true`**.
- في تفاصيل الكورس لكل محاضرة: `assignments[]` + `exams[]` (+ `exam` للتوافق مع الواجهة القديمة).

مثال إنشاء واجب:
```json
{
  "title": "واجب 1",
  "type": "assignment",
  "total_grade": 20,
  "is_visible": true
}
```

يمكن تكرار الطلب أكثر من مرة لنفس `lectureId` لإنشاء واجب ثانٍ وثالث...

### 3. إدارة إظهار الإجابات
- **`show_answers_immediately`**: إذا كان `true`، تظهر الإجابات فور انتهاء الامتحان
- **`show_answers_after_hours`**: عدد الساعات قبل إظهار الإجابات (إذا كان `show_answers_immediately` = `false`)

## APIs الجديدة والمحدثة

### 1. إنشاء امتحان محاضرة مع الإعدادات المتقدمة

**POST** `/api/course/lecture/:lectureId/exam`

#### Request Body
```json
{
  "title": "امتحان المحاضرة الأولى",
  "total_grade": 100,
  "duration": 60,
  "is_visible": true,
  "show_at": "2024-01-20T09:00:00Z",
  "hide_at": "2024-01-25T23:59:59Z",
  "lock_next_lectures": true,
  "show_answers_immediately": false,
  "show_answers_after_hours": 24
}
```

#### Response
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 1,
    "type": "exam",
    "total_grade": 100,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "duration": 60,
    "is_visible": true,
    "show_at": "2024-01-20T09:00:00Z",
    "hide_at": "2024-01-25T23:59:59Z",
    "lock_next_lectures": true,
    "show_answers_immediately": false,
    "show_answers_after_hours": 24,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. تحديث الإعدادات المتقدمة

**PATCH** `/api/course/lecture/exam/:examId/advanced-settings`

#### Request Body
```json
{
  "show_at": "2024-01-21T10:00:00Z",
  "hide_at": "2024-01-26T23:59:59Z",
  "lock_next_lectures": false,
  "show_answers_immediately": true,
  "show_answers_after_hours": 0
}
```

#### Response
```json
{
  "message": "Advanced settings updated successfully",
  "exam": {
    "id": 1,
    "lecture_id": 1,
    "type": "exam",
    "total_grade": 100,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "duration": 60,
    "is_visible": true,
    "show_at": "2024-01-21T10:00:00Z",
    "hide_at": "2024-01-26T23:59:59Z",
    "lock_next_lectures": false,
    "show_answers_immediately": true,
    "show_answers_after_hours": 0,
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. جلب امتحان المحاضرة (محدث)

**GET** `/api/course/lecture/:lectureId/exam`

#### للطلاب
- يرى الامتحان فقط إذا كان:
  - `is_visible` = `true`
  - الوقت الحالي بين `show_at` و `hide_at` (إذا تم تحديدهما)

#### للمدرسين
- يرى الامتحان دائماً بغض النظر عن الإعدادات

### 4. التحقق من إمكانية الوصول للمحاضرات

**GET** `/api/course/lecture/:lectureId/access-check`

#### للطلاب فقط
- يتحقق من إمكانية الوصول لمحاضرة معينة
- يفحص جميع الامتحانات في المحاضرات السابقة التي تمنع الوصول
- يعرض حالة كل امتحان (لم يخضع، نجح، فشل)

#### Response
```json
{
  "can_access": false,
  "blocking_exams": [
    {
      "id": 1,
      "title": "امتحان المحاضرة الأولى",
      "total_grade": 100,
      "lecture_title": "المحاضرة الأولى",
      "order_index": 1,
      "exam_status": "not_taken",
      "submitted_at": null,
      "student_grade": null
    }
  ],
  "message": "لا يمكن الوصول للمحاضرة - يجب النجاح في الامتحانات المطلوبة أولاً"
}
```

#### حالات الامتحان:
- **`not_taken`**: لم يخضع الطالب للامتحان بعد
- **`passed`**: نجح الطالب في الامتحان
- **`failed`**: فشل الطالب في الامتحان

## منطق العمل

### 1. جدولة الامتحان
- إذا لم يتم تحديد `show_at`، يظهر الامتحان فور إنشائه (إذا كان `is_visible` = `true`)
- إذا لم يتم تحديد `hide_at`، يبقى الامتحان ظاهراً
- إذا كان الوقت الحالي قبل `show_at` أو بعد `hide_at`، لا يرى الطلاب الامتحان

### 2. قفل المحاضرات التالية
- إذا كان `lock_next_lectures` = `true`، يتم فحص نجاح الطالب في الامتحان
- **مهم**: قفل المحاضرات التالية يعمل فقط إذا كان الامتحان مرئي للطالب حالياً
- إذا كان الامتحان مخفي (`is_visible` = `false`) أو خارج الوقت المحدد (`show_at`/`hide_at`)، تعتبر المحاضرات التالية مفتوحة
- **المنطق الجديد**: إذا كان الامتحان ظاهر للطالب ولم يخضع له بعد، المحاضرات التالية مقفلة

#### منطق قفل المحاضرات:
1. **الامتحان مرئي للطالب** + `lock_next_lectures` = `true` → يفحص حالة الطالب في الامتحان
2. **الطالب لم يخضع للامتحان بعد** → المحاضرات التالية مقفلة (لأن الامتحان ظاهر)
3. **الطالب نجح في الامتحان** → المحاضرات التالية مفتوحة
4. **الطالب فشل في الامتحان** → المحاضرات التالية مقفلة
5. **الامتحان مخفي أو غير مرئي** → المحاضرات التالية مفتوحة دائماً
6. **لا يوجد امتحان** → المحاضرات التالية مفتوحة دائماً

### 3. إظهار الإجابات
- إذا كان `show_answers_immediately` = `true`، تظهر الإجابات فور تسليم الامتحان
- إذا كان `show_answers_immediately` = `false`، تظهر الإجابات بعد `show_answers_after_hours` ساعة من تسليم الامتحان
- إذا لم يخضع الطالب للامتحان، لا يمكنه رؤية الإجابات

## التوافق مع الإصدار القديم

- جميع الحقول الجديدة اختيارية
- إذا لم يتم إرسالها، يتم استخدام القيم الافتراضية:
  - `show_at`: `null` (يظهر فوراً)
  - `hide_at`: `null` (لا يختفي)
  - `lock_next_lectures`: `false`
  - `show_answers_immediately`: `true`
  - `show_answers_after_hours`: `0`

## أمثلة الاستخدام

### امتحان يظهر لمدة أسبوع فقط
```json
{
  "title": "امتحان أسبوعي",
  "show_at": "2024-01-20T09:00:00Z",
  "hide_at": "2024-01-27T23:59:59Z",
  "is_visible": true
}
```

### امتحان يقفل المحاضرات التالية
```json
{
  "title": "امتحان مهم",
  "lock_next_lectures": true,
  "show_answers_immediately": false,
  "show_answers_after_hours": 48
}
```

### امتحان بسيط (بدون إعدادات متقدمة)
```json
{
  "title": "امتحان بسيط",
  "total_grade": 50,
  "is_visible": true
}
```

## سيناريوهات قفل المحاضرات

### السيناريو 1: امتحان مرئي مع قفل المحاضرات
```json
{
  "title": "امتحان المحاضرة الأولى",
  "is_visible": true,
  "lock_next_lectures": true
}
```
**النتيجة**: الطالب يجب أن ينجح في الامتحان للوصول للمحاضرات التالية

### السيناريو 2: امتحان مخفي مع قفل المحاضرات
```json
{
  "title": "امتحان المحاضرة الأولى",
  "is_visible": false,
  "lock_next_lectures": true
}
```
**النتيجة**: المحاضرات التالية مفتوحة للطالب (لأن الامتحان مخفي)

### السيناريو 3: طالب لم يخضع للامتحان بعد
```json
{
  "title": "امتحان المحاضرة الأولى",
  "is_visible": true,
  "lock_next_lectures": true
}
```
**النتيجة**: المحاضرات التالية مقفلة للطالب (لأن الامتحان ظاهر ولم يخضع له بعد)

### السيناريو 4: طالب فشل في الامتحان
```json
{
  "title": "امتحان المحاضرة الأولى",
  "is_visible": true,
  "lock_next_lectures": true
}
```
**النتيجة**: المحاضرات التالية مقفلة للطالب (لأنه فشل في الامتحان)


## ملاحظات مهمة

### منطق قفل المحاضرات:
- **يعمل فقط** إذا كان الامتحان مرئي للطالب حالياً
- **لا يعمل** إذا كان الامتحان مخفي (`is_visible` = `false`)
- **لا يعمل** إذا كان الامتحان خارج الوقت المحدد (`show_at`/`hide_at`)
- **لا يعمل** إذا لم يكن الطالب مسجل في الكورس

### مثال عملي:
1. المدرس ينشئ امتحان مع `is_visible: false` و `lock_next_lectures: true`
2. الطالب يرى المحاضرات التالية مفتوحة (لأن الامتحان مخفي)
3. المدرس يغير `is_visible` إلى `true`
4. الآن الطالب يجب أن ينجح في الامتحان للوصول للمحاضرات التالية

---

# إعدادات التحكم في عرض الإجابات والمواعيد الزمنية

تم إضافة مجموعة إعدادات جديدة يمكن للمدرس تحديدها عند إنشاء الامتحان لضبط تجربة الطالب بالكامل:

1. **إظهار الإجابات فوراً**  
   - `showAnswersImmediately: boolean`  
   - إذا كانت `true` تظهر الأسئلة الخاطئة والإجابات الصحيحة مباشرة بعد التسليم.

2. **جدولة إظهار الإجابات لاحقاً**  
   - `showAnswersLater: boolean`  
   - `answersReleaseDate: ISO Date`  
   - إذا كانت `true` فلا يظهر أي تصحيح قبل موعد `answersReleaseDate`. بعده يرى الطالب كل إجاباته السابقة والأسئلة الخاطئة.

3. **عدد المحاولات**  
   - `allowMultipleAttempts: boolean`  
   - إذا كانت `false`، لن يتمكن الطالب من رؤية الأسئلة بعد تسليم الامتحان، وسيستلم رسالة `status: "already_submitted"`.

4. **التحكم في الوقت**  
   - `timeLimitEnabled: boolean`  
   - `timeLimitMinutes: number | null`  
   - `startWindow: ISO Date | null`  
   - `endWindow: ISO Date | null`  
   - عند بدء المحاولة يتم تسجيل `attemptStartTime` ويتم حساب `attemptExpireAt`. أي تسليم بعد انتهاء الوقت يُخزن كـ `status: "late"` ويُعلَم المعلم بذلك.

> **أولوية المنطق**:  
> 1. `showAnswersImmediately`  
> 2. `showAnswersLater + answersReleaseDate`  
> 3. تحقق انتهاء الوقت `timeLimitEnabled`  
> 4. `allowMultipleAttempts`

---

# واجهات REST الجديدة

## إنشاء امتحان بمحاولات ووقت

```
POST /api/exams
Authorization: Bearer <TEACHER_TOKEN>
Content-Type: application/json

{
  "lectureId": 42,
  "title": "Midterm - Chapter 1",
  "totalGrade": 20,
  "isVisible": true,
  "showAnswersImmediately": false,
  "showAnswersLater": true,
  "answersReleaseDate": "2025-01-12T10:00:00Z",
  "allowMultipleAttempts": false,
  "timeLimitEnabled": true,
  "timeLimitMinutes": 45,
  "startWindow": "2025-01-10T17:00:00Z",
  "endWindow": "2025-01-10T19:00:00Z"
}
```

### استجابة النجاح
```
{
  "exam": {
    "id": 315,
    "lectureId": 42,
    "title": "Midterm - Chapter 1",
    "totalGrade": 20,
    "isVisible": true,
    "showAnswersImmediately": false,
    "showAnswersLater": true,
    "answersReleaseDate": "2025-01-12T10:00:00.000Z",
    "allowMultipleAttempts": false,
    "timeLimitEnabled": true,
    "timeLimitMinutes": 45,
    "startWindow": "2025-01-10T17:00:00.000Z",
    "endWindow": "2025-01-10T19:00:00.000Z",
    "createdAt": "2024-11-22T11:00:00.000Z"
  }
}
```

## جلب الامتحان (طالب أو مدرس)

```
GET /api/exams/:examId
Authorization: Bearer <TOKEN>
```

### استجابة طالب لديه محاولة نشطة
```
{
  "exam": {
    "id": 315,
    "lectureId": 42,
    "title": "Midterm - Chapter 1",
    "timeLimitEnabled": true,
    "timeLimitMinutes": 45,
    "allowMultipleAttempts": false,
    "showAnswersImmediately": false,
    "showAnswersLater": true,
    "answersReleaseDate": "2025-01-12T10:00:00.000Z",
    "startWindow": "2025-01-10T17:00:00.000Z",
    "endWindow": "2025-01-10T19:00:00.000Z"
  },
  "status": "ready",
  "questions": [
    {
      "id": 901,
      "text": "What is kinetic energy?",
      "grade": 1,
      "choices": [
        { "id": 501, "text": "Energy of motion" },
        { "id": 502, "text": "Stored energy" },
        { "id": 503, "text": "Nuclear energy" },
        { "id": 504, "text": "No energy" }
      ]
    }
  ],
  "attempt": {
    "attemptId": 812,
    "attemptStartTime": "2025-01-10T17:02:00.000Z",
    "attemptExpireAt": "2025-01-10T17:47:00.000Z",
    "remainingSeconds": 2500,
    "timeLimitMinutes": 45
  },
  "attemptHistory": [
    {
      "attemptId": 812,
      "attemptNumber": 1,
      "status": "in_progress",
      "totalGrade": null
    }
  ]
}
```

### استجابة طالب أنهى الامتحان ومحاولة جديدة غير مسموحة
```
{
  "exam": { ... },
  "status": "already_submitted",
  "message": "You have already completed this exam.",
  "attemptHistory": [
    {
      "attemptId": 813,
      "attemptNumber": 1,
      "status": "submitted",
      "totalGrade": 17,
      "submittedAt": "2025-01-10T17:40:00.000Z"
    }
  ],
  "feedback": {
    "attemptId": 813,
    "releasedAt": "2025-01-12T10:00:00.000Z",
    "releaseReason": "scheduled_release",
    "answers": [
      {
        "questionId": 901,
        "questionText": "What is kinetic energy?",
        "selectedChoice": { "id": 501, "text": "Energy of motion" },
        "correctChoice": { "id": 501, "text": "Energy of motion" },
        "isCorrect": true
      }
    ]
  }
}
```

## بدء محاولة
```
POST /api/exams/:examId/start
Authorization: Bearer <STUDENT_TOKEN>

{
  "attemptId": 9001,
  "attemptStartTime": "2025-01-10T17:02:00.000Z",
  "attemptExpireAt": "2025-01-10T17:47:00.000Z",
  "remainingSeconds": 2670,
  "timeLimitMinutes": 45
}
```

في حال وجود محاولة غير منتهية يعاد نفس المعرف مع الوقت المتبقي. إذا انتهت المهلة يتم وسم المحاولة السابقة بـ `status: "expired"` ولا يمكن البدء من جديد إن كان الامتحان يسمح بمحاولة واحدة فقط.

## تسليم الامتحان
```
POST /api/exams/:examId/submit
Authorization: Bearer <STUDENT_TOKEN>
Content-Type: application/json

{
  "attemptId": 9001,
  "answers": [
    { "questionId": 901, "choiceId": 501 },
    { "questionId": 902, "choiceId": 601 }
  ]
}
```

### استجابة التسليم
```
{
  "attemptId": 9001,
  "status": "late",
  "totalGrade": 18,
  "maxGrade": 20,
  "passed": true,
  "showAnswers": true,
  "releaseReason": "scheduled_release",
  "wrongQuestions": [
    {
      "questionId": 902,
      "questionText": "Choose the correct law name.",
      "correctChoice": { "id": 605, "text": "Hooke's law" },
      "yourChoice": { "id": 601, "text": "Ohm's law" }
    }
  ]
}
```

## جلب تفاصيل محاولة
```
GET /api/exams/:examId/attempts/:attemptId
Authorization: Bearer <TOKEN>
```

يرجع تفاصيل المحاولة، و `answers` تظهر فقط للمدرس أو للطالب إذا تحقق شرط عرض الإجابات (فوري أو بعد الموعد المجدول).

```
{
  "attemptId": 9001,
  "examId": 315,
  "studentId": 1205,
  "status": "submitted",
  "submittedAt": "2025-01-10T17:40:00.000Z",
  "totalGrade": 18,
  "passed": true,
  "canViewAnswers": true,
  "answers": [
    {
      "questionId": 901,
      "questionText": "What is kinetic energy?",
      "selectedChoice": { "id": 501, "text": "Energy of motion" },
      "correctChoice": { "id": 501, "text": "Energy of motion" },
      "isCorrect": true
    }
  ]
}
```

---

## حالات الاستجابة الشائعة

| الحالة | الوصف |
|--------|-------|
| `status: "not_open_yet"` | قبل موعد `startWindow` |
| `status: "closed"` | بعد `endWindow` أو `hide_at` |
| `status: "already_submitted"` | عند تفعيل محاولة واحدة فقط |
| `status: "late"` | تم التسليم بعد انتهاء الوقت المحدد |
| `status: "expired"` | انتهى الوقت دون تسليم |

---

## ملفات .http جاهزة للاختبار

تم تحديث ملف `test-advanced-exam-settings.http` بأمثلة كاملة (إنشاء الامتحان، بدء محاولة، تسليم، جلب النتائج) لتسهيل الاختبار اليدوي عبر VS Code أو Thunder Client.