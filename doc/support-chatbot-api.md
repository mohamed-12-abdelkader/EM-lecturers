# Support Chatbot API — شات بوت الدعم الفني (الجديد)

توثيق تكامل **مساعد الدعم الفني** لمنصة EM Online.

المساعد يفهم نية المستخدم من سياق المحادثة (DeepSeek)، ويدعم الزوار بدون تسجيل دخول، مع معالجة خاصة لطلبات الاشتراك / رابط منصة مدرس (`SubscribeTeacher`) عبر البحث في قاعدة البيانات.

---

## Base URL

Production:

```txt
https://YOUR_API_DOMAIN/api/support
```

Local:

```txt
http://localhost:8000/api/support
```

---

## نظرة عامة على المسارات

| Method | Path | Auth | الوصف |
|--------|------|------|--------|
| `POST` | `/guest/start` | لا | بدء أو استئناف محادثة ضيف |
| `GET` | `/guest/chat` | لا | جلب محادثة الضيف والرسائل |
| `POST` | `/guest/messages` | لا | إرسال رسالة ضيف + رد البوت |
| `POST` | `/student/start` | طالب | بدء أو استئناف محادثة طالب |
| `GET` | `/student/chat` | طالب | جلب محادثة الطالب والرسائل |
| `POST` | `/student/messages` | طالب | إرسال رسالة طالب + رد البوت |

---

## المصادقة

| المستخدم | المصادقة |
|----------|----------|
| **ضيف (Guest)** | بدون توكن تسجيل دخول — يستخدم `guest_token` |
| **طالب (Student)** | `Authorization: Bearer <STUDENT_TOKEN>` |

لا يُشترط وجود حساب لاستخدام قناة الضيف. أي شخص يمكنه التحدث مع البوت.

```http
Authorization: Bearer <STUDENT_TOKEN>
```

---

## متغيرات البيئة

```env
DEEPSEEK_API_KEY=...
DEEPSEEK_API_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
TENANT_ROOT_DOMAIN=...   # لبناء رابط منصة المدرس (subdomain)
FRONTEND_HOST=...
```

| المتغير | الاستخدام |
|---------|-----------|
| `DEEPSEEK_API_KEY` | مفتاح DeepSeek لتوليد الردود وفهم النية |
| `DEEPSEEK_API_URL` | عنوان API (افتراضي: `https://api.deepseek.com`) |
| `DEEPSEEK_MODEL` | اسم الموديل (افتراضي: `deepseek-v4-flash`) |
| `TENANT_ROOT_DOMAIN` | نطاق بناء روابط منصات المدرسين |

---

## نماذج البيانات المشتركة

### Message

```ts
{
  id: number;
  sender_role: "guest" | "student" | "bot";
  text: string;
  intent: string | null;
  created_at: string; // ISO datetime
}
```

### Chat (ضيف)

```ts
{
  id: number;
  status: "open" | "closed";
  guest_token: string;
  current_intent: string | null;
}
```

### Chat (طالب)

```ts
{
  id: number;
  status: "open" | "closed";
  current_intent: string | null;
}
```

### Teacher match (عند SubscribeTeacher)

```ts
{
  teacher_id: number;
  teacher_name: string;
  subject: string | null;
  platform_url: string;
}
```

---

## Intents المدعومة

| Intent | المعنى |
|--------|--------|
| `SubscribeTeacher` | طلب اشتراك / رابط منصة مدرس / لينك تسجيل |
| `Greeting` | تحية |
| `Question` | سؤال عام |
| `Complaint` | شكوى |
| `LoginProblem` | مشكلة تسجيل دخول |
| `TechnicalIssue` | مشكلة تقنية |
| `CodeHelp` | مساعدة بخصوص كود |
| `Other` | غير مصنّف / عام |

---

## حالات الشات (`status`)

