# API رسائل الدعم الفني - للطالب

## نظرة عامة
APIs و Socket.io Events الخاصة بالطالب للتواصل مع الدعم الفني.

---

## REST APIs

### 1. الحصول على شات الطالب

**Endpoint**: `GET /api/support/chat`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Response (200 OK)**:
```json
{
  "chat": {
    "id": 1,
    "student_id": 5,
    "admin_id": null,
    "status": "open",
    "last_message_at": "2024-01-15T10:00:00Z",
    "created_at": "2024-01-15T09:00:00Z"
  }
}
```

**مثال**:
```bash
curl -X GET http://localhost:8000/api/support/chat \
  -H "Authorization: Bearer <student_token>"
```

---

### 2. جلب رسائل الشات

**Endpoint**: `GET /api/support/chats/:chatId/messages`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Query Parameters**:
- `limit` (optional, default: 50) - عدد الرسائل
- `before` (optional) - timestamp للـ pagination

**ملاحظة مهمة**: عند جلب الرسائل للطالب:
- يتم تحديد جميع الرسائل غير المقروءة كمقروءة تلقائياً
- يتم إرسال event `support:notifications-cleared` لإلغاء الإشعارات
- عدد الرسائل غير المقروءة يصبح 0 حتى تصل رسالة جديدة

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
      "text": "مرحبا",
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
      "text": "أهلا بك",
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
  -H "Authorization: Bearer <student_token>"
```

---

### 3. إرسال رسالة نصية

**Endpoint**: `POST /api/support/messages`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "text": "مرحبا، أحتاج مساعدة"
}
```

**ملاحظة**: `chat_id` غير مطلوب للطالب (يتم تحديده تلقائياً)

**Response (201 Created)**:
```json
{
  "message": {
    "id": 1,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "student",
    "message_type": "text",
    "text": "مرحبا، أحتاج مساعدة",
    "created_at": "2024-01-15T10:00:00Z",
    "sender_name": "أحمد محمد"
  },
  "auto_reply": {
    "id": 2,
    "message_type": "auto_reply",
    "text": "يمكننا مساعدتك...",
    "is_auto_reply": true,
    "sender_name": "رد تلقائي"
  }
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/messages \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "مرحبا، أحتاج مساعدة"}'
```

---

### 4. إرسال صورة/ملف

**Endpoint**: `POST /api/support/messages/media`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `file` (required) - الملف (صورة/فيديو/ملف)
- `text` (optional) - نص مصاحب

**Response (201 Created)**:
```json
{
  "message": {
    "id": 3,
    "chat_id": 1,
    "sender_id": 5,
    "message_type": "image",
    "text": "صورة المشكلة",
    "media_url": "https://cloudinary.com/...",
    "media_type": "image/jpeg",
    "media_name": "problem.jpg",
    "media_size": 1024000,
    "created_at": "2024-01-15T10:05:00Z"
  }
}
```

**مثال**:
```bash
curl -X POST http://localhost:8000/api/support/messages/media \
  -H "Authorization: Bearer <student_token>" \
  -F "file=@image.jpg" \
  -F "text=صورة المشكلة"
```

---

### 5. إرسال رسالة صوتية

**Endpoint**: `POST /api/support/messages/audio`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `audio` (required) - ملف صوتي (MP3, WAV, OGG, M4A, etc.)
- `duration` (optional) - مدة التسجيل بالثواني

**Response (201 Created)**:
```json
{
  "message": {
    "id": 4,
    "chat_id": 1,
    "sender_id": 5,
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
  -H "Authorization: Bearer <student_token>" \
  -F "audio=@voice-message.mp3" \
  -F "duration=15.5"
```

---

### 6. جلب الأسئلة التلقائية المتاحة

**Endpoint**: `GET /api/support/faq`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Response (200 OK)**:
```json
{
  "faqs": [
    {
      "id": 1,
      "question": "كيف أشترك في الباقة؟",
      "answer": "يمكنك الاشتراك في الباقة من خلال:\n1. الذهاب إلى صفحة الباقات\n2. اختيار الباقة المناسبة\n3. الضغط على زر الاشتراك\n4. إدخال كود التفعيل",
      "priority": 10
    },
    {
      "id": 2,
      "question": "ما هي طرق الدفع المتاحة؟",
      "answer": "طرق الدفع المتاحة:\n- الدفع النقدي\n- التحويل البنكي\n- كروت الهدايا",
      "priority": 8
    }
  ]
}
```

