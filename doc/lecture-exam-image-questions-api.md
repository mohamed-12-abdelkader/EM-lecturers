# API أسئلة امتحان المحاضرة بالصور

## نظرة عامة

تم إنشاء مجموعة من الـ APIs الخاصة بإدارة أسئلة امتحان المحاضرة التي تحتوي على صور. تدعم هذه الـ APIs إضافة أسئلة بالصور، تحديد الإجابة الصحيحة، جلب تفاصيل الامتحان، وحذف الأسئلة.

## المميزات الرئيسية

- ✅ **إضافة أسئلة بالصور** - رفع عدة صور دفعة واحدة (حتى 10 صور)
- ✅ **تحديد الإجابة الصحيحة** - تحديد أي اختيار كإجابة صحيحة
- ✅ **جلب تفاصيل الامتحان** - عرض الأسئلة النصية والصورية معاً
- ✅ **حذف الأسئلة** - حذف الأسئلة بالصور
- ✅ **دعم multipart/form-data** - رفع الصور بسهولة

---

## APIs إدارة الأسئلة بالصور

جميع المسارات تتطلب مصادقة المدرس أو Admin وتبدأ بـ:
```
/api/questions/lecture-exam-question
```

---

### 1. إضافة أسئلة بالصور

**POST** `/api/questions/lecture-exam-question/`

**الوصف:** إضافة مجموعة من الأسئلة التي تأتي كصور فقط (الصورة تحتوي على نص السؤال والاختيارات بداخلها).

**الصلاحيات:** مدرس أو admin

**Content-Type:** `multipart/form-data`

**البيانات المطلوبة:**
- `images`: ملفات الصور (مطلوب، حتى 10 صور)
- `exam_id`: معرف الامتحان (اختياري)

**مثال على الطلب:**
```bash
curl -X POST http://localhost:8000/api/questions/lecture-exam-question/ \
  -H "Authorization: Bearer <token>" \
  -F "exam_id=1" \
  -F "images=@question1.png" \
  -F "images=@question2.png" \
  -F "images=@question3.png"
```

**الاستجابة:**
```json
[
  {
    "id": 101,
    "image": "https://res.cloudinary.com/dkwx24lyh/image/upload/v1756862834/media/unique_filename_1.png",
    "choices": [
      { "id": 1, "label": "أ" },
      { "id": 2, "label": "ب" },
      { "id": 3, "label": "ج" },
      { "id": 4, "label": "د" }
    ]
  },
  {
    "id": 102,
    "image": "https://res.cloudinary.com/dkwx24lyh/image/upload/v1756862834/media/unique_filename_2.png",
    "choices": [
      { "id": 5, "label": "أ" },
      { "id": 6, "label": "ب" },
      { "id": 7, "label": "ج" },
      { "id": 8, "label": "د" }
    ]
  }
]
```

**ملاحظة:** يمكن إضافة الأسئلة بدون ربطها بامتحان محاضرة محدد، في هذه الحالة لا ترسل `exam_id` في الطلب.

---

### 2. تحديد الإجابة الصحيحة

**PATCH** `/api/questions/lecture-exam-question/<question_id>/answer`

**الوصف:** تحديد الإجابة الصحيحة لسؤال معين (سواء كان نصي أو بالصورة).

**الصلاحيات:** مدرس أو admin

**البيانات المطلوبة:**
```json
{
  "correct_answer": 1
}
```

**مثال على الطلب:**
```bash
curl -X PATCH http://localhost:8000/api/questions/lecture-exam-question/101/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"correct_answer": 1}'
```

**الاستجابة:**
```json
{
  "message": "تم تحديث الإجابة الصحيحة بنجاح"
}
```

---

### 3. جلب تفاصيل الامتحان

**GET** `/api/questions/lecture-exam/<exam_id>/details`

**الوصف:** جلب تفاصيل امتحان المحاضرة مع جميع الأسئلة (النصية والصورية).

