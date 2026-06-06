# 📚 توثيق API المساعد العلمي (Scientific Chatbot API)

## نظرة عامة

يوفر API المساعد العلمي نظام إجابة على الأسئلة مدعوم بالذكاء الاصطناعي للكورسات. يمكن للمدرسين رفع ملفات محتوى الكورس (نص، markdown)، والتي يتم معالجتها وتخزينها كـ vector embeddings. يمكن للطلاب بعد ذلك طرح أسئلة حول محتوى الكورس والحصول على إجابات مدعومة بالذكاء الاصطناعي بناءً على المواد المرفوعة.

النظام يستخدم:
- **Vector embeddings** للبحث الدلالي
- **Milvus** لتخزين المتجهات والبحث عن التشابه
- **Text chunking** للمعالجة الفعالة
- **RAG (Retrieval-Augmented Generation)** للحصول على إجابات دقيقة

---

## Base URL

```
http://localhost:8000/api/scientific-chatbot
```

جميع الـ endpoints تتطلب مصادقة باستخدام Bearer token في Authorization header.

---

## 🔐 المصادقة

جميع الـ endpoints تتطلب مصادقة. قم بتضمين Bearer token في Authorization header:

```
Authorization: Bearer <your_token>
```

**الأدوار المطلوبة:**
- **Teacher/Admin**: يمكن رفع الملفات وإدارتها وإعادة تعيين الـ embeddings
- **Student**: يمكن طرح الأسئلة وعرض سجل المحادثة

---

## 👨‍🏫 APIs للمدرس/المدير

### 1. رفع ملف محتوى الكورس

قم برفع ملف نصي أو markdown يحتوي على محتوى الكورس. سيتم معالجة الملف وتقسيمه وتخزينه كـ vector embeddings.

**Endpoint**: `POST /api/scientific-chatbot/courses/:courseId/files`

**المصادقة**: Teacher أو Admin

**الطلب**:
- **Method**: `POST`
- **Content-Type**: `multipart/form-data`
- **Path Parameters**:
  - `courseId` (integer, required): معرف الكورس

**Form Data**:
- `file` (file, required): ملف محتوى الكورس
  - **الأنواع المسموحة**: `.txt`, `.md`, `.pdf`
  - **الحجم الأقصى**: 10MB
  - **MIME types**: `text/plain`, `text/markdown`, `application/pdf`

**Response (201 Created)**:
```json
{
  "message": "File uploaded and processed successfully",
  "file": {
    "id": 1,
    "course_id": 5,
    "teacher_id": 10,
    "file_name": "lecture-notes.txt",
    "file_path": "uploads/course-content/scientific-content-1234567890.txt",
    "file_size": 45678,
    "file_type": "text/plain",
    "content_text": "Course content text...",
    "uploaded_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

**Response (400 Bad Request)**:
```json
{
  "error": "No file uploaded"
}
```

**Response (403 Forbidden)**:
```json
{
  "error": "You do not have permission to upload files for this course"
}
```

**Response (404 Not Found)**:
```json
{
  "error": "Course not found"
}
```

**Response (500 Internal Server Error)**:
```json
{
  "error": "Error uploading file"
}
```

**مثال (cURL)**:
```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/files" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@lecture-notes.txt"
```

**مثال (JavaScript - Fetch)**:
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/files', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: formData
});

const data = await response.json();
console.log(data);
```

**مثال (JavaScript - Axios)**:
```javascript
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

const form = new FormData();
form.append('file', fs.createReadStream('lecture-notes.txt'));

const response = await axios.post(
  'http://localhost:8000/api/scientific-chatbot/courses/5/files',
  form,
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      ...form.getHeaders()
    }
  }
);

console.log(response.data);
```

---

### 2. عرض ملفات محتوى الكورس

الحصول على قائمة بجميع الملفات المرفوعة لكورس محدد.

**Endpoint**: `GET /api/scientific-chatbot/courses/:courseId/files`

