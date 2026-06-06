# API الإشعارات - Notifications API

## نظرة عامة

نظام الإشعارات يوفر إشعارات فورية (Real-time) للطلاب عند حدوث أي إجراء من المدرس في الكورسات المشتركين فيها. النظام يدعم:

- **REST API** لجلب الإشعارات وإدارتها
- **Real-time Notifications** عبر Socket.IO للإشعارات الفورية
- **Push Notifications** عبر OneSignal (إذا كان مُفعّل)

---

## API Endpoints

### 1. جلب الإشعارات

**GET** `/api/notifications`

جلب إشعارات المستخدم مع pagination.

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
- `limit` (optional, default: 20) - عدد الإشعارات المطلوبة
- `offset` (optional, default: 0) - عدد الإشعارات للتخطي

**Response (200 OK):**
```json
{
  "notifications": [
    {
      "id": "notification_123",
      "type": "notification",
      "notification_type": "lecture_added",
      "title": "محاضرة جديدة",
      "message": "تم إضافة محاضرة جديدة \"الرياضيات الأساسية\" في كورس \"الرياضيات للصف الأول\"",
      "description": null,
      "course_id": 1,
      "lecture_id": 5,
      "exam_id": null,
      "video_id": null,
      "is_read": false,
      "created_at": "2024-01-15T10:30:00Z",
      "course_title": "الرياضيات للصف الأول",
      "lecture_title": "الرياضيات الأساسية"
    },
    {
      "id": "notification_124",
      "type": "notification",
      "notification_type": "live_stream_started",
      "title": "بث مباشر جديد",
      "message": "بدأ المدرس بث مباشر \"مراجعة نهائية\" في كورس \"الرياضيات للصف الأول\"",
      "course_id": 1,
      "is_read": false,
      "created_at": "2024-01-15T11:00:00Z",
      "course_title": "الرياضيات للصف الأول"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 50,
    "hasMore": true
  }
}
```

**ملاحظات:**
- الإشعارات مرتبة حسب التاريخ (الأحدث أولاً)
- الطلاب يرون فقط إشعارات الكورسات/الباقات المشتركين فيها
- يتم دمج إشعارات الرسائل (chat messages) مع الإشعارات العادية

---

### 2. جلب عدد الإشعارات غير المقروءة

**GET** `/api/notifications/unread-count`

جلب عدد الإشعارات غير المقروءة للمستخدم.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "count": 5
}
```

---

### 3. تحديد جميع الإشعارات كمقروءة

**PUT** `/api/notifications/read-all`

تحديد جميع إشعارات المستخدم كمقروءة.

**Headers:**
```
Authorization: Bearer <token>
```

**Response (200 OK):**
```json
{
  "message": "All notifications marked as read"
}
```

---

### 4. تحديد إشعار كمقروء

**PUT** `/api/notifications/:notificationId/read`

تحديد إشعار محدد كمقروء.

**Headers:**
```
Authorization: Bearer <token>
```

**Parameters:**
- `notificationId` - معرف الإشعار (يجب أن يكون رقم فقط، مثل: `123`)

**ملاحظة مهمة:** الـ route يستخدم regex constraint `(\\d+)` لضمان أن `notificationId` رقم فقط وليس نص.

**Response (200 OK):**
```json
{
  "message": "Notification marked as read"
}
```

**Response (400 Bad Request):**
```json
{
  "message": "Invalid notification ID"
}
```

**Response (404 Not Found):**
```json
{
  "message": "Notification not found"
}
```

---

### 5. تحديد إشعار كمقروء (مع prefix)

**PUT** `/api/notifications/notification_:notificationId/read`

تحديد إشعار محدد كمقروء باستخدام format `notification_123`.

**Headers:**
```
Authorization: Bearer <token>
```

**Parameters:**
- `notificationId` - معرف الإشعار (يجب أن يكون رقم فقط، مثل: `123`)

**مثال:**
```
PUT /api/notifications/notification_123/read
```

**Response (200 OK):**
```json
{
  "message": "Notification marked as read"
}
```

---

## ترتيب الـ Routes

**مهم:** ترتيب الـ routes في الكود مهم جداً:

1. `GET /` - جلب الإشعارات
2. `GET /unread-count` - عدد الإشعارات غير المقروءة (static route)
3. `PUT /read-all` - تحديد جميع الإشعارات كمقروءة (static route)
4. `PUT /:notificationId(\\d+)/read` - تحديد إشعار واحد (dynamic route مع regex)
5. `PUT /notification_:notificationId(\\d+)/read` - تحديد إشعار واحد (format: notification_123)

الـ static routes يجب أن تأتي قبل الـ dynamic routes لتجنب conflicts.

---

## Real-time Notifications (Socket.IO)

### الاتصال

عند الاتصال بـ Socket.IO، يتم الانضمام تلقائياً إلى room شخصي باسم `user:{userId}`.

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: 'your_token' },
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('Connected to server');
  // المستخدم منضم تلقائياً إلى user:{userId}
});
```

