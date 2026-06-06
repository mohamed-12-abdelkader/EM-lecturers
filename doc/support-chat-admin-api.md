# API شات الدعم الفني - للأدمن

## نظرة عامة

APIs للأدمن للتعامل مع شاتات الطلاب في نظام الدعم الفني.

---

## Base URL

```
http://localhost:8000/api/support
```

جميع الـ endpoints تتطلب `Authorization: Bearer <admin_token>`

---

## REST APIs

### 1. جلب جميع الشاتات

جلب قائمة بجميع شاتات الطلاب مع إمكانية التصفية حسب الحالة.

**Endpoint**: `GET /api/support/chats`

**Headers**:
```
Authorization: Bearer <admin_token>
```

**Query Parameters**:
- `limit` (optional, default: 50) - عدد الشاتات
- `offset` (optional, default: 0) - للـ pagination
- `status` (optional) - تصفية حسب الحالة: `open`, `closed`, `resolved`, `waiting_for_admin`, `admin_handling`, `bot_handling`

**Response (200 OK)**:
```json
{
  "chats": [
    {
      "id": 1,
      "student_id": 5,
      "admin_id": 2,
      "status": "waiting_for_admin",
      "last_message_at": "2024-01-15T10:00:00Z",
      "created_at": "2024-01-15T09:00:00Z",
      "student_name": "أحمد محمد",
      "student_email": "ahmed@example.com",
      "unread_count": 3,
      "current_intent": "LOGIN_PROBLEM",
      "bot_attempts": 2,
      "escalation_reason": "Max bot attempts reached",
      "escalated_at": "2024-01-15T10:05:00Z"
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

**مثال**:
```bash
# جلب جميع الشاتات
curl -X GET "http://localhost:8000/api/support/chats?limit=50&offset=0" \
  -H "Authorization: Bearer <admin_token>"

# جلب الشاتات في انتظار الأدمن
curl -X GET "http://localhost:8000/api/support/chats?status=waiting_for_admin" \
  -H "Authorization: Bearer <admin_token>"
```

---

### 2. جلب رسائل شات معين

جلب جميع رسائل شات طالب معين.

**Endpoint**: `GET /api/support/chats/:chatId/messages`

**Headers**:
```
Authorization: Bearer <admin_token>
```

**Query Parameters**:
- `limit` (optional, default: 50) - عدد الرسائل
- `before` (optional) - timestamp للـ pagination

**Response (200 OK)**:
```json
{
  "messages": [
    {
      "id": 1,
      "chat_id": 1,
      "sender_id": 5,
      "sender_role": "student",
      "message_type": "text",
      "text": "مرحبا، أحتاج مساعدة",
      "is_auto_reply": false,
      "delivered_at": "2024-01-15T10:00:05Z",
      "read_at": "2024-01-15T10:01:00Z",
      "status": "read",
      "created_at": "2024-01-15T10:00:00Z",
      "sender_name": "أحمد محمد"
    },
    {
      "id": 2,
      "chat_id": 1,
      "sender_id": 2,
      "sender_role": "admin",
      "message_type": "text",
      "text": "أهلا بك، كيف يمكنني مساعدتك؟",
      "is_auto_reply": false,
      "created_at": "2024-01-15T10:01:00Z",
      "sender_name": "الدعم الفني"
    }
  ]
}
```

**مثال**:
```bash
curl -X GET "http://localhost:8000/api/support/chats/1/messages?limit=50" \
  -H "Authorization: Bearer <admin_token>"
```

---

### 3. إرسال رسالة نصية للطالب

إرسال رسالة نصية لشات طالب معين.

**Endpoint**: `POST /api/support/messages`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "text": "أهلا بك، كيف يمكنني مساعدتك؟",
  "chat_id": 1
}
```

**ملاحظة**: `chat_id` مطلوب للأدمن

**Response (201 Created)**:
```json
{
  "message": {
    "id": 2,
    "chat_id": 1,
    "sender_id": 2,
    "sender_role": "admin",
    "message_type": "text",
    "text": "أهلا بك، كيف يمكنني مساعدتك؟",
    "created_at": "2024-01-15T10:01:00Z",
    "sender_name": "الدعم الفني"
  }
}
```