**المصادقة**: Teacher أو Admin

**الطلب**:
- **Method**: `GET`
- **Path Parameters**:
  - `courseId` (integer, required): معرف الكورس

**Response (200 OK)**:
```json
{
  "files": [
    {
      "id": 1,
      "course_id": 5,
      "teacher_id": 10,
      "file_name": "lecture-notes.txt",
      "file_path": "uploads/course-content/scientific-content-1234567890.txt",
      "file_size": 45678,
      "file_type": "text/plain",
      "content_text": "Course content text...",
      "uploaded_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:00:00Z"
    },
    {
      "id": 2,
      "course_id": 5,
      "teacher_id": 10,
      "file_name": "chapter-2.md",
      "file_path": "uploads/course-content/scientific-content-1234567891.md",
      "file_size": 23456,
      "file_type": "text/markdown",
      "content_text": "# Chapter 2\n\nContent...",
      "uploaded_at": "2024-01-16T14:30:00Z",
      "updated_at": "2024-01-16T14:30:00Z"
    }
  ]
}
```

**Response (403 Forbidden)**:
```json
{
  "error": "You do not have permission to view files for this course"
}
```

**Response (404 Not Found)**:
```json
{
  "error": "Course not found"
}
```

**مثال (cURL)**:
```bash
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/files" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**مثال (JavaScript - Fetch)**:
```javascript
const response = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/files', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data = await response.json();
console.log(data.files);
```

---

### 3. حذف ملف محتوى الكورس

حذف ملف محتوى الكورس والـ embeddings المرتبطة به.

**Endpoint**: `DELETE /api/scientific-chatbot/files/:fileId`

**المصادقة**: Teacher أو Admin

**الطلب**:
- **Method**: `DELETE`
- **Path Parameters**:
  - `fileId` (integer, required): معرف الملف المراد حذفه

**Response (200 OK)**:
```json
{
  "message": "File deleted successfully"
}
```

**Response (403 Forbidden)**:
```json
{
  "error": "You do not have permission to delete this file"
}
```

**Response (404 Not Found)**:
```json
{
  "error": "File not found"
}
```

**مثال (cURL)**:
```bash
curl -X DELETE "http://localhost:8000/api/scientific-chatbot/files/1" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**مثال (JavaScript - Fetch)**:
```javascript
const response = await fetch('http://localhost:8000/api/scientific-chatbot/files/1', {
  method: 'DELETE',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data = await response.json();
console.log(data);
```

---

### 4. إعادة تعيين الـ Embeddings للكورس

حذف جميع الـ embeddings للكورس وإعادة توليدها من الملفات المرفوعة. مفيد عندما تريد إعادة معالجة جميع المحتويات.

**Endpoint**: `POST /api/scientific-chatbot/courses/:courseId/reset-embeddings`

**المصادقة**: Teacher أو Admin

**الطلب**:
- **Method**: `POST`
- **Path Parameters**:
  - `courseId` (integer, required): معرف الكورس

**Response (200 OK)**:
```json
{
  "message": "Embeddings reset successfully"
}
```

**Response (403 Forbidden)**:
```json
{
  "error": "You do not have permission to reset embeddings for this course"
}
```

**Response (404 Not Found)**:
```json
{
  "error": "Course not found"
}
```