### استقبال الإشعارات الفورية

**Event:** `notification:new`

يتم إرسال هذا الحدث عند إنشاء إشعار جديد للمستخدم.

**Payload:**
```json
{
  "id": "notification_123",
  "type": "notification",
  "notification_type": "lecture_added",
  "title": "محاضرة جديدة",
  "message": "تم إضافة محاضرة جديدة \"الرياضيات الأساسية\" في كورس \"الرياضيات للصف الأول\"",
  "description": null,
  "course_id": 1,
  "lecture_id": 5,
  "exam_id": null,
  "video_id": null,
  "is_read": false,
  "created_at": "2024-01-15T10:30:00Z"
}
```

**مثال الاستخدام:**
```javascript
socket.on('notification:new', (notification) => {
  console.log('New notification:', notification);
  // عرض الإشعار في الواجهة
  showNotification(notification);
  
  // إضافة للإشعارات المحلية
  addNotificationToList(notification);
  
  // تحديث عداد الإشعارات غير المقروءة
  updateUnreadCount();
});
```

---

## أنواع الإشعارات

### إشعارات الكورسات

#### 1. `lecture_added` - محاضرة جديدة
**متى:** عند إضافة محاضرة جديدة للكورس وجعلها ظاهرة (`is_visible = true`)

**ملاحظة:** الإشعار يُرسل فقط عندما تكون المحاضرة ظاهرة. عند تغيير حالة المحاضرة من مخفية إلى ظاهرة، يتم إرسال الإشعار تلقائياً.

**Payload:**
```json
{
  "notification_type": "lecture_added",
  "title": "محاضرة جديدة",
  "message": "تم إضافة محاضرة جديدة \"[lecture_title]\" في كورس \"[course_title]\"",
  "course_id": 1,
  "lecture_id": 5
}
```

---

#### 2. `video_added` - فيديو جديد
**متى:** عند إضافة فيديو جديد لمحاضرة

**Payload:**
```json
{
  "notification_type": "video_added",
  "title": "فيديو جديد",
  "message": "تم إضافة فيديو جديد \"[video_title]\" في محاضرة \"[lecture_title]\" من كورس \"[course_title]\"",
  "course_id": 1,
  "lecture_id": 5,
  "video_id": 10
}
```

---

#### 3. `file_added` - ملف جديد
**متى:** عند إضافة ملف جديد لمحاضرة

**Payload:**
```json
{
  "notification_type": "file_added",
  "title": "ملف جديد",
  "message": "تم إضافة ملف جديد \"[file_name]\" في محاضرة \"[lecture_title]\" من كورس \"[course_title]\"",
  "course_id": 1,
  "lecture_id": 5
}
```

---

#### 4. `exam_added` - امتحان جديد (على مستوى الكورس)
**متى:** عند إضافة امتحان جديد للكورس مع `is_visible = true`

**Payload:**
```json
{
  "notification_type": "exam_added",
  "title": "امتحان جديد",
  "message": "تم إضافة امتحان جديد \"[exam_title]\" في كورس \"[course_title]\"",
  "course_id": 1,
  "exam_id": 20
}
```

---

#### 5. `exam_added` - امتحان جديد (لمحاضرة)
**متى:** عند إضافة امتحان جديد لمحاضرة مع `is_visible = true`

**Payload:**
```json
{
  "notification_type": "exam_added",
  "title": "امتحان جديد",
  "message": "تم إضافة امتحان جديد \"[exam_title]\" في محاضرة \"[lecture_title]\" من كورس \"[course_title]\"",
  "course_id": 1,
  "lecture_id": 5,
  "exam_id": 20
}
```

---

#### 6. `live_stream_started` - بث مباشر جديد
**متى:** عند بدء المدرس بث مباشر في الكورس (عبر webhook من LiveKit)

