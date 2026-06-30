# توثيق تدفق المدرس: تسجيل الدخول، الكورسات، والمحاضرات المباشرة

## نظرة عامة

هذا الملف يشرح التدفق الأساسي للمدرس من أول تسجيل الدخول، ثم جلب كورساته، ثم عرض المحاضرات المباشرة داخل كورس، ثم إنشاء محاضرة مباشرة، ثم الانضمام لها، وأخيراً إغلاقها.

**Base URL محلياً:**

```text
http://localhost:8000/api
```

في بيئة الـ tenant/subdomain قد يكون الطلب من خلال نفس الدومين المستخدم في الواجهة، مثل:

```text
http://omar-mohamed.localhost:3000/api
```

كل الطلبات بعد تسجيل الدخول تحتاج:

```http
Authorization: Bearer <TOKEN>
```

---

## ملخص التدفق

1. تسجيل الدخول للمدرس: `POST /api/login`
2. حفظ `token` وبيانات `user.id`
3. جلب كورسات المدرس: `GET /api/subject-courses/teacher/:teacherId`
4. جلب المحاضرات المباشرة داخل كورس: `GET /api/meeting/course/:courseId`
5. إنشاء محاضرة مباشرة: `POST /api/meeting`
6. جلب بيانات ما قبل الدخول: `GET /api/meeting/:id/pre-join`
7. جلب توكن LiveKit والانضمام: `GET /api/meeting/:id/connection`
8. إغلاق المحاضرة المباشرة: `POST /api/meeting/:id/close`

---

## 1. تسجيل الدخول

### Endpoint

```http
POST /api/login
Content-Type: application/json
```

### الوصف

يستخدم لتسجيل دخول المدرس والحصول على `token` لاستخدامه في باقي APIs.

يمكن تسجيل الدخول بإيميل أو رقم هاتف، لكن يجب إرسال واحد منهما على الأقل.

**المدرس لا يحتاج إرسال `subdomain`** — النظام يحدد منصته تلقائياً من البريد أو الهاتف (مناسب لـ Expo Go و ngrok).

`subdomain` مطلوب للطالب فقط عند الدخول من `localhost` أو ngrok بدون نطاق المنصة.

### Request Body للمدرس (بالإيميل) — الموصى به

```json
{
  "email": "teacher@example.com",
  "password": "123456"
}
```

### Request Body للمدرس (برقم الهاتف)

```json
{
  "phone": "01000000000",
  "password": "123456"
}
```

### مثال مع Expo / ngrok

```http
POST https://your-subdomain.ngrok-free.dev/api/login
Content-Type: application/json
```

```json
{
  "email": "teacher@example.com",
  "password": "123456"
}
```

### حقول اختيارية

| الحقل | النوع | الوصف |
| --- | --- | --- |
| `subdomain` | `string` | **للطالب فقط** عند الدخول من localhost/ngrok. **غير مطلوب للمدرس.** |
| `tenant_subdomain` | `string` | بديل لـ `subdomain` (للطالب). |
| `device_ip` | `string` | للطلاب المرتبطين بجهاز. **غير مطلوب للمدرس.** |

### Response 200

```json
{
  "user": {
    "id": 28,
    "name": "Teacher Name",
    "email": "teacher@example.com",
    "phone": "01000000000",
    "role": "teacher",
    "avatar": "https://example.com/avatar.png"
  },
  "token": "JWT_TOKEN",
  "tenant": {
    "id": 5,
    "subdomain": "omar-mohamed",
    "display_name": "منصة عمر محمد"
  },
  "employee_permissions": null,
  "employee_data": null
}
```

### القيم المهمة للفرونت

| الحقل | الاستخدام |
| --- | --- |
| `token` | يرسل في `Authorization` لكل الطلبات التالية. |
| `user.id` | يستخدم كـ `teacherId` في API جلب كورسات المدرس. |
| `user.role` | يجب أن تكون `teacher` في تدفق المدرس. |
| `tenant.subdomain` | منصة المدرس (يُرجع تلقائياً بدون إرسال subdomain). |

### أخطاء متوقعة

```json
{
  "message": "Invalid credentials"
}
```

```json
{
  "message": "Teacher account is not active",
  "code": "TEACHER_ACCOUNT_INACTIVE"
}
```

```json
{
  "message": "يوجد أكثر من حساب بهذا البريد أو الهاتف. أرسل subdomain المنصة.",
  "code": "MULTIPLE_STAFF_ACCOUNTS",
  "accounts": [
    { "role": "teacher", "subdomain": "ahmed" },
    { "role": "teacher", "subdomain": "omar" }
  ]
}
```

