# Meeting الكورس — دليل المدرس (Course Meeting — Teacher Guide)

توثيق كامل لـ **جلسات البث المباشر (Live)** الخاصة بالكورس من جانب المدرس: من إنشاء الجلسة، الانضمام، فتح المايك والكاميرا، مشاركة الشاشة، وإدارة المشاركين.

**Base URL:** `http://localhost:8000/api/meeting`

جميع الطلبات (ما لم يُذكر غير ذلك) تتطلب مصادقة:  
`Authorization: Bearer <access_token>`

---

## نظرة عامة على التدفق (Flow)

1. **إنشاء جلسة** → `POST /api/meeting`
2. **جلب الجلسة الحالية (اختياري)** → `GET /api/meeting/me/current`
3. **معلومات قبل الدخول** → `GET /api/meeting/:id/pre-join`
4. **الحصول على توكن الدخول (LiveKit)** → `GET /api/meeting/:id/connection`
5. **الدخول للغرفة** عبر LiveKit SDK باستخدام `participantToken` و `serverUrl` و `roomName`
6. **المايك والكاميرا والشير** تُدار من جانب العميل (LiveKit) — للمدرس صلاحية كاملة للنشر
7. **مشاركة الشاشة** باستخدام `screenShareToken` المُعاد من نفس endpoint الـ connection
8. **إدارة المشاركين** (صلاحيات، طرد، إظهار/إخفاء زر رفع اليد)
9. **إنهاء الجلسة** → `POST /api/meeting/:id/close`

---

## 1. إنشاء جلسة (Meeting)

**`POST /api/meeting`**

- **الصلاحية:** مدرس أو أدمن
- **القيود:** لا يمكن إنشاء أكثر من جلسة نشطة واحدة (idle أو started) للمدرس في نفس الوقت.

**Body (JSON):**

```json
{
  "title": "عنوان الجلسة",
  "course_id": 14
}
```

| الحقل      | النوع   | مطلوب | الوصف                    |
|-----------|--------|-------|---------------------------|
| `title`   | string | نعم   | عنوان الجلسة (3 أحرف على الأقل) |
| `course_id` | number | نعم   | معرف الكورس               |

**Response 201:**

```json
{
  "message": "Meeting created",
  "meeting": {
    "id": "02e10c2f-916c-40ca-9ba3-cf850044a693",
    "course_id": 14,
    "room_sid": null,
    "egress_url": null,
    "title": "عنوان الجلسة",
    "allow_chat": true,
    "status": "idle",
    "created_by": 28,
    "created_at": "2026-03-14T20:57:11.339Z",
    "updated_at": "2026-03-14T20:57:11.339Z",
    "allow_waving_hand": false,
    "creator_name": "عمرو علي"
  }
}
```

- **ملاحظة:** يتم إرسال إشعار للطلاب المشتركين في نفس الكورس بوجود لايف جديد (قبل بدء البث).

---

## 2. تحديث جلسة

**`PUT /api/meeting/:id`**

- **الصلاحية:** صاحب الجلسة أو أدمن

**Body (JSON) — كل الحقول اختيارية:**

```json
{
  "title": "عنوان محدث",
  "egress_url": "https://www.youtube.com/watch?v=xxx"
}
```

| الحقل        | النوع   | الوصف                |
|-------------|--------|-----------------------|
| `title`     | string | عنوان الجلسة (3 أحرف على الأقل) |
| `egress_url`| string \| null | رابط التسجيل (مثلاً YouTube) |

---

## 3. حذف جلسة

**`DELETE /api/meeting/:id`**

- **الصلاحية:** صاحب الجلسة أو أدمن
- يحذف الجلسة من DB ويحاول حذف الغرفة من LiveKit إن وُجدت.

**Response 200:**  
`{ "message": "Meeting deleted", "meeting": { ... } }`

---

## 4. إنهاء الجلسة (إغلاق الغرفة)

**`POST /api/meeting/:id/close`**

