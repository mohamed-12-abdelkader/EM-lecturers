## نظام دردشة الصفوف (Group Chat)

يوفر هذا النظام دردشة جماعية تلقائية لكل صف دراسي (Grade). عندما يشترك الطالب في كورس تابع لصف معيّن، يُضاف تلقائياً إلى مجموعة دردشة ذلك الصف. النظام يعمل بالوقت الحقيقي عبر Socket.IO، مع حفظ الرسائل في قاعدة البيانات.

### المصادقة
- جميع الطلبات والاتصالات يجب أن تتم عبر توكن JWT في ترويسة Authorization بالشكل التالي:
  - Authorization: Bearer <TOKEN>
- في Socket.IO يمكن تمرير التوكن في handshake auth باسم token أو في الترويسة.

### تعريفات سريعة
- المجموعة: تمثل صفاً دراسياً واحداً (واحدة لكل `grade_id`).
- صلاحيات الطلاب: يمكن للمعلم تمكين/إيقاف إرسال الرسائل من قبل الطلاب. عند الإيقاف، يمكن للطلاب القراءة فقط.

## REST APIs

### 1) الحصول على مجموعات المستخدم الحالية
- المسار: GET `/api/chat/groups`
- الأدوار المسموحة: student, teacher, admin
- السلوك:
  - الطالب: يرجع مجموعات الصفوف المنتمي إليها، ويضمن إضافته كعضو إن لم يكن موجوداً.
  - المعلم: يرجع مجموعات الصفوف التي يدرّسها.
  - المشرف: كل المجموعات.

رد متوقع:
```json
{
  "groups": [
    {
      "id": 1,
      "grade_id": 3,
      "name": "Third Secondary",
      "owner_teacher_id": null,
      "allow_student_send": true,
      "created_at": "2025-01-01T10:00:00.000Z"
    }
  ]
}
```

مثال curl:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/chat/groups
```

### 2) جلب سجل الرسائل لمجموعة
- المسار: GET `/api/chat/groups/:groupId/history`
- الأدوار: student, teacher, admin
- الاستعلام:
  - `limit` اختياري (افتراضي 50)
  - `before` اختياري (تاريخ/وقت ISO لتفريغ المزيد من القديم)
- الترتيب: تصاعدي حسب الوقت (الأقدم أولاً)

الرد يُرجع الرسائل مع الحقول التالية:
- `text` (اختياري)
- `sender_name` اسم المرسل
- حقول المرفقات إن وجدت:
  - `attachment_url`
  - `attachment_type`: قيمته `image | file | audio`
  - `attachment_name`, `attachment_mime`, `attachment_size`
  - `attachment_duration_ms` للرسائل الصوتية (اختياري)

وللردود (Reply):
- `reply_to_message_id`: رقم الرسالة الأصلية
- `reply`: جسم كامل للرسالة الأصلية يحتوي: `id, sender_id, sender_name, text, attachment_url, attachment_type, attachment_name, attachment_mime, attachment_size, created_at`

أمثلة رد:
```json
{
  "messages": [
    {
      "id": 10,
      "group_id": 1,
      "sender_id": 123,
      "text": "مرحبا بالجميع",
      "created_at": "2025-01-01T10:05:00.000Z",
      "sender_name": "Ahmad"
    },
    {
      "id": 11,
      "group_id": 1,
      "sender_id": 7,
      "text": "مرفق صورة",
      "attachment_url": "https://res.cloudinary.com/.../image/upload/v.../img.png",
      "attachment_type": "image",
      "attachment_name": "img.png",
      "attachment_mime": "image/png",
      "attachment_size": 34567,
      "created_at": "2025-01-01T10:06:00.000Z",
      "sender_name": "Mr. Ali"
    },
    {
      "id": 12,
      "group_id": 1,
      "sender_id": 7,
      "text": "مرفق PDF",
      "attachment_url": "https://res.cloudinary.com/.../upload/v.../lesson.pdf",
      "attachment_type": "file",
      "attachment_name": "lesson.pdf",
      "attachment_mime": "application/pdf",
      "attachment_size": 123456,
      "created_at": "2025-01-01T10:07:00.000Z",
      "sender_name": "Mr. Ali"
    },
    {
      "id": 13,
      "group_id": 1,
      "sender_id": 123,
      "text": "ملاحظة صوتية",
      "reply_to_message_id": 11,
      "reply": {
        "id": 11,
        "sender_id": 7,
        "sender_name": "Mr. Ali",
        "text": "مرفق صورة",
        "attachment_type": "image",
        "attachment_url": "https://res.cloudinary.com/.../image/upload/v.../img.png",
        "attachment_name": "img.png",
        "attachment_mime": "image/png",
        "attachment_size": 34567,
        "created_at": "2025-01-01T10:06:00.000Z"
      },
      "attachment_url": "https://res.cloudinary.com/.../upload/v.../audio.m4a",
      "attachment_type": "audio",
      "attachment_name": "audio.m4a",
      "attachment_mime": "audio/mp4",
      "attachment_size": 45678,
      "attachment_duration_ms": 12450,
      "created_at": "2025-01-01T10:08:00.000Z",
      "sender_name": "Ahmad"
    }
  ]
}
```

مثال curl:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/chat/groups/1/history?limit=50"
```

