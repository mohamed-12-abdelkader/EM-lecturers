# توثيق نظام الدردشة داخل الميتنج

## نظرة عامة

نظام الدردشة داخل الميتنجات في هذا المشروع مرتبط بجلسات البث المباشر التي تعمل عبر **LiveKit**. الدردشة هنا ليست نفس نظام الشات العام الموجود في `/api/chat`، وليست مبنية على Socket.IO أو جدول `chat_messages`.

داخل الميتنج، السماح بإرسال رسائل الدردشة يتم عن طريق صلاحية LiveKit اسمها:

```text
canPublishData
```

هذه الصلاحية تُضاف داخل LiveKit token الذي يحصل عليه المستخدم من endpoint الاتصال بالميتنج. قيمة الصلاحية تعتمد على حقل `allow_chat` الموجود في جدول الميتنج.

---

## الفرق بين شات الميتنج والشات العام

### شات الميتنج

- يعمل داخل غرفة LiveKit الخاصة بالميتنج.
- يستخدم LiveKit Data Messages / Data Channel.
- لا يتم حفظ الرسائل في قاعدة بيانات المشروع.
- يتم التحكم فيه من خلال `allow_chat` على مستوى الميتنج.
- يتم تفعيل أو تعطيل الإرسال من خلال صلاحية `canPublishData` داخل LiveKit token.
- مناسب للرسائل اللحظية أثناء اللايف فقط.

### الشات العام

- يعمل عبر Socket.IO.
- يتم حفظ الرسائل في جدول `chat_messages`.
- له مجموعات مثل `chat_groups` وأعضاء مثل `chat_group_members`.
- يدعم history، مرفقات، رسائل صوتية، replies، تعديل وحذف.
- موثق في `doc/chat.md`.

> مهم: أي رسالة تُرسل داخل LiveKit meeting chat لا تظهر في `/api/chat` ولا يتم جلبها من history، لأنها غير مخزنة في قاعدة البيانات.

---

## مصادر الكود المرتبطة

### ملفات التحكم في الميتنج

- `src/controllers/meeting.ts`
  - إنشاء ميتنجات الكورسات العادية.
  - جلب بيانات pre-join.
  - إصدار LiveKit connection token.
  - إدارة المشاركين والطرد والإغلاق.

- `src/controllers/generalCourseGroupMeeting.ts`
  - نفس فكرة الميتنج، لكن لمجموعات الكورسات العامة.
  - يصدر token بنفس منطق `allow_chat`.

### ملفات الصلاحيات والخدمات

- `src/services/meetings-room-services.ts`
  - يحتوي على `generateParticipantToken`.
  - يضع قيمة `canPublishData` حسب `allowChat`.

- `src/middleware/meetings.ts`
  - يتحقق من أن الميتنج نشط.
  - يتحقق من صلاحية الدخول.
  - يمنع المستخدم المطرود من الدخول مرة أخرى.

### ملفات قاعدة البيانات

- `migrations/1700000000044_base-streams.sql`
  - جدول `meeting`.
  - جدول `kicked_participants`.

- `migrations/1700000006001_general_course_group_meeting.sql`
  - جدول `general_course_group_meeting`.
  - جدول `general_course_group_meeting_kicked`.

---

## تصميم البيانات

### جدول `meeting`

خاص بميتنجات الكورسات العادية.

| الحقل | النوع | الوصف |
| --- | --- | --- |
| `id` | `UUID` | معرف الميتنج، ويستخدم أيضاً كاسم غرفة LiveKit. |
| `course_id` | `INTEGER` | الكورس المرتبط بالميتنج. |
| `room_sid` | `VARCHAR` | معرف الغرفة من LiveKit عند بدء البث. |
| `egress_url` | `VARCHAR` | رابط التسجيل بعد رفعه أو حفظه. |
| `title` | `TEXT` | عنوان الميتنج. |
| `allow_chat` | `BOOLEAN` | يتحكم في سماح إرسال رسائل الشات داخل LiveKit. القيمة الافتراضية `true`. |
| `status` | `VARCHAR` | حالة الميتنج: `idle`, `started`, `ended`. |
| `created_by` | `INTEGER` | المستخدم الذي أنشأ الميتنج. |
| `created_at` | `TIMESTAMP` | وقت الإنشاء. |
| `updated_at` | `TIMESTAMP` | وقت آخر تحديث. |

