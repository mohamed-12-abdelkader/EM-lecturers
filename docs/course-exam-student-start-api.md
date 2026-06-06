# بداية امتحان كورس للطالب (Start Course Exam)

## الطلب

| | |
|--|--|
| **Method** | `POST` |
| **URL** | `/api/exams/:examId/start` |
| **Auth** | طالب (`student`) — Bearer token |

- **`:examId`**: معرّف امتحان الكورس (من `course_level_exams`).
- **Body**: لا يُرسل شيء (أو `{}`).

---

## الشروط

- الطالب مسجّل في الكورس (enrolled).
- الامتحان مفعّل (`is_active`) ومرئي للطلاب (`is_visible_to_students`).
- لم ينتهِ وقت الظهور إن وُجد (`visibility_end_date`).
- لم يستنفد عدد المحاولات إن وُجد حد (`attempt_limit`).
- إن كان الامتحان بمحاولة واحدة فقط وتمت المحاولة مسبقاً، يُرجع **403** مع تفاصيل المحاولة السابقة (ولا يُنشئ محاولة جديدة).

---

## الاستجابة الناجحة (200)

```json
{
  "attemptId": 501,
  "examId": 12,
  "examTitle": "امتحان الوحدة الأولى",
  "durationMinutes": 30,
  "questionsCount": 10,
  "startedAt": "2025-02-06T14:00:00.000Z",
  "questions": [
    {
      "id": 101,
      "type": "TEXT",
      "questionText": "أي مما يلي لا يعتبر من الجزيئات العضوية الصغيرة؟",
      "questionImage": null,
      "optionA": "الأحماض النووية",
      "optionB": "الأحماض الأمينية",
      "optionC": "الأحماض الدهنية",
      "optionD": "لا توجد إجابة صحيحة"
    },
    {
      "id": 102,
      "type": "TEXT",
      "questionText": "أي المركبات الآتية يحتوي على أقل عدد من جزيئات الجلوكوز؟",
      "questionImage": null,
      "optionA": "السليلوز",
      "optionB": "السكروز",
      "optionC": "النشا",
      "optionD": "الكيتين"
    }
  ]
}
```

| الحقل | النوع | الوصف |
|--------|------|--------|
| `attemptId` | number | معرّف المحاولة — يُستخدم عند التسليم في `POST /api/exams/:examId/submit` ضمن `attemptId`. |
| `examId` | number | معرّف الامتحان. |
| `examTitle` | string | عنوان الامتحان. |
| `durationMinutes` | number | مدة الامتحان بالدقائق. |
| `questionsCount` | number | عدد الأسئلة. |
| `startedAt` | string (ISO) | وقت بدء المحاولة. |
| `questions` | array | قائمة الأسئلة **بدون** الإجابة الصحيحة. |
| `questions[].id` | number | معرّف السؤال — يُرسل مع الإجابة عند التسليم. |
| `questions[].type` | string | نوع السؤال (مثلاً `TEXT`). |
| `questions[].questionText` | string | نص السؤال. |
| `questions[].questionImage` | string \| null | رابط صورة السؤال إن وُجدت. |
| `questions[].optionA` … `optionD` | string | نصوص الخيارات أ، ب، ج، د. |

- إذا كان هناك **محاولة نشطة** (لم يُسلّمها الطالب بعد)، يُرجع نفس الشكل مع نفس المحاولة ونفس الأسئلة (لا يُنشئ محاولة جديدة).

---

## استجابة 403 — محاولة واحدة وتمت مسبقاً

عندما يكون الامتحان **محاولة واحدة فقط** والطالب أنهى المحاولة سابقاً:

```json
{
  "message": "You have already completed this exam. Only one attempt is allowed.",
  "previousAttempt": {
    "attemptId": 500,
    "totalGrade": 7,
    "maxGrade": 10,
    "submittedAt": "2025-02-05T12:00:00.000Z",
    "showAnswers": true,
    "releaseReason": "immediate",
    "answersVisibleAt": null,
    "wrongQuestions": [
      {
        "questionId": 101,
        "questionText": "...",
        "questionImage": null,
        "type": "TEXT",
        "correctAnswer": "A",
        "yourAnswer": "B",
        "optionA": "...",
        "optionB": "...",
        "optionC": "...",
        "optionD": "..."
      }
    ]
  }
}
```

---

## أخطاء شائعة

| Status | المعنى |
|--------|--------|
| 400 | `examId` غير صالح. |
| 403 | غير مسجّل في الكورس، أو الامتحان غير مفعّل/غير مرئي، أو انتهى وقت الظهور، أو استنفد المحاولات، أو (محاولة واحدة وتمت مسبقاً — انظر أعلاه). |
| 404 | الامتحان غير موجود. |

---

## بعد البدء — تسليم الامتحان

لتسليم الإجابات استخدم أحد المسارين:

- **`POST /api/exams/:examId/submit`**
- **`POST /api/course/course-exam/:examId/submit`**

**Body (مطلوب):**

```json
{
  "attemptId": 19,
  "answers": [
    { "questionId": 40, "selectedAnswer": "A" },
    { "questionId": 41, "selectedAnswer": "B" }
  ]
}
```

- **`attemptId`**: من استجابة بداية الامتحان (أو يمكن تركه والاعتماد على المحاولة النشطة في مسار الكورس).
- **كل عنصر في `answers`** يجب أن يحتوي على:
  - **معرّف السؤال**: `questionId` أو `question_id` أو `id` (مثل `40`).
  - **الإجابة المختارة** بأحد الأشكال:
    - `selectedAnswer`: `"A"` أو `"B"` أو `"C"` أو `"D"` (أو `"a"`/`"b"`/`"c"`/`"d"`).
    - أو `selected_answer` / `answer` / `choice` / `option` / `selected` بنفس القيم.
    - أو `selectedIndex` / `index`: `0` = أ، `1` = ب، `2` = ج، `3` = د.
    - أو `optionA`/`optionB`/`optionC`/`optionD`: `true` للخيار المختار فقط.

إذا ظهر خطأ **"Received: undefined"** فغالباً:
- أحد عناصر `answers` غير مكتمل (مثلاً يوجد `questionId` بدون حقل للإجابة)، أو
- تم إرسال عناصر `undefined` داخل المصفوفة.

يُفضّل إرسال كل إجابة بالشكل: `{ "questionId": 40, "selectedAnswer": "A" }`.