**مثال (cURL)**:
```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/reset-embeddings" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**مثال (JavaScript - Fetch)**:
```javascript
const response = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/reset-embeddings', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data = await response.json();
console.log(data);
```

---

## 👨‍🎓 APIs للطالب

### 5. طرح سؤال

اطرح سؤالاً حول محتوى الكورس. سيبحث النظام عن أجزاء المحتوى ذات الصلة ويولد إجابة.

**Endpoint**: `POST /api/scientific-chatbot/courses/:courseId/ask`

**المصادقة**: Student

**الطلب**:
- **Method**: `POST`
- **Content-Type**: `application/json`
- **Path Parameters**:
  - `courseId` (integer, required): معرف الكورس

**Request Body**:
```json
{
  "question": "What is the main topic of chapter 2?"
}
```

**حقول Request Body**:
- `question` (string, required): السؤال المراد طرحه حول محتوى الكورس
  - يجب أن يكون نصاً غير فارغ
  - سيتم إزالة المسافات الزائدة

**Response (200 OK)**:
```json
{
  "answer": "Chapter 2 covers the fundamentals of quantum mechanics, including wave-particle duality and the uncertainty principle...",
  "retrieved_chunks": [
    {
      "id": "123",
      "content": "Chapter 2: Quantum Mechanics Fundamentals\n\nWave-particle duality is a fundamental concept...",
      "file_id": 1,
      "chunk_index": 5,
      "similarity_score": 0.89
    },
    {
      "id": "124",
      "content": "The uncertainty principle, formulated by Heisenberg, states that...",
      "file_id": 1,
      "chunk_index": 6,
      "similarity_score": 0.85
    }
  ]
}
```

**حقول Response**:
- `answer` (string): الإجابة المولدة بالذكاء الاصطناعي للسؤال
- `retrieved_chunks` (array): مصفوفة أجزاء المحتوى ذات الصلة المستخدمة لتوليد الإجابة
  - `id` (string): معرف فريد للجزء
  - `content` (string): المحتوى النصي للجزء
  - `file_id` (number): معرف الملف المصدر
  - `chunk_index` (number): فهرس الجزء داخل الملف
  - `similarity_score` (number): درجة التشابه (0-1) تشير إلى الصلة

**Response (400 Bad Request)**:
```json
{
  "error": "Question is required"
}
```

**Response (404 Not Found)**:
```json
{
  "error": "This course does not have uploaded content yet. Please ask your teacher to upload course materials."
}
```

**Response (500 Internal Server Error)**:
```json
{
  "error": "Error answering question"
}
```

**مثال (cURL)**:
```bash
curl -X POST "http://localhost:8000/api/scientific-chatbot/courses/5/ask" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What is the main topic of chapter 2?"
  }'
```

**مثال (JavaScript - Fetch)**:
```javascript
const response = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/ask', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: 'What is the main topic of chapter 2?'
  })
});

const data = await response.json();
console.log('Answer:', data.answer);
console.log('Retrieved chunks:', data.retrieved_chunks);
```

**مثال (JavaScript - Axios)**:
```javascript
const axios = require('axios');

const response = await axios.post(
  'http://localhost:8000/api/scientific-chatbot/courses/5/ask',
  {
    question: 'What is the main topic of chapter 2?'
  },
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json'
    }
  }
);

