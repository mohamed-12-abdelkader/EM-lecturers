# Exam & Assignment API Documentation

---

# امتحان الكورس (Course Level Exam)

## إنشاء امتحان للكورس

**POST** `/api/exams`

- للمدرس فقط
- ينشئ امتحان مرتبط بالكورس نفسه وليس بمحاضرة محددة
- **يجب إرسال البيانات كـ application/json**

### Request Body (JSON)

#### الحقول المطلوبة:
- `title` (string): اسم الامتحان
- `courseId` أو `course_id` (number): معرف الكورس
- `durationMinutes` أو `duration_minutes` (number): مدة الامتحان بالدقائق (يجب أن يكون > 0)
- `questionsCount` أو `questions_count` (number): عدد الأسئلة (يجب أن يكون > 0)

#### إعدادات ظهور الامتحان:
- `isVisibleToStudents` أو `is_visible_to_students` (boolean): هل الامتحان ظاهر للطلاب (افتراضي: `true`)
- `visibilityEndDate` أو `visibility_end_date` (ISO Date string): موعد انتهاء ظهور الامتحان (مطلوب إذا `isVisibleToStudents = false`)

#### إعدادات ظهور الإجابات:
- `showAnswersImmediately` أو `show_answers_immediately` (boolean): إظهار الإجابات فوراً (افتراضي: `true`)
- `answersVisibleAt` أو `answers_visible_at` (ISO Date string): موعد إظهار الإجابات (مطلوب إذا `showAnswersImmediately = false`)

#### حالة الامتحان:
- `isActive` أو `is_active` (boolean): هل الامتحان نشط (افتراضي: `true`)

### قواعد التحقق (Validation Rules):

1. `questionsCount` يجب أن يكون أكبر من 0
2. `durationMinutes` يجب أن يكون أكبر من 0
3. إذا كان `isVisibleToStudents = false`، يجب توفير `visibilityEndDate`
4. إذا كان `showAnswersImmediately = false`، يجب توفير `answersVisibleAt`
5. يجب أن يكون `courseId` موجوداً في قاعدة البيانات
6. يجب أن يكون المدرس صاحب الكورس (أو admin)

### مثال على الطلب:

```json
{
  "title": "امتحان نهاية الكورس",
  "courseId": 12,
  "durationMinutes": 60,
  "questionsCount": 20,
  "isVisibleToStudents": true,
  "showAnswersImmediately": false,
  "answersVisibleAt": "2025-01-15T10:00:00Z",
  "isActive": true
}
```

### مثال آخر (مع إخفاء الامتحان):

```json
{
  "title": "امتحان تجريبي",
  "courseId": 12,
  "durationMinutes": 45,
  "questionsCount": 15,
  "isVisibleToStudents": false,
  "visibilityEndDate": "2025-01-20T23:59:59Z",
  "showAnswersImmediately": true,
  "isActive": true
}
```

### Response (201 Created):

```json
{
  "exam": {
    "id": 1,
    "course_id": 12,
    "title": "امتحان نهاية الكورس",
    "duration_minutes": 60,
    "questions_count": 20,
    "is_visible_to_students": true,
    "visibility_end_date": null,
    "show_answers_immediately": false,
    "answers_visible_at": "2025-01-15T10:00:00.000Z",
    "is_active": true,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-10T10:30:00.000Z"
  }
}
```

### أخطاء محتملة:

#### 400 Bad Request - بيانات ناقصة:
```json
{
  "message": "title is required"
}
```

#### 400 Bad Request - قيم غير صحيحة:
```json
{
  "message": "durationMinutes must be greater than 0"
}
```

#### 400 Bad Request - قواعد التحقق:
```json
{
  "message": "visibilityEndDate is required when isVisibleToStudents is false"
}
```

```json
{
  "message": "answersVisibleAt is required when showAnswersImmediately is false"
}
```

#### 404 Not Found - الكورس غير موجود:
```json
{
  "message": "Course not found"
}
```

#### 403 Forbidden - غير مصرح:
```json
{
  "message": "You are not allowed to create exams for this course"
}
```

### مثال على الاستخدام (cURL):

```bash
curl -X POST http://localhost:8000/api/exams \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "امتحان نهاية الكورس",
    "courseId": 12,
    "durationMinutes": 60,
    "questionsCount": 20,
    "isVisibleToStudents": true,
    "showAnswersImmediately": false,
    "answersVisibleAt": "2025-01-15T10:00:00Z",
    "isActive": true
  }'
```

### ملاحظات مهمة:

1. **الصيغة المرنة**: يمكنك استخدام camelCase (`courseId`) أو snake_case (`course_id`) - النظام يدعم كليهما
2. **القيم الافتراضية**: إذا لم ترسل `isVisibleToStudents`، `showAnswersImmediately`، أو `isActive`، سيتم استخدام القيم الافتراضية (`true`)
3. **التواريخ**: يجب إرسال التواريخ بصيغة ISO 8601 (مثل: `2025-01-15T10:00:00Z`)
4. **الصلاحيات**: فقط المدرس صاحب الكورس (أو admin) يمكنه إنشاء امتحان للكورس
5. **التحقق من الكورس**: النظام يتحقق تلقائياً من وجود الكورس وأن المدرس صاحبه قبل إنشاء الامتحان

---

## إنشاء امتحان شامل للكورس

**POST** `/api/course/:courseId/course-exam`

- للمدرس فقط
- ينشئ امتحان شامل مرتبط بالكورس نفسه وليس بمحاضرة
- **يجب إرسال البيانات كـ multipart/form-data** (وليس JSON)

