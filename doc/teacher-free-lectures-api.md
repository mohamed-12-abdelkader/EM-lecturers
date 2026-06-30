# API المحاضرات المجانية — مرجع مختصر

> للتوثيق الكامل (الهيكل، قاعدة البيانات، تدفقات Frontend):  
> راجع [`teacher-free-lectures-system.md`](./teacher-free-lectures-system.md)

---

## المسارات

| Method | Path | Auth |
|--------|------|------|
| GET | `/api/public/platform/:subdomain/free-lectures` | ❌ |
| GET | `/api/public/platform/:subdomain/courses` | ❌ |
| GET | `/api/tenants/public/:subdomain/free-lectures` | ❌ |
| GET | `/api/tenants/public/:subdomain/courses` | ❌ |
| GET | `/api/public/free-lectures` | ❌ |
| GET | `/api/public/free-lectures/:id` | ❌ |
| POST | `/api/teacher/free-lectures` | teacher |
| GET | `/api/teacher/free-lectures` | teacher |
| GET | `/api/teacher/free-lectures/:id` | teacher |
| PUT | `/api/teacher/free-lectures/:id` | teacher |
| DELETE | `/api/teacher/free-lectures/:id` | teacher |

---

## إنشاء محاضرة

```http
POST /api/teacher/free-lectures
Content-Type: multipart/form-data
Authorization: Bearer {token}

title=اسم المحاضرة
link=https://youtube.com/...
image=@cover.jpg          (اختياري)
is_published=true         (اختياري، افتراضي true)
```

---

## Public — حسب subdomain المنصة

```http
GET /api/public/platform/ahmed/free-lectures
GET /api/public/platform/ahmed/courses
GET /api/public/platform/ahmed/courses?grade_id=3
```

```json
{
  "success": true,
  "data": {
    "platform": {
      "subdomain": "ahmed",
      "display_name": "منصة أحمد",
      "teacher_id": 5,
      "teacher_name": "أ. أحمد",
      "teacher_avatar": "https://..."
    },
    "lectures": []
  }
}
```

---

## Public — قائمة المحاضرات (كل المنصات)

```http
GET /api/public/free-lectures
GET /api/public/free-lectures?teacher_id=5
```

```json
{
  "success": true,
  "lectures": [
    {
      "id": 1,
      "title": "...",
      "link": "https://...",
      "image_url": "https://...",
      "teacher_id": 5,
      "teacher_name": "أ. محمد",
      "teacher_avatar": "https://..."
    }
  ]
}
```
