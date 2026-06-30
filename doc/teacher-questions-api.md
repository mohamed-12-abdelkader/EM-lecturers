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
  └── دروس (teacher_question_lessons)
        ├── أسئلة مباشرة (teacher_questions)
        └── قطع قراءة اختيارية (teacher_question_passages) → أسئلة مرتبطة بالقطعة
```

---

## الدروس (Lessons)

### إضافة درس
- **POST** `/api/teacher/questions/lesson`
- **Body:**
```json
{ "title": "الدرس الأول" }
```
- **Response:**
```json
{ "lesson": { "id": 1, "teacher_id": 5, "title": "الدرس الأول", "created_at": "..." } }
```

### تعديل درس
- **PUT** `/api/teacher/questions/lesson/:id`
- **Body:**
```json
{ "title": "اسم جديد للدرس" }
```
- **Response:**
```json
{ "lesson": { ... } }
```

### حذف درس
- **DELETE** `/api/teacher/questions/lesson/:id`
- **Response:**
```json
{ "success": true }
```

### جلب كل دروس المدرّس
- **GET** `/api/teacher/questions/lessons`
- **Response:**
```json
{
  "lessons": [
    {
      "id": 1,
      "teacher_id": 5,
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

## جلب الشجرة الكاملة (دروس ← أسئلة وقطع)
- **GET** `/api/teacher/questions/tree`
- **Response:**
```json
{
  "lessons": [
    {
      "id": 1,
      "teacher_id": 5,
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
```

---

## مسار عام (بدون مصادقة)
- **GET** `/api/teacher/questions/public/questions/:lesson_id`

---

## ملاحظات
- جميع الـ endpoints (ما عدا public) تتطلب مصادقة المدرس (Bearer Token)
- كل مدرس يرى ويعدل مكتبته فقط
- حذف الدرس يحذف أسئله وقطعه تلقائيًا (Cascade)
- تم إلغاء مستويات **الفصول** و**الأجزاء** — الدروس مباشرة داخل المكتبة