### جدول `general_course_group_meeting`

خاص بميتنجات مجموعات الكورسات العامة.

| الحقل | النوع | الوصف |
| --- | --- | --- |
| `id` | `UUID` | معرف الميتنج، ويستخدم كاسم غرفة LiveKit. |
| `group_id` | `INTEGER` | مجموعة الكورس العام المرتبطة بالميتنج. |
| `room_sid` | `VARCHAR` | معرف الغرفة من LiveKit. |
| `egress_url` | `VARCHAR` | رابط التسجيل. |
| `title` | `TEXT` | عنوان الميتنج. |
| `allow_chat` | `BOOLEAN` | يتحكم في السماح بإرسال رسائل الشات داخل LiveKit. |
| `status` | `VARCHAR` | حالة الميتنج: `idle`, `started`, `ended`. |
| `created_by` | `INTEGER` | منشئ الميتنج. |
| `created_at` | `TIMESTAMP` | وقت الإنشاء. |
| `updated_at` | `TIMESTAMP` | وقت آخر تحديث. |

### جداول الطرد

#### `kicked_participants`

يستخدم مع ميتنجات الكورسات العادية.

| الحقل | الوصف |
| --- | --- |
| `meeting_id` | معرف الميتنج. |
| `user_id` | المستخدم المطرود. |
| `kicked_at` | وقت الطرد. |

#### `general_course_group_meeting_kicked`

يستخدم مع ميتنجات مجموعات الكورسات العامة.

| الحقل | الوصف |
| --- | --- |
| `meeting_id` | معرف الميتنج. |
| `user_id` | المستخدم المطرود. |
| `kicked_at` | وقت الطرد. |

---

## كيف يعمل السماح بالشات؟

قيمة `allow_chat` تتحول إلى `allowChat` عند إصدار LiveKit token، ثم تتحول داخل token إلى:

```text
canPublishData: allowChat
```

المنطق موجود في `generateParticipantToken`:

```typescript
const videoGrant: VideoGrant = {
  room: roomName,
  roomJoin: true,
  canSubscribe: true,
  canPublishData: allowChat,
  hidden,
};
```

### عندما تكون `allow_chat = true`

- يحصل المستخدم على token فيه `canPublishData = true`.
- يستطيع العميل إرسال data messages داخل LiveKit room.
- تظهر الرسائل للمشاركين المتصلين حسب تنفيذ الواجهة الأمامية.

### عندما تكون `allow_chat = false`

- يحصل المستخدم على token فيه `canPublishData = false`.
- LiveKit يمنع المستخدم من إرسال data messages.
- يمكن للمستخدم الدخول للميتنج ومشاهدة البث إذا كانت باقي الصلاحيات صحيحة.

> ملاحظة مهمة: حالياً لا يوجد endpoint واضح في الكود لتغيير `allow_chat` مباشرة من الـ API. الحقل موجود في قاعدة البيانات ويتم استخدامه عند إصدار token، لكن لا يوجد route مخصص مثل `PATCH /api/meeting/:id/chat-permission`.

---

## إصدار توكن الاتصال بالميتنج

### ميتنج كورس عادي

```http
GET /api/meeting/:id/connection
Authorization: Bearer <TOKEN>
```

### ميتنج مجموعة كورس عام

```http
GET /api/general-courses/meeting/:id/connection
Authorization: Bearer <TOKEN>
```

### Query Parameters

| الاسم | النوع | مطلوب | الوصف |
| --- | --- | --- | --- |
| `name` | `string` | لا | اسم مخصص للمشارك داخل LiveKit. إذا لم يُرسل، يستخدم اسم المستخدم من الحساب. |

### Response متوقع

```json
{
  "participantToken": "LIVEKIT_JWT_TOKEN",
  "screenShareToken": "LIVEKIT_SCREEN_SHARE_TOKEN",
  "serverUrl": "wss://livekit.example.com",
  "roomName": "550e8400-e29b-41d4-a716-446655440000",
  "participantName": "Ahmed",
  "isOwner": true
}
```

### ملاحظات