- **الصلاحية:** صاحب الجلسة أو أدمن (أو مدير المجموعة في حالة جلسة مجموعة كورس عام)
- يغلق غرفة LiveKit ويحدّث الحالة إلى `ended`.

**Response 200:**  
`{ "message": "Meeting closed" }`

---

## 5. معلومات قبل الدخول (Pre-join)

**`GET /api/meeting/:id/pre-join`**

- **الصلاحية:** أي مستخدم مصادق له حق الدخول للجلسة (مدرس الجلسة، طالب مشترك في الكورس، أدمن)
- **الاستخدام:** جلب بيانات الجلسة وعدد المشاركين والمستخدم الحالي قبل فتح شاشة الدخول.

**Parameters:**

- `:id` — معرف الجلسة (UUID)، مثال: `02e10c2f-916c-40ca-9ba3-cf850044a693`

**Response 200:**

```json
{
  "meeting": {
    "id": "02e10c2f-916c-40ca-9ba3-cf850044a693",
    "course_id": 14,
    "title": "عنوان الجلسة",
    "status": "started",
    "participantsCount": 1,
    ...
  },
  "user": {
    "id": 28,
    "isOwner": true,
    "username": "عمرو علي",
    "avatar": "..."
  },
  "canEnter": true
}
```

- **`canEnter`:** يسمح للفرونت بتمكين زر «الدخول» دون اشتراط أن يكون `participantsCount > 0`.
- **`user.isOwner`:** يحدد إن كان المستخدم الحالي هو صاحب الجلسة (مدرس).

---

## 6. الحصول على توكن الدخول (Connection) — الانضمام للايف

**`GET /api/meeting/:id/connection`**

- **الصلاحية:** نفس شروط الدخول للجلسة (مدرس الجلسة، طالب مشترك، أدمن)
- **الاستخدام:** الحصول على توكن LiveKit لدخول الغرفة. للمدرس يُعاد أيضاً **توكن مشاركة الشاشة** (`screenShareToken`).

**Parameters:**

- `:id` — معرف الجلسة (UUID)
- **Query (اختياري):** `name` — الاسم المعروض في الغرفة (إن لم يُرسل يُستخدم اسم المستخدم من DB)

**سلوك جانبي:** عند طلب الـ connection من **صاحب الجلسة** والحالة `idle`، يتم تحديث حالة الجلسة إلى `started` فوراً حتى تظهر للطلاب كجلسة نشطة.

**Response 200:**

```json
{
  "participantToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "screenShareToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "serverUrl": "wss://your-livekit-server/live",
  "roomName": "02e10c2f-916c-40ca-9ba3-cf850044a693",
  "participantName": "عمرو علي",
  "isOwner": true
}
```

| الحقل              | الوصف |
|--------------------|--------|
| `participantToken` | توكن الدخول كـ participant أو host (حسب `isOwner`) — يُستخدم للانضمام، المايك، الكاميرا، والدردشة |
| `screenShareToken` | للمدرس فقط — توكن منفصل لمشاركة الشاشة (identity مختلف حتى لا يتعارض مع الـ participant الرئيسي) |
| `serverUrl`        | عنوان سيرفر LiveKit (WebSocket) |
| `roomName`         | اسم الغرفة (يساوي `meeting.id`) |
| `participantName`  | الاسم المعروض في الغرفة |
| `isOwner`          | إن كان المستخدم صاحب الجلسة (مدرس) |

---

## 7. مشاركة الشاشة (Screen Share) — الـ API والطريقة

### الـ API المسؤول عن مشاركة الشاشة (الوحيد)

لا يوجد endpoint منفصل لـ «بدء مشاركة الشاشة» أو «إيقافها». كل ما يلزم من الـ Backend يأتي من:

**`GET /api/meeting/:id/connection`**