| الحالة | المعنى |
|--------|--------|
| `open` | المحادثة مفتوحة ويمكن الإرسال |
| `closed` | مغلقة — لا يمكن إرسال رسائل جديدة |

---

## قناة الضيف (Guest)

### 1) `POST /guest/start`

بدء محادثة جديدة، أو استئناف محادثة سابقة بإرسال `guest_token`.

#### Request body

```json
{
  "guest_token": "optional-existing-token"
}
```

| الحقل | النوع | مطلوب | الوصف |
|-------|------|--------|--------|
| `guest_token` | string | لا | إن وُجد يُستأنف نفس الشات؛ وإلا يُنشأ شات جديد |

#### Response `200`

```json
{
  "chat_id": 1,
  "guest_token": "4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc",
  "chat": {
    "id": 1,
    "status": "open",
    "guest_token": "4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc",
    "current_intent": null
  },
  "welcome_message": {
    "id": 1,
    "sender_role": "bot",
    "text": "أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟",
    "intent": "Greeting",
    "created_at": "2026-07-25T17:11:25.329Z"
  }
}
```

ملاحظات:

- احفظ `guest_token` في التطبيق (localStorage / SecureStore) لاستئناف المحادثة.
- `welcome_message` يظهر فقط عند أول رسالة في شات جديد؛ عند الاستئناف يكون `null`.

#### مثال تكامل

```http
POST /api/support/guest/start
Content-Type: application/json

{}
```

---

### 2) `GET /guest/chat`

جلب بيانات المحادثة وكل الرسائل.

#### Query

| المعامل | مطلوب | الوصف |
|---------|--------|--------|
| `guest_token` | نعم | توكن الضيف |

```http
GET /api/support/guest/chat?guest_token=4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc
```

#### Response `200`

```json
{
  "chat": {
    "id": 1,
    "status": "open",
    "guest_token": "4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc",
    "current_intent": "SubscribeTeacher"
  },
  "messages": [
    {
      "id": 1,
      "sender_role": "bot",
      "text": "أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟",
      "intent": "Greeting",
      "created_at": "2026-07-25T17:11:25.329Z"
    },
    {
      "id": 2,
      "sender_role": "guest",
      "text": "عايز أشترك",
      "intent": null,
      "created_at": "2026-07-25T17:12:01.100Z"
    },
    {
      "id": 3,
      "sender_role": "bot",
      "text": "أكيد، مع أي مدرس تريد الاشتراك؟",
      "intent": "SubscribeTeacher",
      "created_at": "2026-07-25T17:12:02.200Z"
    }
  ]
}
```

#### أخطاء شائعة

| Status | المعنى |
|--------|--------|
| `400` | `guest_token` ناقص |
| `404` | المحادثة غير موجودة — ابدأ بـ `/guest/start` |

---

### 3) `POST /guest/messages`

إرسال رسالة من الضيف والحصول على رد البوت فوراً في نفس الاستجابة.

#### Request body

```json
{
  "guest_token": "4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc",
  "text": "عايز منصة مستر محمد عبدالقادر"
}
```

| الحقل | النوع | مطلوب | القيود |
|-------|------|--------|--------|
| `guest_token` | string | نعم | min 8 أحرف |
| `text` | string | نعم | 1–4000 حرف |

#### Response `200`

