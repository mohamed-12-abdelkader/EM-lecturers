# توثيق API امتحانات الكورسات (Course Level Exams)

## نظرة عامة

نظام امتحانات الكورسات يسمح للمدرسين بإنشاء امتحانات مرتبطة بالكورس مباشرة وليس بمحاضرة محددة. يدعم إعدادات متقدمة للظهور والإجابات مع التحقق الكامل من الصلاحيات.

## المميزات الرئيسية

### للمدرسين:
- ✅ **إنشاء امتحان للكورس** - إنشاء امتحان مرتبط بالكورس
- ✅ **جلب امتحانات الكورس** - عرض جميع امتحانات كورس معين
- ✅ **جلب امتحانات المدرس** - عرض جميع امتحانات المدرس من جميع الكورسات
- ✅ **تعديل الامتحان** - تحديث أي من إعدادات الامتحان
- ✅ **حذف الامتحان** - حذف امتحان مع التحقق من الصلاحيات
- ✅ **إعدادات الظهور** - التحكم في ظهور الامتحان للطلاب
- ✅ **إعدادات الإجابات** - التحكم في موعد إظهار الإجابات
- ✅ **إعدادات المحاولات** - تحديد عدد محاولات الطالب للامتحان
- ✅ **جلب درجات الطلاب** - عرض درجات جميع الطلاب في الامتحان مع إحصائيات
- ✅ **تقرير تفصيلي عن الامتحان** - إحصائيات الأسئلة والطلاب الذين أخطأوا

### للطلاب:
- ✅ **عرض الامتحانات الظاهرة** - جلب جميع الامتحانات الظاهرة للطالب في الكورس
- ✅ **بدء الامتحان** - بدء محاولة جديدة مع التحقق من عدد المحاولات
- ✅ **تسليم الامتحان** - تسليم الإجابات وحساب الدرجة
- ✅ **عرض النتائج** - عرض الدرجة والأسئلة الخاطئة حسب إعدادات المدرس

---

## Authentication

جميع APIs تتطلب token مصادقة في header:
```
Authorization: Bearer <token>
```

---

## 📋 APIs

### 1. إنشاء امتحان للكورس

**POST** `/api/exams`

**الصلاحيات:** `teacher` فقط

**الوصف:** ينشئ امتحان جديد مرتبط بالكورس مباشرة

**Request Body (JSON):**

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

#### إعدادات المحاولات:
- `attemptLimit` أو `attempt_limit` (number | null): الحد الأقصى لعدد محاولات الطالب (افتراضي: `null` = محاولات غير محدودة)
  - إذا كان `null` أو غير موجود: محاولات غير محدودة
  - إذا كان رقم: الحد الأقصى لعدد المحاولات (يجب أن يكون > 0)

**مثال على الطلب:**
```json
{
  "title": "امتحان نهاية الكورس",
  "courseId": 12,
  "durationMinutes": 60,
  "questionsCount": 20,
  "isVisibleToStudents": true,
  "showAnswersImmediately": false,
  "answersVisibleAt": "2025-01-15T10:00:00Z",
  "isActive": true,
  "attemptLimit": 3
}
```

**Response (201 Created):**
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

**أخطاء محتملة:**

- **400 Bad Request** - بيانات ناقصة أو غير صحيحة:
```json
{
  "message": "title is required"
}
```

- **400 Bad Request** - قيم غير صحيحة:
```json
{
  "message": "durationMinutes must be greater than 0"
}
```

- **400 Bad Request** - قواعد التحقق:
```json
{
  "message": "visibilityEndDate is required when isVisibleToStudents is false"
}
```

- **404 Not Found** - الكورس غير موجود:
```json
{
  "message": "Course not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to create exams for this course"
}
```

---

### 2. جلب امتحانات كورس معين

**GET** `/api/exams/course/:courseId`

**الصلاحيات:** `teacher` أو `admin`

**الوصف:** يجلب جميع امتحانات كورس معين مرتبة حسب تاريخ الإنشاء (الأحدث أولاً)

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/exams/course/12 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "exams": [
    {
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
    },
    {
      "id": 2,
      "course_id": 12,
      "title": "امتحان منتصف الكورس",
      "duration_minutes": 45,
      "questions_count": 15,
      "is_visible_to_students": true,
      "visibility_end_date": null,
      "show_answers_immediately": true,
      "answers_visible_at": null,
      "is_active": true,
      "attempt_limit": null,
      "created_at": "2025-01-05T08:00:00.000Z",
      "updated_at": "2025-01-05T08:00:00.000Z"
    }
  ]
}
```

**أخطاء محتملة:**

- **400 Bad Request** - معرف الكورس غير صحيح:
```json
{
  "message": "Invalid course id"
}
```

- **404 Not Found** - الكورس غير موجود:
```json
{
  "message": "Course not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to view exams for this course"
}
```

---

### 3. جلب جميع امتحانات المدرس

**GET** `/api/exams/teacher`

**الصلاحيات:** `teacher` فقط

**الوصف:** يجلب جميع امتحانات المدرس من جميع الكورسات مع معلومات الكورس لكل امتحان

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/exams/teacher \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "exams": [
    {
      "id": 1,
      "course_id": 12,
      "course_title": "فيزياء 3 ثانوي",
      "title": "امتحان نهاية الكورس",
      "duration_minutes": 60,
      "questions_count": 20,
      "is_visible_to_students": true,
      "visibility_end_date": null,
      "show_answers_immediately": false,
      "answers_visible_at": "2025-01-15T10:00:00.000Z",
      "is_active": true,
      "attempt_limit": 3,
      "created_at": "2025-01-10T10:30:00.000Z",
      "updated_at": "2025-01-10T10:30:00.000Z"
    },
    {
      "id": 3,
      "course_id": 15,
      "course_title": "كيمياء 2 ثانوي",
      "title": "امتحان الفصل الأول",
      "duration_minutes": 45,
      "questions_count": 15,
      "is_visible_to_students": true,
      "visibility_end_date": null,
      "show_answers_immediately": true,
      "answers_visible_at": null,
      "is_active": true,
      "attempt_limit": null,
      "created_at": "2025-01-08T14:20:00.000Z",
      "updated_at": "2025-01-08T14:20:00.000Z"
    }
  ]
}
```

---

### 4. جلب امتحان واحد

**GET** `/api/exams/:examId`

**الصلاحيات:** `teacher`, `student`, أو `admin`

