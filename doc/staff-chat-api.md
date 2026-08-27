# Admin ↔ Employee Staff Chat API

Real-time chat between **Admin** and **Employee** using existing **Socket.IO** on the same HTTP server.

> **Note:** This is separate from student/teacher chat (`/api/chat/groups`). Staff chat uses `/api/chat/conversations/*` paths mounted before the legacy chat router.

---

## فكرة النظام باختصار

هناك نوعان من المحادثات:

| النوع | الوصف |
|-------|--------|
| **Group** | مجموعة عامة مثل «فريق العمل» — كل الأدمن والموظفين النشطين |
| **Direct** | محادثة خاصة **1:1** بين Admin واحد وموظف واحد |

### من جهة الموظف

- الموظف يرى في قائمته:
  - مجموعة فريق العمل (إن وُجدت)
  - **محادثة مباشرة واحدة مع الأدمن** (Admin ↔ هذا الموظف فقط)
- لا يرى محادثات موظفين آخرين مع الأدمن.
- لا يستطيع إنشاء Direct بنفسه — الأدمن ينشئها، ثم تظهر تلقائيًا في `GET /conversations` للموظف.

### من جهة الأدمن

- الأدمن يرى **قائمة محادثات الموظفين** (كل Direct Chat أنشأها مع موظف).
- لكل موظف محادثة منفصلة في الليست (مثل واتساب / إنبوكس).
- يمكنه فتح أي محادثة، إرسال نص/صور، ومتابعة `unread_count`.
- لإنشاء محادثة مع موظف جديد: `POST /conversations/direct` بـ `employee_id`.

```
Admin Inbox                          Employee Inbox
─────────────                        ──────────────
• مجموعة فريق العمل                  • مجموعة فريق العمل
• أحمد (موظف)  ←── Direct ──→       • الأدمن فقط (Direct)
• سارة (موظفة) ←── Direct ──→
• محمد (موظف)  ←── Direct ──→
```

---

## Direct Chat — سيناريو الاستخدام

### 1) الأدمن يفتح شات مع موظف

```http
POST /api/chat/conversations/direct
Authorization: Bearer <admin_token>
Content-Type: application/json

{ "employee_id": 12 }
```

Response (مثال):

```json
{
  "success": true,
  "data": {
    "id": 5,
    "type": "direct",
    "name": null,
    "last_message": null,
    "last_message_at": null,
    "unread_count": 0
  }
}
```

- إذا وُجدت محادثة سابقة بين نفس الأدمن ونفس الموظف → تُرجع نفسها (لا تكرار).
- `employee_id` هنا هو **معرف سجل الموظف** في جدول `employees` وليس `user_id`.

### 2) الأدمن يشوف ليست الموظفين (إنبوكس)

```http
GET /api/chat/conversations
Authorization: Bearer <admin_token>
```

