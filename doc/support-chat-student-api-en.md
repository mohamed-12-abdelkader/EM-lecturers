# Support Chat API Documentation - Students Only

## Overview

APIs and Socket.io events for students to communicate with support. Students can send messages, receive real-time responses, and interact with an AI chatbot that may escalate to human admins when needed.

---

## Base URL

```
http://localhost:8000/api/support
```

All endpoints require authentication via Bearer token in the Authorization header.

---

## REST APIs

### 1. Get Student Chat

Retrieves the student's support chat. Creates one if it doesn't exist.

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

**Chat Status Values**:
- `open` - Chat is open
- `bot_handling` - AI chatbot is handling the conversation
- `waiting_for_admin` - Waiting for admin response (student cannot send messages)
- `admin_handling` - Admin is actively handling the chat
- `resolved` - Chat has been resolved
- `closed` - Chat is closed

**Example**:
```bash
curl -X GET http://localhost:8000/api/support/chat \
  -H "Authorization: Bearer <student_token>"
```

---

### 2. Get Chat Messages

Retrieves messages for a specific chat. Students can only access their own chat.

**Endpoint**: `GET /api/support/chats/:chatId/messages`

**Headers**:
```
Authorization: Bearer <student_token>
```

**Query Parameters**:
- `limit` (optional, default: 50) - Number of messages to retrieve
- `before` (optional) - Timestamp for pagination (ISO 8601 format)

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
      "text": "Hello, I need help",
      "is_auto_reply": false,
      "delivered_at": "2024-01-15T10:00:05Z",
      "read_at": "2024-01-15T10:01:00Z",
      "status": "read",
      "created_at": "2024-01-15T10:00:00Z",
      "sender_name": "John Doe"
    },
    {
      "id": 2,
      "chat_id": 1,
      "sender_id": 2,
      "sender_role": "admin",
      "message_type": "text",
      "text": "Hello, how can I help you?",
      "is_auto_reply": false,
      "created_at": "2024-01-15T10:01:00Z",
      "sender_name": "Support Team"
    },
    {
      "id": 3,
      "chat_id": 1,
      "sender_id": 2,
      "sender_role": "admin",
      "message_type": "auto_reply",
      "text": "I can help you with that...",
      "is_auto_reply": true,
      "faq_id": 1,
      "created_at": "2024-01-15T10:02:00Z",
      "sender_name": "Auto Reply"
    }
  ]
}
```

**Message Types**:
- `text` - Text message
- `image` - Image attachment
- `audio` - Audio/voice message
- `file` - File attachment
- `auto_reply` - Automated reply from chatbot

**Message Status**:
- `sent` - Message sent
- `delivered` - Message delivered
- `read` - Message read

**Example**:
```bash
curl -X GET "http://localhost:8000/api/support/chats/1/messages?limit=50" \
  -H "Authorization: Bearer <student_token>"
```

**Error Responses**:
- `403 Forbidden` - If student tries to access another student's chat
- `400 Bad Request` - If chat ID is invalid

---

### 3. Send Text Message

Sends a text message. For students, `chat_id` is optional and will be determined automatically.

**Endpoint**: `POST /api/support/messages`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: application/json
```

**Request Body**:
```json
{
  "text": "Hello, I need help with my subscription"
}
```

**Note**: `chat_id` is not required for students (automatically determined)

**Response (201 Created)**:
```json
{
  "message": {
    "id": 1,
    "chat_id": 1,
    "sender_id": 5,
    "sender_role": "student",
    "message_type": "text",
    "text": "Hello, I need help with my subscription",
    "created_at": "2024-01-15T10:00:00Z",
    "sender_name": "John Doe"
  },
  "bot_reply": {
    "id": 2,
    "message_type": "auto_reply",
    "text": "I can help you with subscription issues...",
    "is_auto_reply": true,
    "sender_name": "Auto Reply"
  }
}
```

**Note**: A `bot_reply` may be included if the AI chatbot generates an automatic response.

**Example**:
```bash
curl -X POST http://localhost:8000/api/support/messages \
  -H "Authorization: Bearer <student_token>" \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, I need help with my subscription"}'
```