**الوصف:** يجلب تفاصيل امتحان معين مع معلومات الكورس

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/exams/1 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "exam": {
    "id": 1,
    "course_id": 12,
    "course_title": "فيزياء 3 ثانوي",
    "title": "امتحان نهاية الكورس",
    "duration_minutes": 60,
    "questions_count": 20,
    "is_visible_to_students": true,
    "visibility_end_date": null,
    "show_answers_immediately": false,
    "answers_visible_at": "2025-01-15T10:00:00.000Z",
    "is_active": true,
    "attempt_limit": 3,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-10T10:30:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **400 Bad Request** - معرف الامتحان غير صحيح:
```json
{
  "message": "Invalid exam id"
}
```

- **404 Not Found** - الامتحان غير موجود:
```json
{
  "message": "Exam not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to view this exam"
}
```

---

### 5. تعديل امتحان

**PATCH** `/api/exams/:examId`

**الصلاحيات:** `teacher` فقط

**الوصف:** يعدل إعدادات امتحان موجود. جميع الحقول اختيارية - أرسل فقط الحقول التي تريد تعديلها.

**Request Body (JSON):**

جميع الحقول اختيارية:
- `title` (string): اسم الامتحان
- `durationMinutes` أو `duration_minutes` (number): مدة الامتحان بالدقائق (يجب أن يكون > 0)
- `questionsCount` أو `questions_count` (number): عدد الأسئلة (يجب أن يكون > 0)
- `isVisibleToStudents` أو `is_visible_to_students` (boolean): هل الامتحان ظاهر للطلاب
- `visibilityEndDate` أو `visibility_end_date` (ISO Date string | null): موعد انتهاء ظهور الامتحان
- `showAnswersImmediately` أو `show_answers_immediately` (boolean): إظهار الإجابات فوراً
- `answersVisibleAt` أو `answers_visible_at` (ISO Date string | null): موعد إظهار الإجابات
- `isActive` أو `is_active` (boolean): هل الامتحان نشط
- `attemptLimit` أو `attempt_limit` (number | null): الحد الأقصى لعدد محاولات الطالب (null = محاولات غير محدودة)

**مثال على الطلب:**
```json
{
  "title": "امتحان نهاية الكورس - محدث",
  "durationMinutes": 90,
  "isVisibleToStudents": false,
  "visibilityEndDate": "2025-01-20T23:59:59Z",
  "attemptLimit": 2
}
```

**Response (200 OK):**
```json
{
  "exam": {
    "id": 1,
    "course_id": 12,
    "title": "امتحان نهاية الكورس - محدث",
    "duration_minutes": 90,
    "questions_count": 20,
    "is_visible_to_students": false,
    "visibility_end_date": "2025-01-20T23:59:59.000Z",
    "show_answers_immediately": false,
    "answers_visible_at": "2025-01-15T10:00:00.000Z",
    "is_active": true,
    "attempt_limit": 2,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-12T15:45:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **400 Bad Request** - بيانات غير صحيحة:
```json
{
  "message": "title cannot be empty"
}
```

- **400 Bad Request** - قواعد التحقق:
```json
{
  "message": "visibilityEndDate is required when isVisibleToStudents is false"
}
```

- **404 Not Found** - الامتحان غير موجود:
```json
{
  "message": "Exam not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to update this exam"
}
```

---

### 6. حذف امتحان

**DELETE** `/api/exams/:examId`

**الصلاحيات:** `teacher` فقط

**الوصف:** يحذف امتحان مع التحقق من أن المدرس صاحب الكورس

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/exams/1 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "message": "Exam deleted successfully"
}
```

**أخطاء محتملة:**

- **400 Bad Request** - معرف الامتحان غير صحيح:
```json
{
  "message": "Invalid exam id"
}
```

- **404 Not Found** - الامتحان غير موجود:
```json
{
  "message": "Exam not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to delete this exam"
}
```

---

### 7. جلب درجات الطلاب في الامتحان

**GET** `/api/exams/:examId/grades`

**الصلاحيات:** `teacher`, `admin` فقط

**الوصف:** يجلب قائمة بجميع الطلاب الذين أدوا الامتحان مع درجاتهم وإحصائيات عامة

**Path Parameters:**
- `examId` (number): معرف الامتحان

**Response (200 OK):**
```json
{
  "exam": {
    "id": 1,
    "title": "امتحان نهاية الكورس",
    "courseId": 12,
    "courseTitle": "كورس البرمجة"
  },
  "students": [
    {
      "studentId": 35,
      "studentName": "أحمد محمد",
      "studentEmail": "ahmed@example.com",
      "attemptId": 5,
      "attemptNumber": 1,
      "totalGrade": 20,
      "obtainedGrade": 18,
      "percentage": 90,
      "startedAt": "2025-01-15T10:00:00.000Z",
      "submittedAt": "2025-01-15T10:45:00.000Z"
    },
    {
      "studentId": 36,
      "studentName": "فاطمة علي",
      "studentEmail": "fatima@example.com",
      "attemptId": 6,
      "attemptNumber": 1,
      "totalGrade": 20,
      "obtainedGrade": 15,
      "percentage": 75,
      "startedAt": "2025-01-15T11:00:00.000Z",
      "submittedAt": "2025-01-15T11:50:00.000Z"
    }
  ],
  "statistics": {
    "totalStudents": 2,
    "averageGrade": 82.5,
    "maxGrade": 18,
    "minGrade": 15,
    "totalGrade": 40,
    "totalObtainedGrade": 33
  }
}
```

**أخطاء محتملة:**

**403 Forbidden:**
```json
{
  "message": "You are not allowed to view grades for this exam"
}
```

**404 Not Found:**
```json
{
  "message": "Exam not found"
}
```

---

### 8. جلب تقرير تفصيلي عن الامتحان

**GET** `/api/exams/:examId/report`

**الصلاحيات:** `teacher`, `admin` فقط

**الوصف:** يجلب تقريراً تفصيلياً عن الامتحان يتضمن:
- إحصائيات عامة عن الامتحان
- قائمة بجميع الأسئلة مع إحصائيات كل سؤال
- عدد الطلاب الذين أخطأوا في كل سؤال
- قائمة بأسماء الطلاب الذين أخطأوا في كل سؤال
- ترتيب الأسئلة حسب عدد الأخطاء (الأكثر خطأً أولاً)
- أكثر 5 أسئلة إشكالية

**Path Parameters:**
- `examId` (number): معرف الامتحان

**Response (200 OK):**
```json
{
  "exam": {
    "id": 1,
    "title": "امتحان نهاية الكورس",
    "courseId": 12,
    "courseTitle": "كورس البرمجة",
    "questionsCount": 20
  },
  "overallStatistics": {
    "totalStudents": 25,
    "totalQuestions": 20,
    "totalAnswers": 500,
    "totalCorrect": 400,
    "totalWrong": 100,
    "overallCorrectPercentage": 80,
    "overallWrongPercentage": 20
  },
  "questions": [
    {
      "questionId": 1,
      "type": "TEXT",
      "questionText": "ما هي لغة البرمجة المستخدمة في تطوير الويب؟",
      "questionImage": null,
      "optionA": "Java",
      "optionB": "Python",
      "optionC": "JavaScript",
      "optionD": "C++",
      "correctAnswer": "C",
      "statistics": {
        "totalAnswers": 25,
        "correctAnswers": 20,
        "wrongAnswers": 5,
        "correctPercentage": 80,
        "wrongPercentage": 20,
        "answerDistribution": {
          "A": 2,
          "B": 3,
          "C": 20,
          "D": 0
        }
      },
      "wrongStudents": [
        {
          "studentId": 35,
          "studentName": "أحمد محمد",
          "selectedAnswer": "A"
        },
        {
          "studentId": 36,
          "studentName": "فاطمة علي",
          "selectedAnswer": "B"
        }
      ]
    },
    {
      "questionId": 2,
      "type": "IMAGE",
      "questionText": null,
      "questionImage": "https://cloudinary.com/image.jpg",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D",
      "correctAnswer": "B",
      "statistics": {
        "totalAnswers": 25,
        "correctAnswers": 15,
        "wrongAnswers": 10,
        "correctPercentage": 60,
        "wrongPercentage": 40,
        "answerDistribution": {
          "A": 5,
          "B": 15,
          "C": 3,
          "D": 2
        }
      },
      "wrongStudents": [
        {
          "studentId": 35,
          "studentName": "أحمد محمد",
          "selectedAnswer": "A"
        },
        {
          "studentId": 37,
          "studentName": "محمد علي",
          "selectedAnswer": "C"
        }
      ]
    }
  ],
  "sortedQuestions": [
    {
      "questionId": 2,
      "type": "IMAGE",
      "questionText": null,
      "questionImage": "https://cloudinary.com/image.jpg",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D",
      "correctAnswer": "B",
      "statistics": {
        "totalAnswers": 25,
        "correctAnswers": 15,
        "wrongAnswers": 10,
        "correctPercentage": 60,
        "wrongPercentage": 40,
        "answerDistribution": {
          "A": 5,
          "B": 15,
          "C": 3,
          "D": 2
        }
      },
      "wrongStudents": [
        {
          "studentId": 35,
          "studentName": "أحمد محمد",
          "selectedAnswer": "A"
        }
      ]
    },
    {
      "questionId": 1,
      "type": "TEXT",
      "questionText": "ما هي لغة البرمجة المستخدمة في تطوير الويب؟",
      "questionImage": null,
      "optionA": "Java",
      "optionB": "Python",
      "optionC": "JavaScript",
      "optionD": "C++",
      "correctAnswer": "C",
      "statistics": {
        "totalAnswers": 25,
        "correctAnswers": 20,
        "wrongAnswers": 5,
        "correctPercentage": 80,
        "wrongPercentage": 20,
        "answerDistribution": {
          "A": 2,
          "B": 3,
          "C": 20,
          "D": 0
        }
      },
      "wrongStudents": [
        {
          "studentId": 35,
          "studentName": "أحمد محمد",
          "selectedAnswer": "A"
        }
      ]
    }
  ],
  "mostProblematicQuestions": [
    {
      "questionId": 2,
      "questionText": "Image Question",
      "wrongAnswers": 10,
      "wrongPercentage": 40
    },
    {
      "questionId": 1,
      "questionText": "ما هي لغة البرمجة المستخدمة في تطوير الويب؟",
      "wrongAnswers": 5,
      "wrongPercentage": 20
    }
  ]
}
```

**ملاحظات:**
- `questions`: قائمة بجميع الأسئلة مرتبة حسب ترتيبها في الامتحان
- `sortedQuestions`: نفس القائمة ولكن مرتبة حسب عدد الأخطاء (الأكثر خطأً أولاً)
- `mostProblematicQuestions`: أكثر 5 أسئلة إشكالية (التي بها أكبر عدد من الأخطاء)
- `wrongStudents`: قائمة بالطلاب الذين أخطأوا في السؤال مع الإجابة التي اختاروها

**أخطاء محتملة:**

**403 Forbidden:**
```json
{
  "message": "You are not allowed to view report for this exam"
}
```

**404 Not Found:**
```json
{
  "message": "Exam not found"
}
```
---

## قواعد التحقق (Validation Rules)

### عند الإنشاء:
1. `title` مطلوب ولا يمكن أن يكون فارغاً
2. `courseId` مطلوب ويجب أن يكون موجوداً في قاعدة البيانات
3. `durationMinutes` يجب أن يكون أكبر من 0
4. `questionsCount` يجب أن يكون أكبر من 0
5. إذا كان `isVisibleToStudents = false`، يجب توفير `visibilityEndDate`
6. إذا كان `showAnswersImmediately = false`، يجب توفير `answersVisibleAt`
7. إذا تم توفير `attemptLimit`، يجب أن يكون رقم صحيح أكبر من 0
8. يجب أن يكون المدرس صاحب الكورس (أو admin)

### عند التعديل:
1. جميع الحقول اختيارية
2. إذا تم تحديث `isVisibleToStudents` إلى `false`، يجب توفير `visibilityEndDate`
3. إذا تم تحديث `showAnswersImmediately` إلى `false`، يجب توفير `answersVisibleAt`
4. `durationMinutes` و `questionsCount` يجب أن يكونا أكبر من 0 إذا تم تحديثهما
5. `attemptLimit` يجب أن يكون رقم صحيح أكبر من 0 إذا تم تحديثه (أو `null` للمحاولات غير المحدودة)
6. `title` لا يمكن أن يكون فارغاً إذا تم تحديثه

---

## ملاحظات مهمة

1. **الصيغة المرنة**: يمكنك استخدام camelCase (`courseId`) أو snake_case (`course_id`) - النظام يدعم كليهما

2. **القيم الافتراضية عند الإنشاء**:
   - `isVisibleToStudents`: `true`
   - `showAnswersImmediately`: `true`
   - `isActive`: `true`
   - `attemptLimit`: `null` (محاولات غير محدودة)

3. **التواريخ**: يجب إرسال التواريخ بصيغة ISO 8601 (مثل: `2025-01-15T10:00:00Z`)

4. **الصلاحيات**: 
   - فقط المدرس صاحب الكورس (أو admin) يمكنه إنشاء/تعديل/حذف امتحان
   - المدرسون يمكنهم رؤية امتحانات كورساتهم فقط
   - الطلاب يمكنهم رؤية الامتحانات الظاهرة فقط

5. **التحقق من الملكية**: النظام يتحقق تلقائياً من أن المدرس صاحب الكورس قبل أي عملية

6. **التحديث التلقائي**: عند تعديل أي حقل، يتم تحديث `updated_at` تلقائياً

7. **Cascade Delete**: عند حذف الكورس، يتم حذف جميع امتحاناته تلقائياً

---

## أمثلة استخدام شاملة

### سير العمل الكامل لإدارة امتحانات الكورس:

```javascript
// 1. إنشاء امتحان جديد
const createExam = async () => {
  const response = await fetch('/api/exams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title: 'امتحان نهاية الكورس',
      courseId: 12,
      durationMinutes: 60,
      questionsCount: 20,
      isVisibleToStudents: true,
      showAnswersImmediately: false,
      answersVisibleAt: '2025-01-15T10:00:00Z',
      isActive: true,
      attemptLimit: 3
    })
  });
  return await response.json();
};

// 2. جلب جميع امتحانات الكورس
const getCourseExams = async (courseId) => {
  const response = await fetch(`/api/exams/course/${courseId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 3. جلب جميع امتحانات المدرس
const getTeacherExams = async () => {
  const response = await fetch('/api/exams/teacher', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 4. جلب امتحان واحد
const getExam = async (examId) => {
  const response = await fetch(`/api/exams/${examId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 5. تعديل امتحان
const updateExam = async (examId, updates) => {
  const response = await fetch(`/api/exams/${examId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify(updates)
  });
  return await response.json();
};

// 6. حذف امتحان
const deleteExam = async (examId) => {
  const response = await fetch(`/api/exams/${examId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// مثال على الاستخدام
const manageExams = async () => {
  try {
    // إنشاء امتحان
    const newExam = await createExam();
    console.log('تم إنشاء الامتحان:', newExam);

    // جلب امتحانات الكورس
    const courseExams = await getCourseExams(12);
    console.log('امتحانات الكورس:', courseExams);

    // تعديل الامتحان
    await updateExam(newExam.exam.id, {
      title: 'امتحان محدث',
      durationMinutes: 90,
      attemptLimit: 2
    });

    // حذف الامتحان
    await deleteExam(newExam.exam.id);
    console.log('تم حذف الامتحان');
  } catch (error) {
    console.error('خطأ:', error);
  }
};
```

---

## ⚠️ أخطاء شائعة

### 400 - بيانات غير صحيحة
```json
{
  "message": "durationMinutes must be greater than 0"
}
```

### 400 - قواعد التحقق
```json
{
  "message": "visibilityEndDate is required when isVisibleToStudents is false"
}
```

### 403 - غير مصرح
```json
{
  "message": "You are not allowed to create exams for this course"
}
```

### 404 - غير موجود
```json
{
  "message": "Course not found"
}
```

---

## جدول الحقول

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | - | معرف الامتحان (تلقائي) |
| `course_id` | number | ✅ | معرف الكورس |
| `title` | string | ✅ | اسم الامتحان |
| `duration_minutes` | number | ✅ | مدة الامتحان بالدقائق |
| `questions_count` | number | ✅ | عدد الأسئلة |
| `is_visible_to_students` | boolean | ❌ | هل الامتحان ظاهر للطلاب (افتراضي: true) |
| `visibility_end_date` | timestamp \| null | ⚠️ | موعد انتهاء الظهور (مطلوب إذا is_visible_to_students = false) |
| `show_answers_immediately` | boolean | ❌ | إظهار الإجابات فوراً (افتراضي: true) |
| `answers_visible_at` | timestamp \| null | ⚠️ | موعد إظهار الإجابات (مطلوب إذا show_answers_immediately = false) |
| `is_active` | boolean | ❌ | هل الامتحان نشط (افتراضي: true) |
| `attempt_limit` | number \| null | ❌ | الحد الأقصى لعدد المحاولات (افتراضي: null = محاولات غير محدودة) |
| `created_at` | timestamp | - | تاريخ الإنشاء (تلقائي) |
| `updated_at` | timestamp | - | تاريخ آخر تحديث (تلقائي) |

---

## ملاحظات إضافية

- جميع التواريخ يجب أن تكون بصيغة ISO 8601
- النظام يدعم camelCase و snake_case في أسماء الحقول
- عند حذف الكورس، يتم حذف جميع امتحاناته تلقائياً (CASCADE)
- المدرس يمكنه فقط إدارة امتحانات كورساته الخاصة
- Admin يمكنه إدارة جميع الامتحانات

---

# إدارة أسئلة امتحانات الكورسات (Exam Questions Management)

## نظرة عامة

نظام إدارة أسئلة امتحانات الكورسات يسمح للمدرسين بإضافة وتعديل وحذف أسئلة الامتحانات. يدعم نوعين من الأسئلة: الأسئلة النصية والأسئلة الصورية.

## المميزات الرئيسية

- ✅ **إضافة سؤال نصي** - إنشاء سؤال مع نص و4 اختيارات
- ✅ **إضافة أسئلة صورية** - رفع حتى 10 صور دفعة واحدة
- ✅ **تعديل السؤال** - تحديث النص أو الصورة أو الاختيارات
- ✅ **حذف السؤال** - حذف سؤال من الامتحان
- ✅ **تحديد الإجابة الصحيحة** - تحديد أي اختيار كإجابة صحيحة
- ✅ **جلب الأسئلة** - عرض جميع أسئلة الامتحان أو سؤال واحد

---

## 📋 APIs إدارة الأسئلة

### 1. إنشاء سؤال نصي

**POST** `/api/exams/:examId/questions`

**الصلاحيات:** `teacher` فقط

**الوصف:** ينشئ سؤال نصي جديد مع 4 اختيارات

**Content-Type:** `multipart/form-data` (لإمكانية رفع صورة اختيارية)

**Request Body (form-data):**

#### الحقول المطلوبة:
- `type` (string): يجب أن يكون `"TEXT"`
- `questionText` (string): نص السؤال
- `optionA` (string): الخيار الأول
- `optionB` (string): الخيار الثاني
- `optionC` (string): الخيار الثالث
- `optionD` (string): الخيار الرابع
- `correctAnswer` (string): الإجابة الصحيحة (`"A"`, `"B"`, `"C"`, أو `"D"`)

#### الحقول الاختيارية:
- `questionImage` (file): صورة اختيارية للسؤال

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/exams/1/questions \
  -H "Authorization: Bearer <token>" \
  -F "type=TEXT" \
  -F "questionText=ما هي عاصمة مصر؟" \
  -F "optionA=الإسكندرية" \
  -F "optionB=الجيزة" \
  -F "optionC=الأقصر" \
  -F "optionD=القاهرة" \
  -F "correctAnswer=D"
```

**Response (201 Created):**
```json
{
  "question": {
    "id": 1,
    "exam_id": 1,
    "type": "TEXT",
    "question_text": "ما هي عاصمة مصر؟",
    "question_image": null,
    "option_a": "الإسكندرية",
    "option_b": "الجيزة",
    "option_c": "الأقصر",
    "option_d": "القاهرة",
    "correct_answer": "D",
    "created_by": 5,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-10T10:30:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **400 Bad Request** - بيانات ناقصة:
```json
{
  "message": "questionText, optionA, optionB, optionC, optionD, and correctAnswer are required"
}
```

- **400 Bad Request** - نوع غير صحيح:
```json
{
  "message": "type must be \"TEXT\" for this endpoint"
}
```

- **400 Bad Request** - إجابة غير صحيحة:
```json
{
  "message": "correctAnswer must be one of A, B, C, or D"
}
```

- **404 Not Found** - الامتحان غير موجود:
```json
{
  "message": "Exam not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to manage questions for this exam"
}
```

---

### 2. إنشاء أسئلة صورية (Bulk Upload)

**POST** `/api/exams/:examId/questions/images`

**الصلاحيات:** `teacher` فقط

**الوصف:** ينشئ عدة أسئلة صورية دفعة واحدة (حتى 10 صور)

**Content-Type:** `multipart/form-data`

**Request Body (form-data):**

- `images[]` (files): مصفوفة من الصور (حتى 10 صور)

**ملاحظات:**
- كل صورة تمثل سؤال واحد
- الاختيارات تُضبط تلقائياً كـ `A`, `B`, `C`, `D`
- `correct_answer` يبدأ كـ `null` (يمكن تحديثه لاحقاً)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/exams/1/questions/images \
  -H "Authorization: Bearer <token>" \
  -F "images[]=@question1.jpg" \
  -F "images[]=@question2.jpg" \
  -F "images[]=@question3.jpg"
```

**Response (201 Created):**
```json
{
  "message": "Image questions created successfully",
  "questions": [
    {
      "id": 2,
      "exam_id": 1,
      "type": "IMAGE",
      "question_text": null,
      "question_image": "https://res.cloudinary.com/.../question1.jpg",
      "option_a": "A",
      "option_b": "B",
      "option_c": "C",
      "option_d": "D",
      "correct_answer": null,
      "created_by": 5,
      "created_at": "2025-01-10T10:35:00.000Z",
      "updated_at": "2025-01-10T10:35:00.000Z"
    },
    {
      "id": 3,
      "exam_id": 1,
      "type": "IMAGE",
      "question_text": null,
      "question_image": "https://res.cloudinary.com/.../question2.jpg",
      "option_a": "A",
      "option_b": "B",
      "option_c": "C",
      "option_d": "D",
      "correct_answer": null,
      "created_by": 5,
      "created_at": "2025-01-10T10:35:00.000Z",
      "updated_at": "2025-01-10T10:35:00.000Z"
    }
  ],
  "count": 2
}
```

**أخطاء محتملة:**

- **400 Bad Request** - لا توجد صور:
```json
{
  "message": "At least one image is required"
}
```

- **400 Bad Request** - عدد كبير من الصور:
```json
{
  "message": "Maximum 10 images allowed per request"
}
```

- **500 Internal Server Error** - فشل رفع بعض الصور:
```json
{
  "message": "Failed to upload some images",
  "errors": ["question3.jpg"]
}
```

---

### 3. جلب جميع أسئلة الامتحان

**GET** `/api/exams/:examId/questions`

**الصلاحيات:** `teacher` فقط

**الوصف:** يجلب جميع أسئلة امتحان معين مرتبة حسب تاريخ الإنشاء

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/exams/1/questions \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "questions": [
    {
      "id": 1,
      "exam_id": 1,
      "type": "TEXT",
      "question_text": "ما هي عاصمة مصر؟",
      "question_image": null,
      "option_a": "الإسكندرية",
      "option_b": "الجيزة",
      "option_c": "الأقصر",
      "option_d": "القاهرة",
      "correct_answer": "D",
      "created_by": 5,
      "created_at": "2025-01-10T10:30:00.000Z",
      "updated_at": "2025-01-10T10:30:00.000Z"
    },
    {
      "id": 2,
      "exam_id": 1,
      "type": "IMAGE",
      "question_text": null,
      "question_image": "https://res.cloudinary.com/.../question1.jpg",
      "option_a": "A",
      "option_b": "B",
      "option_c": "C",
      "option_d": "D",
      "correct_answer": null,
      "created_by": 5,
      "created_at": "2025-01-10T10:35:00.000Z",
      "updated_at": "2025-01-10T10:35:00.000Z"
    }
  ]
}
```

---

### 4. جلب سؤال واحد

**GET** `/api/questions/:questionId`

**الصلاحيات:** `teacher` فقط

**الوصف:** يجلب تفاصيل سؤال معين

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "question": {
    "id": 1,
    "exam_id": 1,
    "type": "TEXT",
    "question_text": "ما هي عاصمة مصر؟",
    "question_image": null,
    "option_a": "الإسكندرية",
    "option_b": "الجيزة",
    "option_c": "الأقصر",
    "option_d": "القاهرة",
    "correct_answer": "D",
    "created_by": 5,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-10T10:30:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **404 Not Found** - السؤال غير موجود:
```json
{
  "message": "Question not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to manage this question"
}
```

---

### 5. تعديل سؤال

**PUT** `/api/questions/:questionId`

**الصلاحيات:** `teacher` فقط

**الوصف:** يعدل سؤال موجود. جميع الحقول اختيارية - أرسل فقط الحقول التي تريد تعديلها.

**Content-Type:** `multipart/form-data` (إذا كنت تريد رفع صورة جديدة)

**Request Body (form-data):**

جميع الحقول اختيارية:
- `questionText` (string): نص السؤال
- `questionImage` (file | null): صورة السؤال (يمكن رفع صورة جديدة أو إرسال `null` لحذف الصورة)
- `optionA` (string): الخيار الأول
- `optionB` (string): الخيار الثاني
- `optionC` (string): الخيار الثالث
- `optionD` (string): الخيار الرابع

**ملاحظات:**
- لا يمكن حذف كل من النص والصورة في نفس الوقت
- إذا كان السؤال من نوع `IMAGE`، لا يمكن حذف الصورة

**مثال على الطلب:**
```bash
curl -X PUT http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>" \
  -F "questionText=ما هي عاصمة مصر؟ (محدث)" \
  -F "optionD=القاهرة - مصر"
```

**Response (200 OK):**
```json
{
  "question": {
    "id": 1,
    "exam_id": 1,
    "type": "TEXT",
    "question_text": "ما هي عاصمة مصر؟ (محدث)",
    "question_image": null,
    "option_a": "الإسكندرية",
    "option_b": "الجيزة",
    "option_c": "الأقصر",
    "option_d": "القاهرة - مصر",
    "correct_answer": "D",
    "created_by": 5,
    "created_at": "2025-01-10T10:30:00.000Z",
    "updated_at": "2025-01-10T11:00:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **400 Bad Request** - محاولة حذف النص والصورة معاً:
```json
{
  "message": "Cannot remove both question text and image"
}
```

- **400 Bad Request** - محاولة حذف صورة سؤال صوري:
```json
{
  "message": "Cannot remove question image for IMAGE type questions"
}
```

---

### 6. حذف سؤال

**DELETE** `/api/questions/:questionId`

**الصلاحيات:** `teacher` فقط

**الوصف:** يحذف سؤال من الامتحان بشكل دائم

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/questions/1 \
  -H "Authorization: Bearer <token>"
```

**Response (200 OK):**
```json
{
  "message": "Question deleted successfully"
}
```

**أخطاء محتملة:**

- **404 Not Found** - السؤال غير موجود:
```json
{
  "message": "Question not found"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "You are not allowed to manage this question"
}
```

---

### 7. تحديد/تحديث الإجابة الصحيحة

**PATCH** `/api/questions/:questionId/correct-answer`

**الصلاحيات:** `teacher` فقط

**الوصف:** يحدد أو يحدث الإجابة الصحيحة لسؤال معين

**Request Body (JSON):**
```json
{
  "correctAnswer": "D"
}
```

**مثال على الطلب:**
```bash
curl -X PATCH http://localhost:8000/api/questions/2/correct-answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "correctAnswer": "B"
  }'
```

**Response (200 OK):**
```json
{
  "question": {
    "id": 2,
    "exam_id": 1,
    "type": "IMAGE",
    "question_text": null,
    "question_image": "https://res.cloudinary.com/.../question1.jpg",
    "option_a": "A",
    "option_b": "B",
    "option_c": "C",
    "option_d": "D",
    "correct_answer": "B",
    "created_by": 5,
    "created_at": "2025-01-10T10:35:00.000Z",
    "updated_at": "2025-01-10T11:05:00.000Z"
  }
}
```

**أخطاء محتملة:**

- **400 Bad Request** - إجابة غير صحيحة:
```json
{
  "message": "correctAnswer must be one of A, B, C, or D"
}
```

- **400 Bad Request** - حقل مفقود:
```json
{
  "message": "correctAnswer is required"
}
```

---

## قواعد التحقق (Validation Rules)

### عند إنشاء سؤال نصي:
1. `type` يجب أن يكون `"TEXT"`
2. `questionText` مطلوب
3. جميع الاختيارات (`optionA`, `optionB`, `optionC`, `optionD`) مطلوبة
4. `correctAnswer` يجب أن يكون واحداً من: `"A"`, `"B"`, `"C"`, أو `"D"`
5. الامتحان يجب أن يكون موجوداً وأن يخص المدرس

### عند إنشاء أسئلة صورية:
1. يجب رفع صورة واحدة على الأقل
2. الحد الأقصى 10 صور في الطلب الواحد
3. كل صورة تُنشئ سؤال واحد من نوع `IMAGE`
4. الاختيارات تُضبط تلقائياً كـ `A`, `B`, `C`, `D`
5. `correct_answer` يبدأ كـ `null`

### عند تعديل سؤال:
1. جميع الحقول اختيارية
2. لا يمكن حذف كل من `questionText` و `questionImage` في نفس الوقت
3. لا يمكن حذف `questionImage` إذا كان السؤال من نوع `IMAGE`
4. يجب أن يكون السؤال يخص امتحان يملكه المدرس

### عند تحديد الإجابة الصحيحة:
1. `correctAnswer` يجب أن يكون واحداً من: `"A"`, `"B"`, `"C"`, أو `"D"`
2. السؤال يجب أن يكون موجوداً وأن يخص امتحان يملكه المدرس

---

## ملاحظات مهمة

1. **أنواع الأسئلة:**
   - `TEXT`: سؤال نصي مع نص السؤال و4 اختيارات
   - `IMAGE`: سؤال صوري مع صورة السؤال فقط (الاختيارات افتراضية)

2. **رفع الصور:**
   - الصور تُرفع إلى Cloudinary تلقائياً
   - الحد الأقصى لحجم الصورة: 10MB
   - الصيغ المدعومة: JPEG, JPG, PNG, GIF, WEBP

3. **الصلاحيات:**
   - فقط المدرس صاحب الامتحان يمكنه إدارة الأسئلة
   - النظام يتحقق تلقائياً من الملكية قبل أي عملية

4. **الإجابات الصحيحة:**
   - يمكن تحديد الإجابة الصحيحة عند الإنشاء (للأسئلة النصية)
   - يمكن تحديثها لاحقاً لأي سؤال
   - للأسئلة الصورية، يجب تحديد الإجابة الصحيحة بعد الإنشاء

5. **الحذف:**
   - حذف السؤال نهائي ولا يمكن التراجع عنه
   - يتم حذف السؤال وجميع بياناته المرتبطة

---

## أمثلة استخدام شاملة

### سير العمل الكامل لإدارة أسئلة الامتحان:

```javascript
// 1. إنشاء سؤال نصي
const createTextQuestion = async (examId) => {
  const formData = new FormData();
  formData.append('type', 'TEXT');
  formData.append('questionText', 'ما هي عاصمة مصر؟');
  formData.append('optionA', 'الإسكندرية');
  formData.append('optionB', 'الجيزة');
  formData.append('optionC', 'الأقصر');
  formData.append('optionD', 'القاهرة');
  formData.append('correctAnswer', 'D');

  const response = await fetch(`/api/exams/${examId}/questions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  return await response.json();
};

// 2. إنشاء أسئلة صورية
const createImageQuestions = async (examId, imageFiles) => {
  const formData = new FormData();
  imageFiles.forEach(file => {
    formData.append('images[]', file);
  });

  const response = await fetch(`/api/exams/${examId}/questions/images`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  return await response.json();
};

// 3. جلب جميع الأسئلة
const getQuestions = async (examId) => {
  const response = await fetch(`/api/exams/${examId}/questions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// 4. تعديل سؤال
const updateQuestion = async (questionId, updates) => {
  const formData = new FormData();
  if (updates.questionText) formData.append('questionText', updates.questionText);
  if (updates.optionA) formData.append('optionA', updates.optionA);
  // ... إلخ

  const response = await fetch(`/api/questions/${questionId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  return await response.json();
};

// 5. تحديد الإجابة الصحيحة
const setCorrectAnswer = async (questionId, correctAnswer) => {
  const response = await fetch(`/api/questions/${questionId}/correct-answer`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ correctAnswer })
  });
  return await response.json();
};

// 6. حذف سؤال
const deleteQuestion = async (questionId) => {
  const response = await fetch(`/api/questions/${questionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};

// مثال على الاستخدام
const manageExamQuestions = async () => {
  try {
    const examId = 1;

    // إنشاء سؤال نصي
    const textQuestion = await createTextQuestion(examId);
    console.log('تم إنشاء السؤال النصي:', textQuestion);

    // إنشاء أسئلة صورية
    const imageFiles = [file1, file2, file3]; // File objects
    const imageQuestions = await createImageQuestions(examId, imageFiles);
    console.log('تم إنشاء الأسئلة الصورية:', imageQuestions);

    // جلب جميع الأسئلة
    const { questions } = await getQuestions(examId);
    console.log('أسئلة الامتحان:', questions);

    // تحديد الإجابة الصحيحة لسؤال صوري
    if (imageQuestions.questions.length > 0) {
      await setCorrectAnswer(imageQuestions.questions[0].id, 'B');
      console.log('تم تحديد الإجابة الصحيحة');
    }

    // تعديل سؤال
    await updateQuestion(textQuestion.question.id, {
      questionText: 'ما هي عاصمة مصر؟ (محدث)'
    });

    // حذف سؤال
    await deleteQuestion(textQuestion.question.id);
    console.log('تم حذف السؤال');
  } catch (error) {
    console.error('خطأ:', error);
  }
};
```

---

## جدول الحقول

| الحقل | النوع | مطلوب | الوصف |
|-------|-------|-------|-------|
| `id` | number | - | معرف السؤال (تلقائي) |
| `exam_id` | number | ✅ | معرف الامتحان |
| `type` | string | ✅ | نوع السؤال (`TEXT` أو `IMAGE`) |
| `question_text` | string \| null | ⚠️ | نص السؤال (مطلوب إذا type = TEXT) |
| `question_image` | string \| null | ⚠️ | رابط صورة السؤال (مطلوب إذا type = IMAGE) |
| `option_a` | string | ✅ | الخيار الأول |
| `option_b` | string | ✅ | الخيار الثاني |
| `option_c` | string | ✅ | الخيار الثالث |
| `option_d` | string | ✅ | الخيار الرابع |
| `correct_answer` | string \| null | ❌ | الإجابة الصحيحة (`A`, `B`, `C`, أو `D`) |
| `created_by` | number | ✅ | معرف المدرس المنشئ |
| `created_at` | timestamp | - | تاريخ الإنشاء (تلقائي) |
| `updated_at` | timestamp | - | تاريخ آخر تحديث (تلقائي) |

---

## ⚠️ أخطاء شائعة

### 400 - بيانات ناقصة
```json
{
  "message": "questionText, optionA, optionB, optionC, optionD, and correctAnswer are required"
}
```

### 400 - نوع غير صحيح
```json
{
  "message": "type must be \"TEXT\" for this endpoint"
}
```

### 400 - إجابة غير صحيحة
```json
{
  "message": "correctAnswer must be one of A, B, C, or D"
}
```

### 400 - عدد كبير من الصور
```json
{
  "message": "Maximum 10 images allowed per request"
}
```

### 403 - غير مصرح
```json
{
  "message": "You are not allowed to manage questions for this exam"
}
```

### 404 - غير موجود
```json
{
  "message": "Exam not found"
}
```

---

# APIs للطلاب (Student APIs)

## نظرة عامة

هذا القسم يغطي جميع APIs المتاحة للطلاب للتفاعل مع امتحانات الكورسات. الطلاب يمكنهم:
- عرض الامتحانات الظاهرة لهم في الكورس
- بدء محاولة جديدة للامتحان
- تسليم الإجابات والحصول على النتائج

## المميزات

- ✅ **عرض الامتحانات الظاهرة** - جلب جميع الامتحانات المتاحة للطالب
- ✅ **بدء الامتحان** - بدء محاولة جديدة مع التحقق من عدد المحاولات
- ✅ **تسليم الامتحان** - تسليم الإجابات وحساب الدرجة
- ✅ **عرض النتائج** - عرض الدرجة والأسئلة الخاطئة حسب إعدادات المدرس

---

## 📋 APIs للطلاب

### 1. جلب الامتحانات الظاهرة للطالب

**GET** `/api/exams/course/:courseId/student`

**الصلاحيات:** `student` فقط

**الوصف:** يجلب جميع الامتحانات الظاهرة للطالب في الكورس المحدد

**Request:**
```
GET /api/exams/course/12/student
Authorization: Bearer <STUDENT_TOKEN>
```

**Response (200 OK):**
```json
{
  "exams": [
    {
      "id": 1,
      "course_id": 12,
      "course_title": "فيزياء 3 ثانوي",
      "title": "امتحان نهاية الكورس",
      "duration_minutes": 60,
      "questions_count": 20,
      "is_visible_to_students": true,
      "visibility_end_date": null,
      "show_answers_immediately": false,
      "answers_visible_at": "2025-01-15T10:00:00.000Z",
      "is_active": true,
      "attempt_limit": 3,
      "attempts_count": 1,
      "last_attempt_number": 1,
      "can_attempt": true,
      "attempts_remaining": 2,
      "created_at": "2025-01-10T10:30:00.000Z",
      "updated_at": "2025-01-10T10:30:00.000Z"
    }
  ]
}
```

**ملاحظات:**
- `attempts_count`: عدد المحاولات التي قام بها الطالب
- `last_attempt_number`: رقم آخر محاولة
- `can_attempt`: هل يمكن للطالب بدء محاولة جديدة
- `attempts_remaining`: عدد المحاولات المتبقية (null = محاولات غير محدودة)

**أخطاء محتملة:**

- **403 Forbidden** - الطالب غير مشترك في الكورس:
```json
{
  "message": "You are not enrolled in this course"
}
```

---

### 2. بدء محاولة امتحان

**POST** `/api/exams/:examId/start`

**الصلاحيات:** `student` فقط

**الوصف:** يبدأ محاولة جديدة للامتحان. إذا كان هناك محاولة نشطة، يتم إرجاعها.

**Request:**
```
POST /api/exams/1/start
Authorization: Bearer <STUDENT_TOKEN>
```

**Response (200 OK):**
```json
{
  "attemptId": 1,
  "examId": 1,
  "examTitle": "امتحان نهاية الكورس",
  "durationMinutes": 60,
  "questionsCount": 20,
  "startedAt": "2025-01-12T10:00:00.000Z",
  "questions": [
    {
      "id": 1,
      "type": "TEXT",
      "questionText": "ما هي وحدة قياس القوة؟",
      "questionImage": null,
      "optionA": "نيوتن",
      "optionB": "جول",
      "optionC": "وات",
      "optionD": "باسكال"
    },
    {
      "id": 2,
      "type": "IMAGE",
      "questionText": null,
      "questionImage": "https://example.com/question2.jpg",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D"
    }
  ]
}
```

**ملاحظات:**
- إذا كان هناك محاولة نشطة (`in_progress`)، يتم إرجاعها بدلاً من إنشاء محاولة جديدة
- الأسئلة لا تحتوي على الإجابات الصحيحة
- يتم التحقق من عدد المحاولات قبل السماح ببدء محاولة جديدة

**أخطاء محتملة:**

- **403 Forbidden** - الطالب غير مشترك في الكورس:
```json
{
  "message": "You are not enrolled in this course"
}
```

- **403 Forbidden** - الامتحان غير ظاهر:
```json
{
  "message": "This exam is not visible to students"
}
```

- **403 Forbidden** - تم استخدام جميع المحاولات:
```json
{
  "message": "You have used all allowed attempts for this exam"
}
```

- **403 Forbidden** - انتهت فترة ظهور الامتحان:
```json
{
  "message": "This exam is no longer available"
}
```

- **403 Forbidden** - محاولة واحدة فقط وتم الامتحان من قبل:
```json
{
  "message": "You have already completed this exam. Only one attempt is allowed.",
  "previousAttempt": {
    "attemptId": 1,
    "totalGrade": 18,
    "maxGrade": 20,
    "submittedAt": "2025-01-12T10:30:00.000Z",
    "showAnswers": true,
    "releaseReason": "scheduled",
    "answersVisibleAt": "2025-01-15T10:00:00.000Z",
    "wrongQuestions": [
      {
        "questionId": 2,
        "questionText": null,
        "questionImage": "https://example.com/question2.jpg",
        "type": "IMAGE",
        "correctAnswer": "C",
        "yourAnswer": "B",
        "optionA": "A",
        "optionB": "B",
        "optionC": "C",
        "optionD": "D"
      },
      {
        "questionId": 5,
        "questionText": "ما هي وحدة قياس الطاقة؟",
        "questionImage": null,
        "type": "TEXT",
        "correctAnswer": "A",
        "yourAnswer": "B",
        "optionA": "جول",
        "optionB": "نيوتن",
        "optionC": "وات",
        "optionD": "باسكال"
      }
    ]
  }
}
```

**ملاحظات:**
- إذا كان `showAnswers = true`: يتم إرجاع `wrongQuestions` مع الأسئلة الخاطئة
- إذا كان `showAnswers = false`: `wrongQuestions` يكون مصفوفة فارغة و`answersVisibleAt` يحتوي على موعد الإظهار

**ملاحظات:**
- إذا كان `attempt_limit = 1` وتم الامتحان من قبل، يتم إرجاع معلومات المحاولة السابقة
- إذا كان `attempt_limit > 1` أو `null` (غير محدود)، يمكن بدء محاولة جديدة

---

### 3. تسليم الامتحان

**POST** `/api/exams/:examId/submit`

**الصلاحيات:** `student` فقط

**الوصف:** يسلم الطالب إجاباته ويحصل على النتيجة. يتم حساب الدرجة وإظهار الأسئلة الخاطئة حسب إعدادات المدرس.

**Request Body:**
```json
{
  "attemptId": 1,
  "answers": [
    {
      "questionId": 1,
      "selectedAnswer": "A"
    },
    {
      "questionId": 2,
      "selectedAnswer": "B"
    }
  ]
}
```

**Response (200 OK):**

**حالة 1: الإجابات تظهر فوراً (`showAnswersImmediately = true`):**
```json
{
  "attemptId": 1,
  "totalGrade": 18,
  "maxGrade": 20,
  "correctCount": 18,
  "wrongCount": 2,
  "showAnswers": true,
  "releaseReason": "immediate",
  "answersVisibleAt": null,
  "wrongQuestions": [
    {
      "questionId": 2,
      "questionText": null,
      "questionImage": "https://example.com/question2.jpg",
      "type": "IMAGE",
      "correctAnswer": "C",
      "yourAnswer": "B",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D"
    }
  ]
}
```

**حالة 2: الإجابات تظهر بعد موعد محدد (`showAnswersImmediately = false` و `answersVisibleAt` موجود):**

**أ) قبل موعد الإظهار:**
```json
{
  "attemptId": 1,
  "totalGrade": 18,
  "maxGrade": 20,
  "correctCount": 18,
  "wrongCount": 2,
  "showAnswers": false,
  "releaseReason": "scheduled_pending",
  "answersVisibleAt": "2025-01-15T10:00:00.000Z",
  "wrongQuestions": []
}
```

**ب) بعد موعد الإظهار:**
```json
{
  "attemptId": 1,
  "totalGrade": 18,
  "maxGrade": 20,
  "correctCount": 18,
  "wrongCount": 2,
  "showAnswers": true,
  "releaseReason": "scheduled",
  "answersVisibleAt": "2025-01-15T10:00:00.000Z",
  "wrongQuestions": [
    {
      "questionId": 2,
      "questionText": null,
      "questionImage": "https://example.com/question2.jpg",
      "type": "IMAGE",
      "correctAnswer": "C",
      "yourAnswer": "B",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D"
    }
  ]
}
```

**ملاحظات:**
- `totalGrade`: الدرجة التي حصل عليها الطالب
- `maxGrade`: الدرجة الكلية للامتحان
- `correctCount`: عدد الإجابات الصحيحة
- `wrongCount`: عدد الإجابات الخاطئة
- `showAnswers`: هل يمكن إظهار الإجابات الآن
- `releaseReason`: سبب الإظهار (`immediate`, `scheduled`, `scheduled_pending`)
- `wrongQuestions`: قائمة بالأسئلة الخاطئة (فارغة إذا لم يحن وقت الإظهار)

**أخطاء محتملة:**

- **400 Bad Request** - المحاولة تم تسليمها مسبقاً:
```json
{
  "message": "This attempt has already been submitted"
}
```

- **400 Bad Request** - بيانات غير صحيحة:
```json
{
  "message": "selectedAnswer must be one of A, B, C, or D"
}
```

- **404 Not Found** - المحاولة غير موجودة:
```json
{
  "message": "Attempt not found"
}
```

---

### 4. جلب الأسئلة الخاطئة بعد موعد الإظهار

**GET** `/api/exams/:examId/wrong-questions`

**الصلاحيات:** `student` فقط

**الوصف:** يجلب الأسئلة الخاطئة للطالب بعد موعد الإظهار المحدد من المدرس

**Request:**
```
GET /api/exams/1/wrong-questions
Authorization: Bearer <STUDENT_TOKEN>
```

**Response (200 OK):**

**حالة 1: الإجابات متاحة (بعد موعد الإظهار):**
```json
{
  "showAnswers": true,
  "releaseReason": "scheduled",
  "attemptId": 1,
  "totalGrade": 18,
  "maxGrade": 20,
  "submittedAt": "2025-01-12T10:30:00.000Z",
  "wrongQuestions": [
    {
      "questionId": 2,
      "questionText": null,
      "questionImage": "https://example.com/question2.jpg",
      "type": "IMAGE",
      "correctAnswer": "C",
      "yourAnswer": "B",
      "optionA": "A",
      "optionB": "B",
      "optionC": "C",
      "optionD": "D"
    },
    {
      "questionId": 5,
      "questionText": "ما هي وحدة قياس الطاقة؟",
      "questionImage": null,
      "type": "TEXT",
      "correctAnswer": "A",
      "yourAnswer": "B",
      "optionA": "جول",
      "optionB": "نيوتن",
      "optionC": "وات",
      "optionD": "باسكال"
    }
  ]
}
```

**حالة 2: الإجابات غير متاحة بعد (قبل موعد الإظهار):**
```json
{
  "showAnswers": false,
  "releaseReason": "scheduled_pending",
  "answersVisibleAt": "2025-01-15T10:00:00.000Z",
  "message": "Answers will be available after the scheduled time"
}
```

**أخطاء محتملة:**

- **403 Forbidden** - الطالب غير مشترك في الكورس:
```json
{
  "message": "You are not enrolled in this course"
}
```

- **403 Forbidden** - الإجابات غير مكونة للإظهار:
```json
{
  "message": "Answers are not configured to be shown for this exam"
}
```

- **404 Not Found** - لا توجد محاولة مكتملة:
```json
{
  "message": "No completed attempt found for this exam"
}
```

---

## قواعد التحقق للطلاب

1. يجب أن يكون الطالب مشتركاً في الكورس
2. يجب أن يكون الامتحان نشطاً (`is_active = true`)
3. يجب أن يكون الامتحان ظاهراً للطلاب (`is_visible_to_students = true`)
4. يجب ألا يكون قد انتهت فترة الظهور (`visibility_end_date`)
5. يجب ألا يكون الطالب قد استخدم جميع المحاولات المسموحة
6. يجب أن تكون المحاولة في حالة `in_progress` عند التسليم

---

## أمثلة استخدام للطلاب

### مثال 1: جلب الامتحانات الظاهرة
```javascript
const getVisibleExams = async (courseId, token) => {
  const response = await fetch(`http://localhost:8000/api/exams/course/${courseId}/student`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### مثال 2: بدء محاولة
```javascript
const startExam = async (examId, token) => {
  const response = await fetch(`http://localhost:8000/api/exams/${examId}/start`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  return await response.json();
};
```

### مثال 3: تسليم الامتحان
```javascript
const submitExam = async (examId, attemptId, answers, token) => {
  const response = await fetch(`http://localhost:8000/api/exams/${examId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      attemptId,
      answers: answers.map(a => ({
        questionId: a.questionId,
        selectedAnswer: a.selectedAnswer
      }))
    })
  });
  return await response.json();
};
```

### مثال 4: جلب الأسئلة الخاطئة
```javascript
const getWrongQuestions = async (examId, token) => {
  const response = await fetch(`http://localhost:8000/api/exams/${examId}/wrong-questions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### مثال 5: سيناريو كامل
```javascript
// 1. جلب الامتحانات الظاهرة
const exams = await getVisibleExams(12, studentToken);
console.log('Available exams:', exams.exams);

// 2. بدء محاولة
try {
  const attempt = await startExam(1, studentToken);
  console.log('Started attempt:', attempt.attemptId);

  // 3. الإجابة على الأسئلة
  const answers = attempt.questions.map(q => ({
    questionId: q.id,
    selectedAnswer: 'A' // مثال
  }));

  // 4. تسليم الامتحان
  const result = await submitExam(1, attempt.attemptId, answers, studentToken);
  console.log('Grade:', result.totalGrade, '/', result.maxGrade);

  // 5. التحقق من الإجابات
  if (result.showAnswers) {
    console.log('Wrong questions:', result.wrongQuestions);
  } else {
    console.log('Answers will be shown at:', result.answersVisibleAt);
    
    // 6. بعد موعد الإظهار، جلب الأسئلة الخاطئة
    setTimeout(async () => {
      const wrongQuestions = await getWrongQuestions(1, studentToken);
      if (wrongQuestions.showAnswers) {
        console.log('Wrong questions:', wrongQuestions.wrongQuestions);
      }
    }, new Date(result.answersVisibleAt) - new Date());
  }
} catch (error) {
  // إذا كان محاولة واحدة فقط وتم الامتحان من قبل
  if (error.status === 403 && error.previousAttempt) {
    console.log('Already completed:', error.previousAttempt);
    // جلب الأسئلة الخاطئة
    const wrongQuestions = await getWrongQuestions(1, studentToken);
    if (wrongQuestions.showAnswers) {
      console.log('Wrong questions:', wrongQuestions.wrongQuestions);
    }
  }
}
```