### Request Body (form-data)
- `title`: اسم الامتحان (نص)
- `image`: ملف صورة (اختياري، type: file)
- `questions_count`: عدد الأسئلة (رقم)
- `duration`: الوقت بالدقائق (رقم)
- `total_grade`: الدرجة الكلية (رقم)

### إعدادات التحكم المتقدمة (اختيارية)
| الحقل | النوع | الوصف |
|-------|-------|-------|
| `showAt` / `show_at` | ISO Date | موعد إظهار الامتحان في المنصة. |
| `hideAt` / `hide_at` | ISO Date | موعد إخفاء الامتحان. |
| `lockNextLectures` / `lock_next_lectures` | boolean | قفل المحتوى التالي حتى النجاح. |
| `showAnswersImmediately` / `show_answers_immediately` | boolean | إظهار التصحيح فور التسليم. |
| `showAnswersAfterHours` / `show_answers_after_hours` | number | تأخير إظهار التصحيح بعد عدد ساعات محدد. |
| `allowMultipleAttempts` / `allow_multiple_attempts` | boolean | السماح بأكثر من محاولة لنفس الطالب. |
| `showAnswersLater` / `show_answers_later` | boolean | جدولة إظهار الحلول لاحقاً. يتطلب `answersReleaseDate`. |
| `answersReleaseDate` / `answers_release_date` | ISO Date | موعد إطلاق التصحيح المجدول. |
| `timeLimitEnabled` / `time_limit_enabled` | boolean | تفعيل المؤقت داخل المحاولة. |
| `timeLimitMinutes` / `time_limit_minutes` | number \| null | مدة المؤقت بالدقائق عند التفعيل. |
| `startWindow` / `start_window` | ISO Date | موعد فتح الامتحان للطلاب. |
| `endWindow` / `end_window` | ISO Date | موعد إغلاق الامتحان أمام المحاولات الجديدة. |

> **ملاحظة:** نفس المنطق والقيود المذكورة في وثيقة `doc/exam-flow-teacher-controls.md` يتم تطبيقها هنا أيضاً، لذا يجب الالتزام بالعلاقات (مثل ضرورة توفير `answersReleaseDate` عند تفعيل `showAnswersLater`).

**مثال في Postman:**
- type: form-data
- key: `title` | value: امتحان نهاية الكورس
- key: `image` | value: [اختيار ملف صورة]
- key: `questions_count` | value: 20
- key: `duration` | value: 60
- key: `total_grade` | value: 100

### Response

يعيد كائن `exam` يحتوي المدة والزمن والحد الأعلى للمحاولات، بالإضافة إلى قائمة الأسئلة.
```
{
  "exam": { ... }
}
```

---

## جلب امتحانات الكورس الشاملة

**GET** `/api/course/:courseId/course-exams`

- متاح للجميع (مدرس أو طالب)

### Response
```
{
  "exams": [ { ... }, ... ]
}
```

---

## تعديل امتحان شامل للكورس

**PATCH** `/api/course/course-exam/:examId`

- للمدرس فقط
- يمكن تعديل أي من الحقول: الاسم (title)، عدد الأسئلة (questions_count)، الوقت (duration)، الدرجة (total_grade)، أو الصورة (image)
- **يجب إرسال البيانات كـ multipart/form-data** إذا كنت تريد تعديل الصورة

### Request Body (form-data)
- `title`: اسم الامتحان (اختياري)
- `image`: ملف صورة جديد (اختياري)
- `questions_count`: عدد الأسئلة (اختياري)
- `duration`: الوقت بالدقائق (اختياري)
- `total_grade`: الدرجة الكلية (اختياري)

### Response
```
{
  "exam": { ... }
}
```

---

## حذف امتحان شامل للكورس

**DELETE** `/api/course/course-exam/:examId`

- للمدرس فقط

### Response
```
{
  "message": "Course exam deleted successfully"
}
```

---

## إضافة أسئلة من مكتبة الأسئلة لامتحان الكورس الشامل

**POST** `/api/course/course-exam/:examId/add-questions`

- للمدرس فقط
- يضيف أسئلة موجودة مسبقاً في مكتبة الأسئلة إلى امتحان الكورس الشامل

### Request Body
```
{
  "question_ids": [1, 2, 3]
}
```

### Response
```
{
  "message": "Questions added from bank"
}
```

---

## إضافة أسئلة جديدة دفعة واحدة (bulk) لامتحان الكورس الشامل

**POST** `/api/course/course-exam/:examId/bulk-questions`

- للمدرس فقط
- يضيف أسئلة جديدة مع اختياراتها دفعة واحدة
- يدعم تنسيقين: JSON array أو نص منسق

### الطريقة الأولى: JSON Array (التنسيق الحالي)

#### Request Body
```
{
  "questions": [
    {
      "text": "Victims of the crash will be __________ for their injuries.",
      "choices": [
        {"text": "compensated", "is_correct": true},
        {"text": "punished", "is_correct": false},
        {"text": "cheated", "is_correct": false},
        {"text": "pirated", "is_correct": false}
      ]
    },
    {
      "text": "When someone is officially found to be guilty of a particular crime is called a/an __________.",
      "choices": [
        {"text": "compensator", "is_correct": false},
        {"text": "murder", "is_correct": false},
        {"text": "convict", "is_correct": true},
        {"text": "casualty", "is_correct": false}
      ]
    }
  ]
}
```

### الطريقة الثانية: النص المنسق (التنسيق الجديد)

#### Request Body
```
{
  "bulk_text": "You were __________ to escape unharmed.\nA) unfortunately\nB) fortunately\nC) fortunate\nD) unfortunate\n\nMai as well as her sisters __________ a promise to help their mother at home.\nA) has done\nB) have done\nC) have made\nD) has made"
}
```

