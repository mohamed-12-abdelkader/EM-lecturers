# توثيق نظام التحكم في الامتحانات (Exam Flow Teacher Controls)

يشرح هذا المستند كيفية ضبط سلوك امتحانات المحاضرات عبر الإعدادات الجديدة التي يتحكم بها المدرس، وكيف تؤثر هذه الإعدادات على تجربة الطالب في إنشاء الامتحان، بدء المحاولة، تسليم الإجابات، ورؤية التصحيح.

> **أولوية المنطق عند التصحيح والظهور:**  
> 1. `showAnswersImmediately`  
> 2. `showAnswersLater + answersReleaseDate`  
> 3. التحقق من انتهاء الوقت `timeLimitEnabled`  
> 4. سياسة المحاولات `allowMultipleAttempts`

---

## 1. إنشاء الامتحان

**POST** `/api/exams`

| الحقل | النوع | الوصف |
|-------|-------|-------|
| `showAnswersImmediately` | boolean | إظهار التصحيح فور التسليم. إذا كانت `true` يتم إرجاع الأسئلة الخاطئة + الإجابات الصحيحة في استجابة التسليم. |
| `allowMultipleAttempts` | boolean | السماح للطالب بأكثر من محاولة. إذا كانت `false` فبعد أول تسليم ناجح/متأخر لن يرى الطالب الأسئلة مجدداً. |
| `showAnswersLater` | boolean | جدول زمني لإظهار الإجابات لاحقاً. يتطلب `answersReleaseDate`. |
| `answersReleaseDate` | ISO Date | تاريخ/وقت فتح التصحيح لاحقاً. |
| `timeLimitEnabled` | boolean | تفعيل التوقيت لكل محاولة. |
| `timeLimitMinutes` | number \| null | مدة المحاولة بالدقائق. يجب توفير قيمة موجبة عند تفعيل التوقيت. |
| `startWindow` | ISO Date \| null | موعد فتح الامتحان للطلاب. قبل هذا الموعد يحصل الطالب على حالة `not_open_yet`. |
| `endWindow` | ISO Date \| null | موعد إغلاق الامتحان. بعده يحصل الطالب على حالة `closed` ولا يمكن بدء محاولات جديدة. |

### مثال طلب
```json
{
  "lectureId": 42,
  "title": "Midterm Chapter 1",
  "totalGrade": 20,
  "isVisible": true,
  "showAnswersImmediately": false,
  "allowMultipleAttempts": false,
  "showAnswersLater": true,
  "answersReleaseDate": "2025-01-12T10:00:00Z",
  "timeLimitEnabled": true,
  "timeLimitMinutes": 45,
  "startWindow": "2025-01-10T17:00:00Z",
  "endWindow": "2025-01-10T19:00:00Z"
}
```

### التحقق عند الإنشاء
- يرفض النظام القيم غير الصحيحة (مثل وقت سالب أو تاريخ غير صالح).
- عند تفعيل `showAnswersLater` يجب إرسال `answersReleaseDate`.
- عند تفعيل المؤقت يجب إرسال `timeLimitMinutes > 0`.
- يجب أن يكون `startWindow < endWindow` عند إرسال كلاهما.

---

## 2. جلب الامتحان (طالب / مدرس)

**GET** `/api/exams/:examId`

### ما يتم إرجاعه لكل طالب
- كائن الامتحان مع جميع الإعدادات.
- حالة الوصول:
  - `hidden`: الامتحان غير مرئي (`isVisible = false` أو خارج `show_at/hide_at`).
  - `not_open_yet`: قبل `startWindow`.
  - `closed`: بعد `endWindow`.
  - `already_submitted`: الطالب استهلك المحاولة الوحيدة المسموحة.
  - `ready`: يمكنه رؤية الأسئلة وبدء/استئناف محاولة.
- `attempt`: إذا كان لديه محاولة نشطة، تحتوي `attemptId`, `attemptStartTime`, `attemptExpireAt`, `remainingSeconds`, `timeLimitMinutes`.
- `attemptHistory`: قائمة مختصرة بكل المحاولات (الترقيم، الحالة، الدرجة، وقت التسليم).
- `feedback`: يظهر فقط عند تفعيل أحد خيارات إظهار الإجابات وحلول الطالب، ويتضمن:
  - `releaseReason` (immediate, scheduled_release, delayed_hours)
  - `wrongQuestions`: الأسئلة التي أخطأ بها الطالب
  - `answers`: كل إجابة اختارها مع الإجابة الصحيحة

