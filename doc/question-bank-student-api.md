# APIs بنك الأسئلة للطلاب

## نظرة عامة

APIs للوصول إلى محتوى بنك الأسئلة حسب صف الطالب.

**المسار:** `/api/question-banks/student/*`

**الهيكل:**

```
مواد → كتب → فصول → دروس → أسئلة
```

## المتطلبات

- دور `student`
- `grade_id` محدد للطالب
- بنك أسئلة مرتبط بالصف

**Headers:** `Authorization: Bearer <student_token>`

---

## 1. جلب المواد

**`GET /api/question-banks/student/subjects`**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "الرياضيات",
      "description": "...",
      "image_url": "https://...",
      "color": "#FF6B6B",
      "books_count": 2,
      "chapters_count": 5,
      "lessons_count": 25,
      "questions_count": 150
    }
  ]
}
```

---

## 2. جلب كتب المادة (جديد)

**`GET /api/question-banks/student/subjects/:subjectId/books`**

```json
{
  "success": true,
  "data": [
    {
      "id": 3,
      "name": "كتاب الامتحان",
      "description": "...",
      "image_url": null,
      "order_num": 1,
      "chapters_count": 3,
      "lessons_count": 12,
      "questions_count": 80
    },
    {
      "id": 4,
      "name": "كتاب نيوتن",
      "order_num": 2,
      "chapters_count": 2,
      "lessons_count": 8,
      "questions_count": 40
    }
  ]
}
```

---

## 3. جلب فصول الكتاب (جديد — المفضّل)

**`GET /api/question-banks/student/books/:bookId/chapters`**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "الفصل الأول",
      "description": "...",
      "image_url": null,
      "lessons_count": 4,
      "questions_count": 20
    }
  ]
}
```

---

## 4. جلب كل فصول المادة (Legacy)

**`GET /api/question-banks/student/subjects/:subjectId/chapters`**

يعرض فصول **جميع الكتب** في المادة كقائمة مسطّحة (بدون تجميع حسب الكتاب).

---

## 5. جلب دروس الفصل

**`GET /api/question-banks/student/chapters/:chapterId/lessons`**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "المعادلات الخطية",
      "description": "...",
      "image_url": null,
      "order_num": 1,
      "questions_count": 15
    }
  ]
}
```

---

## 6. جلب أسئلة الدرس (للألعاب)

**`GET /api/question-banks/student/lessons/:lessonId/questions?count=10`**

- `count`: 1–50 (افتراضي 10)
- أسئلة عشوائية من جدول `questions`

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "text": "ما هو ناتج 2 + 2؟",
      "options": ["3", "4", "5", "6"],
      "correct_answer": "4",
      "difficulty_level": "easy",
      "points": 1
    }
  ]
}
```

---

## مسار التصفح الموصى به (Frontend)

```
GET /student/subjects
  → GET /student/subjects/:id/books
    → GET /student/books/:bookId/chapters
      → GET /student/chapters/:chapterId/lessons
        → GET /student/lessons/:lessonId/questions
```

---

## رسائل الخطأ الشائعة

| Code | Message |
|------|---------|
| 400 | `Student grade not assigned` |
| 400 | `Invalid subject ID` / `Invalid book ID` |
| 404 | `Subject not found or not accessible` |
| 404 | `Book not found or not accessible` |
| 403 | `Forbidden: insufficient role` |

---

## أمثلة cURL

```bash
# المواد
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8000/api/question-banks/student/subjects

# كتب المادة
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8000/api/question-banks/student/subjects/1/books

# فصول الكتاب
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8000/api/question-banks/student/books/3/chapters
```

---

## ملاحظات

1. الطالب يرى فقط محتوى بنك أسئلة **صفه**
2. `books_count` جديد في قائمة المواد
3. للواجهات الجديدة: تصفّح عبر **الكتب** وليس الفصول مباشرة من المادة
4. مسار `/subjects/:id/chapters` ما زال يعمل للتوافق
