# واجهة الدعم الفني (Support Chat) — توثيق API

جميع المسارات تحت البادئة: **`/api/support`**  
يُفضّل استخدام **Bearer Token** في الهيدر: `Authorization: Bearer <token>`

---

## للطالب (Student)

### 1. الحصول على الشات أو إنشاؤه
```
GET /api/support/chat
```
**الصلاحية:** طالب فقط.

**الاستجابة (200):**
```json
{
  "chat": {
    "id": 1,
    "student_id": 5,
    "admin_id": null,
    "status": "bot_handling",
    "last_message_at": "2025-02-06T12:00:00.000Z",
    "created_at": "...",
    "updated_at": "...",
    "student_name": "أحمد",
    "student_email": "ahmed@example.com"
  }
}
```
**حالات الشات:** `bot_handling` | `waiting_for_admin` | `admin_handling` | `resolved` | `open` | `closed`

---

## للمدرس (Teacher)

شات دعم فني مستقل للمدرسين: تحية يومية تلقائية (8 صباحاً)، تقرير مستوى الطلاب، أفكار تسويقية، وتسجيل المشاكل للإدارة.

### 1. الحصول على شات المدرس
```
GET /api/support/teacher/chat
```
**الصلاحية:** teacher فقط.

**الاستجابة (200):**
```json
{
  "chat": {
    "id": 1,
    "teacher_id": 5,
    "admin_id": null,
    "status": "bot_handling",
    "last_message_at": "...",
    "teacher_name": "...",
    "teacher_email": "..."
  },
  "quick_buttons": [
    { "label": "تقرير طلابي", "payload": "تقرير مستوى الطلاب" },
    { "label": "فكرة تسويقية", "payload": "أفكار تسويقية" },
    { "label": "الإبلاغ عن مشكلة", "payload": "أريد الإبلاغ عن مشكلة" }
  ]
}
```

### 2. جلب رسائل شات المدرس
```
GET /api/support/teacher/messages?limit=50&before=
```
**الصلاحية:** teacher فقط (شات نفسه).

**الاستجابة (200):** `{ "messages": [ ... ] }` بنفس شكل الرسائل مع `sender_role`: `teacher` أو `admin`.

### 3. إرسال رسالة (المدرس)
```
POST /api/support/teacher/messages
Content-Type: application/json
Body: { "text": "نص الرسالة" }
```
**الصلاحية:** teacher فقط.

البوت يرد تلقائياً حسب المحتوى:
- **تقرير مستوى الطلاب** (أو "تقرير مفصل"، "تقرير طلابي") → استدعاء `GET /api/teacher/daily-course-report` (يُرجع `{ reports: [...] }` — تقرير لكل صف) وإرجاع التقارير منسقة في الشات.
- **أفكار تسويقية** (أو "فكرة تسويقية"، "تسويق") → إرسال فكرة/نصيحة عشوائية.
- **مشكلة / شكوى / أكواد / امتحانات** → تسجيل في `support_tickets`، تصعيد للإدارة، والرد: "تم تسجيل المشكلة وإرسالها للإدارة، وسيتم متابعتها في أقرب وقت."

**الاستجابة (201):** `{ "message": { ... }, "bot_reply": { ... } }`

### 4. قائمة شاتات المدرسين (للأدمن)
```
GET /api/support/teacher/chats?limit=50&offset=0&status=
```
**الصلاحية:** admin فقط.

### 5. جلب رسائل شات معين للمدرسين
```
GET /api/support/teacher/chats/:chatId/messages?limit=50&before=
```
**الصلاحية:** admin (أي شات) أو teacher (شات نفسه فقط).

---

## للطالب (استمرار)

### 2. جلب رسائل الشات
```
GET /api/support/chats/:chatId/messages
```
**الصلاحية:** طالب (شات نفسه فقط) أو أدمن.

**Query (اختياري):**
| المعامل | النوع   | الوصف                    |
|--------|---------|---------------------------|
| limit  | number  | عدد الرسائل (افتراضي 50) |
| before | string  | تاريخ (cursor للصفحة)     |

