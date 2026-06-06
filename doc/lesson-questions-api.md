# Lesson Questions API Documentation

## نظرة عامة
نظام إدارة أسئلة الدروس بنفس نظام امتحانات المحاضرات، يدعم الأسئلة النصية والصورية مع خيارات متعددة.

## المميزات الرئيسية

### 1. أنواع الأسئلة المدعومة
- **أسئلة نصية:** أسئلة مكتوبة بالكامل
- **أسئلة صورية:** أسئلة تحتوي على صور
- **خيارات متعددة:** دعم خيارات (أ، ب، ج، د)

### 2. إدارة الأسئلة
- **إضافة أسئلة دفعة واحدة:** من نص منسق
- **إضافة أسئلة بالصور:** رفع صور متعددة
- **تعديل الأسئلة:** النص، الصور، الدرجات
- **تحديد الإجابة الصحيحة:** اختيار الخيار الصحيح
- **حذف الأسئلة:** حذف آمن مع الحفاظ على البيانات

## APIs للمدرسين

### 1. إضافة أسئلة اختيار من متعدد دفعة واحدة (مع الإجابة الصحيحة)
**Endpoint:** `POST /api/lesson-questions/lessons/:lessonId/questions/bulk`

يسمح بإضافة أكثر من سؤال في نفس الطلب. التنسيق المدعوم:
- سطر السؤال (يمكن أن يبدأ برقم أو إيموجي مثل 2️⃣ أو ٣.)
- أربعة أسطر للاختيارات: أ) ... ب) ... ج) ... د) ... (أو بالإنجليزية A) B) C) D))
- سطر اختياري: `✅ الإجابة الصحيحة: ب` (أو أ/ج/د أو A/B/C/D)

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "bulk_text": "2️⃣ متى وقعت معركة حطين؟\nأ) 1099م\nب) 1187م\nج) 1250م\nد) 1260م\n✅ الإجابة الصحيحة: ب\n\n3️⃣ من هو قائد المسلمين في معركة عين جالوت؟\nأ) الظاهر بيبرس\nب) قطز\nج) صلاح الدين\nد) قلاوون\n✅ الإجابة الصحيحة: ب"
}
```

**Response:**
```json
{
  "success": true,
  "message": "تمت إضافة 2 سؤال/أسئلة",
  "data": {
    "inserted": 2,
    "questions": [
      {
        "id": 101,
        "text": "متى وقعت معركة حطين؟",
        "options": ["1099م", "1187م", "1250م", "1260م"],
        "correct_answer": "ب"
      },
      {
        "id": 102,
        "text": "من هو قائد المسلمين في معركة عين جالوت؟",
        "options": ["الظاهر بيبرس", "قطز", "صلاح الدين", "قلاوون"],
        "correct_answer": "ب"
      }
    ]
  }
}
```

**ملاحظة:** يعمل مع الدروس في بنك الأسئلة (جدول `lessons`). المدرس يحتاج صلاحية على المادة في بنك الأسئلة.

---

### 2. إضافة أسئلة نصية للدرس في بنك الأسئلة (بدون الإجابة الصحيحة)
**Endpoint:** `POST /api/lesson-questions/lessons/:lessonId/questions/text`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "bulk_text": "السؤال الأول؟\nA) الخيار الأول\nB) الخيار الثاني\nC) الخيار الثالث\nD) الخيار الرابع\n\nالسؤال الثاني؟\nA) الخيار الأول\nB) الخيار الثاني\nC) الخيار الثالث\nD) الخيار الرابع"
}
```