**Error Responses**:
- `403 Forbidden` - If chat status is `waiting_for_admin` (student cannot send messages while waiting)
- `400 Bad Request` - If validation fails (empty text, etc.)

**Error Response Example**:
```json
{
  "message": "Please wait for admin response. You cannot send messages while waiting for support team.",
  "status": "waiting_for_admin"
}
```

---

### 4. Send Media File (Image/Video/File)

Sends a media file (image, video, or document) with optional text.

**Endpoint**: `POST /api/support/messages/media`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `file` (required) - The file (image/video/document)
- `text` (optional) - Accompanying text

**File Size Limit**: 50MB

**Supported Media Types**:
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Videos: `video/mp4`, `video/quicktime`, etc.
- Documents: `application/pdf`, `application/msword`, etc.

**Response (201 Created)**:
```json
{
  "message": {
    "id": 3,
    "chat_id": 1,
    "sender_id": 5,
    "message_type": "image",
    "text": "Screenshot of the problem",
    "media_url": "https://cloudinary.com/...",
    "media_type": "image/jpeg",
    "media_name": "problem.jpg",
    "media_size": 1024000,
    "created_at": "2024-01-15T10:05:00Z"
  }
}
```

**Example**:
```bash
curl -X POST http://localhost:8000/api/support/messages/media \
  -H "Authorization: Bearer <student_token>" \
  -F "file=@image.jpg" \
  -F "text=Screenshot of the problem"
```

**Error Responses**:
- `400 Bad Request` - If file is missing or invalid

---

### 5. Send Audio Message

Sends an audio/voice message.

**Endpoint**: `POST /api/support/messages/audio`

**Headers**:
```
Authorization: Bearer <student_token>
Content-Type: multipart/form-data
```

**Form Data**:
- `audio` (required) - Audio file (MP3, WAV, OGG, M4A, etc.)
- `duration` (optional) - Recording duration in seconds

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

**Example**:
```bash
curl -X POST http://localhost:8000/api/support/messages/audio \
  -H "Authorization: Bearer <student_token>" \
  -F "audio=@voice-message.mp3" \
  -F "duration=15.5"
```

---

### 6. Get Available FAQs

Retrieves active frequently asked questions that students can select for quick responses.

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
      "question": "How do I subscribe to a package?",
      "answer": "You can subscribe to a package by:\n1. Going to the packages page\n2. Selecting the appropriate package\n3. Clicking the subscribe button\n4. Entering the activation code",
      "priority": 10
    },
    {
      "id": 2,
      "question": "What payment methods are available?",
      "answer": "Available payment methods:\n- Cash payment\n- Bank transfer\n- Gift cards",
      "priority": 8
    }
  ]
}
```

**Notes**:
- Only active FAQs (`is_active = true`) are returned
- Ordered by priority (highest first)
- Students can select a question from the list and send it to get an immediate auto-reply

**Example**:
```bash
curl -X GET http://localhost:8000/api/support/faq \
  -H "Authorization: Bearer <student_token>"
```

**Frontend Usage Example**:
```javascript
// Fetch available FAQs
const loadFAQs = async () => {
  const response = await fetch('/api/support/faq', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  setFAQs(data.faqs);
};

// When student selects a FAQ
const selectFAQ = async (faq) => {
  // Send the question to get an auto-reply
  const response = await fetch('/api/support/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text: faq.question })
  });
  const data = await response.json();
  // Auto-reply will appear immediately in data.bot_reply
};
```

---

### 7. Get Unread Message Count

Retrieves the count of unread messages for the student.

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

**Example**:
```bash
curl -X GET http://localhost:8000/api/support/unread-count \
  -H "Authorization: Bearer <student_token>"
```

---

## Socket.io Events

### Connection

Connect to the Socket.io server with authentication:

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: 'your_student_token' },
  transports: ['websocket', 'polling']
});
```

---

### Incoming Events (Listen)

#### 1. `support:chat-connected`

Emitted when the student connects and joins their chat.

**Payload**:
```json
{
  "chat_id": 1
}
```