> ملاحظة: خطأ `TENANT_LOGIN_MISMATCH` يظهر للطلاب فقط، وليس للمدرس.

### مثال JavaScript

```javascript
const loginResponse = await fetch('/api/login', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    email: 'teacher@example.com',
    password: '123456',
  }),
});

const loginData = await loginResponse.json();
const token = loginData.token;
const teacherId = loginData.user.id;
```

---

## 2. جلب كورسات المدرس

### Endpoint

```http
GET /api/subject-courses/teacher/:teacherId
Authorization: Bearer <TOKEN>
```

### الصلاحيات

- `teacher`
- `admin`

### الوصف

يرجع كورسات مدرس معين. إذا كان المستخدم الحالي مدرساً، لا يمكنه جلب كورسات مدرس آخر. يجب أن يكون `teacherId` هو نفس `user.id` القادم من login.

### Path Parameters

| الاسم | الوصف |
| --- | --- |
| `teacherId` | معرف المدرس. |

### Query Parameters

| الاسم | مطلوب | الوصف |
| --- | --- | --- |
| `status` | لا | فلترة حسب حالة الكورس مثل `draft` أو `published`. |

### مثال Request

```http
GET /api/subject-courses/teacher/28?status=published
Authorization: Bearer JWT_TOKEN
```

### Response 200

```json
{
  "courses": [
    {
      "id": 14,
      "subject_id": 3,
      "teacher_id": 28,
      "title": "كورس الرياضيات",
      "description": "شرح منهج الرياضيات",
      "image": "https://example.com/course.png",
      "price": "100.00",
      "duration_hours": 20,
      "level": "مبتدئ",
      "status": "published",
      "created_at": "2026-06-10T09:00:00.000Z",
      "updated_at": "2026-06-10T09:00:00.000Z",
      "subject_name": "الرياضيات",
      "subject_description": "مادة الرياضيات"
    }
  ]
}
```

### أخطاء متوقعة

```json
{
  "error": "غير مصرح لك برؤية كورسات مدرس آخر"
}
```

```json
{
  "error": "خطأ في جلب كورسات المدرس"
}
```

### مثال JavaScript

