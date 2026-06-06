# دليل الطالب لتسليم الواجب

## نظرة عامة

يتم تسليم الواجب في 3 خطوات:
1. **جلب الأسئلة** - عرض الأسئلة مع الخيارات (كل خيار له ID)
2. **اختيار الإجابات** - الطالب يختار `option_id` لكل سؤال
3. **تسليم الواجب** - إرسال الإجابات وحساب النتيجة
4. **عرض التصحيح** - عرض النتيجة والأخطاء

---

## الخطوة 1: جلب أسئلة الواجب

**Endpoint**: `GET /api/assignments/:assignmentId/questions`

**Headers**:
```
Authorization: Bearer <student_token>
```

**مثال للطلب**:
```bash
GET http://localhost:8000/api/assignments/3/questions
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK)**:
```json
{
  "success": true,
  "assignment_id": 3,
  "questions": [
    {
      "id": 1,
      "assignment_id": 3,
      "question_type": "text",
      "question_text": "ما هي عاصمة مصر؟",
      "order_index": 0,
      "options": [
        {
          "id": 5,
          "option_text": "القاهرة",
          "option_letter": "a",
          "order_index": 0
        },
        {
          "id": 6,
          "option_text": "الإسكندرية",
          "option_letter": "b",
          "order_index": 1
        },
        {
          "id": 7,
          "option_text": "الجيزة",
          "option_letter": "c",
          "order_index": 2
        },
        {
          "id": 8,
          "option_text": "أسوان",
          "option_letter": "d",
          "order_index": 3
        }
      ],
      "images": []
    },
    {
      "id": 2,
      "assignment_id": 3,
      "question_type": "image",
      "question_text": null,
      "order_index": 1,
      "options": [
        {
          "id": 9,
          "option_text": "أ",
          "option_letter": "a",
          "order_index": 0
        },
        {
          "id": 10,
          "option_text": "ب",
          "option_letter": "b",
          "order_index": 1
        },
        {
          "id": 11,
          "option_text": "ج",
          "option_letter": "c",
          "order_index": 2
        },
        {
          "id": 12,
          "option_text": "د",
          "option_letter": "d",
          "order_index": 3
        }
      ],
      "images": [
        {
          "id": 1,
          "image_url": "https://res.cloudinary.com/.../question-image.jpg",
          "order_index": 0
        }
      ]
    }
  ],
  "total": 2,
  "has_submitted": false
}
```

**ملاحظات مهمة**:
- ✅ كل خيار له `id` خاص (مثلاً: `5`, `6`, `7`, `8`)
- ✅ `has_submitted: false` يعني أن الطالب لم يسلم الواجب بعد
- ✅ **لا يتم إرجاع الإجابة الصحيحة** في هذه الخطوة
- ✅ يجب أن يكون الطالب مشترك في الباقة

---

## الخطوة 2: اختيار الإجابات

الطالب يختار `option_id` لكل سؤال بناءً على الخيارات المعروضة.

**مثال**: إذا أراد الطالب اختيار "القاهرة" للسؤال الأول:
- `question_id: 1`
- `option_id: 5` (ID الخاص بخيار "القاهرة")

---

## الخطوة 3: تسليم الواجب

**Endpoint**: `POST /api/assignments/:assignmentId/submit`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "answers": [
    {
      "question_id": 1,
      "option_id": 5
    },
    {
      "question_id": 2,
      "option_id": 10
    }
  ]
}
```

**ملاحظات مهمة**:
- ✅ يجب الإجابة على **جميع الأسئلة** في الواجب
- ✅ كل إجابة تحتوي على:
  - `question_id`: معرف السؤال
  - `option_id`: معرف الخيار المختار (من الـ `options` في الخطوة 1)
- ✅ لا يمكن تسليم الواجب أكثر من مرة واحدة

**مثال للطلب** (JavaScript/Fetch):
```javascript
const submitAssignment = async (assignmentId, answers) => {
  const response = await fetch(`http://localhost:8000/api/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${studentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      answers: answers
    })
  });
  
  const result = await response.json();
  return result;
};

// استخدام
const answers = [
  { question_id: 1, option_id: 5 },  // اختار "القاهرة"
  { question_id: 2, option_id: 10 }    // اختار "ب"
];