### مثال استجابة عندما لا يُسمح إلا بمحاولة واحدة وقد سلّم الطالب بالفعل
```json
{
  "exam": { "...": "..." },
  "status": "already_submitted",
  "message": "You have already completed this exam.",
  "attemptHistory": [
    { "attemptId": 15, "status": "submitted", "totalGrade": 16, "submittedAt": "2025-01-10T18:00:00Z" }
  ],
  "feedback": {
    "attemptId": 15,
    "releasedAt": "2025-01-12T10:00:00Z",
    "releaseReason": "scheduled_release",
    "wrongQuestions": [
      {
        "questionId": 901,
        "questionText": "What is kinetic energy?",
        "correctChoice": { "id": 501, "text": "Energy of motion" },
        "yourChoice": { "id": 503, "text": "Nuclear energy" }
      }
    ]
  }
}
```

---

## 3. بدء محاولة

**POST** `/api/exams/:examId/start`

الشروط:
- يجب أن يكون الطالب مسجلاً في نفس الكورس.
- يجب أن يكون الامتحان مرئياً وفي داخل نافذة `startWindow/endWindow`.
- إذا كان لديه محاولة نشطة يتم إرجاعها بدلاً من إنشاء جديدة.
- إذا كان `allowMultipleAttempts = false` وتمت محاولة سابقة منتهية → يتم رفض الطلب برسالة "You have already completed this exam."

### بيانات الإرجاع
```json
{
  "attemptId": 812,
  "attemptStartTime": "2025-01-10T17:02:00Z",
  "attemptExpireAt": "2025-01-10T17:47:00Z",
  "remainingSeconds": 2500,
  "timeLimitMinutes": 45
}
```

---

## 4. تسليم محاولة

**POST** `/api/exams/:examId/submit`

### خطوات المعالجة
1. التحقق من أن الامتحان ما زال متاحاً للطالب.
2. اختيار المحاولة الحالية (أو إنشاء واحدة تلقائياً إذا سمح المعلم بذلك).
3. تقييم الإجابات وحساب الدرجة.
4. تحديد حالة المحاولة:
   - `submitted`: تم التسليم داخل الوقت.
   - `late`: تم التسليم بعد `attempt_expire_at` (يتم حساب الدرجة ولكن تُعلّم كمحاولة متأخرة).
   - `expired`: إذا انتهى الوقت ولم يسلم الطالب، يتم وضع المحاولة تلقائياً في حالة `expired` عند محاولة الدخول لاحقاً.
5. بناء ردّ الإظهار بناءً على إعدادات المدرس.

### استجابة التسليم
```json
{
  "attemptId": 812,
  "status": "late",
  "totalGrade": 16,
  "maxGrade": 20,
  "passed": true,
  "showAnswers": true,
  "releaseReason": "immediate",
  "wrongQuestions": [
    {
      "questionId": 901,
      "questionText": "What is kinetic energy?",
      "correctChoice": { "id": 501, "text": "Energy of motion" },
      "yourChoice": { "id": 503, "text": "Nuclear energy" }
    }
  ]
}
```

> ملاحظة: عند تعطيل كل خيارات إظهار الإجابات لا يتم إرجاع `wrongQuestions` أو `showAnswers = true`.

---

## 5. الاطلاع على تفاصيل محاولة سابقة

**GET** `/api/exams/:examId/attempts/:attemptId`

- الطلاب يرون التفاصيل فقط إذا سمحت سياسة الإظهار (فوري، أو في موعد محدد، أو بعد عدد ساعات).
- المدرسون/الإداريون يرون كل شيء دائماً.

### الحقول الأساسية
| الحقل | الوصف |
|-------|-------|
| `status` | `in_progress`, `submitted`, `late`, `expired` |
| `attemptStartTime`, `attemptEndTime` | توقيت بداية ونهاية المحاولة |
| `timeLimitMinutes` | المدة التي كانت فعالة أثناء المحاولة |
| `wrongQuestions` | متاحة فقط عند السماح بإظهار الإجابات |
| `answers` | قائمة مفصلة بالإجابات المختارة والإجابة الصحيحة |

---

## 6. منطق النوافذ الزمنية

| الحالة | الوصف |
|--------|-------|
| `hidden` | الامتحان مخفي أو خارج `show_at/hide_at`. |
| `not_open_yet` | الوقت الحالي قبل `startWindow`. |
| `closed` | الوقت الحالي بعد `endWindow`. |
| `ready` | الامتحان متاح ويمكن قراءة الأسئلة/بدء محاولة. |
| `already_submitted` | لا توجد محاولات مسموحة إضافية. |

---

## 7. حالة المحاولات

| الحالة | كيف نصل إليها | التأثير |
|--------|---------------|----------|
| `in_progress` | عند بدء المحاولة ولم يتم التسليم بعد. | يتم حساب `remainingSeconds` عند كل جلب للامتحان. |
| `submitted` | تم التسليم قبل انتهاء الوقت. | تُحتسب الدرجة عادة. |
| `late` | تم التسليم بعد انتهاء الوقت. | تُحتسب الدرجة ولكن تُعلّم المحاولة كمخالفة للوقت ليقرر المعلم سياسته. |
| `expired` | انتهى الوقت ولم يتم التسليم (يتم وسمها عند جلب الامتحان التالي). | لا يمكن استئنافها. |