**Usage**:
```javascript
socket.on('support:chat-connected', (data) => {
  console.log('Connected to chat:', data.chat_id);
  // Load previous messages
  loadMessages(data.chat_id);
});
```

---

#### 2. `message:ready`

Emitted when the chat is ready and messages can be loaded.

**Payload**:
```json
{
  "chat_id": 1
}
```

---

#### 3. `support:new-message`

Emitted when a new message arrives (from admin or auto-reply).

**Payload**:
```json
{
  "id": 2,
  "chat_id": 1,
  "sender_id": 2,
  "sender_role": "admin",
  "message_type": "text",
  "text": "Hello, how can I help you?",
  "is_auto_reply": false,
  "created_at": "2024-01-15T10:01:00Z",
  "sender_name": "Support Team",
  "_timestamp": 1705315200000,
  "_uniqueId": "msg_2_1705315200000"
}
```

**Usage**:
```javascript
socket.on('support:new-message', (message) => {
  // Add message to chat
  setMessages(prev => {
    // Prevent duplicates
    const exists = prev.some(msg => msg.id === message.id);
    if (exists) return prev;
    return [...prev, message];
  });
});
```

---

#### 4. `message:receive`

Alternative event name for new messages (legacy support).

**Payload**: Same as `support:new-message`

---

#### 5. `support:admin-message`

Emitted when a message arrives from an admin (legacy event for compatibility).

**Payload**:
```json
{
  "chat_id": 1,
  "message": {
    "id": 2,
    "text": "Hello",
    "sender_role": "admin",
    "created_at": "2024-01-15T10:01:00Z"
  }
}
```

---

#### 6. `support:message-status-updated`

Emitted when a message status is updated (delivered/read).

**Payload**:
```json
{
  "message_id": 1,
  "status": "read",
  "read_at": "2024-01-15T10:01:00Z"
}
```

**Usage**:
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

#### 7. `message:status-updated`

Alternative event name for message status updates.

**Payload**: Same as `support:message-status-updated`

---

#### 8. `notification:new`

Emitted when a new notification arrives (admin reply).

**Payload**:
```json
{
  "type": "admin_reply",
  "chat_id": 1,
  "message": {
    "id": 2,
    "text": "Hello",
    "created_at": "2024-01-15T10:01:00Z"
  }
}
```

**Usage**:
```javascript
socket.on('notification:new', (data) => {
  if (data.type === 'admin_reply') {
    // Show notification to user
    showNotification('Reply from Support Team', data.message.text);
  }
});
```

---

#### 9. `support:admin-viewing`

Emitted when an admin joins and views the chat.

**Payload**:
```json
{
  "chat_id": 1,
  "admin_id": 2
}
```

**Usage**:
```javascript
socket.on('support:admin-viewing', (data) => {
  console.log('Admin is viewing the chat');
  showIndicator('Support team is viewing your chat');
});
```

---

#### 10. `support:user-typing`

Emitted when someone is typing in the chat.

**Payload**:
```json
{
  "chat_id": 1,
  "user_id": 2,
  "user_role": "admin",
  "user_name": "Support Team",
  "is_typing": true
}
```

**Usage**:
```javascript
socket.on('support:user-typing', (data) => {
  if (data.is_typing && data.user_role === 'admin') {
    showTypingIndicator(`${data.user_name} is typing...`);
  } else {
    hideTypingIndicator();
  }
});
```

---

#### 11. `chat:ready`

Emitted when the chat is ready (to prevent message duplication).

**Payload**:
```json
{
  "chat_id": 1,
  "timestamp": 1705315200000
}
```

---

#### 12. `error`

Emitted when an error occurs.

**Payload**:
```json
{
  "message": "Please wait for admin response. You cannot send messages while waiting for support team.",
  "status": "waiting_for_admin"
}
```

**Usage**:
```javascript
socket.on('error', (error) => {
  console.error('Socket error:', error.message);
  if (error.status === 'waiting_for_admin') {
    showWarning('Please wait for admin response');
  }
});
```

---

### Outgoing Events (Emit)

#### 1. `support:send-message`

Send a text message via Socket.io.

**Payload**:
```json
{
  "text": "Hello, I need help"
}
```