```json
{
  "chat": {
    "id": 1,
    "guest_token": "4aeac04c1606e05eff4c83734665a3cc83fce6cace093ddc",
    "status": "open",
    "current_intent": "SubscribeTeacher"
  },
  "user_message": {
    "id": 4,
    "sender_role": "guest",
    "text": "عايز منصة مستر محمد عبدالقادر",
    "intent": null,
    "created_at": "2026-07-25T17:13:00.000Z"
  },
  "bot_message": {
    "id": 5,
    "sender_role": "bot",
    "text": "✅ يمكنك التسجيل من خلال الرابط التالي:\n\nhttps://mr-mohamed-haredy.em-online.online\n\nبعد الدخول إلى المنصة:\n\n1- قم بإنشاء حساب جديد.\n\n2- بعد تسجيل الدخول ستجد كورس الشهر الأول.\n\n3- اضغط على \"اشتراك\".\n\n4- أدخل كود الاشتراك المكون من 8 أرقام.\n\n5- سيتم تفعيل الكورس تلقائيًا على حسابك.",
    "intent": "SubscribeTeacher",
    "created_at": "2026-07-25T17:13:02.000Z"
  },
  "intent": "SubscribeTeacher",
  "teachers": [
    {
      "teacher_id": 23,
      "teacher_name": "محمد عبدالقادر",
      "subject": "الكيمياء",
      "platform_url": "https://mr-mohamed-haredy.em-online.online"
    }
  ]
}
```

ملاحظات للفرونت:

- اعرض `user_message` ثم `bot_message` في الواجهة.
- الحقل `teachers` اختياري؛ يظهر عند بحث اشتراك/منصة.
- زمن الرد يعتمد على DeepSeek وقد يستغرق عدة ثوانٍ — استخدم loading state.

#### أخطاء شائعة

| Status | المعنى |
|--------|--------|
| `400` | Validation failed / المحادثة مغلقة |
| `404` | `guest_token` غير صالح — استدعِ `/guest/start` أولاً |

---

## قناة الطالب (Student)

تتطلب توكن طالب. لا يوجد `guest_token` — الشات مرتبط بـ `student_id`.

### 4) `POST /student/start`

```http
POST /api/support/student/start
Authorization: Bearer <STUDENT_TOKEN>
Content-Type: application/json
```

#### Response `200`

```json
{
  "chat_id": 10,
  "chat": {
    "id": 10,
    "status": "open",
    "current_intent": null
  },
  "welcome_message": {
    "id": 100,
    "sender_role": "bot",
    "text": "أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟",
    "intent": "Greeting",
    "created_at": "2026-07-25T17:20:00.000Z"
  }
}
```

---

### 5) `GET /student/chat`

```http
GET /api/support/student/chat
Authorization: Bearer <STUDENT_TOKEN>
```

#### Response `200`

```json
{
  "chat": {
    "id": 10,
    "status": "open",
    "current_intent": "Question"
  },
  "messages": [
    {
      "id": 100,
      "sender_role": "bot",
      "text": "أهلاً بيك في دعم EM Online 👋 قولي محتاج مساعدة في إيه؟",
      "intent": "Greeting",
      "created_at": "2026-07-25T17:20:00.000Z"
    }
  ]
}
```

---

### 6) `POST /student/messages`

```http
POST /api/support/student/messages
Authorization: Bearer <STUDENT_TOKEN>
Content-Type: application/json

{
  "text": "عايز أشترك"
}
```

#### Response `200`

نفس شكل رد `/guest/messages` مع اختلاف:

- `user_message.sender_role` = `"student"`
- `chat` بدون `guest_token` (أو `null`)

```json
{
  "chat": {
    "id": 10,
    "guest_token": null,
    "status": "open",
    "current_intent": "SubscribeTeacher"
  },
  "user_message": {
    "id": 101,
    "sender_role": "student",
    "text": "عايز أشترك",
    "intent": null,
    "created_at": "2026-07-25T17:21:00.000Z"
  },
  "bot_message": {
    "id": 102,
    "sender_role": "bot",
    "text": "أكيد، مع أي مدرس تريد الاشتراك؟",
    "intent": "SubscribeTeacher",
    "created_at": "2026-07-25T17:21:01.000Z"
  },
  "intent": "SubscribeTeacher"
}
```

| Status | المعنى |
|--------|--------|
| `401` | توكن ناقص أو غير صالح |
| `400` | Validation / المحادثة مغلقة |

---

## سلوك Intent: `SubscribeTeacher`

يُفعَّل عندما يطلب المستخدم:

- الاشتراك مع مدرس
- رابط / لينك منصة
- منصة مستر …
- رابط التسجيل

### القواعد

| الحالة | رد البوت |
|--------|----------|
| بدون اسم مدرس | `أكيد، مع أي مدرس تريد الاشتراك؟` |
| مدرس واحد مطابق | رسالة الاشتراك الثابتة + رابط المنصة من DB |
| أكثر من مدرس متشابه | سؤال توضيح (مادة / مرحلة / لقب) — **بدون تخمين** |
| الاسم غير موجود | اعتذار وطلب كتابة الاسم أوضح |

### صياغة رسالة الرابط (ثابتة — لا تتغير)

```txt
✅ يمكنك التسجيل من خلال الرابط التالي:

{teacher_platform_url}

بعد الدخول إلى المنصة:

1- قم بإنشاء حساب جديد.

2- بعد تسجيل الدخول ستجد كورس الشهر الأول.

3- اضغط على "اشتراك".

4- أدخل كود الاشتراك المكون من 8 أرقام.

5- سيتم تفعيل الكورس تلقائيًا على حسابك.
```

### مثال تدفق محادثة

```txt
المستخدم: عايز أشترك
البوت: أكيد، مع أي مدرس تريد الاشتراك؟

المستخدم: محمد
البوت: لقيت أكتر من مدرس... قولي المادة أو المرحلة أو اللقب...

المستخدم: كيمياء
البوت: ✅ يمكنك التسجيل من خلال الرابط التالي: https://...
```

أو في رسالة واحدة:

```txt
المستخدم: عايز منصة مستر محمد عبدالقادر
البوت: ✅ يمكنك التسجيل من خلال الرابط التالي: https://...
```

---

## تدفق مقترح للفرونت (ضيف)

```txt
1. POST /guest/start
2. احفظ guest_token
3. اعرض welcome_message إن وُجد
4. عند إرسال رسالة → POST /guest/messages
5. أضف user_message + bot_message للـ UI
6. عند فتح الشات لاحقاً → GET /guest/chat?guest_token=...
```

```ts
async function startGuestSupport() {
  const res = await fetch(`${API}/api/support/guest/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guest_token: localStorage.getItem("support_guest_token") || undefined,
    }),
  });
  const data = await res.json();
  localStorage.setItem("support_guest_token", data.guest_token);
  return data;
}

async function sendGuestMessage(text: string) {
  const guest_token = localStorage.getItem("support_guest_token")!;
  const res = await fetch(`${API}/api/support/guest/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ guest_token, text }),
  });
  return res.json();
}
```

---

## ملاحظات مهمة

1. البوت يعتمد على **سياق المحادثة بالكامل** — لا تبدأ سيناريو جديد لكل رسالة.
2. لا يُطلب تسجيل دخول إلا إذا كان الطلب نفسه يحتاج حساباً.
3. روابط المنصات تُبنى من بيانات `tenants` في قاعدة البيانات — البوت لا يخترع روابط.
4. عند فشل DeepSeek يوجد fallback داخلي لطلبات الاشتراك الشائعة حتى يستمر الرد.
5. هذا النظام **REST فقط** حالياً (بدون Socket لأحداث الدعم).

---

## الجداول (Database)

Migration: `1776100000000_create_support_assistant.sql`

| الجدول | الدور |
|--------|--------|
| `support_chats` | محادثات الضيف/الطالب + `context_json` + `guest_token` |
| `support_messages` | الرسائل (`guest` / `student` / `bot`) |

---

## أكواد الأخطاء السريعة

| HTTP | متى |
|------|-----|
| `400` | حقول ناقصة / validation / شات مغلق |
| `401` | مسار الطالب بدون توكن صالح |
| `404` | `guest_token` غير معروف |
| `200` | نجاح العملية (حتى لو البوت اعتذر عن عدم إيجاد مدرس) |
