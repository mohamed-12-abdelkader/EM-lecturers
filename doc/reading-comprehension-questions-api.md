# أسئلة القطعة (Reading Comprehension) - طريقة الإضافة والعرض

هذا الدليل يشرح الوضع الحالي بعد التحديث: كيف تنشئ قطعة ومعها أسئلة MCQ، كيف تضيفها للامتحان، وكيف تظهر الآن في API.

---

## 1) إنشاء قطعة + مجموعة أسئلة MCQ

### Endpoint
`POST /api/question-bank-v2/passages`

### Authentication
- `teacher` أو `admin` أو `employee`
- مع صلاحية `question_bank_management`

### Request Body
```json
{
  "lesson_id": 12,
  "title": "The Solar System",
  "content": "The solar system consists of the sun and all objects that orbit it...",
  "questions": [
    {
      "question_text": "What is at the center of the solar system?",
      "options": [
        { "option_index": 0, "option_type": "text", "text_content": "Earth" },
        { "option_index": 1, "option_type": "text", "text_content": "Sun" },
        { "option_index": 2, "option_type": "text", "text_content": "Moon" },
        { "option_index": 3, "option_type": "text", "text_content": "Mars" }
      ],
      "correct_answer_index": 1,
      "difficulty_level": "easy",
      "points": 1
    },
    {
      "question_text": "Which object orbits the sun?",
      "options": [
        { "option_index": 0, "option_type": "text", "text_content": "Planets" },
        { "option_index": 1, "option_type": "text", "text_content": "Clouds" },
        { "option_index": 2, "option_type": "text", "text_content": "Mountains" },
        { "option_index": 3, "option_type": "text", "text_content": "Rivers" }
      ],
      "correct_answer_index": 0,
      "difficulty_level": "medium",
      "points": 1
    }
  ]
}
```

### Response (201)
```json
{
  "success": true,
  "message": "تمت إضافة القطعة مع 2 سؤال",
  "data": {
    "passage": {
      "id": 44,
      "lesson_id": 12,
      "title": "The Solar System",
      "content": "The solar system consists of the sun and all objects that orbit it...",
      "order_index": 0
    },
    "questions": [
      { "id": 301, "passage_id": 44 },
      { "id": 302, "passage_id": 44 }
    ]
  }
}
```

---

## 2) إضافة كل أسئلة القطعة إلى الامتحان

> هذا المسار جديد ومخصص لسيناريو Reading Comprehension.

### Endpoint
`POST /api/exams/:examId/questions/from-passage`

### Authentication
- `teacher` (صاحب الامتحان)

### Request Body
```json
{
  "passageId": 44
}
```

> يقبل أيضًا `passage_id`.

### Response (200)
```json
{
  "message": "تمت إضافة 2 سؤال من القطعة",
  "examId": 19,
  "passage": {
    "id": 44,
    "title": "The Solar System",
    "content": "The solar system consists of the sun and all objects that orbit it..."
  },
  "questionIds": [301, 302],
  "added": 2
}
```

إذا كانت الأسئلة مضافة مسبقًا:
```json
{
  "message": "كل أسئلة القطعة موجودة مسبقًا في الامتحان",
  "examId": 19,
  "questionIds": [301, 302],
  "added": 0
}
```

---

## 2.1) إنشاء قطعة بأسئلتها وإضافتها مباشرة لامتحان المحاضرة (بدون بنك الأسئلة مسبقًا)

> استخدم هذا المسار عندما تريد إدخال القطعة وأسئلتها مرة واحدة داخل الامتحان مباشرة.

### Endpoint
`POST /api/exams/:examId/questions/passage`

### Authentication
- `teacher` (صاحب الامتحان)

### Request Body
```json
{
  "title": "Reading Passage 1",
  "content": "Ali woke up early and went to school...",
  "questionsBulkText": "1- ...\n(أ) ...\n(ب) ...\n(ج) ...\n(د) ...\n\n2- ...\n(أ) ...\n(ب) ...\n(ج) ...\n(د) ..."
}
```

### ملاحظات
- `correctAnswer` يقبل:
  - حرف: `A` أو `B` أو `C` أو `D`
  - رقم: `0` أو `1` أو `2` أو `3`