**Note**: `chat_id` is not required for students

**Usage**:
```javascript
socket.emit('support:send-message', {
  text: 'Hello, I need help'
});
```

---

#### 2. `support:join-chat`

Join a specific chat room.

**Payload**: `chatId` (number)

**Usage**:
```javascript
socket.emit('support:join-chat', chatId);
```

---

#### 3. `support:mark-read`

Mark a specific message as read.

**Payload**: `messageId` (number)

**Usage**:
```javascript
socket.emit('support:mark-read', messageId);
```

---

#### 4. `support:mark-chat-read`

Mark all messages in a chat as read.

**Payload**: `chatId` (number)

**Usage**:
```javascript
socket.emit('support:mark-chat-read', chatId);
```

---

#### 5. `support:mark-delivered`

Mark a message as delivered.

**Payload**: `messageId` (number)

**Usage**:
```javascript
socket.emit('support:mark-delivered', messageId);
```

---

#### 6. `support:typing`

Send typing indicator.

**Payload**:
```json
{
  "chat_id": 1,
  "is_typing": true
}
```

**Usage**:
```javascript
// Start typing
socket.emit('support:typing', {
  chat_id: chatId,
  is_typing: true
});

// Stop typing (after 3 seconds of inactivity)
setTimeout(() => {
  socket.emit('support:typing', {
    chat_id: chatId,
    is_typing: false
  });
}, 3000);
```

---

#### 7. `support:leave-chat`

Leave a chat room.

**Payload**: `chatId` (number)

**Usage**:
```javascript
socket.emit('support:leave-chat', chatId);
```

---

## Complete Example (React/TypeScript)

```typescript
import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

function StudentSupportChat() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const receivedIds = useRef<Set<number>>(new Set());
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    const newSocket = io('http://localhost:8000', {
      auth: { token },
      transports: ['websocket', 'polling']
    });

    // On connection
    newSocket.on('support:chat-connected', (data) => {
      setChatId(data.chat_id);
      loadMessages(data.chat_id);
    });

    // Receive new message
    newSocket.on('support:new-message', (message) => {
      if (receivedIds.current.has(message.id)) return;
      receivedIds.current.add(message.id);
      
      setMessages(prev => [...prev, message]);
    });

    // Message status update
    newSocket.on('support:message-status-updated', (data) => {
      setMessages(prev => prev.map(msg => 
        msg.id === data.message_id 
          ? { ...msg, status: data.status, read_at: data.read_at }
          : msg
      ));
    });

    // Typing indicator
    newSocket.on('support:user-typing', (data) => {
      if (data.is_typing && data.user_role === 'admin') {
        setIsTyping(true);
        setTypingUser(data.user_name);
      } else {
        setIsTyping(false);
        setTypingUser(null);
      }
    });

    // Admin viewing
    newSocket.on('support:admin-viewing', (data) => {
      console.log('Admin is viewing the chat');
    });

    // Notification
    newSocket.on('notification:new', (data) => {
      if (data.type === 'admin_reply') {
        showNotification('Reply from Support', data.message.text);
      }
    });

    // Error handling
    newSocket.on('error', (error) => {
      console.error('Socket error:', error);
      if (error.status === 'waiting_for_admin') {
        alert('Please wait for admin response');
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
    if (!socket || !chatId) return;

    // Send via REST API (recommended)
    try {
      const res = await fetch('/api/support/messages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text })
      });
      
      if (res.status === 403) {
        const error = await res.json();
        alert(error.message);
        return;
      }

      const data = await res.json();
      setMessages(prev => [...prev, data.message]);
      
      // If bot reply exists, add it too
      if (data.bot_reply) {
        setMessages(prev => [...prev, data.bot_reply]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }

    // Or send via Socket.io
    // socket.emit('support:send-message', { text });
  };

  const handleTyping = (isTyping: boolean) => {
    if (!socket || !chatId) return;
    
    socket.emit('support:typing', {
      chat_id: chatId,
      is_typing: isTyping
    });
  };

  const markAsRead = (messageId: number) => {
    if (!socket) return;
    socket.emit('support:mark-read', messageId);
  };

  return (
    <div className="chat-container">
      <div className="messages">
        {messages.map(msg => (
          <div key={msg.id} className={`message ${msg.sender_role}`}>
            <div className="sender">{msg.sender_name}</div>
            <div className="text">{msg.text}</div>
            {msg.media_url && (
              <img src={msg.media_url} alt="Attachment" />
            )}
            <div className="status">{msg.status}</div>
          </div>
        ))}
        {isTyping && (
          <div className="typing-indicator">
            {typingUser} is typing...
          </div>
        )}
      </div>
      <input 
        type="text"
        onKeyPress={(e) => {
          if (e.key === 'Enter') {
            sendMessage(e.currentTarget.value);
            e.currentTarget.value = '';
          }
        }}
        onInput={(e) => {
          handleTyping(true);
          if (typingTimeout.current) {
            clearTimeout(typingTimeout.current);
          }
          typingTimeout.current = setTimeout(() => {
            handleTyping(false);
          }, 3000);
        }}
      />
    </div>
  );
}
```

