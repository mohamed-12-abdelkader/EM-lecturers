# رفع صور الأسئلة في الامتحانات

## نظرة عامة

تم إضافة إمكانية رفع صور للأسئلة في كل من:
- امتحان الكورس الشامل
- امتحان المحاضرة

## التغييرات في قاعدة البيانات

### إضافة عمود `image` لجدول `questions`
```sql
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT;
```

## APIs المحدثة

### 0. إضافة سؤال بصورة في امتحان الكورس الشامل

**Endpoint:** `POST /api/course/course-exam/:examId/question-image`

**الصلاحيات:** `teacher` فقط  
**Content-Type:** `multipart/form-data`

**Request Body:**
```
text: "نص اختياري يظهر فوق الصورة"
image: [ملف صورة]
choices: [
  {"text": "خيار 1", "is_correct": true},
  {"text": "خيار 2", "is_correct": false},
  {"text": "خيار 3", "is_correct": false},
  {"text": "خيار 4", "is_correct": false}
]
```

**Response:**
```json
{
  "message": "Question added with image",
  "questionId": 321
}
```

---

### 0.1 إضافة مجموعة صور دفعة واحدة لامتحان الكورس الشامل

**Endpoint:** `POST /api/course/course-exam/:examId/questions/images`

**الصلاحيات:** `teacher` فقط  
**Content-Type:** `multipart/form-data`

**Request Body:**
```
images[]: [ملف_1, ملف_2, ...]   (إجباري، حتى 10 ملفات)
texts: ["نص السؤال 1", "نص السؤال 2", ...] (اختياري - JSON بنفس الترتيب)
```

**Response:**
```json
{
  "message": "Image questions added",
  "inserted": 4,
  "questionIds": [300, 301, 302, 303]
}
```

> يتم توليد اختيارات افتراضية (A/B/C/D) لكل سؤال، ويمكن تعديلها لاحقاً بنفس واجهات التعديل المعتادة.

---

### 1. تعديل سؤال في امتحان الكورس الشامل

**Endpoint:** `PATCH /api/course/course-exam-question/:questionId`

**الصلاحيات:** `teacher` فقط

**Content-Type:** `multipart/form-data`

**Request Body:**
```
text: "نص السؤال المحدث؟" (اختياري)
choices: [{"text": "اختيار 1", "is_correct": false}, ...] (اختياري)
image: [ملف صورة] (اختياري)
```

**ملاحظات:**
- يمكن إرسال `text` أو `choices` أو `image` أو أي مجموعة منهم
- الصورة يجب أن تكون من نوع: `jpg`, `jpeg`, `png`, `gif`
- حجم الصورة الأقصى: 5MB

**Response:**
```json
{
  "message": "تم تحديث السؤال بنجاح"
}
```

### 2. تعديل سؤال في امتحان المحاضرة

**Endpoint:** `PATCH /api/questions/lecture-exam-question/:questionId`

**الصلاحيات:** `teacher`, `admin`

**Content-Type:** `multipart/form-data`

**Request Body:**
```
question_text: "نص السؤال المحدث؟" (اختياري)
grade: 10 (اختياري - سيصبح 1 تلقائياً)
image: [ملف صورة] (اختياري)
```

**ملاحظات:**
- يمكن إرسال `question_text` أو `image` أو كلاهما
- الصورة يجب أن تكون من نوع: `jpg`, `jpeg`, `png`, `gif`
- حجم الصورة الأقصى: 5MB

**Response:**
```json
{
  "id": 1,
  "question_text": "نص السؤال المحدث؟",
  "grade": 1,
  "image": "image-1234567890.jpg"
}
```

## جلب الأسئلة مع الصور

### 1. أسئلة امتحان الكورس الشامل

**Endpoint:** `GET /api/course/course-exam/:examId/questions`

**Response:**
```json
[
  {
    "id": 1,
    "text": "نص السؤال",
    "type": "single_choice",
    "image": "image-1234567890.jpg",
    "position": 1,
    "choices": [
      {"id": 1, "text": "اختيار 1", "is_correct": false},
      {"id": 2, "text": "اختيار 2", "is_correct": true}
    ]
  }
]
```

### 2. أسئلة امتحان المحاضرة

**Endpoint:** `GET /api/questions/lecture-exam/:examId/questions`

**Response:**
```json
{
  "questions": [
    {
      "id": 1,
      "text": "نص السؤال",
      "grade": 1,
      "image": "image-1234567890.jpg",
      "choices": [
        {"id": 1, "text": "اختيار 1", "is_correct": false},
        {"id": 2, "text": "اختيار 2", "is_correct": true}
      ]
    }
  ],
  "duration": 30
}
```