- **المسار:** `/api/meeting/:id/connection` (نفس endpoint الدخول للايف)
- **المطلوب:** المستخدم مصادق + له حق الدخول للجلسة، و **أن يكون صاحب الجلسة (مدرس)** حتى يُعاد له توكن الشاشة

**الاستجابة للمدرس تحتوي على:**

| الحقل | الاستخدام في مشاركة الشاشة |
|--------|-----------------------------|
| `screenShareToken` | توكن LiveKit منفصل لمشاركة الشاشة — identity فيه `_screenShare` (مثلاً `user_28_meeting_<uuid>_screenShare`) ودور host مع `hidden: true` |
| `participantToken` | التوكن الرئيسي (مايك، كاميرا، حضور في الغرفة) |
| `serverUrl` | نفس السيرفر يُستخدم مع كلا التوكنين |
| `roomName` | نفس اسم الغرفة |

- **للطالب:** لا يُعاد `screenShareToken` (أو يكون `undefined`)؛ فقط المدرس (صاحب الجلسة) يحصل عليه.

### طريقة العمل من جانب الخادم (Backend)

1. عند طلب **Connection** للمدرس، الخادم يولّد توكنين:
   - **participantToken:** identity = `user_{userId}_meeting_{meetingId}`، role = host
   - **screenShareToken:** identity = `user_{userId}_meeting_{meetingId}_screenShare`، role = host، metadata فيها `hidden: true`
2. كلا التوكنين للغرفة نفسها (`roomName = meeting.id`).
3. لا يوجد استدعاء REST إضافي لبدء أو إيقاف الشير — كل ذلك يحدث من الفرونت عبر LiveKit.

### طريقة الاستخدام من جانب الواجهة (Frontend)

**الخيار (أ) — توكن واحد (participantToken):**  
في LiveKit، الـ host عادة يستطيع نشر track من نوع **screen** باستخدام نفس الـ `participantToken` بعد الانضمام للغرفة (نشر `TrackSource.ScreenShare` أو ما يعادله في الـ SDK). في هذه الحالة قد لا تحتاج استخدام `screenShareToken` إلا إذا أردت فصل مشاركة الشاشة في identity منفصل.

**الخيار (ب) — توكن منفصل للشاشة (screenShareToken):**  
- إنشاء **اتصال ثانٍ** للغرفة نفسها باستخدام `screenShareToken` و `serverUrl` و `roomName`.
- هذا الاتصال يكون بمشارك «مخفي» (hidden) يقتصر على نشر track الشاشة فقط.
- عند الضغط على «مشاركة الشاشة»: الاتصال بالغرفة بهذا التوكن ثم بدء capture الشاشة ونشر الـ track.
- عند «إيقاف المشاركة»: إيقاف الـ track وإغلاق هذا الاتصال الثانوي.

**ملخص:**  
- **الـ API المسؤول عن مشاركة الشاشة:** `GET /api/meeting/:id/connection` فقط (يُرجع `screenShareToken` للمدرس).  
- **لا يوجد:** `POST` لبدء شير أو `DELETE` لإيقافه — كل ذلك من الفرونت عبر LiveKit SDK باستخدام التوكنات المُعادة من هذا الـ endpoint.

---

## 8. المايك والكاميرا (من جانب المدرس)

هذه الأمور **لا تُدار عبر REST** بل عبر **LiveKit من جانب العميل** باستخدام `participantToken` و `serverUrl` و `roomName`.

- **مدرس (host):** التوكن يمنحه صلاحية النشر (مايك، كاميرا، وشاشة إن استخدمها من نفس الاتصال أو من توكن الشاشة).
- **طالب (participant):** `canPublish: false` إلا إذا منحه المدرس صلاحية عبر `PATCH /api/meeting/:id/participant/:participantId`.

المايك والكاميرا: تفعيل/إيقاف من واجهة LiveKit في الفرونت بدون استدعاء أي endpoint إضافي.

---

## 9. تحديث صلاحيات مشارك (ميكروفون / كاميرا لطالب)

