# إشعارات الدعم الفني — الطالب والمدرس

توثيق **إشعارات الشات بوت** (الرسائل الواردة من الدعم الفني) فقط: جزء للطالب وجزء للمدرس.

البادئة: **`/api/support`**  
الهيدر: **`Authorization: Bearer <token>`**

---

## مسح الإشعارات عند فتح الشات

- **طالب:** عند فتح الشات (`GET /api/support/chat`) تُحدَّد الرسائل الواردة كمقروءة.
- **مدرس:** عند دخول الشات وجلب الرسائل (`GET /api/support/teacher/messages`، مثلاً `?limit=50`) تُحدَّد **كل** الرسائل الواردة كمقروءة تلقائياً، فيرجع `GET /api/support/teacher/notifications` **فاضياً** حتى يصل إشعار جديد.

---

# الجزء الأول — الطالب

## 1. عدد الرسائل غير المقروءة

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

## 2. قائمة إشعارات الرسائل

```
GET /api/support/notifications
```

**الصلاحية:** `student`

**Query (اختياري):**

| المعامل | النوع   | الوصف                    |
|---------|--------|---------------------------|
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
      "text": "تم استلام مشكلتك. جرب تحديث الصفحة...",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": true,
      "chat_status": "bot_handling",
      "student_id": 5,
      "is_unread": true,
      "created_at": "2025-02-06T13:00:00.000Z",
      "title": "دعم فني",
      "body": "تم استلام مشكلتك. جرب تحديث الصفحة...",
      "data": { "type": "student_support_chat", "chat_id": 1, "message_id": 8 }
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
      "created_at": "2025-02-06T12:30:00.000Z",
      "title": "محمد الأدمن",
      "body": "تم حل المشكلة من السيرفر.",
      "data": { "type": "student_support_chat", "chat_id": 1, "message_id": 7 }
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

**شكل عنصر من `notifications` (طالب):**

| الحقل         | النوع   | الوصف |
|---------------|---------|--------|
| message_id    | number  | معرف الرسالة |
| chat_id       | number  | معرف الشات |
| sender_id     | number  | معرف المرسل |
| sender_role   | string  | `"admin"` |
| sender_name   | string  | اسم المرسل أو **"رد تلقائي"** عند البوت |
| message_type  | string  | نوع الرسالة |
| text          | string \| null | نص الرسالة |
| media_url     | string \| null | رابط الميديا |
| media_type    | string \| null | نوع الميديا |
| is_auto_reply | boolean | `true` = رد تلقائي (بوت)، `false` = أدمن |
| chat_status   | string  | حالة الشات |
| student_id    | number  | معرف الطالب |
| is_unread     | boolean | غير مقروءة |
| created_at    | string  | ISO تاريخ الإرسال |

الرسائل = الواردة من **الأدمن** أو من **الرد التلقائي (الشات بوت)**.

---

# الجزء الثاني — المدرس

## 1. عدد الرسائل غير المقروءة

```
GET /api/support/unread-count
```

**الصلاحية:** `teacher`

عدد الرسائل **الواردة** للمدرس من شات الدعم (من الأدمن أو البوت) والتي لم تُقرأ بعد.

**الاستجابة (200):**

```json
{
  "unread_count": 2
}
```

---

## 2. قائمة إشعارات الرسائل

```
GET /api/support/teacher/notifications
```

**الصلاحية:** `teacher`

**Query (اختياري):** `limit` (افتراضي 20)، `offset` (افتراضي 0).

القائمة ترجع **غير المقروءة فقط دائماً**. عند دخول الشات (GET /teacher/chat أو GET /teacher/messages) تُحدَّد كل الرسائل كمقروءة فيرجع هذا الـ API فاضياً حتى يصل إشعار جديد.

**الاستجابة (200) — عند وجود إشعارات غير مقروءة:**

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
      "read_at": null,
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

**الاستجابة (200) — بعد دخول الشات وجلب الرسائل (GET /teacher/messages):**

بعد استدعاء `GET /api/support/teacher/messages` تُحدَّد كل الرسائل كمقروءة، فيرجع هذا الـ API:

```json
{
  "notifications": [],
  "unread_count": 0,
  "pagination": {
    "total": 0,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**شكل عنصر من `notifications` (مدرس):**

| الحقل         | النوع   | الوصف |
|---------------|---------|--------|
| message_id    | number  | معرف الرسالة |
| chat_id       | number  | معرف الشات |
| sender_id     | number  | معرف المرسل |
| sender_role   | string  | `"admin"` |
| sender_name   | string  | اسم المرسل أو **"رد تلقائي"** عند البوت |
| message_type  | string  | نوع الرسالة (مثلاً auto_reply) |
| text          | string \| null | نص الرسالة |
| media_url     | string \| null | رابط الميديا |
| media_type    | string \| null | نوع الميديا |
| is_auto_reply | boolean | `true` = رد تلقائي (بوت)، `false` = أدمن |
| is_unread     | boolean | غير مقروءة |
| read_at       | string \| null | ISO وقت القراءة أو null |
| created_at    | string  | ISO تاريخ الإرسال |

الإشعارات = الرسائل **الواردة** للمدرس من شات الدعم (من الأدمن أو الرد التلقائي من البوت).

---

## 3. آخر إشعار واحد (للمدرس) — مناسب لـ Expo Push والبادج

```
GET /api/support/teacher/notifications/latest
```

**الصلاحية:** `teacher`

يرجع **آخر إشعار واحد غير مقروء** فقط (أو `null` إذا لا يوجد). الشكل متناسب مع Expo Push: `title`, `body`, `data` للتنقل.

**الاستجابة (200):**

عند وجود إشعار غير مقروء:

```json
{
  "notification": {
    "message_id": 14,
    "chat_id": 1,
    "sender_id": 1,
    "sender_role": "admin",
    "sender_name": "رد تلقائي",
    "message_type": "auto_reply",
    "text": "نص الرسالة...",
    "media_url": null,
    "media_type": null,
    "is_auto_reply": true,
    "created_at": "2025-02-06T14:00:00.000Z",
    "title": "دعم فني",
    "body": "نص الرسالة...",
    "data": {
      "type": "teacher_support_chat",
      "chat_id": 1,
      "message_id": 14,
      "sender_id": 1
    }
  },
  "unread_count": 1
}
```

عند عدم وجود إشعار غير مقروء:

```json
{
  "notification": null,
  "unread_count": 0
}
```

الحقول `title` و `body` و `data` مطابقة لشكل payload إشعار Expo Push، فيمكن استخدامها مباشرة للتنقل أو عرض البادج.

---

## 4. إشعارات المدرس Real-Time (Socket.IO)

لكي تظهر الإشعارات **في وقت حدوثها** دون الحاجة لتحديث الصفحة أو استدعاء الـ API بشكل دوري:

1. **اتصال Socket:** عند تسجيل دخول المستخدم كـ **مدرس** يتم ضمه تلقائياً للغرفة `support:teacher:{teacher_id}`.
2. **الاستماع للحدث:** استمع للحدث `support:teacher-notification` على الـ Socket.

**شكل الـ payload المرسل فور وصول رسالة جديدة (من الأدمن أو البوت):**

```json
{
  "notification": {
    "message_id": 14,
    "chat_id": 1,
    "sender_id": 1,
    "sender_role": "admin",
    "sender_name": "رد تلقائي",
    "message_type": "auto_reply",
    "text": "نص الرسالة...",
    "media_url": null,
    "media_type": null,
    "is_auto_reply": true,
    "is_unread": true,
    "created_at": "2025-02-06T14:00:00.000Z"
  },
  "unread_count": 3,
  "timestamp": 1738857600000
}
```

الحقل `notification` له **نفس شكل** عنصر واحد من مصفوفة `notifications` في استجابة `GET /api/support/teacher/notifications`، فيمكنك إضافته مباشرة لقائمة الإشعارات في الواجهة وتحديث `unread_count` دون إعادة جلب القائمة.

**مثال (عميل):**

- عند تحميل الصفحة: استدعاء `GET /api/support/teacher/notifications` لملء القائمة و `unread_count`.
- عند استقبال حدث `support:teacher-notification`: إضافة `payload.notification` لأعلى القائمة وتحديث العداد إلى `payload.unread_count`.

---

# ملخص المسارات (إشعارات فقط)

| الدور   | المسار | الوصف |
|--------|--------|--------|
| طالب  | GET /api/support/unread-count | عدد الرسائل الواردة غير المقروءة |
| طالب  | GET /api/support/notifications | قائمة غير المقروءة فقط (تُمسح عند دخول الشات) |
| طالب  | GET /api/support/notifications/latest | آخر إشعار واحد (Expo Push) |
| مدرس  | GET /api/support/unread-count | عدد الرسائل الواردة غير المقروءة |
| مدرس  | GET /api/support/teacher/notifications | قائمة إشعارات غير المقروءة فقط |
| مدرس  | GET /api/support/teacher/notifications/latest | آخر إشعار واحد غير مقروء (Expo Push) |

**ملاحظة (طالب):** استدعاء فتح الشات يحدّد الرسائل كمقروءة. **ملاحظة (مدرس):** بمجرد استدعاء `GET /api/support/teacher/messages` (عند دخول الشات) تُحدَّد كل الإشعارات كمقروءة، و`GET /api/support/teacher/notifications` يرجع فاضياً حتى يصل إشعار جديد.