### 3) قائمة أعضاء المجموعة (للمعلم/المشرف)
- المسار: GET `/api/chat/groups/:groupId/members`
- الأدوار: teacher, admin

رد متوقع:
```json
{
  "members": [
    { "id": 123, "name": "Ahmad", "role": "student", "joined_at": "2025-01-01T10:00:00.000Z" },
    { "id": 7, "name": "Mr. Ali", "role": "teacher", "joined_at": "2025-01-01T09:00:00.000Z" }
  ]
}
```

مثال curl:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8000/api/chat/groups/1/members
```

### 4) تبديل سماح الطلاب بالإرسال (للمعلم/المشرف)
- المسار: PATCH `/api/chat/groups/:groupId/permission`
- الأدوار: teacher (لا بد أن يملك الصف), admin
- جسم الطلب:
```json
{ "allow_student_send": false }
```
- الأثر:
  - يتم تحديث الإعداد في قاعدة البيانات.
  - يتم بث حدث Socket `chat:permission-changed` فوراً لكل أعضاء المجموعة المتصلين.

مثال curl:
```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allow_student_send": false}' \
  http://localhost:8000/api/chat/groups/1/permission
```

## Socket.IO

### الاتصال
- العنوان: نفس مضيف الـ API (مثلاً `http://localhost:8000`)
- المسار الافتراضي: `/socket.io`
- المصادقة: تمرير `token` ضمن `auth` في الاتصال أو استخدام ترويسة Authorization.

مثال (Front-End):
```javascript
import { io } from 'socket.io-client';

const token = localStorage.getItem('Authorization')?.replace(/^Bearer\s+/i, '')
  || localStorage.getItem('token');

const socket = io('/', {
  path: '/socket.io',
  withCredentials: true,
  auth: { token },
  transports: ['websocket'],
});
```

### الأحداث

- إرسال رسالة إلى مجموعة (يدعم الرد)
  - الحدث: `chat:send`
  - من العميل إلى الخادم
  - الحمولة:
  ```json
  { "groupId": 1, "text": "مرحبا", "replyTo": 123 }
  ```
  - ملاحظات:
    - يتم التحقق من العضوية.
    - إن كان المرسل طالباً، يتم التحقق من السماح الحالي.
    - عند النجاح، تُحفظ الرسالة ويُبث `chat:new-message` لغرفة المجموعة.

