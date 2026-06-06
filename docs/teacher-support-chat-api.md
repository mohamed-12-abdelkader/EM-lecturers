# شات دعم المدرس — APIs وشكل البيانات فقط

البادئة: **`/api/support`**  
الهيدر: **`Authorization: Bearer <token>`**

---

## 1. المدرس

### 1.1 الحصول على الشات (أو إنشاؤه)

```
GET /api/support/teacher/chat
```

**الصلاحية:** `teacher`

**الاستجابة (200):**

```json
{
  "chat": {
    "id": 1,
    "teacher_id": 5,
    "admin_id": null,
    "status": "bot_handling",
    "last_message_at": "2025-02-06T12:00:00.000Z",
    "created_at": "2025-02-01T00:00:00.000Z",
    "updated_at": "2025-02-06T12:00:00.000Z",
    "teacher_name": "أحمد محمد",
    "teacher_email": "teacher@example.com"
  },
  "quick_buttons": [
    { "label": "تقرير طلابي", "payload": "تقرير مستوى الطلاب" },
    { "label": "تقرير طالب بالاسم", "payload": "تقرير الطالب " },
    { "label": "فكرة تسويقية", "payload": "أفكار تسويقية" },
    { "label": "الإبلاغ عن مشكلة", "payload": "أريد الإبلاغ عن مشكلة" }
  ],
  "can_teacher_send": true
}
```

**شكل `chat` (TeacherSupportChat):**

| الحقل            | النوع   | الوصف                          |
|------------------|---------|---------------------------------|
| id               | number  | معرف الشات                     |
| teacher_id       | number  | معرف المدرس                    |
| admin_id         | number \| null | معرف الأدمن إن وُجد      |
| status           | string  | bot_handling \| waiting_for_admin \| admin_handling \| resolved \| open \| closed |
| last_message_at  | string \| null | ISO تاريخ آخر رسالة    |
| created_at       | string  | ISO                             |
| updated_at       | string  | ISO                             |
| teacher_name     | string? | اسم المدرس                     |
| teacher_email    | string? | إيميل المدرس                   |

---

### 1.2 جلب رسائل الشات

```
GET /api/support/teacher/messages
```

**Query (اختياري):**

| المعامل | النوع   | الوصف                    |
|--------|---------|---------------------------|
| limit  | number  | عدد الرسائل (افتراضي 50) |
| before | string  | ISO تاريخ للصفحة السابقة  |

**الصلاحية:** `teacher` (شات نفسه فقط)

**الاستجابة (200):**

```json
{
  "messages": [
    {
      "id": 10,
      "chat_id": 1,
      "sender_id": 5,
      "sender_role": "teacher",
      "message_type": "text",
      "text": "عايز تقرير عن مستوى الطلاب",
      "media_url": null,
      "media_type": null,
      "media_name": null,
      "media_size": null,
      "duration": null,
      "is_auto_reply": false,
      "faq_id": null,
      "delivered_at": null,
      "read_at": null,
      "created_at": "2025-02-06T12:00:00.000Z",
      "sender_name": "أحمد محمد"
    },
    {
      "id": 11,
      "chat_id": 1,
      "sender_id": 1,
      "sender_role": "admin",
      "message_type": "auto_reply",
      "text": "📊 **تقرير الكورسات...**",
      "media_url": null,
      "media_type": null,
      "media_name": null,
      "media_size": null,
      "duration": null,
      "is_auto_reply": true,
      "faq_id": null,
      "delivered_at": null,
      "read_at": null,
      "created_at": "2025-02-06T12:00:01.000Z",
      "sender_name": "رد تلقائي"
    }
  ]
}
```

**شكل عنصر من `messages` (TeacherSupportMessage):**

