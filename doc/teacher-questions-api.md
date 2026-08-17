# توثيق API مكتبة الأسئلة الخاصة بالمدرس

> للتوثيق الكامل (الهيكل، قاعدة البيانات، التدفقات، OCR): راجع [`teacher-question-library-system.md`](./teacher-question-library-system.md)  
> **إضافة أسئلة المكتبة لامتحان محاضرة أو امتحان كورس:** [`teacher-library-to-exam-api.md`](./teacher-library-to-exam-api.md)

جميع المسارات تتطلب مصادقة المدرس (Bearer Token) وتبدأ بـ:
```
/api/teacher/questions
```

## الهيكل

```
مكتبة المدرّس
  └── صفوف دراسية (teacher_question_grades)
        └── دروس (teacher_question_lessons)
              ├── أسئلة مباشرة (teacher_questions)
              └── قطع قراءة اختيارية (teacher_question_passages) → أسئلة مرتبطة بالقطعة
```

---

## الصفوف الدراسية (Grades)

### إضافة صف
- **POST** `/api/teacher/questions/grade`
- **Body:**
```json
{ "title": "الصف الأول الثانوي", "platform_grade_id": 10 }
```
- `title` مطلوب إلا إذا أُرسل `platform_grade_id` — حينها يُستخدم اسم الصف من المنصة تلقائيًا.
- `platform_grade_id` اختياري: ربط بصف من جدول `grades`.
- **Response:**
```json
{
  "grade": {
    "id": 1,
    "teacher_id": 5,
    "title": "الصف الأول الثانوي",
    "platform_grade_id": 10,
    "platform_grade_name": "الصف الأول الثانوي",
    "created_at": "..."
  }
}
```

### تعديل صف
- **PUT** `/api/teacher/questions/grade/:id`
- **Body:** `{ "title": "اسم جديد" }` و/أو `{ "platform_grade_id": 11 }` (أو `null` لإلغاء الربط)

### حذف صف
- **DELETE** `/api/teacher/questions/grade/:id`
- يحذف الصف **وكل دروسه وأسئلته** (Cascade)

### جلب صفوف المدرّس
- **GET** `/api/teacher/questions/grades`
- **Response:**
```json
{
  "grades": [
    {
      "id": 1,
      "teacher_id": 5,
      "title": "الصف الأول الثانوي",
      "platform_grade_id": 10,
      "platform_grade_name": "الصف الأول الثانوي",
      "lessons_count": 4,
      "questions_count": 30,
      "created_at": "..."
    }
  ]
}
```

---

## الدروس (Lessons)

### إضافة درس
- **POST** `/api/teacher/questions/lesson`
- **Body:**
```json
{ "grade_id": 1, "title": "الدرس الأول" }
```
- **Response:**
```json
{ "lesson": { "id": 1, "teacher_id": 5, "grade_id": 1, "title": "الدرس الأول", "created_at": "..." } }
```

### تعديل درس
- **PUT** `/api/teacher/questions/lesson/:id`
- **Body:** `{ "title": "اسم جديد للدرس" }` و/أو `{ "grade_id": 2 }` لنقل الدرس لصف آخر

### حذف درس
- **DELETE** `/api/teacher/questions/lesson/:id`
- **Response:**
```json
{ "success": true }
```

### جلب دروس المدرّس
- **GET** `/api/teacher/questions/lessons`
- **Query (اختياري):** `?grade_id=1` لجلب دروس صف معيّن
- **Response:**
```json
{
  "lessons": [
    {
      "id": 1,
      "teacher_id": 5,
      "grade_id": 1,
      "grade_title": "الصف الأول الثانوي",
      "title": "الدرس الأول",
      "questions_count": 12,
      "created_at": "..."
    }
  ]
}
```

---

## القطع (Passages) — اختياري، مرتبطة بالدرس

### إضافة قطعة مع أسئلة
- **POST** `/api/teacher/questions/passage`
- **Body:**
```json
{
  "lesson_id": 1,
  "title": "قطعة القراءة",
  "content": "نص القطعة...",
  "questions": [
    {
      "question_text": "ما الفكرة الرئيسية؟",
      "question_type": "choice",
      "choices": ["أ", "ب", "ج", "د"],
      "correct_answer_index": 1
    }
  ]
}
```

### جلب قطع درس
- **GET** `/api/teacher/questions/passages/:lesson_id`

### جلب قطعة واحدة
- **GET** `/api/teacher/questions/passage/:id`

---

## الأسئلة (Questions)

### إضافة سؤال
- **POST** `/api/teacher/questions/question`
- **Body:**
```json
{
  "lesson_id": 1,
  "question_text": "ما هو عدد الحروف الأبجدية؟",
  "question_type": "choice",
  "choices": ["26", "28", "29", "30"],
  "answer": "28",
  "passage_id": null
}
```
- **Response:**
```json
{ "question": { "id": 1, "lesson_id": 1, "question_text": "...", ... } }
```

### تعديل سؤال
- **PUT** `/api/teacher/questions/question/:id`
- **Body:** نفس حقول الإضافة (بدون `lesson_id`)

### حذف سؤال
- **DELETE** `/api/teacher/questions/question/:id`
- **Response:**
```json
{ "success": true }
```

### جلب أسئلة درس
- **GET** `/api/teacher/questions/questions/:lesson_id`
- **Response:**
```json
{ "questions": [ { "id": 1, "lesson_id": 1, "question_text": "...", ... } ] }
```

---

## إضافة أسئلة دفعة واحدة (Bulk Insert)

- **POST** `/api/teacher/questions/bulk`
- **Body:**
```json
{
  "lesson_id": 1,
  "bulk_text": "ما المقصود بمبدأ \"توازن القوى\"...\nA) ...\nB) ...\nC) ...\nD) ...\n\n..."
}
```
- **Response:**
```json
{ "success": true, "inserted": 5 }
```

---

## جلب الشجرة الكاملة (صفوف ← دروس ← أسئلة وقطع)
- **GET** `/api/teacher/questions/tree`
- **Response:**
```json
{
  "grades": [
    {
      "id": 1,
      "teacher_id": 5,
      "title": "الصف الأول الثانوي",
      "platform_grade_id": 10,
      "platform_grade_name": "الصف الأول الثانوي",
      "lessons": [
        {
          "id": 1,
          "teacher_id": 5,
          "grade_id": 1,
          "title": "الدرس الأول",
          "questions": [
            { "id": 1, "question_text": "...", "passage_id": null }
          ],
          "passages": [
            {
              "id": 1,
              "title": "قطعة قراءة",
              "content": "...",
              "questions": [
                { "id": 2, "passage_id": 1, "question_text": "..." }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

---

## مسار عام (بدون مصادقة)
- **GET** `/api/teacher/questions/public/questions/:lesson_id`

---

## ملاحظات
- جميع الـ endpoints (ما عدا public) تتطلب مصادقة المدرس (Bearer Token)
- كل مدرس يرى ويعدل مكتبته فقط
- حذف الصف يحذف دروسه وأسئلته وقطعه تلقائيًا (Cascade)
- حذف الدرس يحذف أسئله وقطعه تلقائيًا (Cascade)
- الهيكل: **صفوف دراسية → دروس → أسئلة** (مع قطع قراءة اختيارية داخل الدرس)