**ملاحظة:** هذا الـ API يعمل مع الدروس في بنك الأسئلة (جدول `lessons`) وليس مع دروس الكورسات (جدول `lectures`). 
الهيكل: بنك الأسئلة → المادة → الفصل → الدرس

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 71,
      "lesson_id": 40,
      "text": "السؤال الأول؟",
      "image": null,
      "options": [
        "الخيار الأول",
        "الخيار الثاني",
        "الخيار الثالث",
        "الخيار الرابع"
      ],
      "correct_answer": null,
      "created_at": "2025-10-20T11:42:01.054Z",
      "updated_at": "2025-10-20T11:42:01.054Z"
    }
  ]
}
```

### 3. إضافة أسئلة بالصور للدرس في بنك الأسئلة
**Endpoint:** `POST /api/lesson-questions/lessons/:lessonId/questions/images`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**
```
images: [file1.jpg, file2.jpg, ...] (up to 10 files)
```

**ملاحظة:** هذا الـ API يعمل مع الدروس في بنك الأسئلة (جدول `lessons`) وليس مع دروس الكورسات (جدول `lectures`). 
الهيكل: بنك الأسئلة → المادة → الفصل → الدرس

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 36,
      "lesson_id": 39,
      "text": "",
      "image": "https://cloudinary.com/image1.jpg",
      "options": ["أ", "ب", "ج", "د"],
      "correct_answer": null,
      "created_at": "2025-10-16T23:40:58.515Z",
      "updated_at": "2025-10-16T23:40:58.515Z"
    }
  ]
}
```

### 2. جلب أسئلة الدرس من بنك الأسئلة (API جديد)
**Endpoint:** `GET /api/lesson-questions/lessons/:lessonId/questions`

**Headers:**
```
Authorization: Bearer <token>
```

**ملاحظة:** هذا الـ API يعمل مع الدروس في بنك الأسئلة (جدول `lessons`) وليس مع دروس الكورسات (جدول `lectures`).

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 36,
      "lesson_id": 39,
      "text": "السؤال الأول؟",
      "image": null,
      "options": [
        "الخيار الأول",
        "الخيار الثاني", 
        "الخيار الثالث",
        "الخيار الرابع"
      ],
      "correct_answer": null,
      "created_at": "2025-10-16T23:40:58.515Z",
      "updated_at": "2025-10-16T23:40:58.515Z"
    },
    {
      "id": 69,
      "lesson_id": 39,
      "text": "",
      "image": "https://cloudinary.com/image1.jpg",
      "options": ["أ", "ب", "ج", "د"],
      "correct_answer": null,
      "created_at": "2025-10-20T10:50:04.836Z",
      "updated_at": "2025-10-20T10:50:04.836Z"
    },
    {
      "id": 70,
      "lesson_id": 39,
      "text": "السؤال الثاني؟",
      "image": null,
      "options": [
        "الخيار الأول",
        "الخيار الثاني",
        "الخيار الثالث",
        "الخيار الرابع"
      ],
      "correct_answer": null,
      "created_at": "2025-10-20T10:50:04.836Z",
      "updated_at": "2025-10-20T10:50:04.836Z"
    }
  ]
}
```

**ملاحظة:** هذا الـ API يجلب **جميع الأسئلة** (النصية والصورية) من كلا الجدولين:
- الأسئلة من الجدول الجديد (questions مع lesson_id)
- الأسئلة من الجدول القديم (lesson_questions + questions + question_choices)
- الأسئلة مرتبة حسب تاريخ الإنشاء

### 3. حذف سؤال من درس
**Endpoint:** `DELETE /api/lesson-questions/questions/:questionId`

**Headers:**
```
Authorization: Bearer <token>
```

**ملاحظة:** هذا الـ API يعمل مع الأسئلة في بنك الأسئلة ويدعم كلا النوعين من الأسئلة.

**Response:**
```json
{
  "success": true,
  "message": "تم حذف السؤال بنجاح"
}
```

**Error Responses:**
```json
{
  "message": "السؤال غير موجود"
}
```

```json
{
  "message": "ليس لديك صلاحية لحذف هذا السؤال"
}
```

### 4. تعديل سؤال من درس
**Endpoint:** `PUT /api/lesson-questions/questions/:questionId`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "text": "السؤال المحدث؟",
  "image": "https://cloudinary.com/new-image.jpg",
  "options": ["الخيار الأول", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"],
  "correct_answer": "الخيار الأول"
}
```