**`PATCH /api/meeting/:id/participant/:participantId`**

- **الصلاحية:** صاحب الجلسة أو أدمن
- **الاستخدام:** منح أو سحب صلاحيات نشر (مثلاً السماح لطالب بفتح المايك/الكاميرا).

**Parameters:**

- `:id` — معرف الجلسة (UUID)
- `:participantId` — معرف المشارك في LiveKit (مثلاً `user_123_meeting_xxx`)

**Body (JSON):**

```json
{
  "permissions": {
    "canPublish": true,
    "canPublishData": true
  }
}
```

- الخادم يمرّر `permissions` لـ LiveKit مع الإبقاء على `canSubscribe: true`.
- **ملاحظة:** أسماء الحقول قد تتبع واجهة LiveKit `updateParticipant` (راجع LiveKit docs للخيارات الدقيقة).

---

## 10. إظهار / إخفاء زر رفع اليد (Wave Hand)

**`PATCH /api/meeting/:id/wavehand`**

- **الصلاحية:** صاحب الجلسة أو أدمن

**Body (JSON):**

```json
{
  "visible": true
}
```

| الحقل     | النوع   | الوصف                          |
|----------|--------|---------------------------------|
| `visible`| boolean | `true` = إظهار زر رفع اليد للطلاب، `false` = إخفاؤه |

يتم تحديث **غرفة LiveKit** عبر `updateRoomMetadata` بمفتاح `waveHandVisible`. الفرونت يقرأ الـ metadata ويعرض أو يخفي الزر حسبها.

---

## 11. طرد مشارك (Kick)

**`POST /api/meeting/:id/participant/:participantId/kick`**

- **الصلاحية:** صاحب الجلسة أو أدمن
- يخرج المشارك من غرفة LiveKit ويسجّله في `kicked_participants` حتى لا يستطيع إعادة الدخول.

**Parameters:**

- `:id` — معرف الجلسة
- `:participantId` — معرف المشارك في LiveKit

**Response 200:**  
`{ "message": "Participant kicked successfully." }`

---

## 12. جلستي النشطة الحالية (للمدرس)

**`GET /api/meeting/me/current`**

- **الصلاحية:** مدرس أو أدمن
- يُرجع **جلسة واحدة** فقط: آخر جلسة للمستخدم بحالة `started` أو `idle`.

**Response 200:**

```json
{
  "meeting": {
    "id": "02e10c2f-916c-40ca-9ba3-cf850044a693",
    "course_id": 14,
    "title": "عنوان الجلسة",
    "status": "started",
    ...
  }
}
```

**Response 404:**  
`{ "message": "No active meeting found" }`

---

## 13. قائمة جلساتي (للمدرس)

**`GET /api/meeting/me`**

- **الصلاحية:** مدرس أو أدمن

**Query (اختياري):**

| الحقل       | النوع   | الوصف           |
|------------|--------|------------------|
| `courseId` | number | تصفية حسب الكورس |
| `limit`    | number | عدد النتائج (افتراضي 10) |
| `skip`     | number | إزاحة للترقيم    |

**Response 200:**

```json
{
  "meetings": [ { "id": "...", "course_id": 14, "title": "...", "status": "idle", ... } ],
  "pagination": { "limit": 10, "skip": 0, "count": 1 }
}
```

---

## 14. جلسات كورس معيّن (للطلاب/المدرس)

**`GET /api/meeting/course/:courseId`**

- **الصلاحية:** المستخدم يجب أن يكون مسجلاً في الكورس (طالب أو مدرس أو أدمن حسب منطق الـ backend)
- يُستخدم لعرض قائمة جلسات البث الخاصة بكورس (مثلاً في صفحة الكورس).

**Response 200:**

```json
{
  "meetings": [
    {
      "id": "02e10c2f-916c-40ca-9ba3-cf850044a693",
      "course_id": 14,
      "room_sid": null,
      "egress_url": null,
      "title": "tytr",
      "allow_chat": true,
      "status": "started",
      "created_by": 28,
      "creator_name": "عمرو علي",
      ...
    }
  ]
}
```