**Payload:**
```json
{
  "notification_type": "live_stream_started",
  "title": "بث مباشر جديد",
  "message": "بدأ المدرس بث مباشر \"[meeting_title]\" في كورس \"[course_title]\"",
  "course_id": 1
}
```

---

#### 7. `exam_updated` - تحديث امتحان
**متى:** عند تحديث امتحان موجود

**Payload:**
```json
{
  "notification_type": "exam_updated",
  "title": "تحديث امتحان",
  "message": "تم تحديث امتحان \"[exam_title]\" في كورس \"[course_title]\"",
  "course_id": 1,
  "exam_id": 20
}
```

---

### إشعارات الباقات

#### 8. `package_lesson_added` - درس جديد
**متى:** عند إضافة درس جديد في الباقة (فقط إذا كان visible)

**Payload:**
```json
{
  "notification_type": "package_lesson_added",
  "title": "درس جديد",
  "message": "تم إضافة درس جديد \"[lesson_name]\" في مادة \"[subject_name]\"",
  "package_id": 1,
  "subject_id": 2,
  "lesson_id": 10
}
```

---

#### 9. `package_video_added` - فيديو جديد في الباقة
**متى:** عند إضافة فيديو جديد في درس بالباقة (فقط إذا كان visible)

**Payload:**
```json
{
  "notification_type": "package_video_added",
  "title": "فيديو جديد",
  "message": "تم إضافة فيديو جديد \"[video_name]\" في درس \"[lesson_name]\" من مادة \"[subject_name]\"",
  "package_id": 1,
  "subject_id": 2,
  "lesson_id": 10,
  "video_id": 15
}
```

---

#### 10. `package_file_added` - ملف جديد في الباقة
**متى:** عند إضافة ملف جديد في الباقة

**Payload:**
```json
{
  "notification_type": "package_file_added",
  "title": "ملف جديد",
  "message": "تم إضافة ملف جديد \"[file_name]\" في درس \"[lesson_name]\" من مادة \"[subject_name]\"",
  "package_id": 1,
  "subject_id": 2,
  "lesson_id": 10
}
```

---

#### 11. `package_exam_added` - امتحان جديد في الباقة
**متى:** عند إضافة امتحان جديد في الباقة (فقط إذا كان visible)

**Payload:**
```json
{
  "notification_type": "package_exam_added",
  "title": "امتحان جديد",
  "message": "تم إضافة امتحان جديد \"[exam_name]\" في مادة \"[subject_name]\"",
  "package_id": 1,
  "subject_id": 2,
  "exam_id": 25
}
```

---

#### 12. `package_assignment_added` - واجب جديد في الباقة
**متى:** عند إضافة واجب جديد في الباقة (فقط إذا كان visible)

**Payload:**
```json
{
  "notification_type": "package_assignment_added",
  "title": "واجب جديد",
  "message": "تم إضافة واجب جديد \"[assignment_name]\" في درس \"[lesson_name]\" من مادة \"[subject_name]\"",
  "package_id": 1,
  "subject_id": 2,
  "lesson_id": 10,
  "assignment_id": 30
}
```

---

### إشعارات أخرى

#### 13. `direct_message` - رسالة مباشرة
**متى:** عند إرسال رسالة مباشرة من مدرس/أدمن للطالب

**Payload:**
```json
{
  "notification_type": "direct_message",
  "title": "رسالة جديدة",
  "message": "[sender_name]: [message_text]",
  "sender_id": 5,
  "sender_name": "مستر أحمد"
}
```

---

#### 14. `group_message` - رسالة في مجموعة
**متى:** عند إرسال رسالة في مجموعة شات

**Payload:**
```json
{
  "notification_type": "group_message",
  "title": "رسالة جديدة في المجموعة",
  "message": "[sender_name]: [message_text]",
  "group_id": 10,
  "sender_id": 5,
  "metadata": {
    "message_count": 3,
    "last_sender": "مستر أحمد",
    "last_message": "نص الرسالة...",
    "group_name": "مجموعة الرياضيات"
  }
}
```

---

#### 15. `essay_exam_created` - امتحان مقالي جديد
**متى:** عند إنشاء امتحان مقالي جديد

**Payload:**
```json
{
  "notification_type": "essay_exam_created",
  "title": "امتحان مقالي جديد",
  "message": "تم إضافة امتحان مقالي جديد: [exam_title] في محاضرة [lecture_title]",
  "course_id": 1,
  "lecture_id": 5,
  "sender_id": 10
}
```