submitAssignment(3, answers)
  .then(result => {
    console.log('النتيجة:', result);
    // {
    //   success: true,
    //   message: "تم تسليم الواجب بنجاح",
    //   submission: {
    //     id: 1,
    //     assignment_id: 3,
    //     total_questions: 2,
    //     correct_answers: 1,
    //     wrong_answers: 1,
    //     score: "50.00",
    //     submitted_at: "2024-01-15T11:00:00.000Z"
    //   }
    // }
  });
```

**Response (201 Created)**:
```json
{
  "success": true,
  "message": "تم تسليم الواجب بنجاح",
  "submission": {
    "id": 1,
    "assignment_id": 3,
    "total_questions": 2,
    "correct_answers": 1,
    "wrong_answers": 1,
    "score": "50.00",
    "submitted_at": "2024-01-15T11:00:00.000Z"
  }
}
```

**أخطاء محتملة**:

- **400 Bad Request** - عدد الإجابات لا يساوي عدد الأسئلة:
```json
{
  "error": "يجب الإجابة على جميع الأسئلة (2 سؤال)"
}
```

- **400 Bad Request** - تم التسليم من قبل:
```json
{
  "error": "لقد قمت بتسليم هذا الواجب من قبل"
}
```

- **403 Forbidden** - الطالب غير مشترك:
```json
{
  "error": "Forbidden",
  "message": "يجب تفعيل الباقة أولاً لتسليم الواجب"
}
```

---

## الخطوة 4: عرض التصحيح والنتيجة

**Endpoint**: `GET /api/assignments/:assignmentId/submission`

**Headers**:
```
Authorization: Bearer <student_token>
```

**مثال للطلب**:
```bash
GET http://localhost:8000/api/assignments/3/submission
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK)**:
```json
{
  "success": true,
  "submission": {
    "id": 1,
    "assignment_id": 3,
    "total_questions": 2,
    "correct_answers": 1,
    "wrong_answers": 1,
    "score": 50.00,
    "submitted_at": "2024-01-15T11:00:00.000Z",
    "answers": [
      {
        "question_id": 1,
        "question_type": "text",
        "question_text": "ما هي عاصمة مصر؟",
        "options": [
          {
            "id": 5,
            "option_text": "القاهرة",
            "option_letter": "a",
            "order_index": 0
          },
          {
            "id": 6,
            "option_text": "الإسكندرية",
            "option_letter": "b",
            "order_index": 1
          },
          {
            "id": 7,
            "option_text": "الجيزة",
            "option_letter": "c",
            "order_index": 2
          },
          {
            "id": 8,
            "option_text": "أسوان",
            "option_letter": "d",
            "order_index": 3
          }
        ],
        "images": [],
        "student_option_id": 5,
        "student_answer": "a",
        "student_option": {
          "id": 5,
          "option_text": "القاهرة",
          "option_letter": "a"
        },
        "correct_option_id": 5,
        "correct_answer": "a",
        "correct_option": {
          "id": 5,
          "option_text": "القاهرة",
          "option_letter": "a"
        },
        "is_correct": true
      },
      {
        "question_id": 2,
        "question_type": "image",
        "question_text": null,
        "options": [
          {
            "id": 9,
            "option_text": "أ",
            "option_letter": "a",
            "order_index": 0
          },
          {
            "id": 10,
            "option_text": "ب",
            "option_letter": "b",
            "order_index": 1
          },
          {
            "id": 11,
            "option_text": "ج",
            "option_letter": "c",
            "order_index": 2
          },
          {
            "id": 12,
            "option_text": "د",
            "option_letter": "d",
            "order_index": 3
          }
        ],
        "images": [
          {
            "id": 1,
            "image_url": "https://res.cloudinary.com/.../question-image.jpg",
            "order_index": 0
          }
        ],
        "student_option_id": 10,
        "student_answer": "b",
        "student_option": {
          "id": 10,
          "option_text": "ب",
          "option_letter": "b"
        },
        "correct_option_id": 11,
        "correct_answer": "c",
        "correct_option": {
          "id": 11,
          "option_text": "ج",
          "option_letter": "c"
        },
        "is_correct": false,
        "error": {
          "message": "إجابة خاطئة",
          "your_option_id": 10,
          "your_answer": "b",
          "your_option_text": "ب",
          "correct_option_id": 11,
          "correct_answer": "c",
          "correct_option_text": "ج"
        }
      }
    ]
  }
}
```