#### قواعد التنسيق:
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- **ملاحظة:** في التنسيق الجديد، جميع الاختيارات تُحفظ كـ `is_correct: false` (يمكن تعديلها لاحقاً)

### Response
```
{
  "message": "Bulk questions added from text",
  "success": true,
  "inserted": 2
}
```

---

## جلب أسئلة امتحان الكورس الشامل

**GET** `/api/course/course-exam/:examId/questions`

- متاح للمدرس صاحب الكورس أو الطالب المشترك في الكورس

### Response
```
{
  "questions": [
    {
      "id": 1,
      "text": "Victims of the crash will be __________ for their injuries.",
      "type": "single_choice",
      "position": 1,
      "choices": [
        { "id": 10, "text": "compensated", "is_correct": true },
        { "id": 11, "text": "punished", "is_correct": false },
        ...
      ]
    },
    ...
  ]
}
```

---

## تغيير حالة ظهور محاضرة (إظهار/إخفاء)

**PATCH** `/api/course/lecture/:lectureId/visibility`

- للمدرس فقط
- يغير حالة ظهور المحاضرة للطلاب

### Request Body
```
{
  "is_visible": true // أو false
}
```

### Response
```
{
  "lecture": { ... }
}
```

---

## ملاحظات
- امتحان الكورس الشامل مرتبط بالكورس نفسه وليس بمحاضرة محددة
- يمكن للمدرس إضافة أسئلة من مكتبة الأسئلة أو إضافة أسئلة جديدة
- يدعم التنسيق الجديد لإضافة الأسئلة بالطريقة المفضلة للمدرس

---

# امتحانات المحاضرات

## إنشاء امتحان محاضرة

**POST** `/api/course/lecture/:lectureId/exam`

- للمدرس فقط
- ينشئ امتحان مرتبط بمحاضرة معينة
- **يجب إرسال البيانات كـ multipart/form-data** إذا كنت تريد إضافة صورة

### Request Body (form-data)
- `title`: اسم الامتحان (اختياري، افتراضي: "Lecture Exam")
- `image`: ملف صورة (اختياري، type: file)
- `total_grade`: الدرجة الكلية (اختياري، افتراضي: 100)
- `duration`: الوقت بالدقائق (اختياري)

**مثال في Postman:**
- type: form-data
- key: `title` | value: امتحان المحاضرة الأولى
- key: `image` | value: [اختيار ملف صورة]
- key: `total_grade` | value: 50
- key: `duration` | value: 30

### Response
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "image": "/uploads/exams/filename.jpg",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## جلب امتحان محاضرة

**GET** `/api/course/lecture/:lectureId/exam`

- متاح للمدرس والطالب
- يجلب امتحان المحاضرة المحددة

### Response
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 50,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى",
    "image": "/uploads/exams/filename.jpg",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## تعديل امتحان محاضرة

**PATCH** `/api/course/lecture/exam/:examId`

- للمدرس فقط
- يمكن تعديل أي من الحقول: الاسم (title)، الدرجة (total_grade)، الوقت (duration)، أو الصورة (image)
- **يجب إرسال البيانات كـ multipart/form-data** إذا كنت تريد تعديل الصورة

### Request Body (form-data)
- `title`: اسم الامتحان (اختياري)
- `image`: ملف صورة جديد (اختياري)
- `total_grade`: الدرجة الكلية (اختياري)
- `duration`: الوقت بالدقائق (اختياري)

### Response
```json
{
  "exam": {
    "id": 1,
    "lecture_id": 12,
    "type": "exam",
    "total_grade": 60,
    "created_by": 1,
    "title": "امتحان المحاضرة الأولى - محدث",
    "image": "/uploads/exams/new_filename.jpg",
    "created_at": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## حذف امتحان محاضرة

**DELETE** `/api/course/lecture/exam/:examId`

- للمدرس فقط

### Response
```json
{
  "message": "Lecture exam deleted successfully"
}
```

---

## ملاحظات
- امتحان المحاضرة مرتبط بمحاضرة معينة
- يمكن إنشاء امتحان واحد فقط لكل محاضرة
- بعد إنشاء الامتحان، يمكن إضافة الأسئلة باستخدام `/api/questions/lecture-exam/:examId/bulk`

---

# نظام إدارة الأسئلة المركزي

## نظرة عامة

نظام إدارة الأسئلة يسمح للمدرسين بإدارة الأسئلة بشكل مركزي. يدعم إضافة أسئلة دفعة واحدة من نص منسق، وتحديث الإجابات الصحيحة، وحذف وتعديل الأسئلة.

## المميزات الرئيسية

- ✅ إضافة أسئلة دفعة واحدة من نص منسق
- ✅ جلب جميع الأسئلة مع خياراتها
- ✅ تحديث الإجابة الصحيحة لكل سؤال
- ✅ حذف وتعديل الأسئلة
- ✅ تخزين الخيارات كـ JSONB للمرونة

---

## APIs إدارة الأسئلة

جميع المسارات تتطلب مصادقة المدرس أو Admin وتبدأ بـ:
```
/api/questions
```

---

### 1. إضافة أسئلة دفعة واحدة

**POST** `/api/questions/bulk`

**الوصف:** إضافة عدة أسئلة دفعة واحدة من نص منسق

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished\n\nSuch bad behaviour __________ all the rules of a civilized society.\nA) announces\nB) punishes\nC) violates\nD) demands"
}
```

**قواعد التنسيق:**
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- **ملاحظة:** الإجابة الصحيحة تُحفظ كـ `null` افتراضياً (يمكن تحديثها لاحقاً)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/questions/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

