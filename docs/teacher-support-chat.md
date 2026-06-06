# شات الدعم الفني مع المدرس — توثيق كامل

هذا المستند يوضح **شات الدعم الفني للمدرسين**: الـ API، السلوك التلقائي (البوت)، والأحداث (Socket)، وكيفية استخدامه من الواجهة.

---

## نظرة عامة

- شات **مستقل** عن شات الطالب (جداول: `teacher_support_chats`, `teacher_support_messages`).
- كل مدرس له **شات واحد** يُنشأ تلقائياً عند أول طلب.
- البوت يرد تلقائياً حسب نص الرسالة: تقرير طلابي، أفكار تسويقية، أو تسجيل مشكلة للإدارة.
- **التحية اليومية** تُرسل تلقائياً كل يوم الساعة **8 صباحاً** (مرة واحدة للمدرس).
- **الشات لا يُقفل أبداً على المدرس:** يمكنه الإرسال في كل الحالات (قبل التصعيد، أثناء انتظار الأدمن، وبعد رد الأدمن). الـ API لا يمنع الإرسال ولا يُرجع 403 للمدرس، وتستطيع الواجهة الاعتماد على `can_teacher_send: true` دائماً.

---

## البادئة والصلاحيات

- جميع المسارات تحت: **`/api/support`**
- الهيدر: **`Authorization: Bearer <token>`** (توكن المدرس أو الأدمن حسب المسار)

---

## 1. API للمدرس

### 1.1 الحصول على الشات (أو إنشاؤه)

```
GET /api/support/teacher/chat
```

**الصلاحية:** `teacher` فقط.

**الاستجابة (200):**

```json
{
  "chat": {
    "id": 1,
    "teacher_id": 5,
    "admin_id": null,
    "status": "bot_handling",
    "last_message_at": "2025-02-06T12:00:00.000Z",
    "created_at": "...",
    "updated_at": "...",
    "teacher_name": "أحمد محمد",
    "teacher_email": "teacher@example.com"
  },
  "quick_buttons": [
    { "label": "تقرير طلابي", "payload": "تقرير مستوى الطلاب" },
    { "label": "تقرير طالب بالاسم", "payload": "تقرير الطالب " },
    { "label": "فكرة تسويقية", "payload": "أفكار تسويقية" },
    { "label": "الإبلاغ عن مشكلة", "payload": "أريد الإبلاغ عن مشكلة" }
  ]
}
```

**حالات الشات:**  
`bot_handling` | `waiting_for_admin` | `admin_handling` | `resolved` | `open` | `closed`

---

### 1.2 جلب رسائل الشات

```
GET /api/support/teacher/messages
```

**Query (اختياري):**

| المعامل | النوع   | الوصف                          |
|--------|---------|---------------------------------|
| limit  | number  | عدد الرسائل (افتراضي 50)       |
| before | string  | تاريخ (ISO) للصفحة السابقة     |