- `screenShareToken` يرجع فقط لصاحب الميتنج.
- `roomName` يساوي `meeting.id`.
- `participantToken` يحتوي على صلاحية `canPublishData` حسب قيمة `allow_chat`.
- إذا كان المستخدم مطروداً من الميتنج، لن يحصل على token.
- إذا كان الميتنج `ended`، لن يتم اعتباره active meeting.

---

## صلاحيات LiveKit داخل التوكن

### المستخدم العادي داخل الميتنج

المستخدم غير صاحب الميتنج يحصل على role:

```text
participant
```

وتكون الصلاحيات الأساسية:

| الصلاحية | القيمة | الوصف |
| --- | --- | --- |
| `roomJoin` | `true` | يسمح بدخول غرفة LiveKit. |
| `canSubscribe` | `true` | يسمح باستقبال بث وصوت وبيانات الآخرين. |
| `canPublish` | `false` | لا يسمح بنشر صوت/فيديو كمتحدث افتراضياً. |
| `canPublishData` | حسب `allow_chat` | يسمح أو يمنع إرسال رسائل Data داخل الشات. |
| `canUpdateOwnMetadata` | `false` | لا يسمح بتعديل metadata الخاصة به. |

### صاحب الميتنج

صاحب الميتنج يحصل على role:

```text
host
```

وتضاف له صلاحيات إدارة:

| الصلاحية | الوصف |
| --- | --- |
| `roomAdmin` | إدارة الغرفة. |
| `roomCreate` | إنشاء الغرفة عند الاتصال. |
| `canUpdateOwnMetadata` | تعديل metadata الخاصة به. |
| `canPublishData` | حسب `allow_chat`. |

### التسجيل التلقائي

عند بدء التسجيل، يتم إصدار token بدور:

```text
egress
```

ويحصل على صلاحية:

```text
roomRecord: true
```

---

## هوية المشاركين داخل LiveKit

الهوية المستخدمة داخل LiveKit لها صيغة ثابتة:

```text
user_{userId}_meeting_{meetingId}
```

مثال:

```text
user_123_meeting_550e8400-e29b-41d4-a716-446655440000
```

هوية مشاركة الشاشة لصاحب الميتنج:

```text
user_{userId}_meeting_{meetingId}_screenShare
```

هذه الهوية مهمة عند:

- عرض المشاركين.
- تحديث صلاحيات مشارك.
- طرد مشارك من LiveKit room.
- ربط رسالة الشات باسم أو avatar المرسل في الواجهة الأمامية.

---

## تدفق عمل شات الميتنج

### 1. إنشاء الميتنج

يقوم المدرس أو الأدمن بإنشاء الميتنج.

```http
POST /api/meeting
```

أو لمجموعات الكورسات العامة:

```http
POST /api/general-courses/groups/:groupId/meeting
```

افتراضياً:

```text
allow_chat = true
status = idle
```

### 2. فتح شاشة ما قبل الدخول

العميل يستدعي:

```http
GET /api/meeting/:id/pre-join
```

أو:

```http
GET /api/general-courses/meeting/:id/pre-join
```

الرد يحتوي على بيانات الميتنج، ومنها:

```json
{
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة مباشرة",
    "allow_chat": true,
    "participantsCount": 12
  },
  "user": {
    "id": 123,
    "isOwner": false,
    "username": "Ahmed",
    "avatar": "https://example.com/avatar.png"
  },
  "canEnter": true
}
```

### 3. الحصول على LiveKit token

العميل يستدعي endpoint الاتصال:

```http
GET /api/meeting/:id/connection
```

الـ backend:

1. يتحقق أن الميتنج نشط `idle` أو `started`.
2. يتحقق من صلاحية الوصول.
3. يتحقق أن المستخدم غير مطرود.
4. يحدد هل المستخدم صاحب الميتنج أم مشارك.
5. يقرأ `allow_chat`.
6. يصدر token فيه `canPublishData`.

### 4. الاتصال بغرفة LiveKit

في الواجهة الأمامية، يتم استخدام `serverUrl` و `participantToken`:

```javascript
import { Room, RoomEvent } from 'livekit-client';

const room = new Room();

await room.connect(connection.serverUrl, connection.participantToken);

room.on(RoomEvent.Connected, () => {
  console.log('Connected to meeting');
});
```