```javascript
async function getTeacherCourses(token, teacherId) {
  const response = await fetch(`/api/subject-courses/teacher/${teacherId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch teacher courses');
  }

  return response.json();
}
```

---

## 3. جلب المحاضرات المباشرة داخل كورس

### Endpoint

```http
GET /api/meeting/course/:courseId
Authorization: Bearer <TOKEN>
```

### الصلاحيات

المستخدم يجب أن يكون لديه صلاحية الوصول للكورس:

- `admin`
- مدرس صاحب الكورس
- طالب مشترك في الكورس

### الوصف

يرجع كل المحاضرات المباشرة المرتبطة بكورس معين، مرتبة من الأحدث للأقدم.

### Path Parameters

| الاسم | الوصف |
| --- | --- |
| `courseId` | معرف الكورس. |

### Response 200

```json
{
  "meetings": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "course_id": 14,
      "room_sid": "RM_abc123",
      "egress_url": null,
      "title": "محاضرة مباشرة - الفصل الأول",
      "allow_chat": true,
      "status": "started",
      "created_by": 28,
      "created_at": "2026-06-10T09:30:00.000Z",
      "updated_at": "2026-06-10T09:45:00.000Z",
      "creator_name": "Teacher Name"
    }
  ]
}
```

### حالات المحاضرة المباشرة

| الحالة | المعنى |
| --- | --- |
| `idle` | تم إنشاء المحاضرة لكن لم يبدأ المدرس الاتصال بها بعد. |
| `started` | المحاضرة بدأت وغرفة LiveKit نشطة. |
| `ended` | المحاضرة انتهت. |

### أخطاء متوقعة

```json
{
  "message": "Course not found"
}
```

```json
{
  "message": "You are not enrolled in this course"
}
```

### مثال JavaScript

```javascript
async function getCourseMeetings(token, courseId) {
  const response = await fetch(`/api/meeting/course/${courseId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch course meetings');
  }

  return response.json();
}
```

---

## 4. إنشاء محاضرة مباشرة داخل كورس

### Endpoint

```http
POST /api/meeting
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

### الصلاحيات

- `teacher`
- `admin`

### الوصف

ينشئ محاضرة مباشرة جديدة داخل كورس. المحاضرة تنشأ بحالة `idle`، ثم تتحول إلى `started` عند دخول المدرس للغرفة من خلال API الاتصال.

### قيود مهمة

- لا يمكن للمدرس إنشاء أكثر من محاضرة نشطة في نفس الوقت بحالة `idle` أو `started`.
- المدرس يخضع لحدود باقة اللايف الخاصة به.
- `course_id` يجب أن يكون معرف كورس موجود.

### Request Body

```json
{
  "title": "محاضرة مباشرة - الفصل الأول",
  "course_id": 14
}
```

### Request Fields

| الحقل | النوع | مطلوب | الوصف |
| --- | --- | --- | --- |
| `title` | `string` | نعم | عنوان المحاضرة، 3 أحرف على الأقل. |
| `course_id` | `number` | نعم | معرف الكورس. |

### Response 201

```json
{
  "message": "Meeting created",
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "course_id": 14,
    "room_sid": null,
    "egress_url": null,
    "title": "محاضرة مباشرة - الفصل الأول",
    "allow_chat": true,
    "status": "idle",
    "created_by": 28,
    "created_at": "2026-06-10T09:30:00.000Z",
    "updated_at": "2026-06-10T09:30:00.000Z"
  }
}
```

### أخطاء متوقعة

```json
{
  "message": "You already have an active meeting. Close it before creating a new one."
}
```

```json
{
  "message": "Title must be at least 3 characters long"
}
```

### مثال JavaScript

```javascript
async function createLiveMeeting(token, courseId, title) {
  const response = await fetch('/api/meeting', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title,
      course_id: courseId,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to create live meeting');
  }

  return response.json();
}
```

---

## 5. جلب بيانات ما قبل الانضمام

### Endpoint

```http
GET /api/meeting/:id/pre-join
Authorization: Bearer <TOKEN>
```

### الوصف

يستخدم قبل فتح شاشة الانضمام. يرجع بيانات المحاضرة، عدد المشاركين، وبيانات المستخدم الحالي.

### Path Parameters

| الاسم | الوصف |
| --- | --- |
| `id` | معرف المحاضرة المباشرة `meeting.id`. |

### Response 200

```json
{
  "meeting": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "course_id": 14,
    "title": "محاضرة مباشرة - الفصل الأول",
    "status": "idle",
    "allow_chat": true,
    "participantsCount": 0,
    "created_by": 28,
    "created_at": "2026-06-10T09:30:00.000Z"
  },
  "user": {
    "id": 28,
    "isOwner": true,
    "username": "Teacher Name",
    "avatar": "https://example.com/avatar.png"
  },
  "canEnter": true
}
```

### ملاحظات

- `user.isOwner = true` تعني أن المستخدم هو صاحب المحاضرة.
- `canEnter` يرجع `true` للسماح للفرونت بتفعيل زر الدخول.
- إذا كان المستخدم مطروداً من المحاضرة، لن يستطيع الدخول.

---

## 6. الانضمام للمحاضرة المباشرة

### Endpoint

```http
GET /api/meeting/:id/connection
Authorization: Bearer <TOKEN>
```

### الوصف

يرجع بيانات الاتصال بـ LiveKit. هذا endpoint لا يدخل المستخدم بنفسه، لكنه يرجع `participantToken` و `serverUrl` التي يستخدمها الفرونت للاتصال بغرفة LiveKit.

عندما يستدعي صاحب المحاضرة هذا endpoint وكانت المحاضرة `idle`، يتم تحديث حالتها إلى `started`.

### Query Parameters

| الاسم | مطلوب | الوصف |
| --- | --- | --- |
| `name` | لا | اسم مخصص يظهر داخل غرفة LiveKit. |

### Response 200 للمدرس صاحب المحاضرة

```json
{
  "participantToken": "LIVEKIT_PARTICIPANT_TOKEN",
  "screenShareToken": "LIVEKIT_SCREEN_SHARE_TOKEN",
  "serverUrl": "wss://livekit.example.com",
  "roomName": "550e8400-e29b-41d4-a716-446655440000",
  "participantName": "Teacher Name",
  "isOwner": true
}
```

### Response 200 للطالب

```json
{
  "participantToken": "LIVEKIT_PARTICIPANT_TOKEN",
  "serverUrl": "wss://livekit.example.com",
  "roomName": "550e8400-e29b-41d4-a716-446655440000",
  "participantName": "Student Name",
  "isOwner": false
}
```

### معنى الحقول

| الحقل | الوصف |
| --- | --- |
| `participantToken` | توكن LiveKit الأساسي للانضمام للغرفة. |
| `screenShareToken` | يرجع للمدرس فقط لمشاركة الشاشة بتوكن منفصل. |
| `serverUrl` | رابط LiveKit server. |
| `roomName` | اسم الغرفة، ويساوي `meeting.id`. |
| `participantName` | الاسم الذي سيظهر داخل اللايف. |
| `isOwner` | هل المستخدم صاحب المحاضرة. |

### مثال Front-End للانضمام

```javascript
import { Room, RoomEvent } from 'livekit-client';