**الصلاحية:** `teacher` فقط (شات نفسه).

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
      "is_auto_reply": false,
      "created_at": "2025-02-06T12:00:00.000Z",
      "sender_name": "أحمد محمد"
    },
    {
      "id": 11,
      "sender_role": "admin",
      "message_type": "auto_reply",
      "text": "📊 **تقرير الكورس: ...**\n\n...",
      "is_auto_reply": true,
      "created_at": "2025-02-06T12:00:01.000Z",
      "sender_name": "رد تلقائي"
    }
  ],
  "can_teacher_send": true
}
```

**ملاحظة:** الرسائل مرتبة من الأقدم للأحدث. `sender_role` إما `teacher` أو `admin`. `can_teacher_send` دائماً `true` للمدرس.

---

### 1.3 إرسال رسالة

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

**الصلاحية:** `teacher` فقط.

**سلوك البوت (حسب النص):**

| نوع الطلب           | أمثلة نصية                          | رد البوت |
|---------------------|--------------------------------------|----------|
| تقرير مستوى الطلاب  | تقرير، تقرير مفصل، تقرير طلابي، إحصائيات | استدعاء `GET /api/teacher/daily-course-report` وعرض التقرير منسقاً؛ **تقرير منفصل لكل صف** (أولى، ثانية، ثالثة ثانوي...) — آخر كورس شغال عليه المدرس في كل صف. |
| **تقرير طالب معين** | تقرير الطالب أحمد، تقرير طالب 10، تقرير عن الطالب محمد | تقرير مفصل للطالب: عدد الكورسات، المحاضرات المشاهدة، الامتحانات المحلولة، الدرجات، ونسبة المشاهدة. إذا وُجد أكثر من طالب بنفس الاسم يُطلب من المدرس إرسال **كود الطالب** (الرقم) مثل: **تقرير الطالب 10**. |
| أفكار تسويقية       | أفكار تسويقية، فكرة تسويقية، تسويق، منشور، فيسبوك | فكرة/نصيحة عشوائية (وقت الإرسال، منشور، تفاعل، إلخ) |
| مشكلة / شكوى        | مشكلة، شكوى، لا يعمل، خطأ، أكواد، امتحانات، أبلغ | تسجيل في `support_tickets`، تصعيد للإدارة، والرد: "تم تسجيل المشكلة وإرسالها للإدارة، وسيتم متابعتها في أقرب وقت." |
| غير ذلك             | أي نص آخر                            | رسالة ترحيب وتوضيح الخدمات المتاحة |

**ملاحظة:** المدرس يمكنه الاستمرار في إرسال رسائل حتى بعد تحويل المشكلة للأدمن (الشات لا يُقفل كشات الطالب).

**الاستجابة (201):**

```json
{
  "message": {
    "id": 12,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "teacher",
    "message_type": "text",
    "text": "تقرير مستوى الطلاب",
    "is_auto_reply": false,
    "created_at": "...",
    "sender_name": "أحمد محمد"
  },
  "bot_reply": {
    "id": 13,
    "sender_role": "admin",
    "message_type": "auto_reply",
    "text": "📊 **تقرير الكورس: ...** ...",
    "is_auto_reply": true,
    "created_at": "...",
    "sender_name": "رد تلقائي"
  }
}
```

---

## 2. API للأدمن

### 2.1 قائمة شاتات المدرسين

```
GET /api/support/teacher/chats
```

**Query (اختياري):**

| المعامل | النوع   | الوصف                |
|--------|---------|----------------------|
| limit  | number  | عدد الشاتات (افتراضي 50) |
| offset | number  | للإرجاع              |
| status | string  | فلتر حسب الحالة      |

**الصلاحية:** `admin` فقط.

**الاستجابة (200):**

```json
{
  "chats": [
    {
      "id": 1,
      "teacher_id": 5,
      "admin_id": null,
      "status": "waiting_for_admin",
      "last_message_at": "...",
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

---

### 2.2 قائمة تذاكر الدعم (مشاكل المدرسين)

```
GET /api/support/teacher/tickets
```

**Query (اختياري):** `limit`, `offset`, `status` (قيم: `open`, `in_progress`, `resolved`, `closed`)

**الصلاحية:** `admin` فقط.

**الاستجابة (200):** `{ "tickets": [ { "id", "chat_id", "teacher_id", "teacher_name", "teacher_email", "message_text", "status", "admin_notes", "created_at", "updated_at" } ], "pagination": { "total", "limit", "offset", "has_more" } }`

مناسب لعرض "صندوق مشاكل المدرسين" في لوحة الأدمن.

---

### 2.3 تحديث حالة التذكرة + إرسال رسالة للمدرس عند الحل

```
PATCH /api/support/teacher/tickets/:ticketId
Content-Type: application/json
```

**الصلاحية:** `admin` فقط.

**Body (اختياري):**

| الحقل | النوع | الوصف |
|--------|------|--------|
| status | string | `open` \| `in_progress` \| `resolved` \| `closed` |
| admin_notes | string | ملاحظات الأدمن على التذكرة |
| message_to_teacher | string | نص الرسالة التي تُرسل للمدرس عند تعيين الحالة "تم الحل". إذا لم يُرسل يُستخدم الافتراضي: "تم حل مشكلتك. لو عندك أي استفسار آخر اكتب هنا." |

**السلوك:** عند تحديث `status` إلى `resolved` أو `closed` تُرسل تلقائياً رسالة للمدرس في شات الدعم (وتصل له فوراً عبر Socket). يمكن تخصيص النص عبر `message_to_teacher`.

**الاستجابة (200):** `{ "ticket": { ... }, "message_sent_to_teacher": true }` (يظهر `message_sent_to_teacher` فقط عند إرسال رسالة الحل).

---

### 2.4 جلب رسائل شات معين (مدرس)

```
GET /api/support/teacher/chats/:chatId/messages
```

**Query (اختياري):** `limit`, `before` (نفس جلب رسائل المدرس).

**الصلاحية:**  
- `admin`: أي شات.  
- `teacher`: فقط إذا كان `chatId` يخص شات نفسه.

**الاستجابة (200):** `{ "messages": [ ... ], "can_teacher_send": true }` (يظهر `can_teacher_send` للمدرس فقط). بنفس شكل رسائل الشات.

---

### 2.5 رد الأدمن على شات المدرس

يتم استخدام **نفس endpoint إرسال الرسائل للدعم** مع تحديد الشات:

```
POST /api/support/messages
Content-Type: application/json
```

**Body (أدمن):**

```json
{
  "text": "نص الرد",
  "chat_id": 1
}
```

إذا كان `chat_id` يخص **شات مدرس** (`teacher_support_chats`)، يتم حفظ الرسالة في `teacher_support_messages` وإرسالها للمدرس عبر Socket. لا يُستخدم بوت المدرس هنا (الرد يدوي من الأدمن).

---

## 3. التحية اليومية التلقائية

- **الوقت:** كل يوم الساعة **8:00 صباحاً** (حسب ساعة السيرفر).
- **المستلمون:** كل المستخدمين بدور `teacher`.
- **النص المرسل (مرة واحدة في اليوم لكل مدرس):**

```
صباح الخير 👋
هل تواجه أي مشاكل في المنصة أو مشاكل يواجهها طلابك تحب نوصلها للإدارة؟
وأيضاً أقدر أساعدك في:
1️⃣ تقرير مفصل عن مستوى طلابك
2️⃣ أفكار تساعدك في تحسين التفاعل أو التسويق
```

- إذا كان آخر رسالة في الشات هي نفس التحية وتم إرسالها **نفس اليوم**، لا يُعاد إرسال التحية مرة ثانية.

---

## 4. Socket.io (Real-time)

### 4.1 انضمام المدرس

- عند اتصال المستخدم بدور `teacher` ينضم تلقائياً إلى الغرفة:  
  **`support:teacher:{teacherId}`**
- عند فتح واجهة الشات، يُرسل الحدث:  
  **`support:join-chat`** مع `chatId` (معرف شات المدرس من `GET /api/support/teacher/chat`).  
  السيرفر يضم الـ socket إلى غرفة الشات: **`support:teacher-chat:{chatId}`**

### 4.2 استقبال رسالة جديدة (مدرس)

العميل يستمع لـ:

- **`message:receive`** أو **`support:new-message`**

الـ payload يتضمن:

- `message`: كائن الرسالة (نفس شكل عنصر في `messages`).
- `chat_id`: معرف الشات.

### 4.3 إشعارات الأدمن

عند إرسال المدرس رسالة، يُرسل للأدمن:

- **`support:notification`** أو **`support:teacher-message`**

مع: `chat_id`, `teacher_id`, `teacher_name`, `teacher_email`, `message`, `unread_count`, إلخ.

### 4.4 انضمام الأدمن لشات مدرس

عند فتح الأدمن شات مدرس يُرسل:

**`support:join-chat`** مع `chatId` (معرف من `teacher_support_chats`).

السيرفر يتحقق من أن هذا `chatId` لشات مدرس ويضم الأدمن إلى **`support:teacher-chat:{chatId}`** حتى يصل له كل تحديث لهذا الشات.

---

## 5. الأزرار السريعة (Quick Buttons)

يُرجى استخدامها في الواجهة لتسريع اختيارات المدرس:

| Label (العرض)   | payload (يُرسل كنص في POST /api/support/teacher/messages) |
|-----------------|------------------------------------------------------------|
| تقرير طلابي    | `تقرير مستوى الطلاب`                                      |
| فكرة تسويقية   | `أفكار تسويقية`                                           |
| الإبلاغ عن مشكلة | `أريد الإبلاغ عن مشكلة`                                 |

عند الضغط على زر: أرسل `text: payload` في نفس الـ endpoint إرسال الرسالة؛ البوت سيتعامل معه كطلب تقرير أو فكرة أو مشكلة حسب الجدول أعلاه.

---

## 6. تسجيل المشاكل (support_tickets) — كيف ترجع مشاكل المدرسين للأدمن

عندما يرسل المدرس رسالة تُصنَّف كمشكلة/شكوى:

1. يُنشأ سجل في جدول **`support_tickets`** (مع `teacher_id`, `message_text`, `status: 'open'`).
2. حالة الشات تتغير إلى **`waiting_for_admin`** (تصعيد للإدارة).
3. يُرسل للمدرس الرد: *"تم تحويل مشكلتك للإدارة للعمل على حلها. عند حلها سأقوم بمراسلتك."*

**طرق وصول المشاكل للأدمن (ثلاث طرق):**

| الطريقة | الوصف |
|--------|--------|
| **1) إشعار Socket فوري** | عند كل مشكلة يُرسل للأدمن حدث **`support:teacher-problem-escalated`** و **`support:notification`** (نوع `teacher_problem_escalated`) ويحتوي على: `chat_id`, `teacher_id`, `teacher_name`, `teacher_email`, `problem_text`, وملخص `message`. |
| **2) قائمة الشاتات** | **`GET /api/support/teacher/chats`** تعيد كل شاتات المدرسين (مع `status` مثل `waiting_for_admin`). الأدمن يفتح الشات ويرى الرسائل عبر **`GET /api/support/teacher/chats/:chatId/messages`** ثم يرد عبر **`POST /api/support/messages`** مع `chat_id`. |
| **3) قائمة التذاكر (المشاكل)** | **`GET /api/support/teacher/tickets`** تعيد قائمة تذاكر الدعم: كل مشكلة مسجّلة مع اسم المدرس، الإيميل، نص المشكلة، الحالة، والتاريخ. مناسبة لعرض "صندوق مشاكل المدرسين" في لوحة الأدمن. |