---

## أمثلة الاستخدام

### مثال 1: جلب الإشعارات

```javascript
// جلب أول 20 إشعار
const response = await fetch('/api/notifications?limit=20&offset=0', {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log('Notifications:', data.notifications);
console.log('Total:', data.pagination.total);
console.log('Has more:', data.pagination.hasMore);
```

---

### مثال 2: تحديد إشعار كمقروء

```javascript
// باستخدام ID رقمي
const notificationId = 123;

const response = await fetch(`/api/notifications/${notificationId}/read`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(data.message); // "Notification marked as read"
```

```javascript
// باستخدام format notification_123
const notificationId = 123;

const response = await fetch(`/api/notifications/notification_${notificationId}/read`, {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(data.message); // "Notification marked as read"
```

---

### مثال 3: تحديد جميع الإشعارات كمقروءة

```javascript
const response = await fetch('/api/notifications/read-all', {
  method: 'PUT',
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const data = await response.json();
console.log(data.message); // "All notifications marked as read"
```

---

### مثال 4: Real-time Notifications

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: userToken },
  transports: ['websocket', 'polling']
});

// استقبال إشعارات جديدة
socket.on('notification:new', (notification) => {
  // عرض الإشعار في الواجهة
  showNotificationToast(notification);
  
  // إضافة للإشعارات المحلية
  addNotificationToList(notification);
  
  // تحديث العداد
  updateUnreadBadge();
});

