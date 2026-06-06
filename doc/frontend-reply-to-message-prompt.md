# برومبت: تنفيذ ميزة "Reply to Message" في الشات (Frontend)

## المطلوب
تنفيذ ميزة **الرد على رسالة معينة** في شاشة الشات المباشر بين المدرس والطلاب (Direct Chat)، بنفس طريقة الواتساب.

---

## 1. Backend APIs المتاحة

### إرسال رسالة مع Reply
**POST** `/api/chat/direct/:otherId/messages`

**Body:**
```json
{
  "message": "رد على رسالتك",
  "reply_to_message_id": 123  // ID الرسالة اللي عايز ترد عليها (اختياري)
}
```

**Response (201):**
```json
{
  "chat_group_id": 777,
  "message": {
    "id": 456,
    "group_id": 777,
    "sender_id": 111,
    "text": "رد على رسالتك",
    "reply_to_message_id": 123,
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### جلب الرسائل (مع Reply Info)
**GET** `/api/chat/direct/:otherId/messages`

**Response:**
```json
{
  "chat_group_id": 777,
  "other_user": { "id": 28, "name": "المدرس", "avatar": null },
  "messages": [
    {
      "id": 456,
      "text": "رد على رسالتك",
      "sender_id": 111,
      "sender_name": "الطالب",
      "reply_to_message_id": 123,
      "reply": {
        "id": 123,
        "text": "الرسالة الأصلية",
        "sender_id": 28,
        "sender_name": "المدرس",
        "text": "الرسالة الأصلية",
        "attachment_type": null,
        "attachment_url": null,
        "created_at": "2024-01-15T10:00:00Z"
      },
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Socket.IO (Realtime)
**Event:** `chat:send-direct`

**Payload:**
```json
{
  "otherId": 28,
  "message": "رد على رسالتك",
  "replyTo": 123  // اختياري
}
```

**Response Event:** `chat:new-message`
- يبث على room: `group:{chat_group_id}` و `user:{recipientId}`

---

## 2. UI/UX Requirements

### أ) عرض الرسالة المرد عليها (Reply Preview)
- لما المستخدم يضغط على رسالة معينة → يظهر **Reply Preview** فوق الـ input field
- الـ Preview يحتوي على:
  - اسم المرسل الأصلي (مثل: "المدرس" أو "الطالب")
  - نص الرسالة (مختصر لو طويل)
  - أيقونة "X" لإلغاء الرد
  - خط فاصل بين الـ Preview والـ Input

**مثال UI:**
```
┌─────────────────────────────────┐
│ ← المدرس                        │
│ الرسالة الأصلية...              │
│ ─────────────────────────────── │
│ [Input field للرسالة الجديدة]   │
└─────────────────────────────────┘
```

### ب) عرض الرد في قائمة الرسائل
- الرسالة اللي فيها رد (`reply_to_message_id !== null`) تعرض:
  - **Reply Box** صغير داخل الـ message bubble
  - يحتوي على:
    - اسم المرسل الأصلي
    - نص الرسالة المرد عليها (مختصر)
    - خط فاصل
    - نص الرسالة الجديدة

**مثال UI:**
```
┌─────────────────────────────────┐
│ ← المدرس                        │
│ ┌─────────────────────────────┐ │
│ │ ← الطالب                    │ │
│ │ الرسالة الأصلية...          │ │
│ └─────────────────────────────┘ │
│ رد على رسالتك                   │
└─────────────────────────────────┘
```

---

## 3. Implementation Steps

### Step 1: State Management
```typescript
// في شاشة الشات
const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);

interface Message {
  id: number;
  text: string;
  sender_id: number;
  sender_name?: string;
  reply_to_message_id?: number | null;
  reply?: {
    id: number;
    text: string;
    sender_id: number;
    sender_name?: string;
    created_at: string;
  } | null;
  created_at: string;
}
```

### Step 2: Reply Preview Component
```tsx
// ReplyPreview.tsx
interface ReplyPreviewProps {
  message: Message;
  onCancel: () => void;
}

const ReplyPreview: React.FC<ReplyPreviewProps> = ({ message, onCancel }) => {
  return (
    <View style={styles.replyPreview}>
      <View style={styles.replyContent}>
        <Text style={styles.replySenderName}>
          {message.sender_name || (message.sender_id === currentUserId ? 'أنت' : 'الآخر')}
        </Text>
        <Text style={styles.replyText} numberOfLines={1}>
          {message.text || 'رسالة مرفقة'}
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} style={styles.cancelButton}>
        <Icon name="close" size={20} />
      </TouchableOpacity>
    </View>
  );
};
```

### Step 3: Message Component (مع Reply Box)
```tsx
// MessageItem.tsx
const MessageItem: React.FC<{ message: Message; onReply: (msg: Message) => void }> = ({ 
  message, 
  onReply 
}) => {
  const isMyMessage = message.sender_id === currentUserId;
  
  return (
    <View style={[styles.messageContainer, isMyMessage && styles.myMessage]}>
      {/* Reply Box */}
      {message.reply && (
        <View style={styles.replyBox}>
          <View style={styles.replyBoxLine} />
          <View style={styles.replyBoxContent}>
            <Text style={styles.replyBoxSender}>
              {message.reply.sender_name || 'الآخر'}
            </Text>
            <Text style={styles.replyBoxText} numberOfLines={2}>
              {message.reply.text || 'رسالة مرفقة'}
            </Text>
          </View>
        </View>
      )}
      
      {/* Message Text */}
      <Text style={styles.messageText}>{message.text}</Text>
      
      {/* Long Press to Reply */}
      <Pressable onLongPress={() => onReply(message)}>
        {/* ... message content ... */}
      </Pressable>
    </View>
  );
};
```

### Step 4: إرسال رسالة مع Reply
```typescript
// في ChatScreen.tsx
const sendMessage = async (text: string) => {
  const payload = {
    message: text,
    ...(replyToMessage && { reply_to_message_id: replyToMessage.id })
  };
  
  // REST API
  const response = await fetch(`/api/chat/direct/${otherUserId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  // أو Socket.IO
  socket.emit('chat:send-direct', {
    otherId: otherUserId,
    message: text,
    replyTo: replyToMessage?.id || null
  });
  
  // Clear reply after sending
  setReplyToMessage(null);
};
```

### Step 5: Realtime Handling
```typescript
// في useEffect
useEffect(() => {
  socket.on('chat:new-message', (newMessage: Message) => {
    // Append to messages list
    setMessages(prev => [...prev, newMessage]);
    
    // Clear reply if it's the message we just sent
    if (newMessage.sender_id === currentUserId && replyToMessage) {
      setReplyToMessage(null);
    }
  });
  
  return () => {
    socket.off('chat:new-message');
  };
}, [replyToMessage]);
```

---

## 4. Styling (مثال React Native)

```typescript
const styles = StyleSheet.create({
  replyPreview: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderLeftWidth: 3,
    borderLeftColor: '#25D366', // WhatsApp green
    marginBottom: 8,
  },
  replyContent: {
    flex: 1,
  },
  replySenderName: {
    fontWeight: 'bold',
    fontSize: 14,
    color: '#25D366',
  },
  replyText: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  cancelButton: {
    padding: 4,
  },
  replyBox: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#25D366',
  },
  replyBoxLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: '#25D366',
  },
  replyBoxContent: {
    marginLeft: 8,
  },
  replyBoxSender: {
    fontWeight: 'bold',
    fontSize: 12,
    color: '#25D366',
  },
  replyBoxText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
});
```

---

## 5. Checklist

- [ ] إضافة State للـ `replyToMessage`
- [ ] إنشاء `ReplyPreview` component
- [ ] تعديل `MessageItem` لعرض Reply Box
- [ ] إضافة `onLongPress` على الرسائل لتفعيل Reply
- [ ] تعديل `sendMessage` لإرسال `reply_to_message_id`
- [ ] Clear الـ Reply بعد الإرسال
- [ ] Handle Realtime messages مع Reply
- [ ] Styling مشابه للواتساب
- [ ] Test على Android/iOS

---

## 6. ملاحظات مهمة

1. **الرسالة المرد عليها مش موجودة:**
   - لو `reply_to_message_id` موجود لكن `reply` object `null` → اعرض "رسالة محذوفة" أو "رسالة غير متاحة"

2. **الرسالة المرد عليها طويلة:**
   - استخدم `numberOfLines={1}` أو `numberOfLines={2}` في الـ Preview
   - اعرض "..." في النهاية

3. **الرسالة المرد عليها فيها Attachment:**
   - لو `reply.attachment_type !== null` → اعرض "📎 مرفق" أو أيقونة حسب النوع

4. **Performance:**
   - استخدم `React.memo` للـ MessageItem عشان مايعيدش render كل مرة
   - استخدم `FlatList` مع `keyExtractor` و `getItemLayout` للـ messages list

---

## 7. مثال كامل (React Native)

```tsx
import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet } from 'react-native';
import { io } from 'socket.io-client';