---

## Quick Reference

### REST APIs
- `GET /api/support/chat` - Get student's chat
- `GET /api/support/chats/:chatId/messages` - Get messages
- `POST /api/support/messages` - Send text message
- `POST /api/support/messages/media` - Send image/file
- `POST /api/support/messages/audio` - Send audio message
- `GET /api/support/unread-count` - Get unread count
- `GET /api/support/faq` - Get available FAQs

### Socket.io Events (Incoming)
- `support:chat-connected` - On connection
- `message:ready` - Chat ready
- `support:new-message` - New message
- `message:receive` - New message (alternative)
- `support:admin-message` - Admin message (legacy)
- `support:message-status-updated` - Message status update
- `message:status-updated` - Message status (alternative)
- `notification:new` - New notification
- `support:admin-viewing` - Admin viewing chat
- `support:user-typing` - Typing indicator
- `chat:ready` - Chat ready signal
- `error` - Error event

### Socket.io Events (Outgoing)
- `support:send-message` - Send message
- `support:join-chat` - Join chat
- `support:mark-read` - Mark message as read
- `support:mark-chat-read` - Mark chat as read
- `support:mark-delivered` - Mark message as delivered
- `support:typing` - Typing indicator
- `support:leave-chat` - Leave chat

---

## Important Notes

1. **Real-time**: Messages appear instantly via Socket.io
2. **Prevent duplicates**: Use a `Set` to track message IDs
3. **Auto-reply**: An auto-reply may be sent when you send a message
4. **Token**: Must be a valid student token
5. **Reconnection**: Socket.io automatically reconnects
6. **Chat status**: When status is `waiting_for_admin`, students cannot send messages
7. **AI chatbot**: The system uses an AI chatbot that may escalate to human admins
8. **Message deduplication**: Use `_uniqueId` or message `id` to prevent duplicate messages
9. **File uploads**: Maximum file size is 50MB
10. **Media storage**: All media files are uploaded to Cloudinary

---

## Error Handling

### Common Error Responses

**403 Forbidden** - Access denied
```json
{
  "message": "Access denied"
}
```

**403 Forbidden** - Waiting for admin
```json
{
  "message": "Please wait for admin response. You cannot send messages while waiting for support team.",
  "status": "waiting_for_admin"
}
```

**400 Bad Request** - Validation failed
```json
{
  "message": "Validation failed",
  "errors": [
    {
      "path": ["text"],
      "message": "String must contain at least 1 character(s)"
    }
  ]
}
```

**401 Unauthorized** - Invalid or missing token
```json
{
  "message": "Unauthorized"
}
```

---

## Best Practices

1. Always handle connection errors and reconnection
2. Implement message deduplication using message IDs
3. Show typing indicators for better UX
4. Mark messages as read when viewed
5. Handle the `waiting_for_admin` status gracefully
6. Use REST API for sending messages (more reliable)
7. Use Socket.io for real-time updates
8. Implement proper error handling and user feedback
9. Cache FAQs locally for faster access
10. Implement pagination for message history

---

This documentation covers all student-specific endpoints and events for the support chat system.











