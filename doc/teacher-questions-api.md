# توثيق API مكتبة الأسئلة الخاصة بالمدرس

جميع المسارات تتطلب مصادقة المدرس (Bearer Token) وتبدأ بـ:
```
/api/teacher/questions
```

---

## الفصول (Chapters)

### إضافة فصل جديد
- **POST** `/api/teacher/questions/chapter`
- **Body:**
```json
{ "title": "الفصل الأول" }
```
- **Response:**
```json
{ "chapter": { "id": 1, "teacher_id": 5, "title": "الفصل الأول", "created_at": "..." } }
```

### تعديل فصل
- **PUT** `/api/teacher/questions/chapter/:id`
- **Body:**
```json
{ "title": "اسم جديد للفصل" }
```
- **Response:**
```json
{ "chapter": { ... } }
```

### حذف فصل
- **DELETE** `/api/teacher/questions/chapter/:id`
- **Response:**
```json
{ "success": true }
```

### جلب كل الفصول
- **GET** `/api/teacher/questions/chapters`
- **Response:**
```json
{ "chapters": [ { "id": 1, "teacher_id": 5, "title": "الفصل الأول", ... } ] }
```

---

## الدروس (Lessons)

### إضافة درس
- **POST** `/api/teacher/questions/lesson`
- **Body:**
```json
{ "chapter_id": 1, "title": "الدرس الأول" }
```
- **Response:**
```json
{ "lesson": { "id": 1, "chapter_id": 1, "title": "الدرس الأول", ... } }
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

### جلب دروس فصل
- **GET** `/api/teacher/questions/lessons/:chapter_id`
- **Response:**
```json
{ "lessons": [ { "id": 1, "chapter_id": 1, "title": "الدرس الأول", ... } ] }
```

---

## الأجزاء (Parts)

### إضافة جزء
- **POST** `/api/teacher/questions/part`
- **Body:**
```json
{ "lesson_id": 1, "title": "الجزء الأول" }
```
- **Response:**
```json
{ "part": { "id": 1, "lesson_id": 1, "title": "الجزء الأول", ... } }
```

### تعديل جزء
- **PUT** `/api/teacher/questions/part/:id`
- **Body:**
```json
{ "title": "اسم جديد للجزء" }
```
- **Response:**
```json
{ "part": { ... } }
```

### حذف جزء
- **DELETE** `/api/teacher/questions/part/:id`
- **Response:**
```json
{ "success": true }
```

### جلب أجزاء درس
- **GET** `/api/teacher/questions/parts/:lesson_id`
- **Response:**
```json
{ "parts": [ { "id": 1, "lesson_id": 1, "title": "الجزء الأول", ... } ] }
```

---

## الأسئلة (Questions)

### إضافة سؤال
- **POST** `/api/teacher/questions/question`
- **Body:**
```json
{
  "part_id": 1,
  "question_text": "ما هو عدد الحروف الأبجدية؟",
  "question_type": "choice", // أو "text"
  "choices": ["26", "28", "29", "30"], // إذا كان اختياري
  "answer": "28"
}
```
- **Response:**
```json
{ "question": { "id": 1, "part_id": 1, "question_text": "...", ... } }
```

### تعديل سؤال
- **PUT** `/api/teacher/questions/question/:id`
- **Body:**
```json
{
  "question_text": "...",
  "question_type": "...",
  "choices": [ ... ],
  "answer": "..."
}
```
- **Response:**
```json
{ "question": { ... } }
```

### حذف سؤال
- **DELETE** `/api/teacher/questions/question/:id`
- **Response:**
```json
{ "success": true }
```

### جلب أسئلة جزء
- **GET** `/api/teacher/questions/questions/:part_id`
- **Response:**
```json
{ "questions": [ { "id": 1, "part_id": 1, "question_text": "...", ... } ] }
```

---

## إضافة أسئلة دفعة واحدة (Bulk Insert)

### إضافة عدة أسئلة دفعة واحدة
- **POST** `/api/teacher/questions/bulk`
- **Body:**
```json
{
  "part_id": 1,
  "bulk_text": "ما المقصود بمبدأ \"توازن القوى\" في السياسة الدولية؟\nA) إقامة علاقات اقتصادية بين الدول\nB) توزيع النفوذ السياسي بالتساوي بين الدول الكبرى\nC) دعم الحركات الوطنية في المستعمرات\nD) منع تحالفات عسكرية في أوروبا\n\nما الحدث الذي ترتب عليه قيام الحرب العالمية الأولى؟\nA) احتلال فرنسا للمغرب\nB) اغتيال ولي عهد النمسا في سراييفو\nC) قيام الثورة البلشفية\nD) توقيع معاهدة فرساي\n\n..."
}
```
- **طريقة التنسيق:**
  - كل سؤال يبدأ بسطر نص السؤال.
  - بعده 4 أسطر اختيارات (A/B/C/D).
  - ثم سطر فارغ أو نهاية النص.
- **Response:**
```json
{ "success": true, "inserted": 5 }
```
- **ملاحظات:**
  - لا يتم تحديد الإجابة الصحيحة أثناء الإضافة bulk (يمكن تعديلها لاحقًا عبر تعديل السؤال).
  - إذا كان هناك خطأ في التنسيق لن يتم إدخال السؤال.

---

## جلب الشجرة الكاملة (فصول ← دروس ← أجزاء ← أسئلة)
- **GET** `/api/teacher/questions/tree`
- **Response:**
```json
{
  "chapters": [
    {
      "id": 1,
      "title": "الفصل الأول",
      "lessons": [
        {
          "id": 1,
          "title": "الدرس الأول",
          "parts": [
            {
              "id": 1,
              "title": "الجزء الأول",
              "questions": [
                { "id": 1, "question_text": "...", ... }
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

## ملاحظات
- جميع الـ endpoints تتطلب مصادقة المدرس (Bearer Token)
- كل مدرس يرى ويعدل مكتبته فقط
- الحذف لأي عنصر يحذف كل ما تحته تلقائيًا (Cascade)
- يمكن للمدرس إضافة وتعديل وحذف أي عنصر في مكتبته
- جميع التواريخ بصيغة ISO 