يرجع كل محادثات الأدمن (Group + كل Direct مع الموظفين) مع آخر رسالة وعدد غير المقروء:

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "group",
      "name": "فريق العمل",
      "last_message": { "content": "صباح الخير للجميع", "...": "..." },
      "last_message_at": "2026-08-26T08:00:00.000Z",
      "unread_count": 0
    },
    {
      "id": 5,
      "type": "direct",
      "name": null,
      "last_message": { "content": "خلصت المهمة؟", "...": "..." },
      "last_message_at": "2026-08-26T10:15:00.000Z",
      "unread_count": 2
    },
    {
      "id": 7,
      "type": "direct",
      "name": null,
      "last_message": null,
      "last_message_at": null,
      "unread_count": 0
    }
  ]
}
```

**Frontend للأدمن:** اعرض العناصر ذات `type: "direct"` كقائمة شات موظفين. اسم الموظف يُجلب من `GET /conversations/:id` → `members`.

### 3) الموظف يفتح إنبوكسه

```http
GET /api/chat/conversations
Authorization: Bearer <employee_token>
```

يرى فقط:

- المجموعة (إن كان عضوًا نشطًا)
- **محادثته المباشرة مع الأدمن فقط** — لا Direct لأي موظف آخر

### 4) إرسال رسالة في الـ Direct (Real-Time)

بعد معرفة `conversationId`:

```javascript
socket.emit('message:send', {
  conversationId: 5,
  type: 'text',
  content: 'تمام، خلّصت المهمة',
}, (ack) => { /* ok / error */ });
```

الطرف الآخر يستقبل فورًا:

```javascript
socket.on('message:new', ({ message }) => {
  // أضف الرسالة في UI المحادثة المفتوحة
});
```

### 5) حالة القراءة في Direct

- الأدمن أرسل → الموظف لم يفتح: `unread_count` عند الموظف يزيد.
- الموظف فتح وأرسل `message:read` → الأدمن يستقبل `message:read` ويظهر **Read**.

```javascript
socket.emit('message:read', { conversationId: 5, messageId: 40 });
```

---

## Migration

```bash
npm run migrate up
```

File: `migrations/1778300000000_staff_chat_system.sql`

Creates: `staff_conversations`, `staff_conversation_members`, `staff_messages`, `staff_message_reads`  
Seeds default group: **فريق العمل**

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `STAFF_CHAT_MAX_IMAGE_SIZE_MB` | 5 | Max image upload size |
| `STAFF_CHAT_MAX_MESSAGE_LENGTH` | 4000 | Max text length |
| `STAFF_CHAT_MESSAGE_EDIT_WINDOW_MINUTES` | 15 | Edit window |
| `STAFF_CHAT_RATE_LIMIT_MESSAGES_PER_MINUTE` | 30 | Rate limit hint |
| `STAFF_CHAT_GROUP_NAME` | فريق العمل | Default group name |

## Authentication

- **REST:** `Authorization: Bearer <JWT>` — roles: `admin`, `employee`
- **Socket.IO:** same token via `handshake.auth.token` or `Authorization: Bearer`
- Inactive employees rejected at socket + REST layer

## Database Schema

### staff_conversations
- `type`: `group` | `direct`
- Direct: unique `(direct_admin_id, direct_employee_id)` — محادثة واحدة فقط لكل زوج Admin↔Employee

### staff_conversation_members
- `last_read_message_id`, `last_read_at`, `is_active`

### staff_messages
- `type`: `text` | `image`
- Soft delete: `deleted_at`, `deleted_by`
- Edit: `edited_at`

### staff_message_reads
- Per-user read receipt: `(message_id, user_id)` unique

---

## REST APIs

Base: `/api/chat`  
Auth: `admin` | `employee`

### GET `/conversations`
قائمة محادثات المستخدم الحالي:
- **Admin:** مجموعة + كل Direct مع الموظفين (ليست شات الموظفين)
- **Employee:** مجموعة + Direct الخاص به مع الأدمن فقط

كل عنصر يتضمن: `last_message`, `last_message_at`, `unread_count`.

### POST `/conversations/direct` *(Admin only)*
Body: `{ "employee_id": 12 }`  
إنشاء أو إرجاع محادثة Direct موجودة مع الموظف (بدون تكرار).

### GET `/conversations/:conversationId`
تفاصيل المحادثة + الأعضاء (اسم/دور/أونلاين) + صلاحيات.

استخدمه في UI الأدمن لعرض **اسم الموظف** في الليست أو رأس الشات.

### GET `/conversations/:conversationId/messages?cursor=&limit=30`
Cursor pagination (newest first in DB, returned ascending).

Response:
```json
{
  "success": true,
  "data": {
    "items": [],
    "nextCursor": 120,
    "hasMore": true
  }
}
```

### POST `/conversations/:conversationId/images`
Multipart: `image` field → Cloudinary → creates image message + broadcasts.

### GET `/messages/:messageId/readers`
Group read receipts list.

### PATCH `/messages/:messageId`
Body: `{ "content": "..." }` — own messages within edit window.

### DELETE `/messages/:messageId`
Soft delete — own message or admin.

### POST `/conversations/:conversationId/members` *(Admin, group only)*
Body: `{ "user_id": 5 }`

### DELETE `/conversations/:conversationId/members/:userId` *(Admin, group only)*

---

## WebSocket

**URL:** same as server (`ws://localhost:8000` / Socket.IO path `/socket.io`)

