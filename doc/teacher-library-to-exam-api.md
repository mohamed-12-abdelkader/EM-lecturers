# إضافة أسئلة من مكتبة المدرس إلى الامتحانات

> مكتبة المدرس (`teacher_questions`) منفصلة عن **بنك الأسئلة العام** (`questions_v2`).  
> لإضافة من بنك الأسئلة العام راجع [`add-questions-from-bank.md`](../docs/add-questions-from-bank.md).

## نظرة عامة

- تُنسخ الأسئلة **داخل الامتحان** (snapshot) مع الاحتفاظ بمرجع `teacher_question_id`.
- تعديل أو حذف السؤال في الامتحان **لا يغيّر** مكتبة المدرس.
- تعديل السؤال في المكتبة **لا يغيّر** الأسئلة المضافة مسبقاً للامتحان.
- يُمنع تكرار نفس السؤال من المكتبة في نفس الامتحان.

### Migration مطلوبة

```bash
npm run migrate up
```

الملف: `migrations/1773800000000_teacher_library_exam_links.sql`  
يضيف عمود `teacher_question_id` على `exam_questions` و `course_level_exam_questions`.

---

## 1. امتحان المحاضرة (Lecture Exam)

| | |
|--|--|
| **Method** | `POST` |
| **URL (موحّد)** | `/api/exams/:examId/questions/from-teacher-library` |
| **URL (مختصر)** | `/api/exams/lecture/:examId/questions/from-teacher-library` |
| **Auth** | معلم (`teacher`) |

### Body (JSON) — أحد الخيارات

```json
{
  "questionIds": [12, 15, 18]
}
```

أو إضافة **كل أسئلة صف دراسي**:

```json
{
  "gradeId": 2
}
```

أو إضافة **كل أسئلة درس**:

```json
{
  "lessonId": 3
}
```

أو إضافة **كل أسئلة قطعة قراءة**:

```json
{
  "passageId": 7
}
```

| الحقل | النوع | الوصف |
|--------|------|--------|
| `questionIds` | number[] | معرّفات من `teacher_questions` |
| `gradeId` | number | يضيف كل أسئلة الصف |
| `lessonId` | number | يضيف كل أسئلة الدرس |
| `passageId` | number | يضيف كل أسئلة القطعة |
| `type` | string | لا تُمرّر أو أي قيمة غير `course-exam` |

### Response (200)

```json
{
  "message": "Questions added successfully",
  "examId": 45,
  "examType": "lecture-exam",
  "addedCount": 3,
  "examQuestionIds": [501, 502, 503],
  "addedTeacherQuestionIds": [12, 15, 18],
  "skippedTeacherQuestionIds": []
}
```

- `examQuestionIds`: معرّفات الأسئلة **داخل الامتحان** (`exam_questions.id`) — للحذف والتعديل.
- يدعم أسئلة `choice` و `text` (المقالي بدون خيارات).

---

## 2. امتحان الكورس العام (Course-Level Exam)

| | |
|--|--|
| **Method** | `POST` |
| **URL (موحّد)** | `/api/exams/:examId/questions/from-teacher-library` |
| **URL (مختصر)** | `/api/exams/course-level/:examId/questions/from-teacher-library` |
| **Auth** | معلم (`teacher`) |

### Body (JSON)

```json
{
  "questionIds": [12, 15, 18],
  "type": "course-exam"
}
```

أو مع `lessonId` / `passageId` (نفس امتحان المحاضرة) + **`type: "course-exam"`** في المسار الموحّد.

### Response (200)

```json
{
  "message": "Questions added successfully",
  "examId": 8,
  "examType": "course-exam",
  "addedCount": 2,
  "addedTeacherQuestionIds": [12, 15],
  "skippedTeacherQuestionIds": [],
  "questions": [
    {
      "id": 201,
      "exam_id": 8,
      "type": "TEXT",
      "question_text": "ما هو ...؟",
      "option_a": "أ",
      "option_b": "ب",
      "option_c": "ج",
      "option_d": "د",
      "correct_answer": "B",
      "teacher_question_id": 12
    }
  ]
}
```

> **ملاحظة:** امتحان الكورس يقبل فقط أسئلة **`choice`** (اختيار من متعدد) بخيارين على الأقل.

---

## 3. ملخص المسارات

| نوع الامتحان | Endpoint موصى به |
|--------------|------------------|
| محاضرة | `POST /api/exams/lecture/:examId/questions/from-teacher-library` |
| كورس عام | `POST /api/exams/course-level/:examId/questions/from-teacher-library` |
| أي نوع (مع `type`) | `POST /api/exams/:examId/questions/from-teacher-library` |

---

## 4. أخطاء شائعة

| HTTP | السبب |
|------|--------|
| 400 | `questionIds` فارغ ولم يُرسَل `gradeId` أو `lessonId` أو `passageId` |
| 400 | معرّفات غير موجودة في مكتبة المدرس (`missingQuestionIds`) |
| 400 | سؤال مقالي في امتحان كورس |
| 403 | الامتحان لا يخص المدرس |
| 404 | الامتحان غير موجود |

---

## 5. بعد الإضافة

| العملية | امتحان محاضرة | امتحان كورس |
|---------|---------------|-------------|
| حذف سؤال | `DELETE /api/exams/:examId/questions/:examQuestionId` | `DELETE /api/course/course-exam/question/:questionId` |
| تعديل الإجابة | `PATCH /api/exams/:examId/questions/:examQuestionId/correct-answer` | `PATCH /api/course/course-exam/question/:questionId/correct-answer` |
| إخفاء/إظهار | `PATCH /api/exams/:examId/questions/:examQuestionId/visibility` | — |

---

## 6. الملفات

| الملف | الدور |
|-------|------|
| `src/services/teacherLibraryExamQuestions.ts` | منطق النسخ والتحقق |
| `src/controllers/exams.ts` | المسارات الثلاثة |
| `migrations/1773800000000_teacher_library_exam_links.sql` | ربط `teacher_question_id` |

---

## 7. جلب أسئلة المكتبة (للاختيار في الواجهة)

| Method | URL |
|--------|-----|
| GET | `/api/teacher/questions/grades` |
| GET | `/api/teacher/questions/lessons` |
| GET | `/api/teacher/questions/lessons?grade_id=` |
| GET | `/api/teacher/questions/lesson/:lesson_id/questions` |
| GET | `/api/teacher/questions/passage/:id` |

راجع [`teacher-questions-api.md`](./teacher-questions-api.md).