**ملاحظات**:
- يتم جلب فقط FAQs النشطة (`is_active = true`)
- مرتبة حسب الأولوية (`priority DESC`)
- الطالب يمكنه اختيار سؤال من القائمة وإرساله للحصول على رد تلقائي فوراً

**مثال**:
```bash
curl -X GET http://localhost:8000/api/support/faq \
  -H "Authorization: Bearer <student_token>"
```

**الاستخدام في Frontend**:
```javascript
// جلب الأسئلة المتاحة
const loadFAQs = async () => {
  const response = await fetch('/api/support/faq', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  setFAQs(data.faqs);
};

// عند اختيار الطالب لسؤال
const selectFAQ = async (faq) => {
  // إرسال السؤال للحصول على رد تلقائي
  const response = await fetch('/api/support/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: faq.question })
  });
  const data = await response.json();
  // الرد التلقائي سيظهر فوراً في data.auto_reply
};
```

---

### 7. عدد الرسائل غير المقروءة

**Endpoint**: `GET /api/support/unread-count`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Response (200 OK)**:
```json
{
  "unread_count": 3
}
```

**مثال**:
```bash
curl -X GET http://localhost:8000/api/support/unread-count \
  -H "Authorization: Bearer <student_token>"
```

---

### 8. جلب إشعارات الرسائل

جلب قائمة بالرسائل غير المقروءة من الأدمن في شات الدعم الفني.

**Endpoint**: `GET /api/support/notifications`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Query Parameters**:
- `limit` (optional, default: 20) - عدد الإشعارات
- `offset` (optional, default: 0) - للـ pagination

**Response (200 OK)**:
```json
{
  "notifications": [
    {
      "message_id": 2,
      "chat_id": 1,
      "sender_id": 2,
      "sender_role": "admin",
      "sender_name": "الدعم الفني",
      "sender_email": null,
      "message_type": "text",
      "text": "أهلا بك، كيف يمكنني مساعدتك؟",
      "media_url": null,
      "media_type": null,
      "is_auto_reply": false,
      "chat_status": "admin_handling",
      "student_id": 5,
      "admin_id": 2,
      "is_unread": true,
      "created_at": "2024-01-15T10:01:00Z"
    }
  ],
  "pagination": {
    "total": 3,
    "limit": 20,
    "offset": 0,
    "has_more": false
  }
}
```

**ملاحظات**:
- يرجع فقط الرسائل من الأدمن غير المقروءة في شات الطالب
- يتم استبعاد الرسائل التلقائية (`is_auto_reply = false`)
- يتم استبعاد الرسائل المقروءة (`read_at IS NULL`)

**مثال**:
```bash
# جلب الإشعارات
curl -X GET "http://localhost:8000/api/support/notifications?limit=20&offset=0" \
  -H "Authorization: Bearer <student_token>"
```

---

## Socket.io Events