**الاستجابة:**
```json
{
  "success": true,
  "inserted": 2,
  "questions": [
    {
      "id": 1,
      "question_text": "To __________ is to spoil or destroy something severely or completely.",
      "options": {
        "A": "compensated",
        "B": "compensate", 
        "C": "occur",
        "D": "ruin"
      },
      "correct_option": null,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": 2,
      "question_text": "She was __________ of murdering her drunken husband.",
      "options": {
        "A": "convicted",
        "B": "supported",
        "C": "admitted", 
        "D": "punished"
      },
      "correct_option": null,
      "created_at": "2024-01-15T10:30:00.000Z",
      "updated_at": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### 2. إضافة أسئلة دفعة واحدة لامتحان محاضرة معينة

**POST** `/api/questions/lecture-exam/:examId/bulk`

**الوصف:** إضافة أسئلة دفعة واحدة لامتحان محاضرة معينة

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
}
```

**قواعد التنسيق:**
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- **ملاحظة:** جميع الاختيارات تُحفظ كـ `is_correct: false` افتراضياً (يمكن تعديلها لاحقاً)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/questions/lecture-exam/123/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

**الاستجابة:**
```json
{
  "success": true,
  "inserted": 2,
  "questions": [
    {
      "id": 1,
      "text": "To __________ is to spoil or destroy something severely or completely.",
      "choices": [
        {"text": "compensated", "is_correct": false},
        {"text": "compensate", "is_correct": false},
        {"text": "occur", "is_correct": false},
        {"text": "ruin", "is_correct": false}
      ]
    },
    {
      "id": 2,
      "text": "She was __________ of murdering her drunken husband.",
      "choices": [
        {"text": "convicted", "is_correct": false},
        {"text": "supported", "is_correct": false},
        {"text": "admitted", "is_correct": false},
        {"text": "punished", "is_correct": false}
      ]
    }
  ],
  "examId": 123
}
```

---

### 3. جلب أسئلة امتحان محاضرة معين

**GET** `/api/questions/lecture-exam/:examId/questions`

**الوصف:** جلب جميع أسئلة امتحان محاضرة معين مع اختياراتها

**الصلاحيات:** مدرس أو admin أو student

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/lecture-exam/123/questions \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "questions": [
    {
      "id": 1,
      "text": "To __________ is to spoil or destroy something severely or completely.",
      "grade": 10,
      "choices": [
        {
          "id": 1,
          "text": "compensated",
          "is_correct": false
        },
        {
          "id": 2,
          "text": "compensate",
          "is_correct": false
        },
        {
          "id": 3,
          "text": "occur",
          "is_correct": false
        },
        {
          "id": 4,
          "text": "ruin",
          "is_correct": true
        }
      ]
    },
    {
      "id": 2,
      "text": "She was __________ of murdering her drunken husband.",
      "grade": 10,
      "choices": [
        {
          "id": 5,
          "text": "convicted",
          "is_correct": true
        },
        {
          "id": 6,
          "text": "supported",
          "is_correct": false
        },
        {
          "id": 7,
          "text": "admitted",
          "is_correct": false
        },
        {
          "id": 8,
          "text": "punished",
          "is_correct": false
        }
      ]
    }
  ]
}
```

---

### 4. جلب جميع الأسئلة

**GET** `/api/questions`

**الوصف:** جلب جميع الأسئلة مع خياراتها

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
[
  {
    "id": 1,
    "questionText": "To __________ is to spoil or destroy something severely or completely.",
    "options": {
      "A": "compensated",
      "B": "compensate",
      "C": "occur", 
      "D": "ruin"
    },
    "correctOption": "D",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:35:00.000Z"
  },
  {
    "id": 2,
    "questionText": "She was __________ of murdering her drunken husband.",
    "options": {
      "A": "convicted",
      "B": "supported",
      "C": "admitted",
      "D": "punished"
    },
    "correctOption": "A",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:40:00.000Z"
  }
]
```

---

### 5. جلب سؤال واحد

**GET** `/api/questions/:id`

**الوصف:** جلب سؤال معين بواسطة ID

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "To __________ is to spoil or destroy something severely or completely.",
  "options": {
    "A": "compensated",
    "B": "compensate",
    "C": "occur",
    "D": "ruin"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 6. تحديث الإجابة الصحيحة

**PATCH** `/api/questions/:id/answer`

**الوصف:** تحديث الإجابة الصحيحة لسؤال معين

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "correctOption": "D"
}
```

**مثال على الطلب:**
```bash
curl -X PATCH http://localhost:8000/api/questions/1/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correctOption": "D"
  }'
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "To __________ is to spoil or destroy something severely or completely.",
  "options": {
    "A": "compensated",
    "B": "compensate",
    "C": "occur",
    "D": "ruin"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:35:00.000Z"
}
```

---

### 7. حذف سؤال

**DELETE** `/api/questions/:id`

**الوصف:** حذف سؤال معين بواسطة ID

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

---

### 8. تحديث سؤال كامل

**PUT** `/api/questions/:id`

**الوصف:** تحديث السؤال والخيارات كاملة

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "questionText": "Updated question text?",
  "options": {
    "A": "option A",
    "B": "option B", 
    "C": "option C",
    "D": "option D"
  }
}
```

**مثال على الطلب:**
```bash
curl -X PUT http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "questionText": "What is the capital of Egypt?",
    "options": {
      "A": "Alexandria",
      "B": "Giza", 
      "C": "Luxor",
      "D": "Cairo"
    }
  }'
```

**الاستجابة:**
```json
{
  "id": 1,
  "questionText": "What is the capital of Egypt?",
  "options": {
    "A": "Alexandria",
    "B": "Giza",
    "C": "Luxor", 
    "D": "Cairo"
  },
  "correctOption": "D",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:45:00.000Z"
}
```

---

## ملاحظات مهمة