### 5. إرسال رسالة شات داخل الميتنج

بعد الاتصال، يتم إرسال الرسالة كـ Data Message داخل LiveKit.

مثال مقترح للواجهة الأمامية:

```javascript
const encoder = new TextEncoder();

const payload = {
  type: 'meeting-chat-message',
  text: 'السلام عليكم',
  sentAt: new Date().toISOString(),
};

await room.localParticipant.publishData(
  encoder.encode(JSON.stringify(payload)),
  { reliable: true }
);
```

إذا كان `allow_chat = false` وقت إصدار التوكن، فلن يسمح LiveKit للمستخدم بإرسال data messages.

### 6. استقبال رسالة شات داخل الميتنج

مثال مقترح:

```javascript
const decoder = new TextDecoder();

room.on(RoomEvent.DataReceived, (payload, participant) => {
  const data = JSON.parse(decoder.decode(payload));

  if (data.type !== 'meeting-chat-message') return;

  console.log('Message from:', participant?.identity);
  console.log('Text:', data.text);
});
```

> التنفيذ الفعلي لشكل الرسالة، عرضها، وحفظها مؤقتاً في state هو مسؤولية الواجهة الأمامية، لأن الـ backend لا يستقبل رسائل الميتنج ولا يخزنها.

---

## شكل رسالة مقترح

لأن LiveKit data message عبارة عن bytes، الأفضل الاتفاق على JSON واضح بين الواجهة الأمامية والأجهزة المختلفة.

```json
{
  "type": "meeting-chat-message",
  "id": "client-generated-uuid",
  "meetingId": "550e8400-e29b-41d4-a716-446655440000",
  "sender": {
    "id": 123,
    "identity": "user_123_meeting_550e8400-e29b-41d4-a716-446655440000",
    "name": "Ahmed",
    "avatar": "https://example.com/avatar.png",
    "role": "participant"
  },
  "text": "السلام عليكم",
  "sentAt": "2026-06-10T06:30:00.000Z"
}
```

### الحقول المقترحة

| الحقل | مطلوب | الوصف |
| --- | --- | --- |
| `type` | نعم | يميز نوع الرسالة، مثل `meeting-chat-message`. |
| `id` | يفضل | معرف يولده العميل لتجنب التكرار في الواجهة. |
| `meetingId` | يفضل | معرف الميتنج. |
| `sender` | يفضل | بيانات المرسل لسهولة العرض. |
| `text` | نعم | نص الرسالة. |
| `sentAt` | نعم | وقت الإرسال من العميل. |

---

## APIs مرتبطة بالشات داخل الميتنج

لا توجد APIs مباشرة لإرسال أو جلب رسائل شات الميتنج، لكن توجد APIs تؤثر على عمل الشات.

### 1. معلومات ما قبل الدخول

#### كورس عادي

```http
GET /api/meeting/:id/pre-join
```

#### مجموعة كورس عام

```http
GET /api/general-courses/meeting/:id/pre-join
```

#### الاستخدام

- معرفة بيانات الميتنج.
- معرفة حالة `allow_chat`.
- معرفة هل المستخدم owner.
- عرض عدد المشاركين.

### 2. الاتصال بالميتنج

#### كورس عادي

```http
GET /api/meeting/:id/connection
```

#### مجموعة كورس عام

```http
GET /api/general-courses/meeting/:id/connection
```

#### الاستخدام

- الحصول على `participantToken`.
- الحصول على `serverUrl`.
- التحقق الضمني من صلاحيات الدخول.
- تطبيق صلاحية الشات داخل LiveKit token.

### 3. تحديث صلاحيات مشارك

#### كورس عادي

```http
PATCH /api/meeting/:id/participant/:participantId
```

#### مجموعة كورس عام

```http
PATCH /api/general-courses/meeting/:id/participant/:participantId
```

#### Body

```json
{
  "permissions": {
    "canPublishData": true,
    "canPublish": false,
    "canSubscribe": true
  }
}
```

#### الاستخدام

يمكن استخدامه لتحديث صلاحية `canPublishData` لمشارك موجود داخل LiveKit room، لكن يجب الانتباه إلى أن هذا لا يغير قيمة `allow_chat` في قاعدة البيانات. عند إعادة إصدار token جديد، ستعود الصلاحية حسب قيمة `allow_chat`.

