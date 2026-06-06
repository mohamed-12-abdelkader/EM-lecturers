# إدارة الأسئلة في الامتحان الشامل - API Documentation

## نظرة عامة

هذا النظام يتيح للمدرس إدارة الأسئلة في الامتحان الشامل بشكل كامل، بما في ذلك تحديد الإجابة الصحيحة، تعديل وحذف الأسئلة.

## المميزات الرئيسية

- ✅ **تحديد الإجابة الصحيحة** - تحديد أي اختيار كإجابة صحيحة
- ✅ **تعديل السؤال** - تعديل نص السؤال أو درجته أو اختياراته
- ✅ **حذف السؤال** - حذف سؤال من الامتحان
- ✅ **جلب سؤال واحد** - عرض تفاصيل سؤال معين
- ✅ **التحقق من الملكية** - التأكد أن السؤال يخص المدرس

## Authentication

جميع APIs تتطلب token مصادقة في header:
```
Authorization: Bearer <token>
```

---

## 📋 APIs

### 1. تحديد الإجابة الصحيحة لسؤال

**Endpoint:** `PATCH /api/course/course-exam/question/:questionId/correct-answer`

**الصلاحيات:** `teacher` فقط

**Request Body:**
```json
{
  "correct_choice_id": 15
}
```

**الشرح:**
- `correct_choice_id` - ID الاختيار الصحيح (مطلوب)

**Response (200):**
```json
{
  "message": "تم تحديث الإجابة الصحيحة بنجاح"
}
```

**مثال JavaScript:**
```javascript
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

// استخدام
await setCorrectAnswer(123, 15);
```

---

### 2. تعديل سؤال في الامتحان الشامل

**Endpoint:** `PUT /api/course/course-exam/question/:questionId`

**الصلاحيات:** `teacher` فقط

**Request Body:**
```json
{
  "text": "نص السؤال المحدث؟",
  "grade": 10,
  "choices": [
    {
      "text": "الاختيار الأول",
      "is_correct": false
    },
    {
      "text": "الاختيار الثاني", 
      "is_correct": true
    },
    {
      "text": "الاختيار الثالث",
      "is_correct": false
    },
    {
      "text": "الاختيار الرابع",
      "is_correct": false
    }
  ]
}
```

**الشرح:**
- `text` - نص السؤال (اختياري)
- `grade` - درجة السؤال (اختياري)
- `choices` - مصفوفة الاختيارات (اختياري)
  - `text` - نص الاختيار
  - `is_correct` - هل هو الإجابة الصحيحة (يجب أن يكون true لاختيار واحد فقط)

**ملاحظات:**
- جميع الحقول اختيارية
- إذا أرسلت `choices`، سيتم استبدال جميع الاختيارات القديمة
- `is_correct` يجب أن يكون `true` لاختيار واحد فقط

**Response (200):**
```json
{
  "message": "تم تحديث السؤال بنجاح"
}
```

**مثال JavaScript:**
```javascript
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

// استخدام
await updateQuestion(123, {
  text: "ما هي عاصمة مصر؟",
  grade: 10,
  choices: [
    {"text": "الإسكندرية", "is_correct": false},
    {"text": "الجيزة", "is_correct": false},
    {"text": "الأقصر", "is_correct": false},
    {"text": "القاهرة", "is_correct": true}
  ]
});
```

---

### 3. حذف سؤال من الامتحان الشامل

**Endpoint:** `DELETE /api/course/course-exam/question/:questionId`

**الصلاحيات:** `teacher` فقط

**Response (200):**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

**مثال JavaScript:**
```javascript
const deleteQuestion = async (questionId) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
await deleteQuestion(123);
```

---

### 4. جلب سؤال واحد من الامتحان الشامل

**Endpoint:** `GET /api/course/course-exam/question/:questionId`

**الصلاحيات:** `teacher` فقط

**Response (200):**
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

**مثال JavaScript:**
```javascript
const getQuestion = async (questionId) => {
  const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const { question } = await getQuestion(123);
console.log('تفاصيل السؤال:', question);
```

---

### 5. جلب جميع أسئلة الامتحان الشامل

**Endpoint:** `GET /api/course/course-exam/:examId/questions`

**الصلاحيات:** `teacher` أو `student` (المدرس صاحب الكورس أو الطالب المشترك)

**Response (200):**
```json
{
  "questions": [
    {
      "id": 123,
      "text": "ما هي عاصمة مصر؟",
      "type": "single_choice",
      "position": 1,
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
  ]
}
```

**مثال JavaScript:**
```javascript
const getExamQuestions = async (examId) => {
  const response = await fetch(`/api/course/course-exam/${examId}/questions`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};

// استخدام
const { questions } = await getExamQuestions(1);
console.log('أسئلة الامتحان:', questions);
```

---

## 🔧 سير العمل الكامل لإدارة الأسئلة

### مثال شامل لإدارة أسئلة الامتحان:

```javascript
// مكتبة دوال إدارة الأسئلة
class ExamQuestionManager {
  constructor(token) {
    this.token = token;
  }

  // جلب جميع أسئلة الامتحان
  async getExamQuestions(examId) {
    const response = await fetch(`/api/course/course-exam/${examId}/questions`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    return await response.json();
  }

  // تحديد الإجابة الصحيحة
  async setCorrectAnswer(questionId, choiceId) {
    const response = await fetch(`/api/course/course-exam/question/${questionId}/correct-answer`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify({
        correct_choice_id: choiceId
      })
    });
    return await response.json();
  }

  // تعديل سؤال
  async updateQuestion(questionId, questionData) {
    const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`
      },
      body: JSON.stringify(questionData)
    });
    return await response.json();
  }

  // حذف سؤال
  async deleteQuestion(questionId) {
    const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    return await response.json();
  }

  // جلب سؤال واحد
  async getQuestion(questionId) {
    const response = await fetch(`/api/course/course-exam/question/${questionId}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`
      }
    });
    return await response.json();
  }
}