### الاتصال

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: 'your_student_token' },
  transports: ['websocket', 'polling']
});
```

---

### الأحداث الواردة (Incoming Events)

#### 1. `support:chat-connected`
**الوصف**: يتم إرساله عند الاتصال والانضمام للشات

**Payload**:
```json
{
  "chat_id": 1
}
```

**الاستخدام**:
```javascript
socket.on('support:chat-connected', (data) => {
  console.log('Connected to chat:', data.chat_id);
  // جلب الرسائل السابقة
  loadMessages(data.chat_id);
});
```

---

#### 2. `support:new-message`
**الوصف**: يتم إرساله عند وصول رسالة جديدة (من الأدمن أو رد تلقائي)

**Payload**:
```json
{
  "id": 2,
  "chat_id": 1,
  "sender_id": 2,
  "sender_role": "admin",
  "message_type": "text",
  "text": "أهلا بك، كيف يمكنني مساعدتك؟",
  "is_auto_reply": false,
  "created_at": "2024-01-15T10:01:00Z",
  "sender_name": "الدعم الفني",
  "_timestamp": 1705315200000,
  "_uniqueId": "msg_2_1705315200000"
}
```

**الاستخدام**:
```javascript
socket.on('support:new-message', (message) => {
  // إضافة الرسالة للشات
  setMessages(prev => {
    // منع التكرار
    const exists = prev.some(msg => msg.id === message.id);
    if (exists) return prev;
    return [...prev, message];
  });
});
```

---

#### 3. `support:admin-message`
**الوصف**: يتم إرساله عند وصول رسالة من الأدمن (Event قديم للتوافق)

**Payload**:
```json
{
  "chat_id": 1,
  "message": {
    "id": 2,
    "text": "أهلا بك",
    "sender_role": "admin",
    "created_at": "2024-01-15T10:01:00Z"
  }
}
```

**الاستخدام**:
```javascript
socket.on('support:admin-message', (data) => {
  setMessages(prev => [...prev, data.message]);
});
```

---

#### 4. `support:message-status-updated`
**الوصف**: يتم إرساله عند تحديث حالة الرسالة (delivered/read)

**Payload**:
```json
{
  "message_id": 1,
  "status": "read",
  "read_at": "2024-01-15T10:01:00Z"
}
```

**الاستخدام**:
```javascript
socket.on('support:message-status-updated', (data) => {
  setMessages(prev => prev.map(msg => 
    msg.id === data.message_id 
      ? { ...msg, status: data.status, read_at: data.read_at }
      : msg
  ));
});
```

---

#### 5. `support:notification` (Real-Time)
**الوصف**: Event محسّن لإشعارات الدعم الفني (Real-Time)

**Payload**:
```json
{
  "type": "support_chat_message",
  "notification_type": "admin_reply",
  "chat_id": 1,
  "message": {
    "id": 2,
    "message_id": 2,
    "chat_id": 1,
    "sender_id": 2,
    "sender_role": "admin",
    "sender_name": "الدعم الفني",
    "message_type": "text",
    "text": "أهلا بك، كيف يمكنني مساعدتك؟",
    "media_url": null,
    "media_type": null,
    "is_auto_reply": false,
    "created_at": "2024-01-15T10:01:00Z"
  },
  "timestamp": 1705315200000
}
```

**الاستخدام**:
```javascript
socket.on('support:notification', (notification) => {
  if (notification.notification_type === 'admin_reply') {
    // عرض إشعار للمستخدم
    showNotification('رد من الدعم الفني', notification.message.text);
    
    // تحديث قائمة الإشعارات
    addNotificationToList(notification);
  }
});
```

---

#### 6. `notification:new` (Legacy)
**الوصف**: Event قديم لإشعارات الدعم الفني (للتوافق)

**Payload**:
```json
{
  "type": "support_chat_message",
  "notification_type": "admin_reply",
  "chat_id": 1,
  "message": {
    "id": 2,
    "text": "أهلا بك",
    "created_at": "2024-01-15T10:01:00Z"
  }
}
```

**الاستخدام**:
```javascript
socket.on('notification:new', (data) => {
  if (data.type === 'support_chat_message' && data.notification_type === 'admin_reply') {
    // عرض إشعار للمستخدم
    showNotification('رد من الدعم الفني', data.message.text);
  }
});
```

---

### الأحداث الصادرة (Outgoing Events)

#### 1. `support:send-message`
**الوصف**: إرسال رسالة نصية عبر Socket.io

**Payload**:
```json
{
  "text": "مرحبا، أحتاج مساعدة"
}
```

**ملاحظة**: `chat_id` غير مطلوب للطالب

**الاستخدام**:
```javascript
socket.emit('support:send-message', {
  text: 'مرحبا، أحتاج مساعدة'
});
```

---

#### 2. `support:join-chat`
**الوصف**: الانضمام لشات محدد

**Payload**: `chatId` (number)

**الاستخدام**:
```javascript
socket.emit('support:join-chat', chatId);
```

---

#### 3. `support:mark-read`
**الوصف**: تحديد رسالة كمقروءة

**Payload**: `messageId` (number)

**الاستخدام**:
```javascript
socket.emit('support:mark-read', messageId);
```

---

#### 4. `support:mark-chat-read`
**الوصف**: تحديد جميع رسائل الشات كمقروءة

**Payload**: `chatId` (number)

**الاستخدام**:
```javascript
socket.emit('support:mark-chat-read', chatId);
```

---

#### 5. `support:typing`
**الوصف**: إرسال مؤشر الكتابة (Typing Indicator)

**Payload**:
```json
{
  "chat_id": 1,
  "is_typing": true
}
```

**الاستخدام**:
```javascript
// بدء الكتابة
socket.emit('support:typing', {
  chat_id: chatId,
  is_typing: true
});