### Connection
```javascript
import { io } from 'socket.io-client';
const socket = io(API_URL, {
  auth: { token: accessToken },
  transports: ['websocket'],
});
```

Auto-joins rooms: `staff-conversation:{id}` for member conversations.

### Events (Client → Server)

| Event | Payload | Description |
|-------|---------|-------------|
| `conversation:join` | `{ conversationId }` | Join room after permission check |
| `message:send` | `{ conversationId, type: "text", content }` | Send text |
| `message:read` | `{ conversationId, messageId }` | Mark read |
| `typing:start` | `{ conversationId }` | Typing indicator |
| `typing:stop` | `{ conversationId }` | Stop typing |

### Events (Server → Client)

| Event | Payload |
|-------|---------|
| `message:new` | `{ event, message }` |
| `message:updated` | `{ event, message }` |
| `message:deleted` | `{ event, message }` |
| `message:read` | `{ messageId, conversationId, userId, readAt }` |
| `typing:start` | `{ conversationId, userId }` |
| `typing:stop` | `{ conversationId, userId }` |
| `user:online` | `{ userId }` |
| `user:offline` | `{ userId }` |
| `chat:error` | `{ code, message }` |

### Image flow
1. `POST /api/chat/conversations/:id/images` (multipart)
2. Server saves message + emits `message:new` to room

---

## Unread Count

Per member: count messages where `id > last_read_message_id` AND `sender_id != userId`.

Updated when client sends `message:read`.

في Direct Chat يكفي عرض:
- **Unread** عند الطرف الذي لم يقرأ
- **Read** بعد `message:read`

---

## Authorization Rules

| Action | Admin | Employee |
|--------|-------|----------|
| Group chat | ✅ | ✅ |
| قائمة شات الموظفين (Directs) | ✅ عبر `GET /conversations` | ❌ يرى Direct الخاص به فقط |
| إنشاء Direct مع موظف | ✅ `POST /conversations/direct` | ❌ |
| إرسال في Direct الخاص | ✅ | ✅ |
| مشاهدة Direct موظف آخر | ❌ | ❌ |
| Manage group members | ✅ | ❌ |
| Delete own message | ✅ | ✅ |
| Delete any message | ✅ | ❌ |

---

## Production

- No separate WebSocket server — runs on same `PORT` as Express
- Ensure reverse proxy supports WebSocket upgrade (nginx: `proxy_http_version 1.1`, `Upgrade` headers)
- Run migrations before deploy
- Cloudinary env vars required for image upload

## Frontend Notes

### شاشة الأدمن (ليست الموظفين)
1. `GET /api/chat/conversations` → فلتر `type === 'direct'`
2. لكل عنصر: اعرض اسم الموظف من `GET /conversations/:id` → `members` (role = employee)
3. Badge = `unread_count`
4. عند اختيار موظف جديد: `POST /conversations/direct` ثم افتح المحادثة

### شاشة الموظف
1. `GET /api/chat/conversations` → يظهر Direct مع الأدمن (+ المجموعة إن وُجدت)
2. افتح المحادثة وأرسل عبر Socket `message:send`
3. عند فتح الشات: `message:read` لآخر رسالة

### عام
1. Connect Socket.IO with JWT in `auth.token`
2. Listen `message:new` on joined conversations
3. Upload images via REST, not socket
4. Handle `auth:token-refreshed` from existing socket auth