**ملاحظة**: عند إرسال الأدمن رسالة لشات في حالة `waiting_for_admin`، يتم تحديث الحالة تلقائياً إلى `admin_handling`.

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/messages \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "أهلا بك، كيف يمكنني مساعدتك؟",
    "chat_id": 1
  }'
```

---

### 4. إرسال صورة/ملف للطالب

إرسال ملف (صورة/فيديو/ملف) لشات طالب معين.

**Endpoint**: `POST /api/support/messages/media`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `file` (required) - الملف
- `text` (optional) - نص مصاحب
- `chat_id` (required) - معرف الشات

**Response (201 Created)**:
```json
{
  "message": {
    "id": 3,
    "chat_id": 1,
    "sender_id": 2,
    "message_type": "image",
    "text": "صورة الحل",
    "media_url": "https://cloudinary.com/...",
    "media_type": "image/jpeg",
    "media_name": "solution.jpg",
    "media_size": 1024000,
    "created_at": "2024-01-15T10:05:00Z"
  }
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/messages/media \
  -H "Authorization: Bearer <admin_token>" \
  -F "file=@image.jpg" \
  -F "text=صورة الحل" \
  -F "chat_id=1"
```

---

### 5. إرسال رسالة صوتية للطالب

إرسال رسالة صوتية لشات طالب معين.

**Endpoint**: `POST /api/support/messages/audio`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `audio` (required) - ملف صوتي
- `duration` (optional) - مدة التسجيل بالثواني
- `chat_id` (required) - معرف الشات

**Response (201 Created)**:
```json
{
  "message": {
    "id": 4,
    "chat_id": 1,
    "sender_id": 2,
    "message_type": "audio",
    "media_url": "https://cloudinary.com/voice.mp3",
    "media_type": "audio/mpeg",
    "media_name": "voice-message.mp3",
    "media_size": 245760,
    "duration": 15,
    "created_at": "2024-01-15T10:10:00Z"
  }
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/messages/audio \
  -H "Authorization: Bearer <admin_token>" \
  -F "audio=@voice-message.mp3" \
  -F "duration=15.5" \
  -F "chat_id=1"
```

---

### 6. تعيين الأدمن للشات

تعيين الأدمن الحالي لشات طالب معين. هذا يحدث الحالة تلقائياً إلى `admin_handling`.

**Endpoint**: `POST /api/support/chats/:chatId/assign`

**Headers**:
```
Authorization: Bearer <admin_token>
```

**Response (200 OK)**:
```json
{
  "message": "Admin assigned to chat"
}
```

**ملاحظة**: عند تعيين الأدمن للشات:
- يتم تحديث `admin_id` للأدمن الحالي
- يتم تحديث حالة الشات إلى `admin_handling`
- يتوقف البوت عن الرد التلقائي

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/chats/1/assign \
  -H "Authorization: Bearer <admin_token>"
```

---

### 7. تحديث حالة الشات

تحديث حالة شات معين.

**Endpoint**: `PATCH /api/support/chats/:chatId/status`

**Headers**:
```
Authorization: Bearer <admin_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "status": "resolved"
}
```

**Status Values**:
- `open` - الشات مفتوح
- `bot_handling` - البوت يتعامل مع الشات
- `waiting_for_admin` - في انتظار الأدمن
- `admin_handling` - الأدمن يتعامل مع الشات
- `resolved` - تم حل المشكلة
- `closed` - الشات مغلق

**Response (200 OK)**:
```json
{
  "message": "Chat status updated"
}
```

**مثال**:
```bash
curl -X PATCH http://localhost:8000/api/support/chats/1/status \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "resolved"}'
```

---

### 8. عدد الرسائل غير المقروءة

جلب عدد الرسائل غير المقروءة للأدمن.

**Endpoint**: `GET /api/support/unread-count`

**Headers**:
```
Authorization: Bearer <admin_token>
```

**Response (200 OK)**:
```json
{
  "unread_count": 5
}
```

**مثال**:
```bash
curl -X GET http://localhost:8000/api/support/unread-count \
  -H "Authorization: Bearer <admin_token>"
```

---

### 9. جلب إشعارات الرسائل

جلب قائمة بالرسائل غير المقروءة في شاتات الدعم الفني.

**Endpoint**: `GET /api/support/notifications`

**Headers**:
```
Authorization: Bearer <admin_token>
```

**Query Parameters**:
- `limit` (optional, default: 20) - عدد الإشعارات
- `offset` (optional, default: 0) - للـ pagination

**Response (200 OK)**:
```json
{
  "notifications": [
    {
      "message_id": 5,
      "chat_id": 1,
      "sender_id": 5,
      "sender_role": "student",
      "sender_name": "أحمد محمد",
      "sender_email": "ahmed@example.com",
      "message_type": "text",
      "text": "مرحبا، أحتاج مساعدة",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": false,
      "chat_status": "waiting_for_admin",
      "student_id": 5,
      "admin_id": null,
      "is_unread": true,
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**ملاحظات**:
- للأدمن: يرجع جميع الرسائل من الطلاب غير المقروءة في جميع الشاتات
- للطالب: يرجع الرسائل من الأدمن غير المقروءة في شاته
- يتم استبعاد الرسائل التلقائية (`is_auto_reply = false`)
- يتم استبعاد الرسائل المقروءة (`read_at IS NULL`)

**مثال**:
```bash
# جلب الإشعارات
curl -X GET "http://localhost:8000/api/support/notifications?limit=20&offset=0" \
  -H "Authorization: Bearer <admin_token>"

# جلب المزيد من الإشعارات
curl -X GET "http://localhost:8000/api/support/notifications?limit=20&offset=20" \
  -H "Authorization: Bearer <admin_token>"
```

---

## Socket.io Events

### الاتصال

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: 'your_admin_token' },
  transports: ['websocket', 'polling']
});
```

---

### الأحداث الواردة (Incoming Events)

#### 1. `support:admin-connected`

يتم إرساله عند اتصال الأدمن.

**Payload**:
```json
{
  "total_chats": 10
}
```

---

#### 2. `support:notification` (Real-Time)

Event محسّن لإشعارات الدعم الفني (Real-Time) - يُرسل عند وصول رسالة جديدة من طالب.

**Payload**:
```json
{
  "type": "support_chat_message",
  "notification_type": "student_message",
  "chat_id": 1,
  "student_id": 5,
  "student_name": "أحمد محمد",
  "student_email": "ahmed@example.com",
  "message": {
    "id": 1,
    "message_id": 1,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "student",
    "sender_name": "أحمد محمد",
    "message_type": "text",
    "text": "مرحبا، أحتاج مساعدة",
    "media_url": null,
    "media_type": null,
    "is_auto_reply": false,
    "created_at": "2024-01-15T10:00:00Z"
  },
  "unread_count": 3,
  "timestamp": 1705315200000
}
```

**الاستخدام**:
```javascript
socket.on('support:notification', (notification) => {
  if (notification.notification_type === 'student_message') {
    console.log('New message from student:', notification.student_name);
    
    // عرض إشعار
    showNotification(`رسالة من ${notification.student_name}`, notification.message.text);
    
    // تحديث قائمة الشاتات
    updateChatsList(notification);
    
    // تحديث عدد الرسائل غير المقروءة
    updateUnreadCount(notification.unread_count);
  }
});
```

---

#### 3. `support:new-chat-message` (Legacy)

Event قديم لإشعارات الدعم الفني (للتوافق).

**Payload**:
```json
{
  "chat_id": 1,
  "student_id": 5,
  "student_name": "أحمد محمد",
  "student_email": "ahmed@example.com",
  "message": {
    "id": 1,
    "text": "مرحبا، أحتاج مساعدة",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "unread_count": 3
}
```

**الاستخدام**:
```javascript
socket.on('support:new-chat-message', (data) => {
  console.log('New message from student:', data.student_name);
  // عرض إشعار أو تحديث قائمة الشاتات
});
```

---

#### 4. `notification:new` (Legacy)

Event قديم لإشعارات الدعم الفني (للتوافق).

**Payload**:
```json
{
  "type": "support_chat_message",
  "notification_type": "student_message",
  "chat_id": 1,
  "student_id": 5,
  "student_name": "أحمد محمد",
  "message": {
    "id": 1,
    "text": "مرحبا، أحتاج مساعدة",
    "created_at": "2024-01-15T10:00:00Z"
  },
  "unread_count": 3
}
```

---

#### 5. `support:new-message`

يتم إرساله عند وصول رسالة جديدة في شات معين.

**Payload**: نفس `support:new-message` للطالب

---

#### 4. `support:admin-viewing`

يتم إرساله عندما ينضم أدمن آخر للشات.

**Payload**:
```json
{
  "chat_id": 1,
  "admin_id": 3
}
```

---

### الأحداث الصادرة (Outgoing Events)

#### 1. `support:send-message`

إرسال رسالة نصية عبر Socket.io.

**Payload**:
```json
{
  "chat_id": 1,
  "text": "أهلا بك، كيف يمكنني مساعدتك؟"
}
```

**الاستخدام**:
```javascript
socket.emit('support:send-message', {
  chat_id: 1,
  text: 'أهلا بك، كيف يمكنني مساعدتك؟'
});
```

---

#### 2. `support:join-chat`

الانضمام لشات معين.

**Payload**: `chatId` (number)

**الاستخدام**:
```javascript
socket.emit('support:join-chat', chatId);
```

**ملاحظة**: عند الانضمام للشات:
- يتم إرسال إشعار للطالب أن الأدمن يشاهد الشات
- يتم تحديث جميع الرسائل كمستلمة ومقروءة

---

#### 3. `support:mark-read`

تحديد رسالة كمقروءة.

**Payload**: `messageId` (number)

---

#### 4. `support:mark-chat-read`

تحديد جميع رسائل الشات كمقروءة.

**Payload**: `chatId` (number)

---

#### 5. `support:typing`

إرسال مؤشر الكتابة.

**Payload**:
```json
{
  "chat_id": 1,
  "is_typing": true
}
```

---

## مثال كامل (React/TypeScript)

```typescript
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';

function AdminSupportChat() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [chats, setChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    const newSocket = io('http://localhost:8000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    // عند الاتصال
    newSocket.on('support:admin-connected', (data) => {
      console.log('Connected as admin, total chats:', data.total_chats);
      loadChats();
    });

    // رسالة جديدة من طالب
    newSocket.on('support:new-chat-message', (data) => {
      // تحديث قائمة الشاتات
      setChats(prev => prev.map(chat => 
        chat.id === data.chat_id 
          ? { ...chat, unread_count: data.unread_count }
          : chat
      ));
      
      // إذا كان الشات مفتوح، إضافة الرسالة
      if (selectedChat === data.chat_id) {
        setMessages(prev => [...prev, data.message]);
      }
    });

    // رسالة جديدة في الشات
    newSocket.on('support:new-message', (message) => {
      if (selectedChat === message.chat_id) {
        setMessages(prev => [...prev, message]);
      }
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, [selectedChat]);

  const loadChats = async () => {
    const res = await fetch('/api/support/chats?status=waiting_for_admin', {
      headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` }
    });
    const data = await res.json();
    setChats(data.chats);
  };

  const loadMessages = async (chatId: number) => {
    const res = await fetch(`/api/support/chats/${chatId}/messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` }
    });
    const data = await res.json();
    setMessages(data.messages);
    
    // الانضمام للشات
    if (socket) {
      socket.emit('support:join-chat', chatId);
    }
  };

  const assignToChat = async (chatId: number) => {
    const res = await fetch(`/api/support/chats/${chatId}/assign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('admin_token')}` }
    });
    
    if (res.ok) {
      setSelectedChat(chatId);
      loadMessages(chatId);
      loadChats(); // تحديث القائمة
    }
  };

  const sendMessage = async (text: string) => {
    if (!selectedChat) return;

    const res = await fetch('/api/support/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('admin_token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        chat_id: selectedChat
      })
    });

    const data = await res.json();
    setMessages(prev => [...prev, data.message]);
  };

  return (
    <div className="admin-chat-container">
      <div className="chats-list">
        <h2>الشاتات ({chats.length})</h2>
        {chats.map(chat => (
          <div 
            key={chat.id} 
            className={`chat-item ${selectedChat === chat.id ? 'active' : ''}`}
            onClick={() => {
              assignToChat(chat.id);
            }}
          >
            <div className="student-name">{chat.student_name}</div>
            <div className="status">{chat.status}</div>
            {chat.unread_count > 0 && (
              <div className="unread-badge">{chat.unread_count}</div>
            )}
          </div>
        ))}
      </div>

      {selectedChat && (
        <div className="chat-messages">
          <div className="messages">
            {messages.map(msg => (
              <div key={msg.id} className={`message ${msg.sender_role}`}>
                <div className="sender">{msg.sender_name}</div>
                <div className="text">{msg.text}</div>
              </div>
            ))}
          </div>
          <input 
            type="text"
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                sendMessage(e.currentTarget.value);
                e.currentTarget.value = '';
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
```

---

## ملخص سريع

### REST APIs
- `GET /api/support/chats` - جلب جميع الشاتات
- `GET /api/support/chats/:chatId/messages` - جلب رسائل الشات
- `POST /api/support/messages` - إرسال رسالة نصية
- `POST /api/support/messages/media` - إرسال صورة/ملف
- `POST /api/support/messages/audio` - إرسال رسالة صوتية
- `POST /api/support/chats/:chatId/assign` - تعيين الأدمن للشات
- `PATCH /api/support/chats/:chatId/status` - تحديث حالة الشات
- `GET /api/support/unread-count` - عدد الرسائل غير المقروءة
- `GET /api/support/notifications` - جلب إشعارات الرسائل

### Socket.io Events (Incoming)
- `support:admin-connected` - عند الاتصال
- `support:notification` - إشعار Real-Time محسّن (جديد)
- `support:new-chat-message` - رسالة جديدة من طالب (legacy)
- `notification:new` - إشعار قديم (legacy)
- `support:new-message` - رسالة جديدة في الشات
- `support:admin-viewing` - أدمن آخر يشاهد الشات

### Socket.io Events (Outgoing)
- `support:send-message` - إرسال رسالة
- `support:join-chat` - الانضمام للشات
- `support:mark-read` - تحديد رسالة كمقروءة
- `support:mark-chat-read` - تحديد الشات كمقروء
- `support:typing` - مؤشر الكتابة

---

## ملاحظات مهمة

1. ✅ **chat_id مطلوب**: عند إرسال رسالة، يجب تحديد `chat_id`
2. ✅ **تعيين الأدمن**: استخدم `/assign` لتعيين نفسك للشات قبل البدء
3. ✅ **تحديث الحالة**: عند إرسال رسالة لشات في `waiting_for_admin`، يتم تحديث الحالة تلقائياً
4. ✅ **Real-time**: الرسائل تظهر فوراً عبر Socket.io
5. ✅ **Unread Count**: يتم تحديث عدد الرسائل غير المقروءة تلقائياً

---

## سيناريو الاستخدام النموذجي

1. **جلب الشاتات في انتظار الأدمن**:
   ```bash
   GET /api/support/chats?status=waiting_for_admin
   ```

2. **تعيين نفسك للشات**:
   ```bash
   POST /api/support/chats/1/assign
   ```

3. **جلب الرسائل**:
   ```bash
   GET /api/support/chats/1/messages
   ```

4. **إرسال رد للطالب**:
   ```bash
   POST /api/support/messages
   {
     "text": "أهلا بك، كيف يمكنني مساعدتك؟",
     "chat_id": 1
   }
   ```

5. **تحديث الحالة بعد الحل**:
   ```bash
   PATCH /api/support/chats/1/status
   {
     "status": "resolved"
   }
   ```