## أمثلة JavaScript

### تعديل سؤال مع صورة في امتحان الكورس الشامل
```javascript
const updateQuestionWithImage = async (questionId) => {
  const formData = new FormData();
  formData.append('text', 'نص السؤال المحدث؟');
  formData.append('choices', JSON.stringify([
    {"text": "اختيار 1", "is_correct": false},
    {"text": "اختيار 2", "is_correct": true},
    {"text": "اختيار 3", "is_correct": false},
    {"text": "اختيار 4", "is_correct": false}
  ]));
  
  // إضافة صورة من input file
  const fileInput = document.getElementById('questionImage');
  if (fileInput.files[0]) {
    formData.append('image', fileInput.files[0]);
  }

  const response = await fetch(`/api/course/course-exam-question/${questionId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};
```

### تعديل سؤال مع صورة في امتحان المحاضرة
```javascript
const updateLectureQuestionWithImage = async (questionId) => {
  const formData = new FormData();
  formData.append('question_text', 'نص السؤال المحدث؟');
  
  // إضافة صورة من input file
  const fileInput = document.getElementById('questionImage');
  if (fileInput.files[0]) {
    formData.append('image', fileInput.files[0]);
  }

  const response = await fetch(`/api/questions/lecture-exam-question/${questionId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};
```

### عرض السؤال مع الصورة
```javascript
const displayQuestion = (question) => {
  const questionContainer = document.getElementById('questionContainer');
  
  let html = `<h3>${question.text}</h3>`;
  
  // إضافة الصورة إذا وجدت
  if (question.image) {
    html += `<img src="/uploads/${question.image}" alt="صورة السؤال" style="max-width: 100%; height: auto; margin: 10px 0;" />`;
  }
  
  // إضافة الاختيارات
  question.choices.forEach((choice, index) => {
    html += `
      <div class="choice">
        <input type="radio" name="question_${question.id}" value="${choice.id}" id="choice_${choice.id}">
        <label for="choice_${choice.id}">${choice.text}</label>
      </div>
    `;
  });
  
  questionContainer.innerHTML = html;
};
```

## HTML Form Example

### نموذج تعديل سؤال مع صورة
```html
<form id="questionForm" enctype="multipart/form-data">
  <div>
    <label for="questionText">نص السؤال:</label>
    <textarea id="questionText" name="text" rows="4" cols="50"></textarea>
  </div>
  
  <div>
    <label for="questionImage">صورة السؤال:</label>
    <input type="file" id="questionImage" name="image" accept="image/*">
    <small>الأنواع المسموحة: JPG, JPEG, PNG, GIF. الحجم الأقصى: 5MB</small>
  </div>
  
  <div>
    <label>الاختيارات:</label>
    <div id="choicesContainer">
      <div class="choice">
        <input type="text" name="choices[0][text]" placeholder="الاختيار الأول">
        <input type="radio" name="choices[0][is_correct]" value="true"> صحيح
      </div>
      <div class="choice">
        <input type="text" name="choices[1][text]" placeholder="الاختيار الثاني">
        <input type="radio" name="choices[1][is_correct]" value="true"> صحيح
      </div>
      <!-- يمكن إضافة المزيد من الاختيارات -->
    </div>
  </div>
  
  <button type="submit">تحديث السؤال</button>
</form>
```

## Migration

تم إنشاء migration لإضافة عمود `image`:

```sql
-- Up Migration
ALTER TABLE questions ADD COLUMN IF NOT EXISTS image TEXT;

-- Down Migration
ALTER TABLE questions DROP COLUMN IF EXISTS image;
```

## الفوائد

1. **المرونة:** يمكن إضافة صور توضيحية للأسئلة
2. **الوضوح:** الصور تساعد في فهم السؤال بشكل أفضل
3. **التوافق:** يعمل مع جميع أنواع الأسئلة
4. **الأمان:** تحقق من نوع وحجم الملفات
5. **التخزين:** الصور تُحفظ في مجلد `uploads/`

## ملاحظات مهمة

- الصور تُحفظ في مجلد `uploads/` على الخادم
- يتم التحقق من نوع وحجم الملف قبل الحفظ
- يمكن حذف الصورة بإرسال `image: null` أو عدم إرسال الصورة
- الصور تُعرض عبر URL: `/uploads/filename.jpg`
- يجب التأكد من وجود مجلد `uploads/` مع صلاحيات الكتابة 