**استجابة `GET /api/support/teacher/tickets` (للأدمن):**

```json
{
  "tickets": [
    {
      "id": 1,
      "chat_id": 5,
      "teacher_id": 28,
      "teacher_name": "أحمد محمد",
      "teacher_email": "teacher@example.com",
      "message_text": "الطلاب بيقولوا الأكواد مش شغالة...",
      "status": "open",
      "admin_notes": null,
      "created_at": "2025-02-06T12:00:00.000Z",
      "updated_at": "2025-02-06T12:00:00.000Z"
    }
  ],
  "pagination": { "total": 1, "limit": 50, "offset": 0, "has_more": false }
}
```

**Query اختياري:** `?status=open` أو `in_progress` أو `resolved` أو `closed` لفلترة التذاكر.

---

## 7. شكل التقرير المنسق (في الشات)

عند طلب "تقرير مستوى الطلاب" يُرجع البوت رسالة **نصية منسقة** (وليس JSON)، تحتوي تقريباً على:

- **تقرير الكورس:** اسم الكورس.
- **إحصائيات الطلاب:** إجمالي، جدد اليوم، نشطون، غير نشطين.
- **تفاعل المحاضرات:** عدد من شاهدوا آخر محاضرة، متوسط المشاهدة %.
- **آخر امتحان:** عدد من أدوا، نسبة النجاح، نسبة التفوق.
- **نقاط تحتاج تركيز:** أسئلة نسبة الخطأ فيها مرتفعة (نص السؤال أو "صورة السؤال"، نسبة الخطأ، عدد من أخطأ).

