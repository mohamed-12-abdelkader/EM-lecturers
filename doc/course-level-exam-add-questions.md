# إضافة أسئلة من بنك الأسئلة لامتحان الكورس

## نظرة عامة
هذا الدليل يشرح كيفية إضافة أسئلة من بنك الأسئلة إلى امتحان الكورس (Course Level Exam) وعرضها.

---

## 1. إضافة أسئلة من بنك الأسئلة

### Endpoint
```
POST /api/exams/course-level/:examId/questions/from-bank
```

### Authentication
يتطلب صلاحية `teacher` فقط.

### Request Headers
```
Authorization: Bearer <token>
Content-Type: application/json
```

### Request Body
```json
{
  "questionIds": [1, 2, 3, 4, 5]
}
```

**Parameters:**
- `questionIds` (array of numbers, required): مصفوفة تحتوي على IDs الأسئلة من بنك الأسئلة التي تريد إضافتها

### Response (Success - 201)
```json
{
  "message": "Questions added successfully to course-level exam",
  "count": 5
}
```

**Response Fields:**
- `message` (string): رسالة نجاح العملية
- `count` (number): عدد الأسئلة التي تم إضافتها بنجاح

### Response (Error - 400)
```json
{
  "message": "questionIds array is required"
}
```

### Response (Error - 403)
```json
{
  "message": "You do not own this exam"
}
```

### Response (Error - 404)
```json
{
  "message": "Exam not found"
}
```

### Response (Error - 500)
```json
{
  "message": "Failed to add questions to course-level exam"
}
```

### مثال على الاستخدام

#### cURL
```bash
curl -X POST "http://localhost:8000/api/exams/course-level/9/questions/from-bank" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "questionIds": [1, 2, 3, 4, 5]
  }'
```

#### JavaScript (Fetch)
```javascript
const response = await fetch('http://localhost:8000/api/exams/course-level/9/questions/from-bank', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    questionIds: [1, 2, 3, 4, 5]
  })
});

const data = await response.json();
console.log(data);
```

#### JavaScript (Axios)
```javascript
const axios = require('axios');

const response = await axios.post(
  'http://localhost:8000/api/exams/course-level/9/questions/from-bank',
  {
    questionIds: [1, 2, 3, 4, 5]
  },
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);

console.log(response.data);
```

---

## 2. عرض أسئلة امتحان الكورس

### Endpoint
```
GET /api/course/course-exam/:examId/questions
```

### Authentication
يتطلب صلاحية `teacher` فقط (صاحب الكورس).

### Request Headers
```
Authorization: Bearer <token>
```

### Response (Success - 200)
```json
{
  "exam": {
    "id": 9,
    "title": "امتحان الكورس الشامل",
    "durationMinutes": 120,
    "questionsCount": 5
  },
  "questions": [
    {
      "id": 101,
      "type": "TEXT",
      "questionText": "ما هي عاصمة مصر؟",
      "questionImage": null,
      "optionA": "القاهرة",
      "optionB": "الإسكندرية",
      "optionC": "الجيزة",
      "optionD": "أسوان",
      "correctAnswer": "A"
    },
    {
      "id": 102,
      "type": "IMAGE",
      "questionText": null,
      "questionImage": "https://example.com/question-image.jpg",
      "optionA": "الخيار الأول",
      "optionB": "الخيار الثاني",
      "optionC": "الخيار الثالث",
      "optionD": "الخيار الرابع",
      "correctAnswer": "B"
    }
  ]
}
```

**Response Fields:**

**exam:**
- `id` (number): معرف الامتحان
- `title` (string): عنوان الامتحان
- `durationMinutes` (number): مدة الامتحان بالدقائق
- `questionsCount` (number): عدد الأسئلة في الامتحان

**questions (array):**
- `id` (number): معرف السؤال
- `type` (string): نوع السؤال (`TEXT` أو `IMAGE`)
- `questionText` (string | null): نص السؤال (للسؤال النصي)
- `questionImage` (string | null): رابط صورة السؤال (للسؤال المصور)
- `optionA` (string): الخيار الأول
- `optionB` (string): الخيار الثاني
- `optionC` (string): الخيار الثالث
- `optionD` (string): الخيار الرابع
- `correctAnswer` (string): الإجابة الصحيحة (`A`, `B`, `C`, أو `D`)