### 4. طرد مشارك

#### كورس عادي

```http
POST /api/meeting/:id/participant/:participantId/kick
```

#### مجموعة كورس عام

```http
POST /api/general-courses/meeting/:id/participant/:participantId/kick
```

#### التأثير على الشات

- المشارك المطرود يخرج من الغرفة.
- لا يستطيع الحصول على token جديد لنفس الميتنج.
- بالتالي لا يستطيع مشاهدة البث أو إرسال رسائل شات.

---

## الصلاحيات والتحقق من الدخول

### كورس عادي

المستخدم يستطيع دخول الميتنج إذا كان واحداً من التالي:

- `admin`.
- صاحب الميتنج `created_by`.
- طالب مشترك في الكورس المرتبط بالميتنج.

### مجموعة كورس عام

المستخدم يستطيع دخول الميتنج إذا كان واحداً من التالي:

- `admin`.
- صاحب الميتنج.
- مدرس المجموعة.
- طالب مسجل في المجموعة.

### المنع بعد الطرد

قبل pre-join والاتصال، يتم فحص جداول الطرد:

- `kicked_participants` لميتنجات الكورسات العادية.
- `general_course_group_meeting_kicked` لميتنجات مجموعات الكورسات العامة.

إذا كان المستخدم موجوداً في جدول الطرد، يرجع الخطأ:

```json
{
  "message": "You have been removed from this meeting and cannot rejoin."
}
```

---

## حالات الميتنج وتأثيرها على الشات

| الحالة | الوصف | تأثيرها على الشات |
| --- | --- | --- |
| `idle` | الميتنج تم إنشاؤه ولم يبدأ فعلياً. | يمكن إصدار token، وبالتالي يمكن تجهيز الاتصال. |
| `started` | الميتنج بدأ والغرفة نشطة. | الشات يعمل حسب `allow_chat`. |
| `ended` | الميتنج انتهى. | لا يتم إصدار token من endpoints الخاصة بالميتنج النشط. |

---

## أمثلة Front-End كاملة

### الاتصال بالميتنج وتشغيل الشات

```javascript
import { Room, RoomEvent } from 'livekit-client';

async function joinMeeting(meetingId, token) {
  const connectionResponse = await fetch(`/api/meeting/${meetingId}/connection`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!connectionResponse.ok) {
    throw new Error('Failed to get meeting connection');
  }

  const connection = await connectionResponse.json();
  const room = new Room();

  await room.connect(connection.serverUrl, connection.participantToken);

  return {
    room,
    connection,
  };
}
```

### إرسال رسالة

```javascript
async function sendMeetingChatMessage(room, meetingId, text) {
  const cleanText = String(text || '').trim();
  if (!cleanText) return;

  const message = {
    type: 'meeting-chat-message',
    id: crypto.randomUUID(),
    meetingId,
    text: cleanText,
    sentAt: new Date().toISOString(),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(message));

  await room.localParticipant.publishData(encoded, { reliable: true });
}
```

### استقبال الرسائل

```javascript
function listenToMeetingChat(room, onMessage) {
  const decoder = new TextDecoder();

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    try {
      const message = JSON.parse(decoder.decode(payload));

      if (message.type !== 'meeting-chat-message') return;

      onMessage({
        ...message,
        participantIdentity: participant?.identity,
        participantName: participant?.name,
      });
    } catch {
      // Ignore non-chat data messages.
    }
  });
}
```

### تعطيل زر الإرسال من الواجهة

الأفضل أن تعتمد الواجهة على قيمة `allow_chat` القادمة من pre-join:

```javascript
const preJoinResponse = await fetch(`/api/meeting/${meetingId}/pre-join`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

const preJoin = await preJoinResponse.json();
const isChatEnabled = preJoin.meeting.allow_chat !== false;
```

ثم:

- إذا `isChatEnabled = true` يتم عرض input الإرسال.
- إذا `isChatEnabled = false` يتم تعطيل input الإرسال وإظهار رسالة مثل: "الدردشة غير مفعلة في هذه المحاضرة".

---

## الأخطاء المتوقعة

### `401 Unauthorized`

السبب:

- لم يتم إرسال token.
- token غير صالح أو منتهي.