**الاستجابة (200):**
```json
{
  "messages": [
    {
      "id": 10,
      "chat_id": 1,
      "sender_id": 5,
      "sender_role": "student",
      "message_type": "text",
      "text": "عندي مشكلة في كود التفعيل",
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
      "sender_name": "أحمد"
    },
    {
      "id": 11,
      "sender_role": "admin",
      "message_type": "auto_reply",
      "text": "حالة الكود 12345678: ...",
      "is_auto_reply": true,
      "created_at": "..."
    }
  ]
}
```
**أنواع الرسائل:** `text` | `image` | `file` | `audio` | `auto_reply`

---

### 3. إرسال رسالة نصية
```
POST /api/support/messages
Content-Type: application/json
```
**الصلاحية:** طالب أو أدمن.

**Body (طالب):**
```json
{
  "text": "نص الرسالة"
}
```
**Body (أدمن):**
```json
{
  "text": "نص الرسالة",
  "chat_id": 1
}
```

**ملاحظة للطالب:** إذا كان الشات في حالة `waiting_for_admin` يُرجع **403** مع رسالة انتظار رد الدعم.

**الاستجابة (201):**
```json
{
  "message": {
    "id": 12,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "student",
    "message_type": "text",
    "text": "نص الرسالة",
    "is_auto_reply": false,
    "created_at": "..."
  },
  "bot_reply": {
    "id": 13,
    "text": "رد البوت الذكي إن وُجد...",
    "message_type": "auto_reply",
    "is_auto_reply": true,
    "created_at": "..."
  }
}
```
`bot_reply` يظهر فقط عندما يكون المرسل **طالباً** ويُولَّد رد تلقائي (بوت الدعم).

---

### 4. إرسال ميديا (صورة / فيديو / ملف)
```
POST /api/support/messages/media
Content-Type: multipart/form-data
```
**الصلاحية:** طالب أو أدمن.

**Body (form-data):**
| الحقل     | النوع | إلزامي | الوصف                    |
|----------|-------|--------|---------------------------|
| file     | File  | نعم    | الملف (صورة/فيديو/ملف)   |
| text     | string| لا     | نص مصاحب                  |
| chat_id  | number| للأدمن | معرف الشات (مطلوب للأدمن)|

**الاستجابة (201):** `{ "message": { ... } }` بنفس شكل رسالة مع `media_url`, `media_type`, `media_name`, `media_size`.

---

### 5. إرسال رسالة صوتية
```
POST /api/support/messages/audio
Content-Type: multipart/form-data
```
**الصلاحية:** طالب أو أدمن.

**Body (form-data):**
| الحقل    | النوع  | إلزامي | الوصف          |
|---------|--------|--------|-----------------|
| audio   | File   | نعم    | ملف الصوت      |
| chat_id | number | للأدمن| معرف الشات      |
| duration| number | لا    | مدة التسجيل (ثانية) |

**الاستجابة (201):** `{ "message": { ... } }` مع `message_type: "audio"` و `media_url`, `duration`.

---

### 6. عدد الرسائل غير المقروءة
```
GET /api/support/unread-count
```
**الصلاحية:** طالب أو أدمن.

**الاستجابة (200):**
```json
{
  "unread_count": 3
}
```

---

### 7. إشعارات الرسائل (قائمة غير المقروءة)
```
GET /api/support/notifications
```
**الصلاحية:** طالب أو أدمن.

**Query (اختياري):** `limit` (افتراضي 20), `offset` (افتراضي 0).