console.log('Answer:', response.data.answer);
console.log('Retrieved chunks:', response.data.retrieved_chunks);
```

---

### 6. الحصول على سجل المحادثة

استرجاع سجل المحادثة (الأسئلة والإجابات) لكورس محدد.

**Endpoint**: `GET /api/scientific-chatbot/courses/:courseId/history`

**المصادقة**: Student

**الطلب**:
- **Method**: `GET`
- **Path Parameters**:
  - `courseId` (integer, required): معرف الكورس

**Query Parameters**:
- `limit` (integer, optional, default: 50): الحد الأقصى لعدد الرسائل المراد استرجاعها
- `beforeId` (integer, optional): استرجاع الرسائل قبل معرف الرسالة هذا (للـ pagination)

**Response (200 OK)**:
```json
{
  "history": [
    {
      "id": 10,
      "student_id": 5,
      "course_id": 5,
      "question": "What is the main topic of chapter 2?",
      "rewritten_question": "What is the main topic of chapter 2?",
      "answer": "Chapter 2 covers the fundamentals of quantum mechanics...",
      "retrieved_chunks": [
        {
          "id": "123",
          "content": "Chapter 2: Quantum Mechanics Fundamentals...",
          "file_id": 1,
          "chunk_index": 5,
          "similarity_score": 0.89
        }
      ],
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": 9,
      "student_id": 5,
      "course_id": 5,
      "question": "Explain wave-particle duality",
      "rewritten_question": "Explain wave-particle duality",
      "answer": "Wave-particle duality is a fundamental concept in quantum mechanics...",
      "retrieved_chunks": [
        {
          "id": "124",
          "content": "Wave-particle duality is a fundamental concept...",
          "file_id": 1,
          "chunk_index": 6,
          "similarity_score": 0.92
        }
      ],
      "created_at": "2024-01-15T09:15:00Z"
    }
  ]
}
```

**حقول Response**:
- `history` (array): مصفوفة رسائل المحادثة، مرتبة من الأحدث إلى الأقدم
  - `id` (number): معرف الرسالة الفريد
  - `student_id` (number): معرف الطالب الذي طرح السؤال
  - `course_id` (number): معرف الكورس
  - `question` (string): السؤال الأصلي
  - `rewritten_question` (string | null): النسخة المعاد كتابتها/المحسنة من السؤال (إن وجدت)
  - `answer` (string): الإجابة المولدة بالذكاء الاصطناعي
  - `retrieved_chunks` (array): مصفوفة أجزاء المحتوى ذات الصلة المستخدمة
  - `created_at` (string): طابع زمني ISO 8601 لوقت إنشاء الرسالة

**Response (500 Internal Server Error)**:
```json
{
  "error": "Error getting chat history"
}
```

**مثال (cURL)**:
```bash
# الحصول على آخر 50 رسالة
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/history" \
  -H "Authorization: Bearer YOUR_TOKEN"

# الحصول على آخر 20 رسالة
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/history?limit=20" \
  -H "Authorization: Bearer YOUR_TOKEN"

# الحصول على الرسائل قبل معرف الرسالة 10 (pagination)
curl -X GET "http://localhost:8000/api/scientific-chatbot/courses/5/history?limit=20&beforeId=10" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

**مثال (JavaScript - Fetch)**:
```javascript
// الحصول على آخر 50 رسالة
const response = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/history', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data = await response.json();
console.log('Chat history:', data.history);

// الحصول على آخر 20 رسالة مع pagination
const response2 = await fetch('http://localhost:8000/api/scientific-chatbot/courses/5/history?limit=20&beforeId=10', {
  method: 'GET',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN'
  }
});

const data2 = await response2.json();
console.log('More history:', data2.history);
```

---

## ⚠️ استجابات الأخطاء

جميع الـ endpoints قد ترجع استجابات الأخطاء التالية:

### 400 Bad Request
```json
{
  "error": "Error message describing what went wrong"
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```

### 403 Forbidden
```json
{
  "error": "You do not have permission to perform this action"
}
```

### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

### 500 Internal Server Error
```json
{
  "error": "Error message describing the server error"
}
```

---

## 🔧 التفاصيل التقنية

### معالجة الملفات

1. **رفع الملف**: يتم رفع الملفات عبر multipart/form-data
2. **استخراج النص**: يتم استخراج المحتوى من الملف
3. **التقسيم**: يتم تقسيم النص إلى أجزاء (افتراضي: 500 حرف مع تداخل 15%)
4. **توليد الـ Embedding**: يتم تحويل كل جزء إلى vector embedding
5. **التخزين**: يتم تخزين الـ embeddings في قاعدة بيانات Milvus

### عملية الإجابة على الأسئلة

1. **معالجة السؤال**: يتم استقبال سؤال الطالب
2. **إعادة كتابة السؤال** (اختياري): قد يتم إعادة كتابة السؤال للبحث الأفضل
3. **توليد الـ Embedding**: يتم تحويل السؤال إلى vector embedding
4. **البحث عن التشابه**: يبحث Milvus عن أجزاء المحتوى المشابهة
5. **استرجاع السياق**: يتم استرجاع أهم الأجزاء ذات الصلة
6. **توليد الإجابة**: يولد نموذج ذكاء اصطناعي إجابة بناءً على السياق المسترجع
7. **الاستجابة**: يتم إرجاع الإجابة والأجزاء المسترجعة للطالب