| الحقل         | النوع   | الوصف                                    |
|---------------|---------|-------------------------------------------|
| id            | number  | معرف الرسالة                             |
| chat_id       | number  | معرف الشات                               |
| sender_id     | number  | معرف المرسل (مدرس أو أدمن)              |
| sender_role   | string  | "teacher" \| "admin"                      |
| message_type  | string  | "text" \| "image" \| "file" \| "audio" \| "auto_reply" |
| text          | string \| null | نص الرسالة                        |
| media_url     | string \| null | رابط الميديا                        |
| media_type    | string \| null | نوع الميديا                        |
| media_name    | string \| null | اسم الملف                           |
| media_size    | number \| null | حجم بالبايت                         |
| duration      | number \| null | مدة (صوت/فيديو) بالثواني           |
| is_auto_reply | boolean | رد تلقائي من البوت                      |
| faq_id        | number \| null | معرف FAQ إن وُجد                     |
| delivered_at  | string \| null | ISO وقت التسليم                    |
| read_at       | string \| null | ISO وقت القراءة                     |
| created_at    | string  | ISO وقت الإنشاء                          |
| sender_name   | string? | اسم المرسل للعرض                        |

الرسائل مرتبة من **الأقدم للأحدث**.

---

### 1.2.1 إشعارات الرسائل الواردة (للمدرس)

```
GET /api/support/teacher/notifications
```

**Query (اختياري):**

| المعامل     | النوع   | الوصف                          |
|-------------|--------|---------------------------------|
| limit       | number | عدد الإشعارات (افتراضي 20)     |
| offset      | number | إزاحة للصفحة (افتراضي 0)      |
| unread_only | boolean | إن كان `true` يرجع غير المقروءة فقط |

**الصلاحية:** `teacher`

**الاستجابة (200):**