---

## 8. سياسات إظهار الإجابات

| الإعداد | الوصف |
|---------|-------|
| `showAnswersImmediately = true` | يتم إرفاق الأسئلة الخاطئة والإجابات الصحيحة فوراً في ردّ `/submit`. |
| `showAnswersLater = true` + `answersReleaseDate` | لا تظهر أي بيانات تصحيح قبل الموعد. بعد الموعد، عند جلب الامتحان أو محاولة سابقة، تظهر الإجابات السابقة كاملة. |
| `showAnswersAfterHours > 0` | بعد X ساعات من وقت التسليم (`submitted_at`) يتم إتاحة التصحيح. |

> إذا كانت كل الإعدادات السابقة `false` أو صفر، فلن يرى الطالب أي تصحيح إلا إذا فعّل المعلم خياراً لاحقاً.

---

## 9. أمثلة سيناريوهات

### سيناريو: امتحان بمحاولة واحدة وتصحيح مجدول
1. المدرس ينشئ الامتحان مع:
   - `allowMultipleAttempts = false`
   - `showAnswersImmediately = false`
   - `showAnswersLater = true`
   - `answersReleaseDate = 2025-01-12T10:00:00Z`
2. الطالب يحل الامتحان في 10 يناير. عند جلب الامتحان مرة أخرى يحصل على:
   - `status: "already_submitted"`
   - `feedback: null` حتى يمر الموعد.
3. بعد 12 يناير الساعة 10 صباحاً، نفس الطلب يعيد:
   - `feedback.releaseReason = "scheduled_release"`
   - `wrongQuestions` و `answers`.

### سيناريو: امتحان تدريب بمحاولات مفتوحة وبدون مؤقت
1. المدرس يرسل:
   - `allowMultipleAttempts = true`
   - `timeLimitEnabled = false`
   - `showAnswersImmediately = true`
2. كل مرة يسلم الطالب، تظهر الأسئلة الخاطئة فوراً، ويمكنه الضغط على `/start` مرة أخرى لبداية محاولة جديدة.

---

## 10. الاختبارات الآلية

- تمت إضافة ملف اختبار وحدات `src/services/__tests__/examPolicies.test.ts` للتحقق من:
  - منطق إظهار الإجابات الفوري والمجدول.
  - السماح بمحاولات متعددة مقابل محاولات مفردة.
  - حساب الوقت المتبقي واكتشاف المحاولات المتأخرة.
- يمكن تشغيل الاختبارات بالأمر:
  ```bash
  npm test -- examPolicies
  ```

---

## 11. تقارير أداء الأسئلة للمدرس

يمكن للمدرس (أو المشرف) طلب تقرير تفصيلي يوضح أداء الطلاب في كل سؤال داخل الامتحان.

**GET** `/api/exams/:examId/report`  
يتطلب صلاحية مدرس يملك الامتحان أو صلاحية مسؤول.

### ما الذي يتم إرجاعه؟
```json
{
  "exam": { "...": "..." },
  "questions": [
    {
      "questionId": 901,
      "questionText": "What is kinetic energy?",
      "questionImage": null,
      "grade": 1,
      "totalResponses": 18,
      "correctCount": 11,
      "incorrectCount": 7,
      "correctStudents": [
        { "studentId": 42, "studentName": "Ahmed Ali", "submissionId": 1205, "attemptNumber": 1 }
      ],
      "incorrectStudents": [
        { "studentId": 51, "studentName": "Sara Mohamed", "submissionId": 1207, "attemptNumber": 1 }
      ]
    }
  ]
}
```

- يتم جمع البيانات من جدول الإجابات النهائي (`exam_answers`) مع محاولات الطلاب المكتملة فقط (`submitted`, `late`, `expired`).
- `correctStudents` و`incorrectStudents` تعرض هوية الطالب، اسمه، رقم المحاولة، ورقم التسليم لتتبع المحاولات.
- `totalResponses = correctCount + incorrectCount`، وتكون القيم صفر إذا لم يُجب أحد على السؤال بعد.

هذا التقرير يساعد المدرس على تحديد الأسئلة التي تسببت في صعوبة أو التي تمت الإجابة عنها بسهولة، ومعرفة أسماء الطلاب لكل حالة.

---

بهذه الإعدادات يستطيع المدرس ضبط تجربة الامتحان بالكامل: متى يظهر، كم محاولة مسموحة، هل يوجد وقت زمني فعلي، ومتى يرى الطالب التصحيح. كل الواجهات الخلفية تم تحديثها لضمان الالتزام بهذه السياسات في جميع الحواف (إنشاء، جلب، بدء، تسليم، استعراض محاولات قديمة).