الحل:

- إرسال `Authorization: Bearer <TOKEN>`.
- إعادة تسجيل الدخول عند انتهاء الجلسة.

### `403 Forbidden`

الأسباب المحتملة:

- المستخدم لا يملك صلاحية دخول الميتنج.
- الطالب غير مشترك في الكورس أو المجموعة.
- المستخدم مطرود من الميتنج.

### `404 Not Found`

الأسباب المحتملة:

- الميتنج غير موجود.
- الميتنج ليس active.
- حالة الميتنج `ended`.

### فشل إرسال رسالة داخل LiveKit

الأسباب المحتملة:

- `allow_chat = false` وبالتالي token لا يحتوي على `canPublishData`.
- المستخدم غير متصل بالغرفة.
- الاتصال بـ LiveKit غير مستقر.
- الواجهة تحاول إرسال payload كبير أو غير صحيح.

---

## حدود النظام الحالية

1. لا يوجد تخزين server-side لرسائل شات الميتنج.
2. لا يوجد history لرسائل شات الميتنج بعد الخروج أو إعادة تحميل الصفحة.
3. لا يوجد endpoint واضح لتغيير `allow_chat` حالياً.
4. لا يوجد moderation على مستوى محتوى الرسائل داخل backend لأن الرسائل لا تمر على API المشروع.
5. أي validation لشكل الرسالة أو طول النص يتم حالياً في الواجهة الأمامية.
6. إذا احتاج النظام أرشفة شات الميتنج مستقبلاً، يجب إضافة backend receiver أو استخدام LiveKit webhooks/data handling مناسب مع جدول مخصص.

---

## توصيات للتطوير المستقبلي

### 1. إضافة API لتفعيل/تعطيل الشات

Endpoint مقترح:

```http
PATCH /api/meeting/:id/chat
```

Body:

```json
{
  "allow_chat": false
}
```

Response:

```json
{
  "message": "Meeting chat permission updated",
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "allow_chat": false
  }
}
```

ويفضل أن يقوم endpoint أيضاً بتحديث صلاحية المشاركين الموجودين حالياً داخل LiveKit room من خلال `updateParticipant`.

### 2. إضافة جدول لحفظ رسائل الميتنج

جدول مقترح:

```sql
CREATE TABLE meeting_chat_messages (
    id BIGSERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL,
    sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sender_identity TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

مع ملاحظة أن الحفظ يحتاج آلية تجعل الرسائل تمر عبر backend، مثل REST endpoint أو Socket.IO أو LiveKit integration مخصص.

### 3. توحيد شكل payload

يجب تثبيت شكل message payload في الواجهة الأمامية لتجنب اختلاف تطبيقات الويب والموبايل.

### 4. إضافة قيود على الرسالة

اقتراحات:

- أقصى طول للرسالة: 1000 حرف.
- منع الرسائل الفارغة.
- إظهار اسم المرسل وصورته من metadata أو من بيانات المستخدم.
- فلترة محتوى غير مناسب إذا كانت الرسائل ستمر على backend مستقبلاً.

---

## Checklist للواجهة الأمامية

- استدعاء pre-join قبل الدخول.
- قراءة `meeting.allow_chat`.
- تعطيل input الإرسال إذا كان الشات مغلقاً.
- استدعاء connection للحصول على LiveKit token.
- الاتصال بـ LiveKit باستخدام `serverUrl` و `participantToken`.
- إرسال الرسائل عبر `publishData`.
- استقبال الرسائل عبر `RoomEvent.DataReceived`.
- تجاهل أي data message لا يملك `type = meeting-chat-message`.
- التعامل مع انقطاع الاتصال وإعادة الاتصال.
- عدم الاعتماد على وجود history لرسائل الميتنج.

---

## ملخص سريع

شات الميتنج في النظام الحالي هو شات لحظي داخل LiveKit. التحكم الأساسي فيه يتم من خلال `allow_chat` في قاعدة البيانات، والذي يتحول إلى `canPublishData` داخل LiveKit token. الرسائل لا تمر عبر REST APIs ولا Socket.IO الخاص بالشات العام، ولا يتم حفظها في قاعدة البيانات حالياً.

**آخر تحديث:** 2026-06-10