البيانات مصدرها **`GET /api/teacher/daily-course-report`** (صلاحية teacher فقط). الاستجابة: **`{ reports: [...] }`** — مصفوفة تقارير، **تقرير واحد لكل صف** (آخر كورس حسب تاريخ الإنشاء في ذلك الصف). كل عنصر له نفس شكل التقرير المفرد (course، students_stats، lecture_stats، last_exam، weak_questions)، مع إمكانية وجود `course.grade_id` و `course.grade_name`.  
**ملاحظة:** لو ظهر تقرير واحد فقط رغم وجود كورسات في أكثر من صف، تأكد أن كل كورس له **`grade_id`** مضبوط للصف الصحيح (أولى، ثانية، ثالثة ثانوي...) في قاعدة البيانات أو من واجهة إنشاء/تعديل الكورس.

---

## 8. ملخص المسارات

| Method | المسار | الصلاحية | الوظيفة |
|--------|--------|----------|---------|
| GET    | `/api/support/teacher/chat` | teacher | الحصول على الشات + أزرار سريعة |
| GET    | `/api/support/teacher/messages` | teacher | رسائل شات المدرس |
| POST   | `/api/support/teacher/messages` | teacher | إرسال رسالة + رد البوت |
| GET    | `/api/support/teacher/chats` | admin | قائمة شاتات المدرسين |
| GET    | `/api/support/teacher/tickets` | admin | قائمة تذاكر الدعم (مشاكل المدرسين) |
| PATCH  | `/api/support/teacher/tickets/:ticketId` | admin | تحديث حالة التذكرة + إرسال "تم حل مشكلتك" للمدرس |
| GET    | `/api/support/teacher/chats/:chatId/messages` | admin أو teacher (شات نفسه) | رسائل شات معين |
| POST   | `/api/support/messages` مع `chat_id` شات مدرس | admin | رد الأدمن على شات المدرس |

---

تم. لأي تعديل على النصوص أو السلوك (مثلاً تغيير وقت التحية أو إضافة أزرار) يمكن الرجوع إلى:

- `src/services/teacherSupportChatbot.ts` (نصوص التحية، الأزرار، وتصنيف الرسائل).
- `src/services/supportDailyReportJob.ts` (وقت وتنفيذ التحية اليومية).
