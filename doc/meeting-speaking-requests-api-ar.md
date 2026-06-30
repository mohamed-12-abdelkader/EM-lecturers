# توثيق طلب التحدث داخل الميتنج

## نظرة عامة

هذا التوثيق يشرح APIs والتدفق المستخدم للسماح للطلاب بإرسال طلب للتحدث داخل الميتنج، ثم موافقة المدرس على طالب معين ليتمكن من فتح الميكروفون والتحدث.

النظام الحالي يعتمد على **LiveKit** في الميتنجات. لذلك يوجد جزآن في التدفق:

- جزء يتم عن طريق REST APIs في الباكند: إظهار/إخفاء زر رفع اليد، وتحديث صلاحية الطالب للتحدث.
- جزء يتم عن طريق LiveKit في الفرونت: الطالب يرسل طلب التحدث كـ data message أو metadata داخل غرفة LiveKit، والمدرس يستقبل الطلب في الواجهة.

> مهم: لا يوجد حالياً endpoint في الباكند باسم `request-to-speak` أو جدول لحفظ طلبات التحدث. طلب الطالب للتحدث يجب تنفيذه في الفرونت عبر LiveKit realtime data داخل نفس غرفة الميتنج.

---

## الملفات المرتبطة

- `src/controllers/meeting.ts`
  - APIs الخاصة بميتنج الكورس العادي.
  - يحتوي على `PATCH /api/meeting/:id/wavehand`.
  - يحتوي على `PATCH /api/meeting/:id/participant/:participantId`.

- `src/controllers/generalCourseGroupMeeting.ts`
  - APIs الخاصة بميتنج مجموعات الكورسات العامة.
  - يحتوي على `PATCH /api/general-courses/meeting/:id/wavehand`.
  - يحتوي على `PATCH /api/general-courses/meeting/:id/participant/:participantId`.

- `src/services/meetings-room-services.ts`
  - يصدر LiveKit token.
  - الطالب يدخل افتراضياً بـ `canPublish = false`.

---

## الفكرة الأساسية

### قبل الموافقة

الطالب يستطيع دخول الميتنج، لكنه لا يستطيع نشر صوت أو فيديو لأن token الخاص به يصدر بصلاحية:

```text
canPublish = false
```

هذا موجود في `generateParticipantToken` عند role:

```text
participant
```

### عند طلب التحدث

الطالب يضغط زر "رفع اليد" أو "طلب التحدث" في الفرونت. هذا الطلب لا يذهب إلى REST API حالياً، بل يفضل إرساله داخل LiveKit room كـ data message.

### عند موافقة المدرس

المدرس يستدعي API تحديث صلاحيات المشارك ويجعل:

```json
{
  "canPublish": true
}
```

بعدها يستطيع الطالب نشر audio track وفتح الميكروفون.

---

## التدفق الكامل

1. المدرس يفتح الميتنج.
2. المدرس يفعّل ظهور زر رفع اليد للطلاب باستخدام `wavehand`.
3. الطالب يدخل الميتنج ويحصل على LiveKit token.
4. الطالب يرى زر طلب التحدث إذا كانت `waveHandVisible = true` في room metadata.
5. الطالب يضغط الزر.
6. الفرونت يرسل data message داخل LiveKit بعنوان `meeting-speaking-request`.
7. واجهة المدرس تستقبل الطلب وتعرض الطالب في قائمة طلبات التحدث.
8. المدرس يضغط موافقة.
9. الفرونت يستدعي API تحديث صلاحيات المشارك مع `canPublish = true`.
10. الطالب يفتح الميكروفون ويتحدث داخل الميتنج.
11. عند انتهاء الطالب، يمكن للمدرس إلغاء الصلاحية بإرسال `canPublish = false`.

---

## API إظهار أو إخفاء زر رفع اليد

هذا API لا يرسل طلب التحدث نفسه، لكنه يتحكم في ظهور زر "رفع اليد" للطلاب داخل الواجهة.

### كورس عادي

```http
PATCH /api/meeting/:id/wavehand
Authorization: Bearer <TEACHER_OR_ADMIN_TOKEN>
Content-Type: application/json
```