**ملاحظة:** يمكن تعديل أي حقل من الحقول المذكورة أعلاه. الحقول غير المذكورة لن تتغير.

**Response:**
```json
{
  "success": true,
  "message": "تم تحديث السؤال بنجاح"
}
```

**Error Responses:**
```json
{
  "message": "السؤال غير موجود"
}
```

```json
{
  "message": "ليس لديك صلاحية لتعديل هذا السؤال"
}
```

### 5. تحديد الإجابة الصحيحة للسؤال
**Endpoint:** `POST /api/lesson-questions/questions/:questionId/answer`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "correctChoiceId": 0
}
```

**ملاحظة:** 
- `correctChoiceId` هو فهرس الاختيار الصحيح (0 = الأول، 1 = الثاني، إلخ)
- يدعم كلا النوعين من الأسئلة (النصية والصورية)

**Response:**
```json
{
  "success": true,
  "message": "تم تحديث الإجابة الصحيحة بنجاح"
}
```

**Error Responses:**
```json
{
  "message": "السؤال غير موجود"
}
```

```json
{
  "message": "ليس لديك صلاحية لتعديل هذا السؤال"
}
```

```json
{
  "message": "اختيار غير صحيح"
}
```

## أمثلة على الاستخدام

### 1. إضافة أسئلة نصية للدرس
```bash
curl -X POST http://localhost:8000/api/lesson-questions/lessons/40/questions/text \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bulk_text": "ما هو الحيوان الذي يسمى ملك الغابة؟\nA) الأسد\nB) النمر\nC) الفيل\nD) الزرافة\n\nما هو لون الدم؟\nA) الأزرق\nB) الأحمر\nC) الأخضر\nD) الأصفر"
  }'
```

### 2. إضافة أسئلة بالصور للدرس
```bash
curl -X POST http://localhost:8000/api/lesson-questions/lessons/40/questions/images \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "images=@question1.jpg" \
  -F "images=@question2.jpg" \
  -F "images=@question3.jpg"
```

### 3. جلب أسئلة الدرس
```bash
curl -X GET http://localhost:8000/api/lesson-questions/lessons/40/questions \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. تعديل سؤال
```bash
curl -X PUT http://localhost:8000/api/lesson-questions/questions/201 \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "السؤال المحدث؟",
    "options": ["الخيار الأول", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"],
    "correct_answer": "الخيار الأول"
  }'
```

### 5. تحديد الإجابة الصحيحة
```bash
curl -X POST http://localhost:8000/api/lesson-questions/questions/201/answer \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "correctChoiceId": 0
  }'
```

### 6. حذف سؤال
```bash
curl -X DELETE http://localhost:8000/api/lesson-questions/questions/201 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 3. إضافة أسئلة دفعة واحدة للدرس
**Endpoint:** `POST /api/lesson-questions/lecture/:lectureId/bulk`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "bulk_text": "ما هي عاصمة مصر؟\nأ) القاهرة\nب) الإسكندرية\nج) الأقصر\nد) أسوان\n\nما هو أكبر محيط في العالم؟\nأ) المحيط الهادئ\nب) المحيط الأطلسي\nج) المحيط الهندي\nد) المحيط المتجمد الشمالي"
}
```

**Response:**
```json
{
  "success": true,
  "inserted": 2,
  "questions": [
    {
      "id": 1,
      "text": "ما هي عاصمة مصر؟",
      "choices": [
        { "text": "القاهرة", "is_correct": false },
        { "text": "الإسكندرية", "is_correct": false },
        { "text": "الأقصر", "is_correct": false },
        { "text": "أسوان", "is_correct": false }
      ]
    }
  ],
  "lectureId": 1
}
```

### 2. إضافة أسئلة بالصور للدرس
**Endpoint:** `POST /api/lesson-questions/lecture-question/`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**
```
images: [file1.jpg, file2.jpg, ...] (up to 10 files)
lecture_id: 1
```