### تنسيق النص للـ bulk upload:
```
سؤال 1
A) خيار أ
B) خيار ب  
C) خيار ج
D) خيار د

سؤال 2
A) خيار أ
B) خيار ب
C) خيار ج
D) خيار د
```

### قواعد التنسيق:
- كل سؤال يبدأ بسطر نص السؤال
- بعده 4 أسطر للاختيارات (A/B/C/D)
- يمكن استخدام أي فاصل بعد الحرف: `A)`, `A.`, `A:`, `A-`, أو حتى `A` فقط
- سطر فارغ بين كل سؤال
- الإجابة الصحيحة تُحفظ كـ `null` افتراضياً

### التحقق من الأخطاء:
- إذا كان هناك خطأ في تنسيق السؤال، سيتم إرجاع رسالة خطأ واضحة
- التحقق من أن الخيارات تحتوي على A, B, C, D جميعاً
- التحقق من أن correctOption يكون A, B, C, أو D فقط

---

## أمثلة استخدام

### إنشاء امتحان محاضرة:
```bash
curl -X POST http://localhost:8000/api/course/lecture/12/exam \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: multipart/form-data" \
  -F "title=امتحان المحاضرة الأولى" \
  -F "total_grade=50" \
  -F "duration=30"
```

### إضافة أسئلة لامتحان محاضرة:
```bash
curl -X POST http://localhost:8000/api/questions/lecture-exam/123/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

### إضافة أسئلة جديدة:
```bash
curl -X POST http://localhost:8000/api/questions/bulk \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "To __________ is to spoil or destroy something severely or completely.\nA) compensated\nB) compensate\nC) occur\nD) ruin\n\nShe was __________ of murdering her drunken husband.\nA) convicted\nB) supported\nC) admitted\nD) punished"
  }'
```

### تحديث الإجابة الصحيحة:
```bash
curl -X PATCH http://localhost:8000/api/questions/1/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"correctOption": "D"}'
```

### جلب جميع الأسئلة:
```bash
curl -X GET http://localhost:8000/api/questions \
  -H "Authorization: Bearer <token>"