**الاستجابة (200):**
```json
{
  "notifications": [
    {
      "chat_id": 1,
      "message_id": 15,
      "text": "نص الرسالة",
      "sender_role": "admin",
      "created_at": "...",
      "unread_count": 2
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

---

### 8. الأسئلة الشائعة (للطالب)
```
GET /api/support/faq
```
**الصلاحية:** طالب فقط.

**الاستجابة (200):** قائمة FAQs نشطة (سؤال/جواب) للعرض في واجهة الدعم.

---

## للأدمن (Admin)

### 9. جلب كل الشاتات
```
GET /api/support/chats
```
**الصلاحية:** أدمن فقط.

**Query (اختياري):**
| المعامل | النوع  | الوصف                    |
|--------|--------|---------------------------|
| limit  | number | عدد الشاتات (افتراضي 50) |
| offset | number | للإرجاع                  |
| status | string | فلتر: open, closed, resolved, bot_handling, waiting_for_admin, admin_handling |

**الاستجابة (200):**
```json
{
  "chats": [
    {
      "id": 1,
      "student_id": 5,
      "admin_id": null,
      "status": "waiting_for_admin",
      "last_message_at": "...",
      "student_name": "أحمد",
      "student_email": "ahmed@example.com",
      "unread_count": 2,
      "current_intent": "ACTIVATION_CODE",
      "bot_attempts": 3,
      "escalation_reason": "...",
      "escalated_at": "..."
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

---

### 10. تحديث حالة الشات
```
PATCH /api/support/chats/:chatId/status
Content-Type: application/json
```
**الصلاحية:** أدمن فقط.

**Body:**
```json
{
  "status": "admin_handling"
}
```
**القيم:** `open` | `closed` | `resolved` | `bot_handling` | `waiting_for_admin` | `admin_handling`

**الاستجابة (200):** `{ "message": "Chat status updated" }`

---

### 11. تعيين أدمن للشات
```
POST /api/support/chats/:chatId/assign
```
**الصلاحية:** أدمن فقط. يُعيَّن الأدمن الحالي ويُحدَّث وضع الشات إلى `admin_handling`.

**الاستجابة (200):** `{ "message": "Admin assigned to chat" }`

---

### 12. إدارة الأسئلة الشائعة (أدمن)
- **إنشاء:** `POST /api/support/faq` (Body: question, answer, keywords, is_active, priority)
- **قائمة للإدمن:** `GET /api/support/faq/admin`
- **تعديل:** `PUT /api/support/faq/:id`
- **حذف:** `DELETE /api/support/faq/:id`
- **اختبار تطابق:** `POST /api/support/faq/test-match` (لاختبار مطابقة كلمات مفتاحية)

---

## Real-Time (Socket.io)

للحصول على الرسائل فوراً دون استدعاء `GET /chats/:chatId/messages` بشكل متكرر:

- **الطالب:** الاشتراك في الغرفة `support:student:<studentId>` — استقبال أحداث مثل `message:receive` أو `support:new-message` عند وصول رسالة من الأدمن أو البوت.
- **الأدمن:** الاشتراك في `support:admin` — استقبال `support:notification` أو `support:new-chat-message` عند رسالة جديدة من طالب.

**شكل رسالة الويب سوكيت (مثال):**
```json
{
  "message": {
    "id": 14,
    "chat_id": 1,
    "sender_role": "admin",
    "message_type": "auto_reply",
    "text": "تم تفعيل الكورس بنجاح...",
    "is_auto_reply": true,
    "created_at": "..."
  },
  "chat_id": 1,
  "timestamp": 1738843200000
}
```

---

## تدفق صفحة الدعم الفني (مقترح)

1. **طالب:**
   - `GET /api/support/chat` → الحصول على `chat.id`.
   - `GET /api/support/chats/:chatId/messages` → تحميل الرسائل.
   - عند الكتابة: `POST /api/support/messages` مع `{ "text": "..." }` — إن وُجد `bot_reply` في الاستجابة اعرضه فوراً.
   - (اختياري) الاتصال بـ Socket والاشتراك في `support:student:<studentId>` لعرض الرسائل الجديدة بدون تحديث الصفحة.

2. **أدمن:**
   - `GET /api/support/chats` → قائمة المحادثات.
   - عند اختيار محادثة: `GET /api/support/chats/:chatId/messages`.
   - للرد: `POST /api/support/messages` مع `{ "text": "...", "chat_id": <chatId> }`.
   - (اختياري) `POST /api/support/chats/:chatId/assign` لتعيين نفسه، و `PATCH /api/support/chats/:chatId/status` لتحديث الحالة.

---

## أخطاء شائعة

| الحالة | المعنى |
|--------|--------|
| 400 | معطيات ناقصة أو غير صحيحة (مثلاً نص فارغ، أو chat_id مطلوب للأدمن). |
| 403 | صلاحية غير كافية، أو طالب يحاول إرسال رسالة أثناء `waiting_for_admin`. |
| 404 | chat_id غير صحيح أو غير موجود. |
