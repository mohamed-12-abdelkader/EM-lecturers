# APIs بنك الأسئلة للطلاب

## نظرة عامة
APIs تسمح للطلاب بالوصول إلى المواد والفصول والدروس الموجودة في بنك الأسئلة الخاص بصفهم، بالإضافة إلى جلب الأسئلة للاستخدام في الألعاب.

## المتطلبات
- يجب أن يكون المستخدم مسجل كطالب (`role = 'student'`)
- يجب أن يكون للطالب صف محدد (`grade_id`)
- يجب أن يكون هناك بنك أسئلة مرتبط بصف الطالب

## APIs

### 1. جلب المواد الموجودة في بنك الأسئلة

**Endpoint:** `GET /api/question-banks/student/subjects`

**الوصف:** يعرض جميع المواد الموجودة في بنك الأسئلة الخاص بصف الطالب.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "الرياضيات",
      "description": "مادة الرياضيات للصف الأول الثانوي",
      "image_url": "https://example.com/math.jpg",
      "color": "#FF6B6B",
      "chapters_count": 5,
      "lessons_count": 25,
      "questions_count": 150
    },
    {
      "id": 2,
      "name": "الفيزياء",
      "description": "مادة الفيزياء للصف الأول الثانوي",
      "image_url": "https://example.com/physics.jpg",
      "color": "#4ECDC4",
      "chapters_count": 4,
      "lessons_count": 20,
      "questions_count": 120
    }
  ]
}
```

### 2. جلب الفصول الموجودة في مادة معينة

**Endpoint:** `GET /api/question-banks/student/subjects/:subjectId/chapters`

**الوصف:** يعرض جميع الفصول الموجودة في مادة معينة.

**Parameters:**
- `subjectId` (number): معرف المادة

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "الجبر",
      "description": "فصل الجبر في الرياضيات",
      "image_url": "https://example.com/algebra.jpg",
      "lessons_count": 8,
      "questions_count": 60
    },
    {
      "id": 2,
      "name": "الهندسة",
      "description": "فصل الهندسة في الرياضيات",
      "image_url": "https://example.com/geometry.jpg",
      "lessons_count": 7,
      "questions_count": 50
    }
  ]
}
```

### 3. جلب الدروس الموجودة في فصل معين

**Endpoint:** `GET /api/question-banks/student/chapters/:chapterId/lessons`

**الوصف:** يعرض جميع الدروس الموجودة في فصل معين.

**Parameters:**
- `chapterId` (number): معرف الفصل

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "المعادلات الخطية",
      "description": "درس المعادلات الخطية",
      "image_url": "https://example.com/linear-equations.jpg",
      "order_num": 1,
      "questions_count": 15
    },
    {
      "id": 2,
      "name": "المعادلات التربيعية",
      "description": "درس المعادلات التربيعية",
      "image_url": "https://example.com/quadratic-equations.jpg",
      "order_num": 2,
      "questions_count": 20
    }
  ]
}
```

### 4. جلب الأسئلة من درس معين

**Endpoint:** `GET /api/question-banks/student/lessons/:lessonId/questions`

**الوصف:** يعرض أسئلة عشوائية من درس معين للاستخدام في الألعاب.

**Parameters:**
- `lessonId` (number): معرف الدرس

**Query Parameters:**
- `count` (number, optional): عدد الأسئلة المطلوبة (افتراضي: 10، الحد الأقصى: 50)

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "text": "ما هو ناتج 2 + 2؟",
      "options": ["3", "4", "5", "6"],
      "image": null,
      "correct_answer": "4",
      "difficulty_level": "easy",
      "points": 1
    },
    {
      "id": 2,
      "text": null,
      "options": ["أ", "ب", "ج", "د"],
      "image": "https://example.com/question-image.jpg",
      "correct_answer": "ب",
      "difficulty_level": "medium",
      "points": 2
    }
  ]
}
```

## رسائل الخطأ

### 404 - Not Found
```json
{
  "message": "Student not found"
}
```

### 400 - Bad Request
```json
{
  "message": "Student grade not assigned"
}
```

```json
{
  "message": "Invalid subject ID"
}
```

```json
{
  "message": "Subject not found or not accessible"
}
```

### 403 - Forbidden
```json
{
  "message": "Forbidden: insufficient role"
}
```

## ملاحظات مهمة

1. **الأمان:** جميع الـ APIs تتطلب توكن طالب صالح
2. **الوصول:** الطالب يمكنه الوصول فقط للمواد الموجودة في بنك الأسئلة الخاص بصفه
3. **الأسئلة:** الأسئلة تُرجع عشوائياً لضمان التنوع في الألعاب
4. **الحدود:** عدد الأسئلة محدود بين 1 و 50 سؤال
5. **العد:** جميع العدود تُرجع كأرقام صحيحة

## أمثلة الاستخدام

### جلب جميع المواد
```bash
curl -X GET "http://localhost:8000/api/question-banks/student/subjects" \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN"
```

### جلب فصول مادة معينة
```bash
curl -X GET "http://localhost:8000/api/question-banks/student/subjects/1/chapters" \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN"
```

### جلب أسئلة للعبة
```bash
curl -X GET "http://localhost:8000/api/question-banks/student/lessons/1/questions?count=15" \
  -H "Authorization: Bearer YOUR_STUDENT_TOKEN"
```















