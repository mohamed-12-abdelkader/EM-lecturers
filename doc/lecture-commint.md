## نظام الكومنتات لمحاضرات الكورسات

يوفّر هذا النظام تعليقات متداخلة (رد على رد …إلخ) داخل محاضرات الكورس، مع بث لحظي (SSE) وإشعارات لصاحب التعليق عند وجود رد عليه.

### الصلاحيات والوصول
- **من يكتب ويقرأ؟** المدرس صاحب الكورس، والطلاب المشتركون في الكورس (وأيضاً admin).
- **التحقق:** يتم التحقق عبر التوكن في الهيدر Authorization: Bearer <token>.

## النقاط الرئيسية
- التعليقات محفوظة في جدول `lecture_comments` مع `parent_comment_id` لدعم التداخل.
- البث اللحظي عبر مسار SSE: كل تعليق جديد يولّد حدث `comment_created`.
- عند إنشاء رد على تعليق، يُرسل إشعار لصاحب التعليق بنوع `comment_reply`.

## المسارات (Endpoints)

### 1) إنشاء تعليق/رد
- **POST** `/api/course-content/lecture/:lectureId/comments`
- الهيدر: `Authorization: Bearer <token>`
- البودي (JSON):
```json
{
  "content": "نص التعليق",
  "parent_comment_id": 123
}
```
- ملاحظات:
  - `parent_comment_id` اختياري. إن أُرسل فهو رد على تعليق سابق.
  - التحقق يضمن أن المستخدم مدرس الكورس أو طالب مشترك.
- استجابة 201 (مثال):
```json
{
  "comment": {
    "id": 45,
    "lecture_id": 10,
    "course_id": 7,
    "user_id": 55,
    "parent_comment_id": 12,
    "content": "رد جديد",
    "created_at": "2025-01-01T10:00:00.000Z",
    "updated_at": "2025-01-01T10:00:00.000Z"
  }
}
```

مثال cURL:
```bash
curl -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"content":"تعليق جديد"}' \
  http://localhost:3000/api/course-content/lecture/10/comments
```

### 2) جلب التعليقات (بصيغة شجرية)
- **GET** `/api/course-content/lecture/:lectureId/comments`
- الهيدر: `Authorization: Bearer <token>`
- الاستجابة (مثال مبسّط):
```json
{
  "comments": [
    {
      "id": 12,
      "lecture_id": 10,
      "user_id": 55,
      "content": "تعليق رئيسي",
      "user_name": "Student A",
      "user_avatar": "https://...",
      "created_at": "...",
      "replies": [
        {
          "id": 45,
          "parent_comment_id": 12,
          "content": "رد",
          "user_name": "Teacher",
          "replies": []
        }
      ]
    }
  ]
}
```

### 3) البث اللحظي للتعليقات (SSE)
- **GET** `/api/course-content/lecture/:lectureId/comments/stream`
- الهيدر: `Authorization: Bearer <token>`
- عند الاتصال، سيتم استقبال أحداث بصيغة SSE. أمثلة:
  - حدث ترحيبي:
    ```
    event: welcome
    data: {"ok":true}

    ```
  - حدث تعليق جديد:
    ```
    data: {"type":"comment_created","comment":{...}}

    ```

اتصال عبر cURL:
```bash
curl -N \
  -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3000/api/course-content/lecture/10/comments/stream
```

ملاحظة: إن كنت تستخدم المتصفح، استخدم مكتبة تدعم SSE مع هيدرز (مثل fetch + ReadableStream أو مكتبات تدعم تعيين الهيدرز) لأن `EventSource` الأصلي لا يرسل Authorization.

## الإشعارات (Notifications)
- عند إنشاء رد على تعليق، يُرسل إشعار لصاحب التعليق بنوع `comment_reply`.
- تم دعم الحقل `comment_id` في جدول `notifications` لربط الإشعار بالتعليق.

مثال منطقي للإشعار:
```json
{
  "title": "رد جديد على تعليقك",
  "message": "المدرس قام بالرد على تعليقك",
  "type": "comment_reply",
  "lecture_id": 10,
  "course_id": 7,
  "comment_id": 45
}
```

## أخطاء شائعة
- 400: content مفقود أو parent_comment_id غير صحيح.
- 403: ليس لديك صلاحية (لست صاحب الكورس أو غير مشترك).
- 404: Lecture غير موجود.


