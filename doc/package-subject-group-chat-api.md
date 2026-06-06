# Package Subject Group Chat API (Realtime) — شات مجموعات الباقات

توثيق الـ APIs الخاصة بـ **Chat Realtime لكل Group داخل مادة الباقة** (`package_subject_item_groups`) باستخدام نفس نظام الشات الحالي (`chat_groups`, `chat_messages`, `chat_group_members`) و Socket.IO.

## Base URL
- كل المسارات تبدأ بـ: `/api`

## Auth
- Header: `Authorization: Bearer <token>`
- Roles:
  - **student**: فقط الجروبات اللي هو منضم لها + الباقة مفعلة بالكود
  - **teacher**: فقط الجروبات المسندة له (`package_subject_item_groups.teacher_id`)
  - **admin**: كل الجروبات

## تعريف الـ IDs المهمة
### `package_subject_group_id`
هو **ID الجروب داخل المادة**: `package_subject_item_groups.id`  
ده هو الـ ID اللي الـ mobile/frontend يستخدمه في Rooms (`group_{id}`) وفي Endpoints الخاصة بشات الباقة.

### `chat_group_id`
هو **ID الشات الداخلي**: `chat_groups.id`  
بيتم إنشاؤه/ضمان وجوده تلقائيًا لكل `package_subject_group_id` (بدون كسر الشات القديم بتاع الـ grade).

---

## 1) جلب مجموعات الشات للمستخدم
### 1.1 GET /api/chat/groups
**GET** `/api/chat/groups`  
**Roles**: `student`, `teacher`, `admin`

**السلوك**
- بيرجع مجموعات الشات الخاصة بالمستخدم.
- ضمن الاستجابة يوجد جزء خاص بـ شات الباقة: `package_subject_groups`.
- الشات القديم الخاص بالـ grade مازال موجود في `groups` (Backward compatible).

**Response (200)**
```json
{
  "groups": [],
  "package_subject_groups": [
    {
      "type": "package_subject_group",
      "chat_group_id": 123,
      "allow_student_send": true,
      "subject": { "id": 10, "name": "اللغة العربية" },
      "group": {
        "id": 1,
        "name": "Group B",
        "schedule_days": ["sat", "tue"],
        "schedule_time": "20:00"
      },
      "teacher": { "id": 28, "name": "Teacher Name", "avatar": null },
      "students": [
        { "id": 108, "name": "Student A", "avatar": null },
        { "id": 109, "name": "Student B", "avatar": null }
      ]
    }
  ]
}
```

---

## 2) جلب رسائل جروب (مع Pagination)
### 2.1 GET /api/chat/groups/:groupId/messages
**GET** `/api/chat/groups/:groupId/messages`  
**Roles**: `student`, `teacher`, `admin`

**Path Params**
- `groupId`: هنا المقصود **package_subject_group_id** (`package_subject_item_groups.id`)

**Query Params**
- `limit` (اختياري): عدد الرسائل (افتراضي 50)
- `before` (اختياري): Timestamp ISO للـ pagination (يجيب رسائل أقدم من هذا الوقت)

**Authorization**
- الطالب: لازم يكون عضو في نفس `package_subject_group_id` + تفعيل الباقة بالكود
- المدرس: لازم يكون `teacher_id` للجروب
- الأدمن: مسموح دائمًا

**Response (200)**
```json
{
  "group_id": 1,
  "kind": "package",
  "messages": [
    {
      "id": 555,
      "group_id": 123,
      "sender_id": 108,
      "text": "السلام عليكم",
      "created_at": "2026-01-01T12:00:00.000Z",
      "sender_name": "Student A",
      "reply_to_message_id": null,
      "reply": null,
      "reply_preview": null
    }
  ]
}
```

> ملاحظة: `messages[].group_id` هنا هو `chat_group_id` داخليًا (لأن التخزين في `chat_messages.group_id`).

**Response (403)**
```json
{ "message": "Not in this package group" }
```

---

## 3) إرسال رسالة (REST) + Realtime Broadcast
### 3.1 POST /api/chat/groups/:groupId/messages
**POST** `/api/chat/groups/:groupId/messages`  
**Roles**: `student`, `teacher`, `admin`

**Body (JSON)**
```json
{ "message": "text" }
```

> Backward compatible: ممكن تبعت `{ "text": "..." }` أيضًا.