**ملاحظات مهمة**:
- ✅ يتم عرض **جميع الخيارات** مع IDs
- ✅ يتم عرض **الإجابة المختارة** (`student_option_id`, `student_option`)
- ✅ يتم عرض **الإجابة الصحيحة** (`correct_option_id`, `correct_option`)
- ✅ يتم عرض **تفاصيل الخطأ** إذا كانت الإجابة خاطئة (`error`)

---

## مثال كامل (Flow كامل)

### 1. جلب الأسئلة
```javascript
const getQuestions = async (assignmentId) => {
  const response = await fetch(`http://localhost:8000/api/assignments/${assignmentId}/questions`, {
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  return await response.json();
};

const questionsData = await getQuestions(3);
console.log('الأسئلة:', questionsData.questions);
// [
//   {
//     id: 1,
//     question_text: "ما هي عاصمة مصر؟",
//     options: [
//       { id: 5, option_text: "القاهرة", option_letter: "a" },
//       { id: 6, option_text: "الإسكندرية", option_letter: "b" },
//       ...
//     ]
//   },
//   ...
// ]
```

### 2. بناء الإجابات (في الواجهة)
```javascript
// الطالب يختار الخيارات في الواجهة
const studentAnswers = [];

// السؤال 1: اختار "القاهرة" (option_id: 5)
studentAnswers.push({
  question_id: 1,
  option_id: 5
});

// السؤال 2: اختار "ب" (option_id: 10)
studentAnswers.push({
  question_id: 2,
  option_id: 10
});
```

### 3. تسليم الواجب
```javascript
const submitAssignment = async (assignmentId, answers) => {
  const response = await fetch(`http://localhost:8000/api/assignments/${assignmentId}/submit`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${studentToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ answers })
  });
  return await response.json();
};

const result = await submitAssignment(3, studentAnswers);
console.log('النتيجة:', result.submission.score); // "50.00"
```

### 4. عرض التصحيح
```javascript
const getSubmission = async (assignmentId) => {
  const response = await fetch(`http://localhost:8000/api/assignments/${assignmentId}/submission`, {
    headers: {
      'Authorization': `Bearer ${studentToken}`
    }
  });
  return await response.json();
};

const submission = await getSubmission(3);
submission.submission.answers.forEach(answer => {
  if (!answer.is_correct) {
    console.log(`السؤال ${answer.question_id}:`);
    console.log(`  إجابتك: ${answer.student_option.option_text}`);
    console.log(`  الإجابة الصحيحة: ${answer.correct_option.option_text}`);
  }
});
```

---

## ملخص سريع

1. **جلب الأسئلة**: `GET /api/assignments/:id/questions`
   - يحصل على الأسئلة مع `options` (كل خيار له `id`)

2. **اختيار الإجابات**: الطالب يختار `option_id` لكل سؤال

3. **تسليم الواجب**: `POST /api/assignments/:id/submit`
   - يرسل `answers` مع `question_id` و `option_id`

4. **عرض التصحيح**: `GET /api/assignments/:id/submission`
   - يعرض النتيجة والأخطاء والإجابات الصحيحة

---

## أخطاء شائعة

❌ **خطأ**: إرسال `student_answer: "a"` بدلاً من `option_id: 5`
```json
{
  "answers": [
    { "question_id": 1, "student_answer": "a" }  // ❌ خطأ
  ]
}
```

✅ **صحيح**: إرسال `option_id`
```json
{
  "answers": [
    { "question_id": 1, "option_id": 5 }  // ✅ صحيح
  ]
}
```

❌ **خطأ**: عدم الإجابة على جميع الأسئلة
```json
{
  "answers": [
    { "question_id": 1, "option_id": 5 }
    // ❌ نسي السؤال 2
  ]
}
```

✅ **صحيح**: الإجابة على جميع الأسئلة
```json
{
  "answers": [
    { "question_id": 1, "option_id": 5 },
    { "question_id": 2, "option_id": 10 }  // ✅ جميع الأسئلة
  ]
}
```