```

---

# امتحان الكورس الشامل (Course Exam)

---

## 1. إنشاء امتحان شامل للكورس

**POST** `/api/course/:courseId/course-exam`

- للمدرس فقط
- ينشئ امتحان شامل مرتبط بالكورس نفسه وليس بمحاضرة
- **يجب إرسال البيانات كـ multipart/form-data** (وليس JSON)

### Request Body (form-data)
- `title`: اسم الامتحان (نص)
- `image`: ملف صورة (اختياري، type: file)
- `questions_count`: عدد الأسئلة (رقم)
- `duration`: الوقت بالدقائق (رقم)
- `total_grade`: الدرجة الكلية (رقم)
- **إعدادات التحكم المتقدمة (اختيارية):**
  - نفس الحقول الموضحة في `doc/exam-flow-teacher-controls.md` مثل:
    - `showAnswersImmediately`, `showAnswersAfterHours`
    - `allowMultipleAttempts` + `attemptLimit`
    - `showAnswersLater` + `answersReleaseDate`
    - `timeLimitEnabled` + `timeLimitMinutes`
    - `showAt`, `hideAt`, `startWindow`, `endWindow`
    - `lockNextLectures`
  - يمكنك إرسال الحقول بصيغة camelCase أو snake_case (مثلاً `showAnswersLater` أو `show_answers_later`).
  - تطبق نفس قواعد التحقق: يجب توفير `answersReleaseDate` عند تفعيل `showAnswersLater`، ومدة موجبة عند تفعيل `timeLimitEnabled`، وأن يكون `startWindow < endWindow` عند إرسال كلاهما.
  - لإدارة المحاولات يمكن إرسال `attemptLimit` (أو `attempt_limit / maxAttempts`) لتحديد أقصى عدد محاولات للطالب. إذا تُرك فارغاً مع `allowMultipleAttempts = true` تعتبر المحاولات غير محدودة، وإذا كان `1` فالمحاولة الواحدة فقط متاحة.

> مثال سريع لطلب يحتوي على الإعدادات الجديدة (ما زال form-data):
> ```
> title = امتحان نهاية الكورس
> questions_count = 20
> duration = 60
> total_grade = 100
> is_visible = true
> show_answers_immediately = false
> show_answers_later = true
> answers_release_date = 2025-01-12T10:00:00Z
> allow_multiple_attempts = false
> time_limit_enabled = true
> time_limit_minutes = 45
> start_window = 2025-01-10T17:00:00Z
> end_window = 2025-01-10T19:00:00Z
> ```

**مثال في Postman:**
- type: form-data
- key: `title` | value: امتحان نهاية الكورس
- key: `image` | value: [اختيار ملف صورة]
- key: `questions_count` | value: 20
- key: `duration` | value: 60
- key: `total_grade` | value: 100

### Response
```json
{
  "exam": { ... }
}
```

---

## 2. جلب امتحانات الكورس الشاملة

**GET** `/api/course/:courseId/course-exams`

- متاح للجميع (مدرس أو طالب)

### Response
```json
{
  "exams": [ { ... }, ... ]
}
```

---

## 3. تعديل امتحان شامل للكورس

**PATCH** `/api/course/course-exam/:examId`

- للمدرس فقط
- يمكن تعديل أي من الحقول: الاسم (title)، عدد الأسئلة (questions_count)، الوقت (duration)، الدرجة (total_grade)، أو الصورة (image)
- **يجب إرسال البيانات كـ multipart/form-data** إذا كنت تريد تعديل الصورة

### Request Body (form-data)
- `title`: اسم الامتحان (اختياري)
- `image`: ملف صورة جديد (اختياري)
- `questions_count`: عدد الأسئلة (اختياري)
- `duration`: الوقت بالدقائق (اختياري)
- `total_grade`: الدرجة الكلية (اختياري)

### Response
```json
{
  "exam": { ... }
}
```

---

## 4. حذف امتحان شامل للكورس

**DELETE** `/api/course/course-exam/:examId`

- للمدرس فقط

### Response
```json
{
  "message": "Course exam deleted successfully"
}
```

---

## 5. إضافة أسئلة من مكتبة الأسئلة لامتحان الكورس الشامل

**POST** `/api/course/course-exam/:examId/add-questions`

- للمدرس فقط
- يضيف أسئلة موجودة مسبقاً في مكتبة الأسئلة إلى امتحان الكورس الشامل

### Request Body
```json
{
  "question_ids": [1, 2, 3]
}
```

### Response
```json
{
  "message": "Questions added from bank"
}
```

---

## 6. إضافة أسئلة جديدة دفعة واحدة (bulk) لامتحان الكورس الشامل

**POST** `/api/course/course-exam/:examId/bulk-questions`

- للمدرس فقط
- يضيف أسئلة جديدة مع اختياراتها دفعة واحدة
- يدعم تنسيقين: JSON array أو نص منسق

### الطريقة الأولى: JSON Array

#### Request Body
```json
{
  "questions": [
    {
      "text": "Victims of the crash will be __________ for their injuries.",
      "choices": [
        {"text": "compensated", "is_correct": true},
        {"text": "punished", "is_correct": false},
        {"text": "cheated", "is_correct": false},
        {"text": "pirated", "is_correct": false}
      ]
    }
  ]
}
```

### الطريقة الثانية: النص المنسق

#### Request Body
```json
{
  "bulk_text": "You were __________ to escape unharmed.\nA) unfortunately\nB) fortunately\nC) fortunate\nD) unfortunate"
}
```

#### تنسيق مضغوط (سطر واحد)
يمكنك أيضاً إرسال جميع الأسئلة في نص واحد دون أسطر فارغة. يكفي الحفاظ على ترتيب الاختيارات بالشكل `A) ... B) ... C) ... D) ...` لكل سؤال:
```json
{
  "bulk_text": "You were __________ to escape unharmed. A) unfortunately B) fortunately C) fortunate D) unfortunate  Mai as well as her sisters __________ a promise to help their mother at home. A) has done B) have done C) have made D) has made"
}
```
النظام سيقوم بتقسيم النص آلياً اعتماداً على تسلسل الاختيارات، لذلك لا حاجة لإضافة فواصل خاصة.

### Response
```json
{
  "message": "Bulk questions added from text",
  "success": true,
  "inserted": 2
}
```

---

## 7. جلب أسئلة امتحان الكورس الشامل

**GET** `/api/course/course-exam/:examId/questions`

- متاح للمدرس صاحب الكورس أو الطالب المشترك في الكورس

### Response
```json
{
  "exam": {
    "id": 3,
    "title": "امتحان منتصف التيرم",
    "durationMinutes": 45,
    "totalGrade": 20,
    "timeLimitEnabled": true,
    "timeLimitMinutes": 30,
    "attemptLimit": 2,
    "allowMultipleAttempts": true,
    "startWindow": "2025-01-10T17:00:00Z",
    "endWindow": "2025-01-10T19:00:00Z"
  },
  "questions": [
    {
      "id": 1,
      "text": "Victims of the crash will be __________ for their injuries.",
      "type": "single_choice",
      "position": 1,
      "choices": [
        { "id": 10, "text": "compensated", "is_correct": true },
        { "id": 11, "text": "punished", "is_correct": false }
      ]
    }
  ]
}
```

---

## 8. بدء امتحان الكورس (تجهيز المؤقت)

**POST** `/api/course/course-exam/:examId/start`

- الصلاحيات: `student` مسجل في الكورس.
- الهدف: التأكد من أن الطالب مسموح له بالبدء والحصول على بيانات المؤقت لبدء التايمر في الواجهة الأمامية.

### Response
```json
{
  "examId": 3,
  "courseId": 12,
  "courseTitle": "فيزياء 3 ثانوي",
  "title": "امتحان منتصف التيرم",
  "durationMinutes": 45,
  "timeLimitEnabled": true,
  "timeLimitMinutes": 30,
  "startedAt": "2025-01-10T17:02:00.000Z",
  "expiresAt": "2025-01-10T17:32:00.000Z",
  "remainingSeconds": 1800,
  "attemptLimit": 2,
  "attemptsUsed": 1,
  "attemptsRemaining": 1,
  "questions": [
    {
      "id": 101,
      "text": "You were __________ to escape unharmed.",
      "image": "https://res.cloudinary.com/...",
      "choices": [
        { "id": 1001, "text": "unfortunately", "is_correct": false },
        { "id": 1002, "text": "fortunately", "is_correct": true },
        { "id": 1003, "text": "fortunate", "is_correct": false },
        { "id": 1004, "text": "unfortunate", "is_correct": false }
      ]
    }
  ]
}
```

> إذا كان الامتحان مخفي، أو خارج نافذة `start_window/end_window`، أو سبق للطالب الحل (مع تعطيل المحاولات المتعددة)، سيُعاد خطأ 403 مع رسالة مناسبة.
> إذا تم تحديد `attemptLimit` وأكمل الطالب جميع المحاولات، يعيد المسار 403 مع الحقول `attemptLimit` و `attemptsUsed` لتوضيح السبب.

---

## 8. إضافة سؤال بصورة واحدة

**POST** `/api/course/course-exam/:examId/question-image`

- للمدرس فقط
- **Content-Type:** `multipart/form-data`

### Request Body (form-data)
- `text` (اختياري): نص يظهر مع الصورة.
- `image` (إجباري): ملف صورة السؤال (jpg/png/webp/gif).
- `choices`: مصفوفة JSON لعدد 4 اختيارات، مثلاً:
  ```json
  [
    {"text": "compensated", "is_correct": true},
    {"text": "punished", "is_correct": false},
    {"text": "cheated", "is_correct": false},
    {"text": "pirated", "is_correct": false}
  ]
  ```

> تذكير: عند استخدام form-data في المتصفح يمكن إرسال الحقل كـ `formData.append('choices', JSON.stringify([...]))`.

### Response
```json
{
  "message": "Question added with image",
  "questionId": 123
}
```

---

## 9. إضافة مجموعة أسئلة بالصور دفعة واحدة

**POST** `/api/course/course-exam/:examId/questions/images`

- للمدرس فقط
- **Content-Type:** `multipart/form-data`
- يسمح برفع حتى 10 صور في الطلب الواحد (بصيغة `images[]`).

### Request Body (form-data)
- `images[]`: الملفات (مطلوب).
- `texts` (اختياري): مصفوفة JSON تحتوي نصاً لكل صورة بنفس الترتيب، مثال:
  ```json
  ["صورة السؤال الأول", "صورة السؤال الثاني", "..."]
  ```

> يتم إنشاء اختيارات افتراضية (`A/B/C/D`) لكل سؤال يمكن تعديلها لاحقاً.

### Response
```json
{
  "message": "Image questions added",
  "inserted": 3,
  "questionIds": [201, 202, 203]
}
```

---

## 10. إضافة أسئلة نصية (تنسيق المحاضرة) لامتحان الكورس

**POST** `/api/course/course-exam/:examId/questions/text`

- للمدرس فقط
- **Content-Type:** `application/json`
- يعتمد نفس تنسيق Exam Flow للمحاضرات (`bulk_text`).

### Request Body
```json
{
  "bulk_text": "You were __________ to escape unharmed.\nA) unfortunately\nB) fortunately\nC) fortunate\nD) unfortunate"
}
```

> ما يزال بالإمكان استخدام المسار العام `/course-exam/:examId/bulk-questions` (يدعم JSON array أو `bulk_text`). هذا المسار فقط يبسّط الحالة الخاصة بالنصوص.

### Response
```json
{
  "message": "Text questions added",
  "success": true,
  "inserted": 5
}
```

---

## ملاحظات
- امتحان الكورس الشامل مرتبط بالكورس نفسه وليس بمحاضرة محددة
- يمكن للمدرس إضافة أسئلة من مكتبة الأسئلة أو إضافة أسئلة جديدة
- يدعم التنسيق الجديد لإضافة الأسئلة بالطريقة المفضلة للمدرس

---

## 11. جلب جميع أسئلة الامتحان (عرض المدرس)

**GET** `/api/course/course-exam/:examId/questions/manage`

- للمدرس مالك الكورس فقط
- يعيد كل الأسئلة مع الاختيارات والصور بنفس صيغة الواجهة العامة لكن بدون قيود الطلاب.

### Response
```json
{
  "questions": [
    {
      "id": 10,
      "text": "سؤال 1",
      "image": "1704733882000-question.png",
      "choices": [
        { "id": 51, "text": "A", "is_correct": false },
        { "id": 52, "text": "B", "is_correct": true },
        { "id": 53, "text": "C", "is_correct": false },
        { "id": 54, "text": "D", "is_correct": false }
      ]
    }
  ]
}
```

---

## ملاحظات
- امتحان الكورس الشامل مرتبط بالكورس نفسه وليس بمحاضرة محددة
- يمكن للمدرس إضافة أسئلة من مكتبة الأسئلة أو إضافة أسئلة جديدة
- يدعم التنسيق الجديد لإضافة الأسئلة بالطريقة المفضلة للمدرس

---

# إدارة الأسئلة في الامتحان الشامل (للمدرس فقط)

## نظرة عامة

هذه APIs تتيح للمدرس إدارة الأسئلة في الامتحان الشامل بشكل كامل، بما في ذلك تحديد الإجابة الصحيحة، تعديل وحذف الأسئلة.

## المميزات الرئيسية

- ✅ **تحديد الإجابة الصحيحة** - تحديد أي اختيار كإجابة صحيحة
- ✅ **تعديل السؤال** - تعديل نص السؤال أو درجته أو اختياراته
- ✅ **حذف السؤال** - حذف سؤال من الامتحان
- ✅ **جلب سؤال واحد** - عرض تفاصيل سؤال معين
- ✅ **التحقق من الملكية** - التأكد أن السؤال يخص المدرس

---

## APIs إدارة الأسئلة

جميع المسارات تتطلب مصادقة المدرس وتبدأ بـ:
```
/api/course/course-exam/question
```

---

### 1. تحديد الإجابة الصحيحة لسؤال

**PATCH** `/api/course/course-exam/question/:questionId/correct-answer`

**الوصف:** تحديد أي اختيار كإجابة صحيحة لسؤال معين

**الصلاحيات:** مدرس فقط

**البيانات المطلوبة:**
```json
{
  "correct_choice_id": 15
}
```

**مثال على الطلب:**
```bash
curl -X PATCH http://localhost:8000/api/course/course-exam/question/123/correct-answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correct_choice_id": 15
  }'