async function joinLiveMeeting(token, meetingId) {
  const response = await fetch(`/api/meeting/${meetingId}/connection`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to get LiveKit connection');
  }

  const connection = await response.json();
  const room = new Room();

  await room.connect(connection.serverUrl, connection.participantToken);

  room.on(RoomEvent.Connected, () => {
    console.log('Joined live meeting');
  });

  return {
    room,
    connection,
  };
}
```

### أخطاء متوقعة

```json
{
  "message": "Active meeting not found"
}
```

```json
{
  "message": "You are not authorized to access this meeting"
}
```

```json
{
  "message": "You have been removed from this meeting and cannot rejoin."
}
```

---

## 7. إغلاق المحاضرة المباشرة

### Endpoint

```http
POST /api/meeting/:id/close
Authorization: Bearer <TOKEN>
```

### الصلاحيات

- مدرس صاحب المحاضرة
- `admin`

### الوصف

يغلق غرفة LiveKit ويحدث حالة المحاضرة إلى:

```text
ended
```

هذا لا يحذف المحاضرة من قاعدة البيانات، لكنه ينهي الجلسة المباشرة.

### Response 200

```json
{
  "message": "Meeting closed"
}
```

### أخطاء متوقعة

```json
{
  "message": "Meeting not found"
}
```

```json
{
  "message": "You are not authorized to manage this meeting"
}
```

### مثال JavaScript

```javascript
async function closeLiveMeeting(token, meetingId) {
  const response = await fetch(`/api/meeting/${meetingId}/close`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to close live meeting');
  }

  return response.json();
}
```

---

## مثال كامل للتدفق

```javascript
async function teacherLiveFlow() {
  // 1. Login
  const loginRes = await fetch('/api/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'teacher@example.com',
      password: '123456',
    }),
  });

  const login = await loginRes.json();
  const token = login.token;
  const teacherId = login.user.id;

  // 2. Get teacher courses
  const coursesRes = await fetch(`/api/subject-courses/teacher/${teacherId}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const { courses } = await coursesRes.json();
  const course = courses[0];

  // 3. Get course live meetings
  const meetingsRes = await fetch(`/api/meeting/course/${course.id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const meetings = await meetingsRes.json();
  console.log('Course meetings:', meetings.meetings);

  // 4. Create new live meeting
  const createRes = await fetch('/api/meeting', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      title: 'محاضرة مباشرة جديدة',
      course_id: course.id,
    }),
  });
  const created = await createRes.json();
  const meetingId = created.meeting.id;

  // 5. Pre-join
  const preJoinRes = await fetch(`/api/meeting/${meetingId}/pre-join`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const preJoin = await preJoinRes.json();
  console.log('Pre join:', preJoin);

  // 6. Get LiveKit connection
  const connectionRes = await fetch(`/api/meeting/${meetingId}/connection`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  const connection = await connectionRes.json();
  console.log('LiveKit connection:', connection);

  // 7. Join LiveKit room from frontend using connection.serverUrl + connection.participantToken

  // 8. Close meeting
  await fetch(`/api/meeting/${meetingId}/close`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
```

---

## ملاحظات مهمة للفرونت

- خزّن `token` بعد login واستخدمه في كل الطلبات التالية.
- استخدم `login.user.id` كـ `teacherId` لجلب كورسات المدرس.
- استخدم `course.id` كـ `course_id` عند إنشاء محاضرة مباشرة.
- استخدم `meeting.id` في endpoints الخاصة بالانضمام والإغلاق.
- الانضمام الفعلي للصوت والفيديو يتم من خلال LiveKit SDK وليس من REST API.
- إغلاق المحاضرة يتم من الباكند عبر `POST /api/meeting/:id/close`.

**آخر تحديث:** 2026-06-10