// إيقاف الكتابة
socket.emit('support:typing', {
  chat_id: chatId,
  is_typing: false
});
```

---

## مثال كامل (React/TypeScript)

```typescript
import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

function StudentSupportChat() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const receivedIds = useRef<Set<number>>(new Set());

  useEffect(() => {
    const token = localStorage.getItem('token');
    const newSocket = io('http://localhost:8000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    // عند الاتصال
    newSocket.on('support:chat-connected', (data) => {
      setChatId(data.chat_id);
      loadMessages(data.chat_id);
    });

    // استلام رسالة جديدة
    newSocket.on('support:new-message', (message) => {
      if (receivedIds.current.has(message.id)) return;
      receivedIds.current.add(message.id);
      
      if (message.sender_role === 'admin') {
        setMessages(prev => [...prev, message]);
      }
    });

    // إشعار جديد
    newSocket.on('notification:new', (data) => {
      if (data.type === 'admin_reply') {
        showNotification('رد من الدعم الفني', data.message.text);
      }
    });

    setSocket(newSocket);
    return () => newSocket.close();
  }, []);

  const loadMessages = async (id: number) => {
    const res = await fetch(`/api/support/chats/${id}/messages`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
    });
    const data = await res.json();
    setMessages(data.messages);
    data.messages.forEach((msg: any) => receivedIds.current.add(msg.id));
  };

  const sendMessage = async (text: string) => {
    const res = await fetch('/api/support/messages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    setMessages(prev => [...prev, data.message]);
  };

  return (
    <div>
      {messages.map(msg => (
        <div key={msg.id}>{msg.text}</div>
      ))}
      <input onKeyPress={(e) => {
        if (e.key === 'Enter') sendMessage(e.currentTarget.value);
      }} />
    </div>
  );
}
```

---

## ملخص سريع

### REST APIs
- `GET /api/support/chat` - الحصول على الشات
- `GET /api/support/chats/:chatId/messages` - جلب الرسائل
- `POST /api/support/messages` - إرسال رسالة نصية
- `POST /api/support/messages/media` - إرسال صورة/ملف
- `POST /api/support/messages/audio` - إرسال رسالة صوتية
- `GET /api/support/unread-count` - عدد الرسائل غير المقروءة
- `GET /api/support/notifications` - جلب إشعارات الرسائل

### Socket.io Events (Incoming)
- `support:chat-connected` - عند الاتصال
- `support:notification` - إشعار Real-Time محسّن (جديد)
- `support:new-message` - رسالة جديدة
- `support:admin-message` - رسالة من الأدمن (legacy)
- `support:message-status-updated` - تحديث حالة الرسالة
- `support:notifications-cleared` - إلغاء الإشعارات عند فتح الشات (جديد)
- `notification:new` - إشعار قديم (legacy)

### Socket.io Events (Outgoing)
- `support:send-message` - إرسال رسالة
- `support:join-chat` - الانضمام للشات
- `support:mark-read` - تحديد رسالة كمقروءة
- `support:mark-chat-read` - تحديد الشات كمقروء
- `support:typing` - مؤشر الكتابة

---

## ملاحظات مهمة

1. ✅ **Real-Time**: الرسائل تظهر فوراً عبر Socket.io
2. ✅ **منع التكرار**: استخدم `Set` لتتبع IDs الرسائل
3. ✅ **Auto Reply**: قد يتم إرسال رد تلقائي عند إرسال رسالة
4. ✅ **Token**: يجب أن يكون Token صحيح وصالح
5. ✅ **Reconnection**: Socket.io يعيد الاتصال تلقائياً