### مجموعة كورس عام

```http
PATCH /api/general-courses/meeting/:id/wavehand
Authorization: Bearer <TEACHER_OR_ADMIN_TOKEN>
Content-Type: application/json
```

### الصلاحيات

- `teacher` صاحب الميتنج أو المدرس المسموح له بإدارة المجموعة.
- `admin`.

### Request Body

```json
{
  "visible": true
}
```

### معنى `visible`

| القيمة | المعنى |
| --- | --- |
| `true` | إظهار زر رفع اليد / طلب التحدث للطلاب. |
| `false` | إخفاء زر رفع اليد / طلب التحدث من الطلاب. |

### Response في ميتنج الكورس العادي

```json
{
  "message": "Done."
}
```

### Response في ميتنج مجموعة كورس عام

```json
{
  "success": true,
  "message": "تم التحديث"
}
```

### ماذا يفعل الباكند؟

الباكند يحدث metadata الخاصة بغرفة LiveKit:

```json
{
  "waveHandVisible": true
}
```

على الفرونت الاستماع لتحديثات room metadata، ثم إظهار أو إخفاء زر طلب التحدث.

### مثال cURL

```bash
curl -X PATCH "http://localhost:8000/api/meeting/MEETING_ID/wavehand" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"visible": true}'
```

---

## إرسال الطالب طلب التحدث

لا يوجد REST API في الباكند حالياً لإرسال طلب التحدث. التنفيذ المقترح في الفرونت هو إرسال LiveKit data message داخل نفس غرفة الميتنج.

### شكل الرسالة المقترح

```json
{
  "type": "meeting-speaking-request",
  "meetingId": "550e8400-e29b-41d4-a716-446655440000",
  "student": {
    "id": 123,
    "identity": "user_123_meeting_550e8400-e29b-41d4-a716-446655440000",
    "name": "Ahmed",
    "avatar": "https://example.com/avatar.png"
  },
  "status": "requested",
  "sentAt": "2026-06-10T06:45:00.000Z"
}
```

### مثال Front-End لإرسال الطلب

```javascript
async function requestToSpeak(room, meetingId, user) {
  const payload = {
    type: 'meeting-speaking-request',
    meetingId,
    student: {
      id: user.id,
      identity: room.localParticipant.identity,
      name: user.username,
      avatar: user.avatar || null,
    },
    status: 'requested',
    sentAt: new Date().toISOString(),
  };

  const encoded = new TextEncoder().encode(JSON.stringify(payload));

  await room.localParticipant.publishData(encoded, { reliable: true });
}
```

### استقبال المدرس للطلب

```javascript
import { RoomEvent } from 'livekit-client';

function listenForSpeakingRequests(room, onRequest) {
  const decoder = new TextDecoder();

  room.on(RoomEvent.DataReceived, (payload, participant) => {
    try {
      const data = JSON.parse(decoder.decode(payload));

      if (data.type !== 'meeting-speaking-request') return;

      onRequest({
        ...data,
        participantIdentity: participant?.identity || data.student?.identity,
      });
    } catch {
      // Ignore invalid data messages.
    }
  });
}
```

> لأن الطلب لا يتم تخزينه في الباكند، إذا عمل المدرس refresh للصفحة قد تضيع قائمة الطلبات الحالية إلا إذا كان الفرونت يحتفظ بها مؤقتاً أو تم إضافة API تخزين لاحقاً.

---

## API الموافقة على تحدث الطالب

هذا هو أهم API في عملية الموافقة. يستخدم لتحديث صلاحيات مشارك موجود داخل LiveKit room.

### كورس عادي

```http
PATCH /api/meeting/:id/participant/:participantId
Authorization: Bearer <TEACHER_OR_ADMIN_TOKEN>
Content-Type: application/json
```

### مجموعة كورس عام

```http
PATCH /api/general-courses/meeting/:id/participant/:participantId
Authorization: Bearer <TEACHER_OR_ADMIN_TOKEN>
Content-Type: application/json
```

### Path Parameters