- لا ترسل `lesson_id`.
- النظام يستنتج `lesson_id` تلقائيًا من `examId` (من مادة الكورس المرتبط بالمحاضرة).
- يمكنك الإرسال بطريقتين:
  - `questions` كمصفوفة (JSON)
  - `questionsBulkText` كنص Bulk (يدعم الترقيم + خيارات `(أ)(ب)(ج)(د)`)  
    ويدعم أيضًا `bulkQuestionsText` أو `mcqText` كأسماء بديلة.
- هذا المسار:
  1. ينشئ القطعة
  2. ينشئ أسئلة MCQ المرتبطة بها
  3. يربط الأسئلة مباشرة بامتحان المحاضرة

### Response (201)
```json
{
  "message": "تم إنشاء القطعة وإضافة 2 سؤال للامتحان",
  "examId": 19,
  "passage": {
    "id": 55,
    "lesson_id": 12,
    "title": "Reading Passage 1",
    "content": "Ali woke up early and went to school..."
  },
  "questionIds": [401, 402],
  "examQuestionIds": [9101, 9102],
  "added": 2
}
```

### تنسيق إدخال الأسئلة (مجموعة واحدة دفعة واحدة)
- أرسل كل أسئلة الـ MCQ داخل مصفوفة `questions` في نفس الطلب.
- لا تحتاج إرسال كل سؤال في Request منفصل.
- كل عنصر داخل `questions` يمثل سؤالًا واحدًا.
- أو أرسلها كنص واحد في `questionsBulkText` بالتنسيق التالي:
  - `1- نص السؤال`
  - `(أ) الاختيار الأول`
  - `(ب) الاختيار الثاني`
  - `(ج) الاختيار الثالث`
  - `(د) الاختيار الرابع`

---

## 3) عرض الامتحان الآن (شكل البيانات الحالي)

### Endpoint
`GET /api/exams/:examId`

### ملاحظات العرض بعد التحديث
- كل MCQ يرجع كعنصر مستقل داخل `questions`.
- إذا السؤال مرتبط بقطعة، سترجع القطعة داخل نفس السؤال في حقل `passage`.
- لو عدة أسئلة لنفس القطعة: نفس `passage` ستتكرر مع كل سؤال (وهذا مقصود لتسهيل الواجهة).

### مثال Response (مختصر)
```json
{
  "status": "ready",
  "questions": [
    {
      "id": 9001,
      "examQuestionId": 9001,
      "text": "What is at the center of the solar system?",
      "grade": 1,
      "passage": {
        "id": 44,
        "title": "The Solar System",
        "content": "The solar system consists of the sun and all objects that orbit it..."
      },
      "choices": [
        { "id": 1, "text": "Earth" },
        { "id": 2, "text": "Sun" },
        { "id": 3, "text": "Moon" },
        { "id": 4, "text": "Mars" }
      ]
    },
    {
      "id": 9002,
      "examQuestionId": 9002,
      "text": "Which object orbits the sun?",
      "grade": 1,
      "passage": {
        "id": 44,
        "title": "The Solar System",
        "content": "The solar system consists of the sun and all objects that orbit it..."
      },
      "choices": [
        { "id": 5, "text": "Planets" },
        { "id": 6, "text": "Clouds" },
        { "id": 7, "text": "Mountains" },
        { "id": 8, "text": "Rivers" }
      ]
    }
  ]
}
```

---

## 4) سيناريو سريع (من البداية للنهاية)

1. أنشئ القطعة + أسئلتها عبر  
   `POST /api/question-bank-v2/passages`
2. خذ `passage.id` من الاستجابة.
3. أضف أسئلة القطعة للامتحان عبر  
   `POST /api/exams/:examId/questions/from-passage`
4. اعرض الامتحان عبر  
   `GET /api/exams/:examId`
5. في الواجهة: اعرض `question.passage.content` فوق السؤال إذا `passage` ليست `null`.

---

## 5) أخطاء شائعة

- `400 Invalid exam id`  
  `examId` غير صحيح.
- `400 passageId is required...`  
  لم يتم إرسال `passageId` أو قيمته غير رقم صحيح.
- `404 القطعة غير موجودة`  
  `passageId` غير موجود في `question_passages`.
- `400 القطعة لا تحتوي على أسئلة`  
  القطعة موجودة لكن لا يوجد أسئلة مرتبطة بها.
- `403 You do not own this exam`  
  المدرس الحالي ليس صاحب الامتحان.