- استلام رسالة جديدة
  - الحدث: `chat:new-message`
  - من الخادم إلى العملاء (بث لأعضاء المجموعة)
  - الحمولة (مثال):
  ```json
  {
    "id": 11,
    "group_id": 1,
    "sender_id": 123,
    "text": "مرحبا",
    "created_at": "2025-01-01T10:06:00.000Z",
    "sender_name": "Ahmad"
  }
  ```

- تغيير صلاحية إرسال الطلاب
  - الحدث: `chat:permission-changed`
  - من الخادم إلى العملاء (بث لأعضاء المجموعة)
  - الحمولة:
  ```json
  { "groupId": 1, "allow_student_send": false }
  ```

- الانضمام لغرفة مجموعة إضافية (اختياري)
  - الحدث: `chat:join-group`
  - من العميل إلى الخادم
  - الحمولة: رقم المجموعة فقط (number)
  - يتطلب أن يكون المستخدم عضواً بالمجموعة.

## ملاحظات مهمة
- الإضافة التلقائية: عند تفعيل كورس لطالب، يُضاف مباشرةً إلى مجموعة دردشة الصف المرتبط بهذا الكورس.
- القيود:
  - الطالب لا يمكنه الإرسال إذا كان `allow_student_send = false`.
  - المعلم/المشرف دائماً يمكنه الإرسال.
- التاريخ في `before` يجب أن يكون بصيغة ISO (مثل: `2025-01-01T10:00:00.000Z`).

## إرسال رسالة عبر REST
- المسار: POST `/api/chat/groups/:groupId/messages`
- الأدوار: 
  - teacher/admin: مسموح إذا كان المعلم يدرّس صف المجموعة
  - student: يجب أن يكون عضواً في المجموعة وأن يكون الإرسال مفعّلاً
- الجسم:
```json
{ "text": "مرحبا", "reply_to": 123 }
```
- رد مثال:
```json
{
  "message": {
    "id": 12,
    "group_id": 1,
    "sender_id": 123,
    "text": "مرحبا",
    "created_at": "2025-01-01T10:07:00.000Z"
  }
}
```
- ملاحظة: يتم بث الرسالة عبر `chat:new-message` لجميع أعضاء المجموعة المتصلين.

## إرسال صورة/ملف عبر REST
- المسار: POST `/api/chat/groups/:groupId/attachments`
- الأدوار:
  - teacher/admin: مسموح إذا كان المعلم يدرّس صف المجموعة
  - student: يجب أن يكون عضواً ومسموحاً له بالإرسال
- نوع الطلب: `multipart/form-data`
- الحقول:
  - `file`: الملف (صورة/ملف/صوت)
  - `text`: نص اختياري مرافق
  - `duration_ms`: رقم اختياري لمدة الصوت بالمللي ثانية عند رفع رسائل صوتية

رد مثال:
```json
{
  "message": {
    "id": 20,
    "group_id": 1,
    "sender_id": 123,
    "text": "مرفق الدرس",
    "attachment_url": "https://res.cloudinary.com/.../image/upload/v.../file.png",
    "attachment_type": "image",
    "attachment_name": "file.png",
    "attachment_mime": "image/png",
    "attachment_size": 34567,
    "created_at": "2025-01-01T10:15:00.000Z"
  }
}
```

مثال curl:
```bash
curl -X POST "http://localhost:8000/api/chat/groups/1/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/file.png" \
  -F "text=هذه صورة مرفقة"
```

مثال رسالة صوتية:
```bash
curl -X POST "http://localhost:8000/api/chat/groups/1/attachments" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/audio.m4a" \
  -F "duration_ms=12345" \
  -F "text=ملاحظة صوتية"
```

## أخطاء شائعة
- 401 Unauthorized: عدم تمرير التوكن أو توكن غير صالح.
- 403 Forbidden: ليس عضواً في المجموعة أو المعلم لا يملك هذا الصف.
- 400 Bad Request: معاملات ناقصة أو غير صحيحة (مثلاً body غير صحيح).