### قاعدة بيانات المتجهات

- **اسم المجموعة**: `course_content_vectors`
- **البعد**: يتم تحديده بواسطة نموذج الـ embedding (عادة 384 أو 768)
- **نوع المقياس**: Inner Product (IP)
- **مستوى الاتساق**: Bounded

### استراتيجية التقسيم

- **حجم الجزء**: 500 حرف
- **تداخل الأجزاء**: 15% (75 حرف)
- **الغرض**: يضمن الحفاظ على السياق عبر حدود الأجزاء

---

## 💡 أفضل الممارسات

### للمدرسين

1. **تنسيق الملف**: استخدم ملفات نصية عادية (`.txt`) أو Markdown (`.md`) للحصول على أفضل النتائج
2. **حجم الملف**: حافظ على الملفات أقل من 10MB للمعالجة المثلى
3. **جودة المحتوى**: تأكد من أن المحتوى المرفوع منظم جيداً وذو صلة
4. **ملفات متعددة**: ارفع عدة ملفات صغيرة بدلاً من ملف كبير واحد لتنظيم أفضل
5. **إعادة تعيين الـ Embeddings**: استخدم endpoint إعادة تعيين الـ embeddings إذا قمت بتحديث محتوى الكورس

### للطلاب

1. **أسئلة واضحة**: اطرح أسئلة محددة وواضحة للحصول على إجابات أفضل
2. **السياق**: أشر إلى فصول أو مواضيع محددة عند الإمكان
3. **المتابعة**: استخدم سجل المحادثة لطرح أسئلة متابعة
4. **مراجعة الأجزاء**: راجع الأجزاء المسترجعة لفهم مصدر الإجابة

---

## ⚙️ القيود

1. **أنواع الملفات**: يدعم حالياً ملفات `.txt` و `.md` و `.pdf` (دعم PDF قد يكون محدوداً)
2. **حجم الملف**: الحد الأقصى لحجم الملف هو 10MB
3. **اللغة**: محسّن لمحتوى العربية والإنجليزية
4. **اعتماد Milvus**: يتطلب تكوين Milvus وتشغيله
5. **نموذج الـ Embedding**: يعتمد على خدمة الـ embedding المكونة

---

## 🐛 استكشاف الأخطاء

### المشكلة: "This course does not have uploaded content yet"

**الحل**: يحتاج المدرس إلى رفع ملفات محتوى الكورس أولاً باستخدام endpoint الرفع.

### المشكلة: "Error uploading file"

**الأسباب المحتملة**:
- حجم الملف يتجاوز 10MB
- نوع الملف غير مدعوم
- Milvus غير مكون أو غير قيد التشغيل
- خدمة الـ embedding غير متاحة

**الحل**: 
- تحقق من حجم الملف ونوعه
- تحقق من تكوين Milvus
- راجع سجلات الخادم للحصول على رسائل الخطأ التفصيلية

### المشكلة: الإجابات غير دقيقة

**الأسباب المحتملة**:
- محتوى الكورس غير شامل
- السؤال غامض جداً
- تحتاج الـ embeddings إلى إعادة توليد

**الحل**:
- تأكد من أن محتوى الكورس كامل ومنظم جيداً
- اطرح أسئلة أكثر تحديداً
- جرب إعادة تعيين الـ embeddings باستخدام endpoint الإعادة

---

## 📚 التوثيق ذو الصلة

- [Milvus Service Documentation](./milvus-service.md)
- [Embedding Service Documentation](./embedding-service.md)
- [Authentication Guide](./authentication.md)
- [Course API Documentation](./courses-api.md)

---

## 🆘 الدعم

للأسئلة أو المشاكل، يرجى الاتصال بفريق التطوير أو مراجعة سجلات الخادم للحصول على رسائل الخطأ التفصيلية.

---

**آخر تحديث:** 2024-01-15