```json
{
  "notifications": [
    {
      "message_id": 13,
      "chat_id": 1,
      "sender_id": 1,
      "sender_role": "admin",
      "sender_name": "رد تلقائي",
      "message_type": "auto_reply",
      "text": "📋 **تقرير الطالب المطلوب:** ...",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": true,
      "is_unread": true,
      "created_at": "2025-02-06T12:00:01.000Z"
    }
  ],
  "unread_count": 2,
  "pagination": {
    "total": 10,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

الإشعارات = الرسائل **الواردة** للمدرس من شات الدعم (من الأدمن أو الرد التلقائي من البوت). `sender_name` يكون `"رد تلقائي"` عندما `is_auto_reply: true`.

**Real-Time:** عند وصول رسالة جديدة للمدرس يُرسل حدث Socket `support:teacher-notification` للغرفة `support:teacher:{teacher_id}`، والـ payload يحتوي على `notification` (بنفس شكل عنصر من مصفوفة `notifications` أعلاه) و `unread_count`. راجع `docs/support-chat-notifications.md` للتفاصيل.

---

### 1.3 إرسال رسالة (المدرس)

```
POST /api/support/teacher/messages
Content-Type: application/json
```

**Body:**

```json
{
  "text": "نص الرسالة"
}
```

| الحقل | النوع  | مطلوب | الوصف      |
|-------|--------|--------|------------|
| text  | string | نعم    | نص الرسالة |

**الصلاحية:** `teacher`

**الاستجابة (201):**

```json
{
  "message": {
    "id": 12,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "teacher",
    "message_type": "text",
    "text": "عايز تقرير الطالب أحمد",
    "media_url": null,
    "media_type": null,
    "media_name": null,
    "media_size": null,
    "duration": null,
    "is_auto_reply": false,
    "faq_id": null,
    "delivered_at": null,
    "read_at": null,
    "created_at": "2025-02-06T12:00:00.000Z",
    "sender_name": "أحمد محمد"
  },
  "bot_reply": {
    "id": 13,
    "chat_id": 1,
    "sender_id": 1,
    "sender_role": "admin",
    "message_type": "auto_reply",
    "text": "📋 **تقرير الطالب المطلوب:**\n\n👤 **الطالب:** ...",
    "media_url": null,
    "media_type": null,
    "media_name": null,
    "media_size": null,
    "duration": null,
    "is_auto_reply": true,
    "faq_id": null,
    "delivered_at": null,
    "read_at": null,
    "created_at": "2025-02-06T12:00:01.000Z",
    "sender_name": "رد تلقائي"
  },
  "can_teacher_send": true
}
```

`message` و `bot_reply` لهما نفس شكل **TeacherSupportMessage** أعلاه.

**أخطاء:**  
- `400`: فشل التحقق (مثلاً `text` فارغ).

---

## 2. الأدمن

### 2.1 قائمة شاتات المدرسين

```
GET /api/support/teacher/chats
```

**Query (اختياري):**

| المعامل | النوع   | الوصف              |
|--------|---------|---------------------|
| limit  | number  | افتراضي 50         |
| offset | number  | افتراضي 0          |
| status | string  | فلتر حسب حالة الشات |

**الصلاحية:** `admin`

**الاستجابة (200):**

```json
{
  "chats": [
    {
      "id": 1,
      "teacher_id": 5,
      "admin_id": null,
      "status": "waiting_for_admin",
      "last_message_at": "2025-02-06T12:00:00.000Z",
      "created_at": "2025-02-01T00:00:00.000Z",
      "updated_at": "2025-02-06T12:00:00.000Z",
      "teacher_name": "أحمد محمد",
      "teacher_email": "teacher@example.com"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

كل عنصر في `chats` له شكل **TeacherSupportChat** (كما في 1.1).

---

### 2.2 رسائل شات معين (أدمن أو المدرس صاحب الشات)

```
GET /api/support/teacher/chats/:chatId/messages
```

**Query (اختياري):**

| المعامل | النوع   | الوصف                    |
|--------|---------|---------------------------|
| limit  | number  | افتراضي 50               |
| before | string  | ISO للصفحة السابقة       |

**الصلاحية:** `teacher` (شاته فقط) أو `admin` (أي شات)

**الاستجابة (200):**

```json
{
  "messages": [ /* نفس شكل TeacherSupportMessage[] */ ],
  "can_teacher_send": true
}
```

`can_teacher_send` يظهر للمدرس فقط (دائماً `true`). للأدمن لا يُعاد.

**أخطاء:**  
- `400`: `chatId` غير صالح  
- `403`: المدرس يطلب شات غيره  
- `404`: الشات غير موجود  

---

### 2.3 قائمة تذاكر الدعم (مشاكل المدرسين)

```
GET /api/support/teacher/tickets
```

**Query (اختياري):**

| المعامل | النوع   | الوصف        |
|--------|---------|---------------|
| limit  | number  | افتراضي 50   |
| offset | number  | افتراضي 0    |
| status | string  | open \| in_progress \| resolved \| closed |

**الصلاحية:** `admin`

**الاستجابة (200):**

```json
{
  "tickets": [
    {
      "id": 1,
      "chat_id": 1,
      "teacher_id": 5,
      "message_text": "الطلاب لا يستطيعون دخول الامتحان",
      "status": "open",
      "admin_notes": null,
      "created_at": "2025-02-06T12:00:00.000Z",
      "updated_at": "2025-02-06T12:00:00.000Z",
      "teacher_name": "أحمد محمد",
      "teacher_email": "teacher@example.com"
    }
  ],
  "pagination": {
    "total": 5,
    "limit": 50,
    "offset": 0,
    "has_more": false
  }
}
```

**شكل عنصر من `tickets`:**

| الحقل         | النوع   | الوصف                |
|---------------|---------|-----------------------|
| id            | number  | معرف التذكرة         |
| chat_id       | number  | teacher_support_chat_id |
| teacher_id    | number  | معرف المدرس          |
| message_text  | string  | نص رسالة المشكلة     |
| status        | string  | open \| in_progress \| resolved \| closed |
| admin_notes   | string \| null | ملاحظات الأدمن |
| created_at    | string  | ISO                   |
| updated_at    | string  | ISO                   |
| teacher_name  | string  | اسم المدرس           |
| teacher_email | string  | إيميل المدرس         |

---

### 2.4 تحديث تذكرة (حالة + ملاحظات + رسالة للمدرس عند الحل)

```
PATCH /api/support/teacher/tickets/:ticketId
Content-Type: application/json
```

**Body (كل الحقول اختيارية):**

```json
{
  "status": "resolved",
  "admin_notes": "تم حل المشكلة من السيرفر",
  "message_to_teacher": "تم حل مشكلتك. لو عندك أي استفسار اكتب هنا."
}
```

| الحقل                | النوع   | الوصف |
|----------------------|---------|--------|
| status               | string  | "open" \| "in_progress" \| "resolved" \| "closed" |
| admin_notes          | string  | ملاحظات داخلية للأدمن |
| message_to_teacher   | string  | إن وُجد وحالة التذكرة أصبحت resolved أو closed، تُرسل رسالة للمدرس في الشات (كرد تلقائي) |

**الصلاحية:** `admin`

**الاستجابة (200):**

```json
{
  "ticket": {
    "id": 1,
    "chat_id": 1,
    "teacher_id": 5,
    "message_text": "الطلاب لا يستطيعون دخول الامتحان",
    "status": "resolved",
    "admin_notes": "تم حل المشكلة من السيرفر",
    "created_at": "2025-02-06T12:00:00.000Z",
    "updated_at": "2025-02-06T12:05:00.000Z",
    "teacher_name": "أحمد محمد",
    "teacher_email": "teacher@example.com"
  },
  "message_sent_to_teacher": true
}
```

`message_sent_to_teacher` يظهر فقط عندما تم إرسال رسالة للمدرس (حالة resolved/closed + وجود `message_to_teacher`).

**أخطاء:**  
- `400`: `ticketId` غير صالح أو فشل التحقق  
- `404`: التذكرة غير موجودة  

---

## 3. إشعارات شات الدعم — الطالب

### 3.1 عدد الرسائل غير المقروءة

```
GET /api/support/unread-count
```

**الصلاحية:** `student` | `teacher` | `admin`

- للطالب: عدد رسائل شات الدعم الواردة له (من أدمن أو بوت) غير المقروءة.
- للمدرس: عدد رسائل شات دعم المدرس الواردة له (من أدمن أو بوت) غير المقروءة.

**الاستجابة (200):** `{ "unread_count": 0 }`

---

### 3.2 إشعارات الرسائل (الطالب)

```
GET /api/support/notifications
```

**الصلاحية:** `student` | `admin`

**Query (اختياري):** `limit`, `offset`

للطالب: يرجع الرسائل **الواردة** له من شات الدعم (من الأدمن أو الرد التلقائي من البوت) غير المقروءة. يتضمن `unread_count` في الاستجابة.

**الاستجابة (200):**

```json
{
  "notifications": [
    {
      "message_id": 5,
      "chat_id": 1,
      "sender_id": 1,
      "sender_role": "admin",
      "sender_name": "رد تلقائي",
      "message_type": "text",
      "text": "نص الرد...",
      "is_auto_reply": true,
      "is_unread": true,
      "created_at": "..."
    }
  ],
  "unread_count": 1,
  "pagination": { "total": 1, "limit": 20, "offset": 0, "has_more": false }
}
```

---

## ملخص المسارات

| Method | المسار | الصلاحية | الوصف |
|--------|--------|----------|--------|
| GET    | /api/support/teacher/chat | teacher | شات المدرس أو إنشاؤه + أزرار سريعة |
| GET    | /api/support/teacher/messages | teacher | رسائل شات المدرس |
| GET    | /api/support/teacher/notifications | teacher | إشعارات الرسائل الواردة (أدمن/بوت) + unread_count |
| POST   | /api/support/teacher/messages | teacher | إرسال رسالة + رد البوت |
| GET    | /api/support/teacher/chats | admin | قائمة شاتات المدرسين |
| GET    | /api/support/teacher/chats/:chatId/messages | teacher, admin | رسائل شات معين |
| GET    | /api/support/teacher/tickets | admin | قائمة تذاكر الدعم |
| PATCH  | /api/support/teacher/tickets/:ticketId | admin | تحديث تذكرة (حالة، ملاحظات، رسالة للمدرس) |
| GET    | /api/support/unread-count | student, teacher, admin | عدد الرسائل غير المقروءة (شات الدعم) |
| GET    | /api/support/notifications | student, admin | إشعارات الرسائل الواردة (طالب: أدمن/بوت؛ أدمن: رسائل الطلاب) |