```

**الاستجابة:**
```json
{
  "message": "تم تحديث الإجابة الصحيحة بنجاح"
}
```

---

### 2. تعديل سؤال في الامتحان الشامل

**PUT** `/api/course/course-exam/question/:questionId`

**الوصف:** تعديل نص السؤال أو درجته أو اختياراته

**الصلاحيات:** مدرس فقط

**البيانات المطلوبة:**
```json
{
  "text": "نص السؤال المحدث؟",
  "grade": 10,
  "choices": [
    {
      "id": 15,
      "text": "الاختيار الأول",
      "is_correct": false
    },
    {
      "id": 16,
      "text": "الاختيار الثاني",
      "is_correct": true
    },
    {
      "id": 17,
      "text": "الاختيار الثالث",
      "is_correct": false
    },
    {
      "id": 18,
      "text": "الاختيار الرابع",
      "is_correct": false
    }
  ]
}
```

**ملاحظات:**
- جميع الحقول اختيارية
- إذا أرسلت `choices`، سيتم استبدال جميع الاختيارات القديمة
- `is_correct` يجب أن يكون `true` لاختيار واحد فقط

**مثال على الطلب:**
```bash
curl -X PUT http://localhost:8000/api/course/course-exam/question/123 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "ما هي عاصمة مصر؟",
    "grade": 10,
    "choices": [
      {"text": "الإسكندرية", "is_correct": false},
      {"text": "الجيزة", "is_correct": false},
      {"text": "الأقصر", "is_correct": false},
      {"text": "القاهرة", "is_correct": true}
    ]
  }'
