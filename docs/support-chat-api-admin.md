# شات الدعم الفني — APIs للأدمن (إشعارات الشات بوت)

البادئة: **`/api/support`**  
الهيدر: **`Authorization: Bearer <token>`** (توكن الأدمن)

---

## 1. إشعارات الرسائل (عدد غير المقروءة + قائمة)

### 1.1 عدد الرسائل غير المقروءة

```
GET /api/support/unread-count
```

**الصلاحية:** `admin`

عدد رسائل الطلاب غير المقروءة في شات الدعم (كل الشاتات).

**الاستجابة (200):**

```json
{
  "unread_count": 5
}
```

---

### 1.2 قائمة إشعارات الرسائل (رسائل الطلاب غير المقروءة)

```
GET /api/support/notifications
```

**الصلاحية:** `admin`

**Query (اختياري):**

| المعامل | النوع   | الوصف                |
|---------|--------|----------------------|
| limit   | number | عدد النتائج (افتراضي 20) |
| offset  | number | إزاحة الصفحة (افتراضي 0) |

**الاستجابة (200):**

```json
{
  "notifications": [
    {
      "message_id": 12,
      "chat_id": 3,
      "sender_id": 10,
      "sender_role": "student",
      "sender_name": "أحمد الطالب",
      "sender_email": "student@example.com",
      "message_type": "text",
      "text": "الامتحان لا يفتح عندي",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": false,
      "chat_status": "bot_handling",
      "student_id": 10,
      "admin_id": null,
      "is_unread": true,
      "created_at": "2025-02-06T14:00:00.000Z"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**شكل عنصر من `notifications`:**

| الحقل          | النوع   | الوصف                          |
|----------------|---------|---------------------------------|
| message_id     | number  | معرف الرسالة                   |
| chat_id        | number  | معرف الشات                     |
| sender_id      | number  | معرف الطالب المرسل             |
| sender_role    | string  | `"student"`                     |
| sender_name    | string  | اسم الطالب                     |
| sender_email   | string  | إيميل الطالب                   |
| message_type   | string  | نوع الرسالة (text, image, …)   |
| text           | string \| null | نص الرسالة              |
| media_url      | string \| null | رابط الميديا              |
| media_type     | string \| null | نوع الميديا              |
| is_auto_reply  | boolean | دائماً `false` لرسائل الطالب   |
| chat_status    | string  | حالة الشات                     |
| student_id     | number  | معرف الطالب صاحب الشات        |
| admin_id       | number \| null | الأدمن المعين إن وُجد   |
| is_unread      | boolean | غير مقروءة                     |
| created_at     | string  | ISO تاريخ الإرسال              |

---

## 2. الشاتات والرسائل (للمتابعة والرد)

### 2.1 قائمة شاتات الطلاب

```
GET /api/support/chats
```

**Query (اختياري):** `limit`, `offset`, `status`

**الاستجابة (200):**

```json
{
  "chats": [
    {
      "id": 1,
      "student_id": 10,
      "admin_id": null,
      "status": "bot_handling",
      "last_message_at": "2025-02-06T14:00:00.000Z",
      "created_at": "2025-02-01T00:00:00.000Z",
      "updated_at": "2025-02-06T14:00:00.000Z",
      "student_name": "أحمد الطالب",
      "student_email": "student@example.com",
      "unread_count": 2,
      "current_intent": null,
      "bot_attempts": 0,
      "escalation_reason": null,
      "escalated_at": null
    }
  ],
  "pagination": {
    "total": 15,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

---

### 2.2 رسائل شات معين

```
GET /api/support/chats/:chatId/messages
```

**Query (اختياري):** `limit`, `before` (ISO تاريخ للصفحة السابقة)

**الاستجابة (200):** `{ "messages": [ ... ] }` — كل عنصر يحتوي حقول الرسالة (id, chat_id, sender_id, sender_role, text, is_auto_reply, created_at, sender_name, …).

---

### 2.3 إرسال رد على الطالب

```
POST /api/support/messages
Content-Type: application/json
```

**Body:**

```json
{
  "text": "نص الرد",
  "chat_id": 1
}
```

| الحقل    | النوع  | مطلوب | الوصف        |
|----------|--------|--------|--------------|
| text     | string | نعم    | نص الرسالة   |
| chat_id  | number | نعم (للأدمن) | معرف الشات |

**الاستجابة (201):** `{ "message": { ... } }`

---

## ملخص مسارات الأدمن (شات الدعم)

| Method | المسار | الوصف |
|--------|--------|--------|
| GET | /api/support/unread-count | عدد الرسائل غير المقروءة من الطلاب |
| GET | /api/support/notifications | قائمة إشعارات الرسائل (رسائل الطلاب غير المقروءة) |
| GET | /api/support/chats | قائمة شاتات الطلاب |
| GET | /api/support/chats/:chatId/messages | رسائل شات معين |
| POST | /api/support/messages | إرسال رد (مع chat_id) |
