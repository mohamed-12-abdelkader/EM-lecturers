# 📹 API توثيق الميتنجات (Meetings API)

## نظرة عامة

هذا التوثيق يشرح جميع APIs الخاصة بإدارة الميتنجات (المحاضرات المباشرة) في النظام. الميتنجات تستخدم LiveKit للبث المباشر والتسجيل التلقائي على YouTube.

---

## 🔐 المصادقة

جميع الـ APIs تتطلب مصادقة باستخدام Bearer Token في Header:
```
Authorization: Bearer YOUR_TOKEN
```

---

## 📋 جدول المحتويات

1. [إدارة الميتنجات](#إدارة-الميتنجات)
   - [إنشاء ميتنج جديد](#1-إنشاء-ميتنج-جديد)
   - [تعديل ميتنج](#2-تعديل-ميتنج)
   - [حذف ميتنج](#3-حذف-ميتنج)
   - [إغلاق ميتنج](#4-إغلاق-ميتنج)
2. [جلب الميتنجات](#جلب-الميتنجات)
   - [جلب ميتنجاتي (للمدرس)](#1-جلب-ميتنجاتي-للمدرس)
   - [جلب الميتنج النشط الحالي](#2-جلب-الميتنج-النشط-الحالي)
   - [جلب جميع الميتنجات (Admin فقط)](#3-جلب-جميع-الميتنجات-admin-فقط)
   - [جلب ميتنجات الكورس (للطالب)](#4-جلب-ميتنجات-الكورس-للطالب)
3. [الانضمام للميتنج](#الانضمام-للميتنج)
   - [معلومات قبل الانضمام](#1-معلومات-قبل-الانضمام)
   - [الحصول على Connection Token](#2-الحصول-على-connection-token)
4. [إدارة المشاركين](#إدارة-المشاركين)
   - [تحديث صلاحيات المشارك](#1-تحديث-صلاحيات-المشارك)
   - [طرد مشارك](#2-طرد-مشارك)
   - [إظهار/إخفاء زر رفع اليد](#3-إظهارإخفاء-زر-رفع-اليد)
5. [حالات الميتنج](#حالات-الميتنج)
6. [أمثلة الاستخدام الكاملة](#أمثلة-الاستخدام-الكاملة)

---

## 🎯 إدارة الميتنجات

### 1. إنشاء ميتنج جديد

**Endpoint:** `POST /api/meeting`

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**القيود:**
- لا يمكن للمدرس إنشاء ميتنج جديد إذا كان لديه ميتنج نشط (`idle` أو `started`)
- يتم إرسال إشعار تلقائي لجميع الطلاب المشتركين في الكورس

**Request Body:**
```json
{
  "title": "محاضرة الرياضيات - الجبر",
  "course_id": 5
}
```

**Response (201 Created):**
```json
{
  "message": "Meeting created",
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة الرياضيات - الجبر",
    "course_id": 5,
    "created_by": 28,
    "status": "idle",
    "room_sid": null,
    "egress_url": null,
    "allow_chat": true,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:00:00Z"
  }
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X POST "http://localhost:8000/api/meeting" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "محاضرة الرياضيات - الجبر",
    "course_id": 5
  }'
```

```javascript
// Fetch
const response = await fetch('http://localhost:8000/api/meeting', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    title: 'محاضرة الرياضيات - الجبر',
    course_id: 5,
  }),
});

const data = await response.json();
console.log(data);
```

```javascript
// Axios
const response = await axios.post(
  'http://localhost:8000/api/meeting',
  {
    title: 'محاضرة الرياضيات - الجبر',
    course_id: 5,
  },
  {
    headers: {
      Authorization: 'Bearer YOUR_TOKEN',
    },
  }
);
```

**أخطاء محتملة:**
- `400 Bad Request`: لديك ميتنج نشط بالفعل
- `400 Bad Request`: `title` يجب أن يكون 3 أحرف على الأقل
- `400 Bad Request`: `course_id` يجب أن يكون رقم صحيح موجب
- `404 Not Found`: الكورس غير موجود

---

### 2. تعديل ميتنج

**Endpoint:** `PUT /api/meeting/:id`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**Request Body:**
```json
{
  "title": "محاضرة الرياضيات - الجبر (محدث)"
}
```

**Response (200 OK):**
```json
{
  "message": "Meeting updated",
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة الرياضيات - الجبر (محدث)",
    "course_id": 5,
    "created_by": 28,
    "status": "idle",
    "updated_at": "2024-01-15T11:00:00Z"
  }
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X PUT "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "محاضرة الرياضيات - الجبر (محدث)"
  }'
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000',
  {
    method: 'PUT',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'محاضرة الرياضيات - الجبر (محدث)',
    }),
  }
);
```

**أخطاء محتملة:**
- `403 Forbidden`: ليس لديك صلاحية لتعديل هذا الميتنج
- `404 Not Found`: الميتنج غير موجود
- `400 Bad Request`: `title` يجب أن يكون 3 أحرف على الأقل

---

### 3. حذف ميتنج

**Endpoint:** `DELETE /api/meeting/:id`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**ملاحظات:**
- يتم حذف الميتنج من قاعدة البيانات
- يتم إغلاق الـ LiveKit room تلقائياً إذا كان نشطاً

**Response (200 OK):**
```json
{
  "message": "Meeting deleted",
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة الرياضيات - الجبر",
    "course_id": 5,
    "created_by": 28,
    "status": "idle"
  }
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X DELETE "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000',
  {
    method: 'DELETE',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
    },
  }
);
```

**أخطاء محتملة:**
- `403 Forbidden`: ليس لديك صلاحية لحذف هذا الميتنج
- `404 Not Found`: الميتنج غير موجود

---

### 4. إغلاق ميتنج

**Endpoint:** `POST /api/meeting/:id/close`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**ملاحظات:**
- يغلق الـ LiveKit room
- يغير حالة الميتنج إلى `ended`
- لا يحذف الميتنج من قاعدة البيانات

**Response (200 OK):**
```json
{
  "message": "Meeting closed"
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X POST "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/close" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/close',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
    },
  }
);
```

**أخطاء محتملة:**
- `403 Forbidden`: ليس لديك صلاحية لإغلاق هذا الميتنج
- `404 Not Found`: الميتنج غير موجود

---

## 📊 جلب الميتنجات

### 1. جلب ميتنجاتي (للمدرس)

**Endpoint:** `GET /api/meeting/me`

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**Query Parameters:**
- `courseId` (optional): تصفية الميتنجات حسب الكورس
- `limit` (optional, default: 10): عدد النتائج
- `skip` (optional, default: 0): عدد النتائج المراد تخطيها

**Response (200 OK):**
```json
{
  "meetings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "محاضرة الرياضيات - الجبر",
      "course_id": 5,
      "created_by": 28,
      "status": "started",
      "room_sid": "RM_abc123",
      "egress_url": "https://www.youtube.com/watch?v=xyz789",
      "allow_chat": true,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "skip": 0,
    "count": 1
  }
}
```

**أمثلة الاستخدام:**

```bash
# جلب جميع ميتنجاتي
curl -X GET "http://localhost:8000/api/meeting/me" \
  -H "Authorization: Bearer YOUR_TOKEN"

# جلب ميتنجاتي في كورس محدد
curl -X GET "http://localhost:8000/api/meeting/me?courseId=5" \
  -H "Authorization: Bearer YOUR_TOKEN"

# مع pagination
curl -X GET "http://localhost:8000/api/meeting/me?limit=20&skip=0" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### 2. جلب الميتنج النشط الحالي

**Endpoint:** `GET /api/meeting/me/current`

**الصلاحيات المطلوبة:** `teacher` أو `admin`

**ملاحظات:**
- يرجع الميتنج النشط الأخير (`idle` أو `started`) للمدرس الحالي

**Response (200 OK):**
```json
{
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة الرياضيات - الجبر",
    "course_id": 5,
    "created_by": 28,
    "status": "started",
    "room_sid": "RM_abc123",
    "egress_url": null,
    "allow_chat": true,
    "created_at": "2024-01-15T10:00:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**Response (404 Not Found):**
```json
{
  "message": "No active meeting found"
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X GET "http://localhost:8000/api/meeting/me/current" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch('http://localhost:8000/api/meeting/me/current', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
  },
});

const data = await response.json();
if (response.status === 404) {
  console.log('لا يوجد ميتنج نشط');
} else {
  console.log('الميتنج النشط:', data.meeting);
}
```

---

### 3. جلب جميع الميتنجات (Admin فقط)

**Endpoint:** `GET /api/meeting`

**الصلاحيات المطلوبة:** `admin` فقط

**Query Parameters:**
- `courseId` (optional): تصفية الميتنجات حسب الكورس
- `limit` (optional, default: 10): عدد النتائج
- `skip` (optional, default: 0): عدد النتائج المراد تخطيها

**Response (200 OK):**
```json
{
  "meetings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "محاضرة الرياضيات - الجبر",
      "course_id": 5,
      "created_by": 28,
      "creator_name": "أحمد محمد",
      "course_title": "رياضيات الصف الأول الثانوي",
      "status": "started",
      "room_sid": "RM_abc123",
      "egress_url": null,
      "allow_chat": true,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

**أمثلة الاستخدام:**

```bash
# جلب جميع الميتنجات
curl -X GET "http://localhost:8000/api/meeting" \
  -H "Authorization: Bearer ADMIN_TOKEN"

# مع تصفية حسب الكورس
curl -X GET "http://localhost:8000/api/meeting?courseId=5" \
  -H "Authorization: Bearer ADMIN_TOKEN"

# مع pagination
curl -X GET "http://localhost:8000/api/meeting?limit=20&skip=20" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

### 4. جلب ميتنجات الكورس (للطالب)

**Endpoint:** `GET /api/meeting/course/:courseId`

**الصلاحيات المطلوبة:** `student` (يجب أن يكون مشتركاً في الكورس)

**Response (200 OK):**
```json
{
  "meetings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "محاضرة الرياضيات - الجبر",
      "course_id": 5,
      "created_by": 28,
      "creator_name": "أحمد محمد",
      "status": "started",
      "room_sid": "RM_abc123",
      "egress_url": "https://www.youtube.com/watch?v=xyz789",
      "allow_chat": true,
      "created_at": "2024-01-15T10:00:00Z",
      "updated_at": "2024-01-15T10:30:00Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655440001",
      "title": "محاضرة الرياضيات - الهندسة",
      "course_id": 5,
      "created_by": 28,
      "creator_name": "أحمد محمد",
      "status": "ended",
      "room_sid": null,
      "egress_url": "https://www.youtube.com/watch?v=abc123",
      "allow_chat": true,
      "created_at": "2024-01-14T10:00:00Z",
      "updated_at": "2024-01-14T11:00:00Z"
    }
  ]
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X GET "http://localhost:8000/api/meeting/course/5" \
  -H "Authorization: Bearer STUDENT_TOKEN"
```

```javascript
// Fetch
const response = await fetch('http://localhost:8000/api/meeting/course/5', {
  headers: {
    'Authorization': 'Bearer STUDENT_TOKEN',
  },
});

const data = await response.json();
console.log('ميتنجات الكورس:', data.meetings);
```

**أخطاء محتملة:**
- `403 Forbidden`: الطالب غير مشترك في هذا الكورس
- `404 Not Found`: الكورس غير موجود

---

## 🚪 الانضمام للميتنج

### 1. معلومات قبل الانضمام

**Endpoint:** `GET /api/meeting/:id/pre-join`

**الصلاحيات المطلوبة:** أي مستخدم مصادق عليه (يجب أن يكون لديه صلاحية الوصول للميتنج)

**ملاحظات:**
- يتحقق من أن الميتنج نشط (`idle` أو `started`)
- يتحقق من أن المستخدم لم يتم طرده من الميتنج
- يتحقق من أن المستخدم لديه صلاحية الوصول (صاحب الميتنج، أو مشترك في الكورس، أو admin)

**Response (200 OK):**
```json
{
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "محاضرة الرياضيات - الجبر",
    "course_id": 5,
    "created_by": 28,
    "status": "started",
    "room_sid": "RM_abc123",
    "allow_chat": true,
    "participantsCount": 15,
    "created_at": "2024-01-15T10:00:00Z"
  },
  "user": {
    "id": 123,
    "isOwner": false,
    "username": "محمد علي",
    "avatar": "https://example.com/avatar.jpg"
  }
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X GET "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/pre-join" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/pre-join',
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
    },
  }
);

const data = await response.json();
console.log('معلومات الميتنج:', data.meeting);
console.log('معلوماتي:', data.user);
console.log('عدد المشاركين:', data.meeting.participantsCount);
```

**أخطاء محتملة:**
- `404 Not Found`: الميتنج غير موجود أو غير نشط
- `403 Forbidden`: لا تملك صلاحية الوصول للميتنج
- `403 Forbidden`: تم طردك من هذا الميتنج

---

### 2. الحصول على Connection Token

**Endpoint:** `GET /api/meeting/:id/connection`

**الصلاحيات المطلوبة:** أي مستخدم مصادق عليه (يجب أن يكون لديه صلاحية الوصول للميتنج)

**Query Parameters:**
- `name` (optional): اسم المستخدم في الميتنج (افتراضي: اسم المستخدم من الحساب)

**ملاحظات:**
- يرجع LiveKit token للانضمام للميتنج
- إذا كان المستخدم صاحب الميتنج:
  - يرجع `screenShareApp` دائماً (معلومات فتح التطبيق الرسمي)
  - يرجع `screenShareToken` **فقط** إذا كان الطلب من تطبيق Expo الرسمي (نفس EAS Project ID)

**التحقق من التطبيق الرسمي (EAS):**

أرسل أحد الهيدرات التالية من التطبيق:
```
X-EAS-Project-Id: 5a2cf549-223a-473b-8c3b-d51796713eca
```
أو query: `?easProjectId=5a2cf549-223a-473b-8c3b-d51796713eca`

القيمة يجب أن تطابق `EAS_PROJECT_ID` في السيرفر.

**Response (200 OK) — من الويب (صاحب الميتنج بدون هيدر التطبيق):**
```json
{
  "participantToken": "eyJ...",
  "screenShareToken": null,
  "screenShareApp": {
    "requiresOfficialApp": true,
    "isOfficialApp": false,
    "easProjectId": "5a2cf549-223a-473b-8c3b-d51796713eca",
    "openAppUrl": "emlecturers://meeting/screen-share?meetingId=550e8400-e29b-41d4-a716-446655440000&easProjectId=5a2cf549-223a-473b-8c3b-d51796713eca&action=screen_share",
    "requiredHeader": "X-EAS-Project-Id"
  },
  "serverUrl": "wss://livekit.example.com",
  "roomName": "550e8400-e29b-41d4-a716-446655440000",
  "participantName": "محمد علي",
  "isOwner": true
}
```

**Response (200 OK) — من التطبيق الرسمي (مع الهيدر):**
```json
{
  "participantToken": "eyJ...",
  "screenShareToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "screenShareApp": {
    "requiresOfficialApp": true,
    "isOfficialApp": true,
    "easProjectId": "5a2cf549-223a-473b-8c3b-d51796713eca",
    "openAppUrl": "emlecturers://meeting/screen-share?meetingId=...&easProjectId=...&action=screen_share",
    "requiredHeader": "X-EAS-Project-Id"
  },
  "serverUrl": "wss://livekit.example.com",
  "roomName": "550e8400-e29b-41d4-a716-446655440000",
  "participantName": "محمد علي",
  "isOwner": true
}
```

> **للفرونت (ويب):** لو `isOwner && !screenShareToken` → افتح `screenShareApp.openAppUrl` عشان يبدأ مشاركة الشاشة من التطبيق.  
> **للتطبيق:** أرسل دائماً `X-EAS-Project-Id` مع طلب `/connection` عشان تستلم `screenShareToken`.

**ملاحظة:** `screenShareToken` / `screenShareApp` يظهران فقط إذا كان `isOwner: true`

**أمثلة الاستخدام:**

```bash
# cURL
curl -X GET "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/connection" \
  -H "Authorization: Bearer YOUR_TOKEN"

# مع اسم مخصص
curl -X GET "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/connection?name=محمد" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/connection',
  {
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
    },
  }
);

const data = await response.json();

// استخدام الـ token للانضمام للميتنج عبر LiveKit SDK
import { Room, RoomEvent } from 'livekit-client';

const room = new Room();
await room.connect(data.serverUrl, data.participantToken);

room.on(RoomEvent.Connected, () => {
  console.log('تم الانضمام للميتنج بنجاح!');
});
```

**أخطاء محتملة:**
- `404 Not Found`: الميتنج غير موجود أو غير نشط
- `403 Forbidden`: لا تملك صلاحية الوصول للميتنج
- `403 Forbidden`: تم طردك من هذا الميتنج

---

## 👥 إدارة المشاركين

### 1. تحديث صلاحيات المشارك

**Endpoint:** `PATCH /api/meeting/:id/participant/:participantId`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**Request Body:**
```json
{
  "permissions": {
    "canPublish": true,
    "canPublishData": true,
    "canSubscribe": true,
    "canUpdateMetadata": false
  }
}
```

**Response (200 OK):**
```json
{
  "message": "Participant permissions updated"
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X PATCH "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/participant/user_123_meeting_550e8400" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": {
      "canPublish": true,
      "canPublishData": true,
      "canSubscribe": true,
      "canUpdateMetadata": false
    }
  }'
```
```

---

### 2. طرد مشارك

**Endpoint:** `POST /api/meeting/:id/participant/:participantId/kick`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**ملاحظات:**
- يطرد المشارك من الميتنج
- يمنع المشارك من إعادة الانضمام (يتم إضافته لجدول `kicked_participants`)

**Response (200 OK):**
```json
{
  "message": "Participant kicked successfully."
}
```

**أمثلة الاستخدام:**

```bash
# cURL
curl -X POST "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/participant/user_123_meeting_550e8400/kick" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

```javascript
// Fetch
const response = await fetch(
  'http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/participant/user_123_meeting_550e8400/kick',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer YOUR_TOKEN',
    },
  }
);
```

**أخطاء محتملة:**
- `403 Forbidden`: ليس لديك صلاحية لطرد المشاركين
- `404 Not Found`: الميتنج غير موجود

---

### 3. إظهار/إخفاء زر رفع اليد

**Endpoint:** `PATCH /api/meeting/:id/wavehand`

**الصلاحيات المطلوبة:** `teacher` (صاحب الميتنج) أو `admin`

**Request Body:**
```json
{
  "visible": true
}
```

**Response (200 OK):**
```json
{
  "message": "Done."
}
```

**أمثلة الاستخدام:**

```bash
# إظهار زر رفع اليد
curl -X PATCH "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/wavehand" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"visible": true}'

# إخفاء زر رفع اليد
curl -X PATCH "http://localhost:8000/api/meeting/550e8400-e29b-41d4-a716-446655440000/wavehand" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"visible": false}'
```

---

## 📊 حالات الميتنج

الميتنج يمكن أن يكون في إحدى الحالات التالية:

- **`idle`**: تم إنشاء الميتنج ولكن لم يبدأ بعد
- **`started`**: الميتنج نشط والبث المباشر جاري
- **`ended`**: الميتنج انتهى

**ملاحظات:**
- عند بدء الميتنج (`room_started` event من LiveKit)، يتم تحديث الحالة تلقائياً إلى `started`
- عند انتهاء الميتنج (`room_finished` event من LiveKit)، يتم تحديث الحالة تلقائياً إلى `ended`
- يمكن إغلاق الميتنج يدوياً باستخدام `POST /api/meeting/:id/close`

---

## 🎬 أمثلة الاستخدام الكاملة

### سيناريو كامل: إنشاء ميتنج والانضمام إليه

```javascript
// 1. إنشاء ميتنج جديد (Teacher)
const createMeeting = async () => {
  const response = await fetch('http://localhost:8000/api/meeting', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer TEACHER_TOKEN',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'محاضرة الرياضيات - الجبر',
      course_id: 5,
    }),
  });

  const data = await response.json();
  console.log('تم إنشاء الميتنج:', data.meeting);
  return data.meeting.id;
};

// 2. الحصول على معلومات قبل الانضمام (Student)
const getPreJoinInfo = async (meetingId) => {
  const response = await fetch(
    `http://localhost:8000/api/meeting/${meetingId}/pre-join`,
    {
      headers: {
        'Authorization': 'Bearer STUDENT_TOKEN',
      },
    }
  );

  const data = await response.json();
  console.log('معلومات الميتنج:', data.meeting);
  console.log('عدد المشاركين:', data.meeting.participantsCount);
  return data;
};

// 3. الحصول على Connection Token (Student)
const getConnectionToken = async (meetingId) => {
  const response = await fetch(
    `http://localhost:8000/api/meeting/${meetingId}/connection`,
    {
      headers: {
        'Authorization': 'Bearer STUDENT_TOKEN',
      },
    }
  );

  const data = await response.json();
  console.log('Connection Token:', data.participantToken);
  return data;
};

// 4. الانضمام للميتنج باستخدام LiveKit SDK
import { Room, RoomEvent } from 'livekit-client';

const joinMeeting = async (connectionData) => {
  const room = new Room();

  await room.connect(
    connectionData.serverUrl,
    connectionData.participantToken
  );

  room.on(RoomEvent.Connected, () => {
    console.log('تم الانضمام للميتنج بنجاح!');
  });

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.log('مشارك جديد انضم:', participant.identity);
  });

  return room;
};

// 5. إغلاق الميتنج (Teacher)
const closeMeeting = async (meetingId) => {
  const response = await fetch(
    `http://localhost:8000/api/meeting/${meetingId}/close`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer TEACHER_TOKEN',
      },
    }
  );

  const data = await response.json();
  console.log(data.message);
};

// استخدام السيناريو
(async () => {
  try {
    // 1. إنشاء الميتنج
    const meetingId = await createMeeting();

    // 2. الحصول على معلومات قبل الانضمام
    await getPreJoinInfo(meetingId);

    // 3. الحصول على Connection Token
    const connectionData = await getConnectionToken(meetingId);

    // 4. الانضمام للميتنج
    const room = await joinMeeting(connectionData);

    // ... استخدام الميتنج ...

    // 5. إغلاق الميتنج
    await closeMeeting(meetingId);
  } catch (error) {
    console.error('خطأ:', error);
  }
})();
```

---

## 🔔 الإشعارات التلقائية

عند إنشاء ميتنج جديد أو بدء البث المباشر، يتم إرسال إشعار تلقائي لجميع الطلاب المشتركين في الكورس:

- **عند الإنشاء**: يتم إرسال إشعار بأن ميتنج جديد تم إنشاؤه (البث لم يبدأ بعد)
- **عند البدء**: يتم إرسال إشعار بأن البث المباشر بدأ الآن

---

## 📝 ملاحظات مهمة

1. **LiveKit Integration**: النظام يستخدم LiveKit للبث المباشر. يجب أن يكون LiveKit server متاحاً ومُكوّناً بشكل صحيح.

2. **التسجيل التلقائي**: عند بدء الميتنج، يتم بدء تسجيل تلقائي. عند انتهاء التسجيل، يتم رفعه تلقائياً على YouTube وحفظ الرابط في `egress_url`.

3. **الصلاحيات**:
   - **Teacher**: يمكنه إدارة الميتنجات الخاصة به فقط
   - **Admin**: يمكنه إدارة جميع الميتنجات
   - **Student**: يمكنه الانضمام للميتنجات في الكورسات المشترك فيها فقط

4. **الحد من الميتنجات النشطة**: لا يمكن للمدرس إنشاء ميتنج جديد إذا كان لديه ميتنج نشط (`idle` أو `started`).

5. **طرد المشاركين**: عند طرد مشارك، يتم منعه من إعادة الانضمام للميتنج.

---

## 🐛 استكشاف الأخطاء

### خطأ: "You already have an active meeting"
**الحل**: أغلق الميتنج النشط الحالي أولاً باستخدام `POST /api/meeting/:id/close`

### خطأ: "You are not enrolled in this course"
**الحل**: تأكد من أن الطالب مشترك في الكورس قبل محاولة الانضمام للميتنج

### خطأ: "You have been removed from this meeting"
**الحل**: تم طرد المستخدم من الميتنج ولا يمكنه إعادة الانضمام

### خطأ: "Active meeting not found"
**الحل**: الميتنج غير موجود أو غير نشط (قد يكون `ended`)

---

## 📚 روابط مفيدة

- [LiveKit Documentation](https://docs.livekit.io/)
- [LiveKit Client SDK](https://docs.livekit.io/client-sdk-js/)

---

**آخر تحديث:** 2024-01-15