**Response (201)**
```json
{
  "message": {
    "id": 556,
    "group_id": 123,
    "sender_id": 108,
    "text": "تم",
    "created_at": "2026-01-01T12:01:00.000Z"
  }
}
```

**Realtime**
- بعد الحفظ، السيرفر يعمل broadcast فورًا لكل أعضاء الجروب على Room:
  - `group_{package_subject_group_id}`
  - مثال: `group_1`

---

## 4) Socket.IO (Realtime)
### 4.1 الانضمام لرووم الجروب
**Event**: `chat:join-group`  
**Payload**: `number` (package_subject_group_id)

**Room**
- `group_{groupId}` (مثال: `group_1`)

### 4.2 إرسال رسالة عبر Socket
**Event**: `chat:send`  
**Payload مثال**
```json
{ "groupId": 1, "message": "hello" }
```

**Broadcast**
- السيرفر يبث الحدث:
  - `chat:new-message`
  - إلى نفس الـ room: `group_1`

---

## 5) ملاحظات أمان وأداء
- الطالب لا يمكنه رؤية أو إرسال رسائل إلا في جروباته داخل مادة الباقة.
- المدرس لا يمكنه الوصول إلا لجروباته المسندة داخل مادة الباقة.
- الأدمن له صلاحية كاملة.
- Rooms معزولة لكل Group لتقليل الـ broadcast scope وتحسين الأداء.

---

## 6) Direct Chat (1:1) بين الطالب ومدرسيه (Courses + Package Groups)

> هذا جزء إضافي: شات مباشر بين طالب ↔ مدرسه (Realtime) باستخدام نفس `chat_groups/chat_messages/chat_group_members`.
> - الطالب يرى فقط المدرسين المرتبط بهم عبر كورسات أو عبر مجموعات الباقة اللي منضم لها.
> - المدرس يرى فقط المحادثات المباشرة التي تم إنشاؤها فعلاً (عند أول رسالة من الطالب).

### 6.1 جلب قائمة المدرسين المتاحين للشات (Student)
**GET** `/api/chat/contacts`  
**Roles**: `student`

**Response (200)**
```json
{
  "contacts": [
    {
      "type": "teacher",
      "teacher": { "id": 28, "name": "Teacher Name", "avatar": null },
      "direct_chat_group_id": 777
    }
  ]
}
```

### 6.1.1 جلب قائمة الطلاب المتاحين للشات (Teacher)
**GET** `/api/chat/contacts`  
**Roles**: `teacher`

**السلوك**
- يرجع كل الطلاب:
  - المسجلين في كورسات المدرس
  - + طلاب مجموعات الباقة المسندة للمدرس (مع شرط تفعيل الباقة بالكود)
  - + أي طلاب لديهم Direct Chat سابق مع المدرس

**Response (200)**
```json
{
  "contacts": [
    {
      "type": "student",
      "student": { "id": 111, "name": "يوسف", "avatar": null },
      "direct_chat_group_id": 777
    }
  ]
}
```

### 6.2 جلب رسائل شات مباشر مع مدرس
**GET** `/api/chat/direct/:otherId/messages`  
**Roles**: `student`

**Path Params**
- `otherId`: `teacherId`

**Query Params**
- `limit` (اختياري، افتراضي 50)
- `before` (اختياري)

**Response (200)**
```json
{
  "chat_group_id": 777,
  "other_user": { "id": 28, "name": "Teacher Name", "avatar": null, "role": "teacher" },
  "messages": []
}
```

> للمدرس: نفس الـ endpoint يعمل لكن `otherId = studentId` و Roles: `teacher`

### 6.3 إرسال رسالة مباشرة لمعلم (Realtime)
**POST** `/api/chat/direct/:otherId/messages`  
**Roles**: `student`

**Body**
```json
{ "message": "السلام عليكم" }
```

**Response (201)**
```json
{
  "chat_group_id": 777,
  "message": { "id": 1, "group_id": 777, "sender_id": 108, "text": "السلام عليكم", "created_at": "2026-01-01T12:00:00.000Z" }
}
```

**Realtime Room**
- يستخدم نفس نظام الشات الحالي (room): `group:{chat_group_id}`
  - مثال: `group:777`

### 6.3.1 Realtime عبر Socket (Direct Chat)
علشان شاشة `/api/chat/direct/:otherId/messages` تبقى Realtime:

- **Join room**
  - Event: `chat:join-direct`
  - Payload:
```json
{ "otherId": 28 }
```
  - Ack:
```json
{ "ok": true, "chat_group_id": 777, "room": "group:777" }
```

- **Send message**
  - Event: `chat:send-direct`
  - Payload:
```json
{ "otherId": 28, "message": "hello" }
```
  - السيرفر يبث `chat:new-message` على `group:777`.

**ملاحظة مهمة**
- السيرفر كمان بيبث `chat:new-message` على room شخصي باسم `user:{recipientId}` لضمان وصول الرسالة فورًا حتى لو المستقبل لم ينضم بعد لـ `group:{chat_group_id}`.

> للمدرس: نفس الـ endpoint يعمل لكن `otherId = studentId` و Roles: `teacher`

---

### 6.4 تعديل رسالة (Direct/Group Chat)
**PUT** `/api/chat/messages/:messageId`  
**Roles**: `student`, `teacher`, `admin`

**Rules**
- المرسل فقط يقدر يعدّل رسالته.
- الأدمن يقدر يعدّل أي رسالة.

**Body**
```json
{ "message": "تم التعديل" }
```

**Realtime Event**
- `chat:message-updated`

---

### 6.5 حذف رسالة (Direct/Group Chat)
**DELETE** `/api/chat/messages/:messageId`  
**Roles**: `student`, `teacher`, `admin`

**Rules**
- المرسل فقط يقدر يحذف رسالته.
- الأدمن يقدر يحذف أي رسالة.

**Realtime Event**
- `chat:message-deleted`

---

## 7) إشعارات الرسائل (Chat Notifications)

### 7.1 GET /api/chat/notifications
**GET** `/api/chat/notifications`  
**Roles**: `student`, `teacher`

**Query Parameters**:
- `limit` (optional, default: 20) - عدد الإشعارات
- `offset` (optional, default: 0) - للـ pagination
- `unread_only` (optional, default: false) - إذا كان `true` يرجع فقط الجروبات اللي فيها رسائل غير مقروءة

**السلوك**:
- للطالب: يرجع قائمة بجميع الجروبات (direct chats مع المدرسين + package groups + grade groups) مع:
  - `unread_count`: عدد الرسائل غير المقروءة
  - `last_message`: آخر رسالة (فقط لو `unread_count > 0`)
  - `other_user`: بيانات المستخدم الآخر (في direct chats)
  - `chat_type`: نوع الشات (`direct`, `package_subject`, `grade`)
- للمدرس: نفس الشيء لكن للجروبات اللي هو عضو فيها

**Response (200)**
```json
{
  "notifications": [
    {
      "chat_group_id": 123,
      "chat_type": "direct",
      "other_user": {
        "id": 28,
        "name": "أحمد محمد",
        "avatar": "https://..."
      },
      "package_subject_group_id": null,
      "grade_id": 1,
      "owner_teacher_id": null,
      "group_name": "Direct Chat",
      "unread_count": 5,
      "last_message": {
        "id": 456,
        "sender_id": 28,
        "text": "مرحبا",
        "attachment_url": null,
        "attachment_type": null,
        "created_at": "2025-01-01T10:00:00.000Z"
      }
    },
    {
      "chat_group_id": 124,
      "chat_type": "package_subject",
      "other_user": {
        "id": 28,
        "name": "أحمد محمد",
        "avatar": "https://..."
      },
      "package_subject_group_id": 10,
      "grade_id": 1,
      "owner_teacher_id": null,
      "group_name": "اللغة العربية",
      "unread_count": 0
    }
  ],
  "pagination": {
    "total": 2,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**ملاحظات**:
- لو `unread_count = 0`: الـ `last_message` مش موجودة في الـ response
- الـ `unread_count` بيتم حسابه بناءً على آخر رسالة من المستخدم (آخر مرة قرأ فيها الرسائل)
- الترتيب بيكون حسب آخر رسالة (الأحدث أولاً)

**مثال curl**:
```bash
curl -X GET "http://localhost:8000/api/chat/notifications?limit=20&offset=0" \
  -H "Authorization: Bearer <token>"
```

**مثال مع unread_only**:
```bash
curl -X GET "http://localhost:8000/api/chat/notifications?unread_only=true" \
  -H "Authorization: Bearer <token>"
```