**Response:**
```json
[
  {
    "id": 1,
    "text": "",
    "image": "https://cloudinary.com/image1.jpg",
    "type": "image",
    "choices": [
      { "id": 1, "text": "أ", "is_correct": false },
      { "id": 2, "text": "ب", "is_correct": false },
      { "id": 3, "text": "ج", "is_correct": false },
      { "id": 4, "text": "د", "is_correct": false }
    ]
  }
]
```

### 3. جلب أسئلة الدرس
**Endpoint:** `GET /api/lesson-questions/lecture/:lectureId/questions`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "questions": [
    {
      "id": 1,
      "type": "text",
      "text": "ما هي عاصمة مصر؟",
      "image": null,
      "grade": 1,
      "choices": [
        { "id": 1, "text": "القاهرة", "is_correct": true },
        { "id": 2, "text": "الإسكندرية", "is_correct": false },
        { "id": 3, "text": "الأقصر", "is_correct": false },
        { "id": 4, "text": "أسوان", "is_correct": false }
      ]
    },
    {
      "id": 2,
      "type": "image",
      "text": null,
      "image": "https://cloudinary.com/image1.jpg",
      "grade": 1,
      "choices": [
        { "id": 5, "text": "أ", "is_correct": false },
        { "id": 6, "text": "ب", "is_correct": true },
        { "id": 7, "text": "ج", "is_correct": false },
        { "id": 8, "text": "د", "is_correct": false }
      ]
    }
  ]
}
```

### 4. تعديل سؤال
**Endpoint:** `PATCH /api/lesson-questions/lecture-question/:questionId`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

**Request Body:**
```
question_text: "ما هي عاصمة جمهورية مصر العربية؟"
grade: 2
image: [optional file]
```

**Response:**
```json
{
  "id": 1,
  "lecture_id": 1,
  "question_text": "ما هي عاصمة جمهورية مصر العربية؟",
  "question_image": null,
  "grade": 2,
  "question_id": 1,
  "created_at": "2024-01-15T10:00:00.000Z",
  "updated_at": "2024-01-15T10:30:00.000Z"
}
```

### 5. تحديد الإجابة الصحيحة
**Endpoint:** `PATCH /api/lesson-questions/lecture-question/:questionId/answer`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "correct_answer": 1
}
```

**Response:**
```json
{
  "message": "تم تحديث الإجابة الصحيحة بنجاح"
}
```

### 6. حذف سؤال
**Endpoint:** `DELETE /api/lesson-questions/lecture-question/:questionId`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