const ChatScreen: React.FC<{ otherUserId: number }> = ({ otherUserId }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const currentUserId = 111; // من Auth context

  useEffect(() => {
    // Load initial messages
    fetch(`/api/chat/direct/${otherUserId}/messages`)
      .then(res => res.json())
      .then(data => setMessages(data.messages));

    // Socket.IO
    socket.on('chat:new-message', (msg: Message) => {
      setMessages(prev => [...prev, msg]);
      if (msg.sender_id === currentUserId && replyToMessage) {
        setReplyToMessage(null);
      }
    });

    return () => {
      socket.off('chat:new-message');
    };
  }, [replyToMessage]);

  const sendMessage = () => {
    if (!inputText.trim()) return;

    socket.emit('chat:send-direct', {
      otherId: otherUserId,
      message: inputText,
      replyTo: replyToMessage?.id || null
    });

    setInputText('');
    setReplyToMessage(null);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={messages}
        keyExtractor={item => item.id.toString()}
        renderItem={({ item }) => (
          <MessageItem
            message={item}
            isMyMessage={item.sender_id === currentUserId}
            onReply={() => setReplyToMessage(item)}
          />
        )}
      />
      
      {replyToMessage && (
        <ReplyPreview
          message={replyToMessage}
          onCancel={() => setReplyToMessage(null)}
        />
      )}
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="اكتب رسالة..."
        />
        <TouchableOpacity onPress={sendMessage}>
          <Text>إرسال</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};
```

---

## 8. Testing

1. **Test Cases:**
   - إرسال رسالة عادية (بدون reply)
   - إرسال رسالة مع reply
   - إلغاء Reply قبل الإرسال
   - عرض Reply في الرسائل المستقبلة
   - Realtime: الرسالة تظهر فورًا مع Reply
   - الرسالة المرد عليها محذوفة (null reply)

2. **Edge Cases:**
   - Reply على رسالة فيها attachment
   - Reply على رسالة طويلة (truncate)
   - Reply على Reply (nested - مش مدعوم في Backend حالياً)

---

## 9. API Documentation Reference

راجع ملف: `doc/package-subject-group-chat-api.md` للـ APIs الكاملة.

---

**ملاحظة:** هذا البرومبت شامل لتنفيذ ميزة Reply to Message في Frontend. استخدمه كمرجع كامل للتنفيذ.