**الصلاحيات:** مدرس أو admin أو student

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/lecture-exam/1/details \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "exam": {
    "id": 1,
    "title": "امتحان المحاضرة الأولى",
    "duration": 30,
    "total_grade": 100,
    "created_at": "2024-01-15T10:30:00.000Z",
    "lecture_id": 12
  },
  "questions": [
    {
      "id": 1,
      "type": "text",
      "text": "ما هي عاصمة مصر؟",
      "image": null,
      "grade": 1,
      "choices": [
        { "id": 1, "text": "الإسكندرية", "is_correct": false },
        { "id": 2, "text": "الجيزة", "is_correct": false },
        { "id": 3, "text": "الأقصر", "is_correct": false },
        { "id": 4, "text": "القاهرة", "is_correct": true }
      ]
    },
    {
      "id": 2,
      "type": "image",
      "text": null,
      "image": "https://res.cloudinary.com/dkwx24lyh/image/upload/v1756862834/media/q1.png",
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

---

### 4. حذف سؤال

**DELETE** `/api/questions/lecture-exam-question/<question_id>`

**الوصف:** حذف سؤال معين (سواء كان نصي أو بالصورة).

**الصلاحيات:** مدرس أو admin

**مثال على الطلب:**
```bash
curl -X DELETE http://localhost:8000/api/questions/lecture-exam-question/101 \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
```json
{
  "message": "تم حذف السؤال بنجاح"
}
```

---

### 5. جلب أسئلة امتحان محاضرة معين

**GET** `/api/questions/lecture-exam/<exam_id>/questions`

**الوصف:** جلب جميع أسئلة امتحان محاضرة معين مع اختياراتها.

**الصلاحيات:** مدرس أو admin أو student

**مثال على الطلب:**
```bash
curl -X GET http://localhost:8000/api/questions/lecture-exam/1/questions \
  -H "Authorization: Bearer <token>"
```

**الاستجابة:**
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
        { "id": 1, "text": "الإسكندرية", "is_correct": false },
        { "id": 2, "text": "الجيزة", "is_correct": false },
        { "id": 3, "text": "الأقصر", "is_correct": false },
        { "id": 4, "text": "القاهرة", "is_correct": true }
      ]
    },
    {
      "id": 2,
      "type": "image",
      "text": null,
      "image": "https://res.cloudinary.com/dkwx24lyh/image/upload/v1756862834/media/q1.png",
      "grade": 1,
      "choices": [
        { "id": 5, "text": "أ", "is_correct": false },
        { "id": 6, "text": "ب", "is_correct": true },
        { "id": 7, "text": "ج", "is_correct": false },
        { "id": 8, "text": "د", "is_correct": false }
      ]
    }
  ],
  "duration": 30
}
```

---

## أمثلة JavaScript

### إضافة أسئلة بالصور
```javascript
const addImageQuestions = async (examId, imageFiles) => {
  const formData = new FormData();
  formData.append('exam_id', examId);
  
  imageFiles.forEach(file => {
    formData.append('images', file);
  });

  const response = await fetch('/api/questions/lecture-exam-question/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  return await response.json();
};
```

### تحديد الإجابة الصحيحة
```javascript
const setCorrectAnswer = async (questionId, choiceId) => {
  const response = await fetch(`/api/questions/lecture-exam-question/${questionId}/answer`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      correct_answer: choiceId
    })
  });
  
  return await response.json();
};
```

### جلب تفاصيل الامتحان
```javascript
const getExamDetails = async (examId) => {
  const response = await fetch(`/api/questions/lecture-exam/${examId}/details`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};
```

### حذف سؤال
```javascript
const deleteQuestion = async (questionId) => {
  const response = await fetch(`/api/questions/lecture-exam-question/${questionId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  return await response.json();
};
```

---

## HTML Form Example

### نموذج إضافة أسئلة بالصور
```html
<form id="imageQuestionsForm" enctype="multipart/form-data">
  <div>
    <label for="examId">معرف الامتحان:</label>
    <input type="number" id="examId" name="exam_id" required>
  </div>
  
  <div>
    <label for="images">صور الأسئلة:</label>
    <input type="file" id="images" name="images" multiple accept="image/*" required>
    <small>يمكن رفع حتى 10 صور. الأنواع المسموحة: JPG, JPEG, PNG, GIF</small>
  </div>
  
  <button type="submit">إضافة الأسئلة</button>
</form>

<script>
document.getElementById('imageQuestionsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const examId = formData.get('exam_id');
  const images = document.getElementById('images').files;
  
  if (images.length === 0) {
    alert('يجب اختيار صورة واحدة على الأقل');
    return;
  }
  
  if (images.length > 10) {
    alert('يمكن رفع 10 صور كحد أقصى');
    return;
  }
  
  try {
    const response = await fetch('/api/questions/lecture-exam-question/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const result = await response.json();
    
    if (response.ok) {
      console.log('تم إضافة الأسئلة بنجاح:', result);
      alert(`تم إضافة ${result.length} سؤال بنجاح`);
    } else {
      console.error('خطأ في إضافة الأسئلة:', result);
      alert('خطأ في إضافة الأسئلة: ' + result.message);
    }
  } catch (error) {
    console.error('خطأ في الاتصال:', error);
    alert('خطأ في الاتصال بالخادم');
  }
});
</script>
```

---

## ملاحظات مهمة

### 1. أنواع الأسئلة المدعومة
- **أسئلة نصية**: تحتوي على `text` و `image = null`
- **أسئلة بالصور**: تحتوي على `image` و `text = null`

### 2. الاختيارات الافتراضية
- الأسئلة بالصور تُنشأ مع 4 اختيارات افتراضية: أ، ب، ج، د
- جميع الاختيارات تُحفظ كـ `is_correct = false` افتراضياً
- يمكن تحديد الإجابة الصحيحة لاحقاً باستخدام API تحديد الإجابة الصحيحة

### 3. رفع الصور
- الحد الأقصى: 10 صور في طلب واحد
- الأنواع المسموحة: JPG, JPEG, PNG, GIF
- الصور تُرفع فعلياً على Cloudinary
- الصور تُحفظ في مجلد `media` على Cloudinary
- الصور تُعرض عبر URL: `https://res.cloudinary.com/dkwx24lyh/image/upload/v1756862834/media/unique_filename`

### 4. الأمان
- جميع APIs تتطلب مصادقة
- يتم التحقق من صلاحيات المدرس أو Admin
- يتم التحقق من وجود الامتحان قبل ربط الأسئلة به

### 5. قاعدة البيانات
- الأسئلة تُحفظ في جدول `questions`
- الاختيارات تُحفظ في جدول `question_choices`
- ربط الأسئلة بالامتحان في جدول `exam_questions`

---

## أخطاء شائعة

### 400 - بيانات غير صحيحة
```json
{
  "message": "يجب رفع صورة واحدة على الأقل"
}
```

### 400 - عدد الصور يتجاوز الحد المسموح
```json
{
  "message": "يمكن رفع 10 صور كحد أقصى"
}
```

### 404 - سؤال غير موجود
```json
{
  "message": "السؤال غير موجود"
}
```

### 404 - امتحان غير موجود
```json
{
  "message": "امتحان المحاضرة غير موجود"
}
```

### 403 - غير مصرح
```json
{
  "message": "غير مسموح لك بحل هذا الامتحان"
}
```

---

## سير العمل الكامل

### 1. إنشاء امتحان محاضرة
```bash
curl -X POST http://localhost:8000/api/course/lecture/12/exam \
  -H "Authorization: Bearer <token>" \
  -F "title=امتحان المحاضرة الأولى" \
  -F "total_grade=100" \
  -F "duration=30"
```

### 2. إضافة أسئلة بالصور
```bash
curl -X POST http://localhost:8000/api/questions/lecture-exam-question/ \
  -H "Authorization: Bearer <token>" \
  -F "exam_id=1" \
  -F "images=@question1.png" \
  -F "images=@question2.png"
```

### 3. تحديد الإجابة الصحيحة
```bash
curl -X PATCH http://localhost:8000/api/questions/lecture-exam-question/101/answer \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"correct_answer": 1}'
```

### 4. جلب تفاصيل الامتحان
```bash
curl -X GET http://localhost:8000/api/questions/lecture-exam/1/details \
  -H "Authorization: Bearer <token>"
```

### 5. حذف سؤال
```bash
curl -X DELETE http://localhost:8000/api/questions/lecture-exam-question/101 \
  -H "Authorization: Bearer <token>"
```

---

## الفوائد

1. **المرونة**: دعم الأسئلة النصية والصورية في نفس النظام
2. **السهولة**: رفع عدة صور دفعة واحدة
3. **الوضوح**: الصور تساعد في فهم السؤال بشكل أفضل
4. **التوافق**: يعمل مع جميع أنواع الأسئلة
5. **الأمان**: تحقق من نوع وحجم الملفات
6. **التخزين**: الصور تُرفع فعلياً على Cloudinary
7. **الاستجابة**: إرجاع البيانات بالشكل المطلوب