- **`status`:** `idle` | `started` | `ended` — الفرونت يعرض الجلسة كـ «نشطة» عندما تكون `started` (أو حسب تصميمك مع `idle` و `canEnter`).

---

## 15. تحميل التسجيل (للمدرس/الأدمن)

**`GET /api/meeting/:id/recording/download`**

- **الصلاحية:** صاحب الجلسة أو أدمن
- يُنزّل ملف التسجيل (بعد انتهاء الجلسة ومعالجة الـ egress). إن وُجد نسخة مضغوطة تُعاد بدلاً من الأصلية.

**Response:**  
ملف فيديو (مثلاً `recording-{id}-low.mp4`).

**Response 404:**  
التسجيل غير موجود.

---

## 16. ملخص سريع لتدفق المدرس (من الانضمام للمايك والكاميرا والشير)

| الخطوة | الـ API / الإجراء |
|--------|-------------------|
| 1 | `POST /api/meeting` — إنشاء جلسة (title, course_id) |
| 2 | (اختياري) `GET /api/meeting/me/current` — التأكد من الجلسة النشطة |
| 3 | `GET /api/meeting/:id/pre-join` — جلب بيانات الجلسة وعدد المشاركين و canEnter |
| 4 | `GET /api/meeting/:id/connection` — جلب participantToken و screenShareToken و serverUrl و roomName |
| 5 | الانضمام للغرفة عبر LiveKit SDK باستخدام participantToken و serverUrl و roomName |
| 6 | فتح المايك والكاميرا من واجهة LiveKit في الفرونت (بدون استدعاء API إضافي) |
| 7 | مشاركة الشاشة باستخدام screenShareToken من الخطوة 4 (تنفيذ من الفرونت عبر LiveKit) |
| 8 | (اختياري) `PATCH /api/meeting/:id/participant/:participantId` — منح طالب صلاحية نشر |
| 9 | (اختياري) `PATCH /api/meeting/:id/wavehand` — إظهار/إخفاء زر رفع اليد |
| 10 | (اختياري) `POST /api/meeting/:id/participant/:participantId/kick` — طرد مشارك |
| 11 | `POST /api/meeting/:id/close` — إنهاء الجلسة وإغلاق الغرفة |

---

## 17. Webhooks (مرجع للمطورين)

الخادم يستقبل أحداث LiveKit على:

**`POST /api/meeting/webhook`**

- **`room_started`:** عند بدء الغرفة (أول مشارك ينضم) — يحدّث حالة الجلسة إلى `started` ويحفظ `room_sid` وقد يبدأ التسجيل (egress).
- **`room_finished`:** عند انتهاء الغرفة — يحدّث الحالة إلى `ended`.
- **`egress_ended`:** عند انتهاء التسجيل — قد يرفع الفيديو لـ YouTube ويحفظ الرابط في `egress_url`.

لا يحتاج المدرس لاستدعاء الـ webhook يدوياً؛ الإعداد يتم في لوحة LiveKit ليرسل الأحداث إلى هذا المسار.

---

## رموز الحالة والصلاحيات

- **حالة الجلسة:** `idle` → `started` (عند دخول المحاضر أو عند استلام webhook room_started) → `ended` (عند الإغلاق أو room_finished).
- **مدرس (host):** يستطيع النشر (مايك، كاميرا، شير)، إدارة الغرفة، تحديث صلاحيات المشاركين، طرد، وإغلاق الجلسة.
- **طالب (participant):** يستمع ويشاهد فقط ما لم يمنحه المدرس صلاحية النشر عبر `PATCH .../participant/:participantId`.

إذا احتجت تفاصيل إضافية لأي endpoint (مثل شكل الأخطاء أو حالات 403/404) يمكن توثيقها في نفس الملف لاحقاً.