| الاسم | الوصف |
| --- | --- |
| `id` | معرف الميتنج، وهو نفس اسم غرفة LiveKit. |
| `participantId` | هوية المشارك داخل LiveKit. |

### صيغة `participantId`

في ميتنج الكورس العادي ومجموعة الكورس العام، هوية المشارك تكون:

```text
user_{userId}_meeting_{meetingId}
```

مثال:

```text
user_123_meeting_550e8400-e29b-41d4-a716-446655440000
```

> ملاحظة: endpoint الطرد في مجموعة الكورس العام يستخدم `user_id` رقمياً، لكن endpoint تحديث الصلاحيات يستخدم LiveKit participant identity.

### Request Body للموافقة

```json
{
  "permissions": {
    "canPublish": true,
    "canPublishData": true,
    "canSubscribe": true
  }
}
```

### معنى الصلاحيات

| الصلاحية | المعنى |
| --- | --- |
| `canPublish` | السماح بنشر audio/video tracks. هذه هي الصلاحية المطلوبة لفتح الميكروفون. |
| `canPublishData` | السماح بإرسال data messages مثل الشات أو طلبات التحدث. |
| `canSubscribe` | السماح باستقبال بث المشاركين الآخرين. الباكند يفرضها دائماً `true`. |

### Response في ميتنج الكورس العادي

```json
{
  "message": "Participant permissions updated"
}
```

### Response في ميتنج مجموعة كورس عام

```json
{
  "success": true,
  "message": "تم تحديث صلاحيات المشارك"
}
```

### مثال cURL للموافقة

```bash
curl -X PATCH "http://localhost:8000/api/meeting/MEETING_ID/participant/user_123_meeting_MEETING_ID" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": {
      "canPublish": true,
      "canPublishData": true,
      "canSubscribe": true
    }
  }'
```

### مثال Front-End للموافقة

```javascript
async function approveStudentToSpeak({ meetingId, participantIdentity, token }) {
  const response = await fetch(
    `/api/meeting/${meetingId}/participant/${encodeURIComponent(participantIdentity)}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        permissions: {
          canPublish: true,
          canPublishData: true,
          canSubscribe: true,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error('Failed to approve participant');
  }

  return response.json();
}
```

---

## API إلغاء صلاحية التحدث

عند انتهاء الطالب من الكلام، يستطيع المدرس إغلاق الميكروفون عليه أو إلغاء السماح بالنشر.

### Request Body

```json
{
  "permissions": {
    "canPublish": false,
    "canPublishData": true,
    "canSubscribe": true
  }
}
```

### مثال cURL

```bash
curl -X PATCH "http://localhost:8000/api/meeting/MEETING_ID/participant/user_123_meeting_MEETING_ID" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": {
      "canPublish": false,
      "canPublishData": true,
      "canSubscribe": true
    }
  }'