// جلب الإشعارات عند الاتصال
socket.on('connect', async () => {
  // جلب الإشعارات الحالية
  const response = await fetch('/api/notifications?limit=20', {
    headers: { 'Authorization': `Bearer ${userToken}` }
  });
  const data = await response.json();
  displayNotifications(data.notifications);
});
```

---

### مثال 5: تحديث عداد الإشعارات غير المقروءة

```javascript
async function updateUnreadCount() {
  const response = await fetch('/api/notifications/unread-count', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  document.getElementById('unread-badge').textContent = data.count;
}

// تحديث كل 30 ثانية
setInterval(updateUnreadCount, 30000);

// تحديث عند استقبال إشعار جديد
socket.on('notification:new', () => {
  updateUnreadCount();
});
```

---

## الفلترة التلقائية

النظام يفلتر الإشعارات تلقائياً بناءً على اشتراكات الطالب:

- **الكورسات العادية:** فقط إذا كان الطالب مشترك (`enrollments` table)
- **الكورسات العامة:** فقط إذا كان الطالب مشترك (`general_course_enrollments` table)
- **الباقات:** فقط إذا كان الطالب مشترك نشط (`package_activations` table مع `is_active = TRUE`)
- **المجموعات:** فقط إذا كان الطالب عضو (`chat_group_members` table)
- **الرسائل المباشرة:** دائماً مرئية (من مدرسين/أدمن)
- **الإشعارات الاجتماعية:** دائماً مرئية

---

## ملاحظات مهمة

1. **المحاضرات:** الإشعارات تُرسل فقط عندما تكون المحاضرة ظاهرة (`is_visible = true`)
   - عند إنشاء محاضرة جديدة: تُرسل إشعار إذا كانت `is_visible = true` افتراضياً
   - عند تغيير حالة المحاضرة من مخفية إلى ظاهرة: يُرسل إشعار تلقائياً

2. **الامتحانات:** الإشعارات تُرسل فقط عندما يكون الامتحان ظاهر (`is_visible = true`)

3. **البث المباشر:** الإشعارات تُرسل تلقائياً عند بدء البث (عبر webhook من LiveKit عند event `room_started`)

4. **Real-time:** جميع الإشعارات تُبث فوراً عبر Socket.IO إلى المستخدمين المتصلين في room `user:{userId}`

5. **Push Notifications:** يتم إرسال push notifications عبر OneSignal (إذا كان مُفعّل)

6. **Route Ordering:** ترتيب الـ routes مهم جداً - الـ static routes يجب أن تأتي قبل الـ dynamic routes

---

## كود الحالة (Status Codes)

- `200 OK` - العملية نجحت
- `400 Bad Request` - بيانات غير صحيحة (مثل: notificationId غير صحيح)
- `401 Unauthorized` - غير مصرح (token مفقود أو غير صحيح)
- `403 Forbidden` - غير مصرح (role غير كافي)
- `404 Not Found` - الإشعار غير موجود
- `500 Internal Server Error` - خطأ في السيرفر

---

## التكامل مع النظام

### إرسال إشعار عند إضافة محاضرة

```typescript
// في controller
import { NotificationService } from '../services/notifications';

// عند إنشاء محاضرة جديدة (إذا كانت visible)
await NotificationService.notifyLectureAdded(
  courseId,
  lectureId,
  lectureTitle,
  courseTitle
);

// عند تغيير حالة المحاضرة إلى visible
// يتم إرسال الإشعار تلقائياً في endpoint PATCH /lecture/:lectureId/visibility
```

### إرسال إشعار عند بدء بث مباشر

```typescript
// في meeting webhook handler (room_started event)
import { NotificationService } from '../services/notifications';

await NotificationService.notifyLiveStreamStarted(
  courseId,
  meetingTitle,
  courseTitle
);
```

### إرسال إشعار عند إضافة امتحان

```typescript
// في exam controller
import { NotificationService } from '../services/notifications';

// امتحان على مستوى الكورس
await NotificationService.notifyExamAdded(
  courseId,
  undefined, // lectureId
  examId,
  examTitle,
  undefined, // lectureTitle
  courseTitle
);

// امتحان لمحاضرة
await NotificationService.notifyExamAdded(
  courseId,
  lectureId,
  examId,
  examTitle,
  lectureTitle,
  courseTitle
);
```

### إرسال إشعار عند إضافة فيديو

```typescript
// في video controller
import { NotificationService } from '../services/notifications';

await NotificationService.notifyVideoAdded(
  courseId,
  lectureId,
  videoTitle,
  lectureTitle,
  courseTitle
);
```

### إرسال إشعار عند إضافة ملف

```typescript
// في file controller
import { NotificationService } from '../services/notifications';

await NotificationService.notifyFileAdded(
  courseId,
  lectureId,
  fileName,
  lectureTitle,
  courseTitle
);
```

---

## الاختبار

### اختبار API

```bash
# جلب الإشعارات
curl -X GET "http://localhost:8000/api/notifications?limit=20" \
  -H "Authorization: Bearer <token>"

# جلب عدد الإشعارات غير المقروءة
curl -X GET "http://localhost:8000/api/notifications/unread-count" \
  -H "Authorization: Bearer <token>"

# تحديد جميع الإشعارات كمقروءة
curl -X PUT "http://localhost:8000/api/notifications/read-all" \
  -H "Authorization: Bearer <token>"

# تحديد إشعار كمقروء (ID رقمي)
curl -X PUT "http://localhost:8000/api/notifications/123/read" \
  -H "Authorization: Bearer <token>"

# تحديد إشعار كمقروء (format: notification_123)
curl -X PUT "http://localhost:8000/api/notifications/notification_123/read" \
  -H "Authorization: Bearer <token>"
```

### اختبار Real-time

1. افتح متصفحين مختلفين
2. سجل دخول كطالب في كليهما
3. في المتصفح الأول، قم بإجراء (مثل إضافة محاضرة) كمدرس
4. في المتصفح الثاني، يجب أن يظهر الإشعار فوراً عبر Socket.IO event `notification:new`

---

## بنية قاعدة البيانات

### جدول notifications

```sql
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL CHECK (type IN (
        'lecture_added',
        'video_added',
        'file_added',
        'social_comment',
        'social_reply',
        'social_like',
        'social_reaction',
        'group_message',
        'direct_message',
        'essay_exam_created',
        'exam_graded',
        'exam_added',
        'exam_updated',
        'quiz_added',
        'quiz_updated',
        'package_lesson_added',
        'package_video_added',
        'package_assignment_added',
        'package_exam_added',
        'package_file_added',
        'course_update',
        'course_content_update',
        'live_stream_started'
    )),
    course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
    general_course_id INTEGER REFERENCES general_courses(id) ON DELETE CASCADE,
    lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
    post_id INTEGER,
    comment_id INTEGER,
    sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES chat_groups(id) ON DELETE CASCADE,
    package_id INTEGER REFERENCES packages(id) ON DELETE CASCADE,
    subject_id INTEGER,
    lesson_id INTEGER,
    assignment_id INTEGER,
    exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
    video_id INTEGER,
    metadata JSONB,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## الدعم والمساعدة

للمزيد من المعلومات، راجع:
- [Notification System Enhancement](./notification-system-enhancement.md)
- [Chat API](./package-subject-group-chat-api.md)