// استخدام المكتبة
const questionManager = new ExamQuestionManager(token);

// مثال على الاستخدام الشامل
const manageExamQuestions = async (examId) => {
  try {
    // 1. جلب جميع أسئلة الامتحان
    const { questions } = await questionManager.getExamQuestions(examId);
    console.log('أسئلة الامتحان:', questions);

    if (questions.length === 0) {
      console.log('لا توجد أسئلة في الامتحان');
      return;
    }

    // 2. تحديد الإجابة الصحيحة للسؤال الأول
    const firstQuestion = questions[0];
    if (firstQuestion.choices.length > 0) {
      const correctChoice = firstQuestion.choices[0]; // أول اختيار
      await questionManager.setCorrectAnswer(firstQuestion.id, correctChoice.id);
      console.log('تم تحديد الإجابة الصحيحة للسؤال الأول');
    }

    // 3. تعديل السؤال الثاني (إذا وجد)
    if (questions.length > 1) {
      const secondQuestion = questions[1];
      await questionManager.updateQuestion(secondQuestion.id, {
        text: "نص السؤال المحدث؟",
        grade: 15,
        choices: [
          {"text": "اختيار جديد 1", "is_correct": false},
          {"text": "اختيار جديد 2", "is_correct": true},
          {"text": "اختيار جديد 3", "is_correct": false},
          {"text": "اختيار جديد 4", "is_correct": false}
        ]
      });
      console.log('تم تعديل السؤال الثاني');
    }

    // 4. حذف السؤال الثالث (إذا وجد)
    if (questions.length > 2) {
      const thirdQuestion = questions[2];
      await questionManager.deleteQuestion(thirdQuestion.id);
      console.log('تم حذف السؤال الثالث');
    }

    // 5. جلب تفاصيل السؤال الأول
    const { question } = await questionManager.getQuestion(firstQuestion.id);
    console.log('تفاصيل السؤال الأول:', question);

  } catch (error) {
    console.error('خطأ في إدارة الأسئلة:', error);
  }
};

// تشغيل المثال
manageExamQuestions(1);
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

### 500 - خطأ في الخادم
```json
{
  "message": "خطأ في تحديث الإجابة الصحيحة",
  "details": "تفاصيل الخطأ"
}
```

---

## 📋 سير العمل (Workflow)

### للمدرس:
1. إنشاء امتحان شامل للكورس
2. إضافة أسئلة للامتحان (من مكتبة الأسئلة أو أسئلة جديدة)
3. تحديد الإجابة الصحيحة لكل سؤال
4. تعديل الأسئلة عند الحاجة
5. حذف الأسئلة غير المرغوب فيها
6. مراجعة الأسئلة قبل إظهار الامتحان للطلاب

### للطالب:
1. رؤية أسئلة الامتحان (بدون الإجابات الصحيحة)
2. حل الامتحان
3. رؤية النتيجة

---

## ملاحظات مهمة

1. **الصلاحيات**: جميع APIs تتطلب صلاحية مدرس
2. **التحقق من الملكية**: يتم التحقق أن السؤال يخص المدرس قبل أي عملية
3. **الإجابة الصحيحة**: يمكن تحديد اختيار واحد فقط كإجابة صحيحة
4. **تعديل الاختيارات**: عند تعديل الاختيارات، يتم استبدال جميع الاختيارات القديمة
5. **الحذف**: عند حذف سؤال، يتم حذف جميع الاختيارات المرتبطة به
6. **الترتيب**: يتم الحفاظ على ترتيب الأسئلة في الامتحان
7. **الأمان**: لا يمكن للطلاب رؤية الإجابات الصحيحة
8. **التكامل**: هذه APIs تعمل مع نظام الامتحانات الشاملة الموجود

---

## أمثلة إضافية

### تحديد الإجابة الصحيحة لعدة أسئلة:

```javascript
const setMultipleCorrectAnswers = async (questionsData) => {
  const results = [];
  
  for (const { questionId, correctChoiceId } of questionsData) {
    try {
      const result = await questionManager.setCorrectAnswer(questionId, correctChoiceId);
      results.push({ questionId, success: true, result });
    } catch (error) {
      results.push({ questionId, success: false, error: error.message });
    }
  }
  
  return results;
};

// استخدام
const questionsToUpdate = [
  { questionId: 123, correctChoiceId: 15 },
  { questionId: 124, correctChoiceId: 19 },
  { questionId: 125, correctChoiceId: 23 }
];

const results = await setMultipleCorrectAnswers(questionsToUpdate);
console.log('نتائج تحديث الإجابات الصحيحة:', results);
```

### تعديل أسئلة متعددة:

```javascript
const updateMultipleQuestions = async (questionsData) => {
  const results = [];
  
  for (const { questionId, ...questionData } of questionsData) {
    try {
      const result = await questionManager.updateQuestion(questionId, questionData);
      results.push({ questionId, success: true, result });
    } catch (error) {
      results.push({ questionId, success: false, error: error.message });
    }
  }
  
  return results;
};

// استخدام
const questionsToUpdate = [
  {
    questionId: 123,
    text: "سؤال محدث 1",
    grade: 10,
    choices: [
      {"text": "أ", "is_correct": false},
      {"text": "ب", "is_correct": true},
      {"text": "ج", "is_correct": false},
      {"text": "د", "is_correct": false}
    ]
  },
  {
    questionId: 124,
    text: "سؤال محدث 2",
    grade: 15
  }
];

const results = await updateMultipleQuestions(questionsToUpdate);
console.log('نتائج تحديث الأسئلة:', results);
``` 