```

**الاستجابة:**
```json
{
  "message": "تم تحديث السؤال بنجاح"
}
```

---

### 3. حذف سؤال من الامتحان الشامل

**DELETE** `/api/course/course-exam/question/:questionId`

**الوصف:** حذف سؤال معين من الامتحان الشامل

**الصلاحيات:** مدرس فقط

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/course/course-exam/question/123 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

---

### 4. جلب سؤال واحد من الامتحان الشامل

**GET** `/api/course/course-exam/question/:questionId`

**الوصف:** جلب تفاصيل سؤال معين مع اختياراته

**الصلاحيات:** مدرس فقط

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/course/course-exam/question/123 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "question": {
    "id": 123,
    "text": "ما هي عاصمة مصر؟",
    "type": "single_choice",
    "position": 1,
    "grade": 10,
    "choices": [
      {
        "id": 15,
        "text": "الإسكندرية",
        "is_correct": false
      },
      {
        "id": 16,
        "text": "الجيزة",
        "is_correct": false
      },
      {
        "id": 17,
        "text": "الأقصر",
        "is_correct": false
      },
      {
        "id": 18,
        "text": "القاهرة",
        "is_correct": true
      }
    ]
  }
}
```

---

## أمثلة استخدام شاملة

### سير العمل الكامل لإدارة الأسئلة:

```javascript
// 1. جلب جميع أسئلة الامتحان
const getExamQuestions = async (examId) => {
  const response = await fetch(`/api/course/course-exam/${examId}/questions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 2. تحديد الإجابة الصحيحة لسؤال
const setCorrectAnswer = async (questionId, choiceId) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}/correct-answer`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      correct_choice_id: choiceId
    })
  });
  return await response.json();
};

// 3. تعديل سؤال
const updateQuestion = async (questionId, questionData) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(questionData)
  });
  return await response.json();
};

// 4. حذف سؤال
const deleteQuestion = async (questionId) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 5. جلب سؤال واحد
const getQuestion = async (questionId) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// مثال على الاستخدام
const manageExamQuestions = async () => {
  try {
    // جلب أسئلة الامتحان
    const { questions } = await getExamQuestions(1);
    console.log('أسئلة الامتحان:', questions);

    // تحديد الإجابة الصحيحة للسؤال الأول
    if (questions.length > 0) {
      const firstQuestion = questions[0];
      const correctChoice = firstQuestion.choices[0]; // أول اختيار
      await setCorrectAnswer(firstQuestion.id, correctChoice.id);
      console.log('تم تحديد الإجابة الصحيحة');
    }

    // تعديل السؤال الثاني
    if (questions.length > 1) {
      const secondQuestion = questions[1];
      await updateQuestion(secondQuestion.id, {
        text: "نص السؤال المحدث؟",
        grade: 15,
        choices: [
          {"text": "اختيار جديد 1", "is_correct": false},
          {"text": "اختيار جديد 2", "is_correct": true},
          {"text": "اختيار جديد 3", "is_correct": false},
          {"text": "اختيار جديد 4", "is_correct": false}
        ]
      });
      console.log('تم تعديل السؤال');
    }

    // حذف السؤال الثالث
    if (questions.length > 2) {
      const thirdQuestion = questions[2];
      await deleteQuestion(thirdQuestion.id);
      console.log('تم حذف السؤال');
    }

  } catch (error) {
    console.error('خطأ في إدارة الأسئلة:', error);
  }
};
```

---

## ⚠️ أخطاء شائعة

### 400 - بيانات غير صحيحة
```json
{
  "message": "correct_choice_id is required and must be a number"
}
```

### 404 - سؤال غير موجود
```json
{
  "message": "Question not found or not yours"
}
```

### 403 - غير مصرح
```json
{
  "message": "Not allowed to view this exam"
}
```

---

## ملاحظات مهمة

1. **الصلاحيات**: جميع APIs تتطلب صلاحية مدرس
2. **التحقق من الملكية**: يتم التحقق أن السؤال يخص المدرس قبل أي عملية
3. **الإجابة الصحيحة**: يمكن تحديد اختيار واحد فقط كإجابة صحيحة
4. **تعديل الاختيارات**: عند تعديل الاختيارات، يتم استبدال جميع الاختيارات القديمة
5. **الحذف**: عند حذف سؤال، يتم حذف جميع الاختيارات المرتبطة به
6. **الترتيب**: يتم الحفاظ على ترتيب الأسئلة في الامتحان