### Response (Error - 400)
```json
{
  "message": "Invalid exam id"
}
```

### Response (Error - 403)
```json
{
  "message": "You are not allowed to view questions for this exam"
}
```

### Response (Error - 404)
```json
{
  "message": "Exam not found"
}
```

### Response (Error - 500)
```json
{
  "message": "Failed to fetch exam questions"
}
```

### مثال على الاستخدام

#### cURL
```bash
curl -X GET "http://localhost:8000/api/course/course-exam/9/questions" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

#### JavaScript (Fetch)
```javascript
const response = await fetch('http://localhost:8000/api/course/course-exam/9/questions', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data = await response.json();
console.log(data);
```

#### JavaScript (Axios)
```javascript
const axios = require('axios');

const response = await axios.get(
  'http://localhost:8000/api/course/course-exam/9/questions',
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN'
    }
  }
);

console.log(response.data);
```

---

## 3. ملاحظات مهمة

### أنواع الأسئلة المدعومة
- **TEXT**: أسئلة نصية تحتاج إلى `questionText` (مطلوب)
- **IMAGE**: أسئلة مصورة تحتاج إلى `questionImage` (مطلوب)

### بنك الأسئلة
- يدعم النظام بنكين للأسئلة:
  - **V2 (New Question Bank)**: `questions_v2` - الأسئلة المعتمدة فقط (`status = 'approved'`)
  - **V1 (Legacy Question Bank)**: `questions` - الأسئلة القديمة

### الصلاحيات
- فقط المدرس صاحب الكورس يمكنه إضافة الأسئلة وعرضها
- يجب أن يكون المستخدم مصادق عليه وله صلاحية `teacher`

### معالجة الأخطاء
- إذا فشل إضافة سؤال واحد، يتم تخطيه والمتابعة مع باقي الأسئلة
- يتم تحديث `questions_count` تلقائياً بعد إضافة الأسئلة

---

## 4. سيناريو كامل

### الخطوة 1: إضافة أسئلة من بنك الأسئلة
```javascript
// إضافة 5 أسئلة من بنك الأسئلة
const addResponse = await fetch('http://localhost:8000/api/exams/course-level/9/questions/from-bank', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    questionIds: [1, 2, 3, 4, 5]
  })
});

const addData = await addResponse.json();
console.log(`تم إضافة ${addData.count} سؤال بنجاح`);
```

### الخطوة 2: عرض الأسئلة المضافة
```javascript
// عرض جميع أسئلة الامتحان
const getResponse = await fetch('http://localhost:8000/api/course/course-exam/9/questions', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const getData = await getResponse.json();
console.log(`الامتحان يحتوي على ${getData.exam.questionsCount} سؤال`);
console.log('الأسئلة:', getData.questions);
```

---

## 5. استكشاف الأخطاء

### المشكلة: الأسئلة لا تظهر بعد الإضافة
**الحل:**
1. تحقق من أن `examId` صحيح في كل الطلبات
2. تحقق من أن المدرس صاحب الكورس
3. تحقق من الـ console logs للبحث عن أخطاء

### المشكلة: خطأ 403 Forbidden
**الحل:**
- تأكد من أن المستخدم هو صاحب الكورس
- تأكد من أن الـ token صحيح وصالح

### المشكلة: خطأ 404 Exam not found
**الحل:**
- تحقق من أن `examId` موجود في قاعدة البيانات
- تحقق من أن الامتحان من نوع `course_level_exams`

### المشكلة: خطأ 500 Internal Server Error
**الحل:**
- تحقق من الـ console logs للبحث عن تفاصيل الخطأ
- تأكد من أن الأسئلة في بنك الأسئلة موجودة وصالحة
- تأكد من أن الأسئلة تلبي الـ constraints (TEXT يحتاج questionText، IMAGE يحتاج questionImage)

---

## 6. روابط مفيدة

- [Course Level Exams API](./course-level-exams.md)
- [Question Bank API](./question-bank.md)
- [Authentication Guide](./authentication.md)