```

> إذا كان المطلوب منع الطالب من إرسال طلبات أو شات أيضاً، يمكن جعل `canPublishData = false`، لكن هذا قد يمنعه من إرسال data messages داخل LiveKit.

---

## كيف يعرف الطالب أنه تمت الموافقة؟

بعد أن يوافق المدرس ويحدث صلاحيات الطالب في LiveKit، يجب على الفرونت عند الطالب التعامل مع تغير الصلاحيات أو محاولة تفعيل الميكروفون.

اقتراح عملي:

1. المدرس بعد نجاح API الموافقة يرسل data message للطالب أو لكل الغرفة بنوع `meeting-speaking-approved`.
2. الطالب يستقبل الرسالة ويظهر له أن الميكروفون أصبح متاحاً.
3. الطالب يستدعي LiveKit publish audio track أو يضغط زر فتح الميكروفون.

### رسالة موافقة مقترحة

```json
{
  "type": "meeting-speaking-approved",
  "meetingId": "550e8400-e29b-41d4-a716-446655440000",
  "studentIdentity": "user_123_meeting_550e8400-e29b-41d4-a716-446655440000",
  "approvedBy": {
    "id": 7,
    "name": "Teacher"
  },
  "sentAt": "2026-06-10T06:50:00.000Z"
}
```

### إرسال إشعار الموافقة من جهة المدرس

```javascript
async function notifySpeakingApproved(room, meetingId, studentIdentity, teacher) {
  const payload = {
    type: 'meeting-speaking-approved',
    meetingId,
    studentIdentity,
    approvedBy: {
      id: teacher.id,
      name: teacher.name,
    },
    sentAt: new Date().toISOString(),
  };

  await room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify(payload)),
    { reliable: true }
  );
}
```

---

## فتح الميكروفون بعد الموافقة

بعد الموافقة، الطالب يمكنه نشر audio track من خلال LiveKit SDK.

مثال مبسط:

```javascript
async function enableMicrophone(room) {
  await room.localParticipant.setMicrophoneEnabled(true);
}
```

إذا لم تتم الموافقة بعد، LiveKit سيرفض النشر لأن `canPublish = false`.

---

## الأخطاء المتوقعة

### `401 Unauthorized`

لم يتم إرسال token أو token غير صالح.

### `403 Forbidden`

الأسباب المحتملة:

- المستخدم ليس مدرساً أو أدمن.
- المدرس لا يملك صلاحية إدارة هذا الميتنج.
- الطالب ليس له صلاحية دخول الميتنج.

### `404 Not Found`

الأسباب المحتملة:

- الميتنج غير موجود.
- ميتنج مجموعة الكورس العام غير موجود.
- الميتنج انتهى في بعض endpoints.

### خطأ من LiveKit عند تحديث المشارك

الأسباب المحتملة:

- `participantId` غير صحيح.
- الطالب غير متصل حالياً بالغرفة.
- غرفة LiveKit غير موجودة أو انتهت.
- مشكلة اتصال بين الباكند و LiveKit server.

---

## ملاحظات مهمة

- زر رفع اليد يتحكم في واجهة الطالب فقط عبر room metadata، ولا يعطي الطالب صلاحية التحدث.
- الطالب لا يستطيع التحدث افتراضياً لأن `canPublish = false`.
- الموافقة الحقيقية تتم من خلال تحديث `canPublish = true`.
- طلبات التحدث غير محفوظة في قاعدة البيانات حالياً.
- إذا خرج الطالب ودخل مرة أخرى، يحصل على token جديد بالصلاحيات الافتراضية، وغالباً سيعود `canPublish = false` إلا إذا تم تحديثه مرة أخرى بعد الدخول.
- تحديث صلاحيات المشارك يؤثر على المشارك المتصل حالياً داخل LiveKit room، وليس على قيمة دائمة في جدول الميتنج.

---

## اقتراح API مستقبلي لحفظ طلبات التحدث

إذا كان المطلوب أن تكون طلبات التحدث محفوظة في الباكند ويمكن جلبها بعد refresh، يمكن إضافة جدول و APIs جديدة.

### جدول مقترح

```sql
CREATE TABLE meeting_speaking_requests (
    id BIGSERIAL PRIMARY KEY,
    meeting_id UUID NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Endpoints مقترحة

```http
POST /api/meeting/:id/speaking-requests
GET /api/meeting/:id/speaking-requests
PATCH /api/meeting/:id/speaking-requests/:requestId
```

لكن هذه endpoints غير موجودة حالياً في الكود.

---

## ملخص سريع للـ APIs الحالية

| العملية | كورس عادي | مجموعة كورس عام |
| --- | --- | --- |
| إظهار/إخفاء زر رفع اليد | `PATCH /api/meeting/:id/wavehand` | `PATCH /api/general-courses/meeting/:id/wavehand` |
| الموافقة على تحدث طالب | `PATCH /api/meeting/:id/participant/:participantId` | `PATCH /api/general-courses/meeting/:id/participant/:participantId` |
| إلغاء تحدث طالب | نفس endpoint تحديث الصلاحيات مع `canPublish=false` | نفس endpoint تحديث الصلاحيات مع `canPublish=false` |
| إرسال طلب التحدث | LiveKit data message من الفرونت | LiveKit data message من الفرونت |

**آخر تحديث:** 2026-06-10
