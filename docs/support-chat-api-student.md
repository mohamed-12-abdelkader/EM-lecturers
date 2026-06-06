# شات الدعم الفني — APIs للطالب (إشعارات الشات بوت)

البادئة: **`/api/support`**  
الهيدر: **`Authorization: Bearer <token>`** (توكن الطالب)

---

## 1. إشعارات الرسائل (عدد غير المقروءة + قائمة)

### 1.1 عدد الرسائل غير المقروءة

```
GET /api/support/unread-count
```

**الصلاحية:** `student`

عدد الرسائل **الواردة** للطالب من شات الدعم (من الأدمن أو البوت) والتي لم تُقرأ بعد.

**الاستجابة (200):**

```json
{
  "unread_count": 2
}
```

---

### 1.2 قائمة إشعارات الرسائل (الرسائل الواردة غير المقروءة)

```
GET /api/support/notifications
```

**الصلاحية:** `student`

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
      "message_id": 8,
      "chat_id": 1,
      "sender_id": 1,
      "sender_role": "admin",
      "sender_name": "رد تلقائي",
      "message_type": "text",
      "text": "تم استلام مشكلتك. جرب تحديث الصفحة وإعادة تسجيل الدخول...",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": true,
      "chat_status": "bot_handling",
      "student_id": 5,
      "is_unread": true,
      "created_at": "2025-02-06T13:00:00.000Z"
    },
    {
      "message_id": 7,
      "chat_id": 1,
      "sender_id": 2,
      "sender_role": "admin",
      "sender_name": "محمد الأدمن",
      "message_type": "text",
      "text": "تم حل المشكلة من السيرفر.",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": false,
      "chat_status": "admin_handling",
      "student_id": 5,
      "is_unread": true,
      "created_at": "2025-02-06T12:30:00.000Z"
    }
  ],
  "unread_count": 2,
  "pagination": {
    "total": 2,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**شكل عنصر من `notifications`:**

| الحقل         | النوع   | الوصف |
|---------------|---------|--------|
| message_id    | number  | معرف الرسالة |
| chat_id       | number  | معرف الشات |
| sender_id     | number  | معرف المرسل (أدمن أو نظام البوت) |
| sender_role   | string  | `"admin"` |
| sender_name   | string  | اسم المرسل أو **"رد تلقائي"** عندما الرسالة من البوت |
| message_type  | string  | نوع الرسالة (text, auto_reply, …) |
| text          | string \| null | نص الرسالة |
| media_url     | string \| null | رابط الميديا |
| media_type    | string \| null | نوع الميديا |
| is_auto_reply | boolean | `true` = رد تلقائي من الشات بوت، `false` = رسالة من الأدمن |
| chat_status   | string  | حالة الشات |
| student_id    | number  | معرف الطالب (أنت) |
| is_unread     | boolean | غير مقروءة |
| created_at    | string  | ISO تاريخ الإرسال |

الرسائل الواردة = من **الأدمن** أو من **الرد التلقائي (الشات بوت)**.

---

## 2. الشات والرسائل (للمحادثة)

### 2.1 الحصول على الشات (أو إنشاؤه)

```
GET /api/support/chat
```

**الصلاحية:** `student`

**الاستجابة (200):**

```json
{
  "chat": {
    "id": 1,
    "student_id": 5,
    "admin_id": null,
    "status": "bot_handling",
    "last_message_at": "2025-02-06T13:00:00.000Z",
    "created_at": "2025-02-01T00:00:00.000Z",
    "updated_at": "2025-02-06T13:00:00.000Z"
  }
}
```

---

### 2.2 جلب رسائل الشات

```
GET /api/support/chats/:chatId/messages
```

**الصلاحية:** `student` (شاتك فقط: `chatId` يجب أن يكون معرف شاتك)

**Query (اختياري):** `limit`, `before` (ISO للصفحة السابقة)

عند فتح الشات تُحدَّد كل الرسائل الواردة لك كمقروءة تلقائياً.

**الاستجابة (200):** `{ "messages": [ ... ] }` — مرتبة من الأقدم للأحدث، كل عنصر فيه (id, sender_role, text, is_auto_reply, created_at, sender_name, …).

---

### 2.3 إرسال رسالة

```
POST /api/support/messages
Content-Type: application/json
```

**Body:**

```json
{
  "text": "نص رسالتك"
}
```

| الحقل | النوع  | مطلوب | الوصف      |
|-------|--------|--------|------------|
| text  | string | نعم    | نص الرسالة |

**ملاحظة:** للطالب لا يُرسل `chat_id` — يُستخدم شاتك تلقائياً. لا يمكنك الإرسال عندما يكون الشات في حالة `waiting_for_admin` (انتظار رد الأدمن).

**الاستجابة (201):** `{ "message": { ... } }` — وقد يُعاد معها رد البوت حسب المنطق الداخلي.

---

## 3. الأسئلة الشائعة (FAQ)

```
GET /api/support/faq
```

**الصلاحية:** `student`

**الاستجابة (200):**

```json
{
  "faqs": [
    {
      "id": 1,
      "question": "كيف أغير كلمة المرور؟",
      "answer": "من الإعدادات > الحساب...",
      "priority": 1
    }
  ]
}
```

---

## ملخص مسارات الطالب (شات الدعم)

| Method | المسار | الوصف |
|--------|--------|--------|
| GET | /api/support/unread-count | عدد الرسائل الواردة غير المقروءة (أدمن + بوت) |
| GET | /api/support/notifications | قائمة إشعارات الرسائل الواردة (أدمن + بوت) |
| GET | /api/support/chat | شاتك (أو إنشاؤه) |
| GET | /api/support/chats/:chatId/messages | رسائل الشات (شاتك فقط) |
| POST | /api/support/messages | إرسال رسالة (نص فقط) |
| GET | /api/support/faq | الأسئلة الشائعة للدعم |