### 7. جلب تفاصيل الدرس مع الأسئلة
**Endpoint:** `GET /api/lesson-questions/lecture/:lectureId/details`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "lecture": {
    "id": 1,
    "title": "مقدمة في الرياضيات",
    "description": "درس تعريفي بالرياضيات",
    "position": 1,
    "course_id": 1,
    "created_at": "2024-01-15T10:00:00.000Z"
  },
  "questions": [
    {
      "id": 1,
      "type": "text",
      "text": "ما هي عاصمة مصر؟",
      "image": null,
      "grade": 1,
      "choices": [
        { "id": 1, "text": "القاهرة", "is_correct": true },
        { "id": 2, "text": "الإسكندرية", "is_correct": false }
      ]
    }
  ]
}
```

## APIs للطلاب

### جلب أسئلة الدرس (بدون الإجابات الصحيحة)
**Endpoint:** `GET /api/lesson-questions/lecture/:lectureId/questions`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
```json
{
  "questions": [
    {
      "id": 1,
      "type": "text",
      "text": "ما هي عاصمة مصر؟",
      "image": null,
      "grade": 1,
      "choices": [
        { "id": 1, "text": "القاهرة", "is_correct": false },
        { "id": 2, "text": "الإسكندرية", "is_correct": false },
        { "id": 3, "text": "الأقصر", "is_correct": false },
        { "id": 4, "text": "أسوان", "is_correct": false }
      ]
    }
  ]
}
```

## أمثلة على الاستخدام

### للمدرسين

#### إضافة أسئلة بالصور:
```javascript
const addImageQuestions = async (lessonId, files) => {
  const formData = new FormData();
  files.forEach(file => formData.append('images', file));
  
  const response = await fetch(`/api/lesson-questions/lessons/${lessonId}/questions/bulk`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    body: formData
  });
  
  const result = await response.json();
  console.log('تم إضافة', result.data.length, 'سؤال صوري');
};
```

#### جلب أسئلة الدرس:
```javascript
const getLessonQuestions = async (lessonId) => {
  const response = await fetch(`/api/lesson-questions/lessons/${lessonId}/questions`, {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });
  
  const data = await response.json();
  
  data.data.forEach((question, index) => {
    if (question.image) {
      console.log(`السؤال ${index + 1}: صورة - ${question.image}`);
    } else {
      console.log(`السؤال ${index + 1}: ${question.text}`);
    }
    
    question.options.forEach((option, optionIndex) => {
      console.log(`  ${String.fromCharCode(65 + optionIndex)}) ${option}`);
    });
  });
};
```

#### إضافة أسئلة دفعة واحدة:
```javascript
const addBulkQuestions = async (lectureId, questionsText) => {
  const response = await fetch(`/api/lesson-questions/lecture/${lectureId}/bulk`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bulk_text: questionsText
    })
  });
  
  const result = await response.json();
  console.log('تم إضافة', result.inserted, 'سؤال');
};
```

#### إضافة أسئلة بالصور:
```javascript
const addImageQuestions = async (lectureId, files) => {
  const formData = new FormData();
  files.forEach(file => formData.append('images', file));
  formData.append('lecture_id', lectureId);
  
  const response = await fetch('/api/lesson-questions/lecture-question/', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    body: formData
  });
  
  const result = await response.json();
  console.log('تم إضافة', result.length, 'سؤال صوري');
};
```

#### تحديد الإجابة الصحيحة:
```javascript
const setCorrectAnswer = async (questionId, choiceId) => {
  const response = await fetch(`/api/lesson-questions/lecture-question/${questionId}/answer`, {
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      correct_answer: choiceId
    })
  });
  
  const result = await response.json();
  console.log(result.message);
};
```

### للطلاب

#### عرض أسئلة الدرس:
```javascript
const showLessonQuestions = async (lectureId) => {
  const response = await fetch(`/api/lesson-questions/lecture/${lectureId}/questions`, {
    headers: {
      'Authorization': 'Bearer ' + token
    }
  });
  
  const data = await response.json();
  
  data.questions.forEach((question, index) => {
    console.log(`السؤال ${index + 1}: ${question.text || 'سؤال صوري'}`);
    question.choices.forEach((choice, choiceIndex) => {
      console.log(`  ${String.fromCharCode(65 + choiceIndex)}) ${choice.text}`);
    });
  });
};
```

## قواعد البيانات

### الجداول المستخدمة

#### 1. lesson_questions
```sql
CREATE TABLE lesson_questions (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL REFERENCES lectures(id),
    question_text TEXT,
    question_image TEXT,
    grade INTEGER DEFAULT 1,
    question_id INTEGER REFERENCES questions(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 2. questions (جدول موجود)
```sql
CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    text TEXT,
    type VARCHAR(50),
    image TEXT
);
```

#### 3. question_choices (جدول موجود)
```sql
CREATE TABLE question_choices (
    id SERIAL PRIMARY KEY,
    question_id INTEGER REFERENCES questions(id),
    text TEXT,
    is_correct BOOLEAN
);
```

## ملاحظات مهمة

1. **الأمان:** المدرسون يمكنهم فقط إدارة أسئلة دروسهم
2. **الطلاب:** يمكنهم فقط الوصول للأسئلة في الكورسات المسجلين فيها
3. **الإجابات:** الطلاب لا يرون الإجابات الصحيحة إلا بعد الإجابة
4. **الصور:** يتم رفع الصور على Cloudinary تلقائياً
5. **المرونة:** دعم كامل للأسئلة النصية والصورية

هذا النظام يوفر تجربة تعليمية تفاعلية ومتنوعة للطلاب! 🎓✨





