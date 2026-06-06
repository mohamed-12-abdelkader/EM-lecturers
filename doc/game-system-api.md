# نظام اللعبة التفاعلية - دليل المطور

## نظرة عامة

نظام اللعبة التفاعلية يسمح للطلاب بإرسال دعوات لبعضهم البعض للعب ألعاب تعليمية تفاعلية باستخدام الأسئلة من بنك الأسئلة. النظام يدعم التواصل المباشر عبر WebSocket ويوفر تجربة لعب تفاعلية كاملة.

## المكونات الرئيسية

### 1. قاعدة البيانات
- **game_invitations**: دعوات اللعبة بين الطلاب
- **game_rooms**: غرف اللعبة النشطة
- **game_questions**: الأسئلة المختارة لكل لعبة
- **game_answers**: إجابات اللاعبين على الأسئلة
- **game_results**: نتائج الألعاب المكتملة
- **player_game_stats**: إحصائيات اللاعبين العامة

### 2. الخدمات
- **GameService**: إدارة منطق اللعبة والبيانات
- **WebSocketService**: التواصل المباشر بين اللاعبين

### 3. الـ APIs
- **GameController**: REST APIs لإدارة اللعبة

## تدفق اللعبة

### 1. إرسال الدعوة
```
الطالب الأول → إرسال دعوة → الطالب الثاني
```

### 2. قبول الدعوة
```
الطالب الثاني → قبول الدعوة → إنشاء غرفة اللعبة
```

### 3. بدء اللعبة
```
أي من اللاعبين → بدء اللعبة → إرسال السؤال الأول
```

### 4. الإجابة على الأسئلة
```
اللاعبون → إرسال الإجابات → الانتقال للسؤال التالي
```

### 5. إنهاء اللعبة
```
انتهاء الأسئلة → حساب النتائج → عرض الفائز
```

## الـ APIs المتاحة

### دعوات اللعبة

#### إرسال دعوة (متعددة الطلاب)
```http
POST /api/game/invite
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "inviteeIds": [58, 59, 60],
  "lessonIds": [38,45],
  "questionsCount": 10
}
```

**الحد الأقصى:** 8 طلاب في المرة الواحدة

**الاستجابة:**
```json
{
  "success": true,
  "message": "تم إرسال الدعوات بنجاح لـ 3 من 3 طالب",
  "data": {
    "totalInvited": 3,
    "successfulInvitations": 3,
    "failedInvitations": 0,
    "lessonIds": [38, 45],
    "questionsCount": 10,
    "invitations": [
      {
        "inviteeId": 58,
        "success": true,
        "invitationId": 123,
        "error": null
      },
      {
        "inviteeId": 59,
        "success": true,
        "invitationId": 124,
        "error": null
      },
      {
        "inviteeId": 60,
        "success": false,
        "invitationId": null,
        "error": "الطالب لديه دعوة معلقة بالفعل"
      }
    ]
  }
}
```

#### جلب الدعوات الصادرة

**Endpoint:** `GET /api/game/invitations/outgoing`

**الوصف:** يعرض جميع الدعوات التي أرسلها الطالب مع حالة كل دعوة.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 123,
      "inviteeId": 58,
      "inviteeName": "محمد أحمد",
      "lessonIds": [44, 46],
      "lessonNames": [
        { "id": 44, "name": "الرياضيات - الدرس الأول" },
        { "id": 46, "name": "الرياضيات - الدرس الثاني" }
      ],
      "questionsCount": 10,
      "status": "pending",
      "statusMessage": "في انتظار الرد",
      "canResend": false,
      "createdAt": "2025-10-29T20:44:05.213Z",
      "expiresAt": "2025-10-29T21:44:05.213Z",
      "acceptedAt": null,
      "rejectedAt": null
    },
    {
      "id": 124,
      "inviteeId": 59,
      "inviteeName": "أحمد علي",
      "lessonIds": [44, 46],
      "lessonNames": [
        { "id": 44, "name": "الرياضيات - الدرس الأول" }
      ],
      "questionsCount": 10,
      "status": "accepted",
      "statusMessage": "تم قبول الدعوة",
      "canResend": true,
      "createdAt": "2025-10-29T19:00:00.000Z",
      "expiresAt": "2025-10-29T20:00:00.000Z",
      "acceptedAt": "2025-10-29T19:30:00.000Z",
      "rejectedAt": null
    },
    {
      "id": 125,
      "inviteeId": 60,
      "inviteeName": "سارة محمود",
      "lessonIds": [45],
      "lessonNames": [
        { "id": 45, "name": "الفيزياء - الدرس الأول" }
      ],
      "questionsCount": 10,
      "status": "rejected",
      "statusMessage": "تم رفض الدعوة",
      "canResend": true,
      "createdAt": "2025-10-29T18:00:00.000Z",
      "expiresAt": "2025-10-29T19:00:00.000Z",
      "acceptedAt": null,
      "rejectedAt": "2025-10-29T18:15:00.000Z"
    }
  ]
}
```

**حالات الدعوة:**
- `pending`: في انتظار الرد (لا يمكن إرسال دعوة جديدة)
- `accepted`: تم قبول الدعوة (يمكن إرسال دعوة جديدة)
- `rejected`: تم رفض الدعوة (يمكن إرسال دعوة جديدة)
- `expired`: الدعوة منتهية الصلاحية (يمكن إرسال دعوة جديدة)

**قواعد إعادة الإرسال:**
- `canResend: false`: لا يمكن إرسال دعوة جديدة (الدعوة معلقة)
- `canResend: true`: يمكن إرسال دعوة جديدة (الدعوة قبلت/رفضت/انتهت)

#### التحقق من إمكانية إرسال دعوة

**Endpoint:** `GET /api/game/invitations/can-invite/:inviteeId`

**الوصف:** يتحقق من إمكانية إرسال دعوة لطالب معين قبل الإرسال.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response (يمكن الإرسال):**
```json
{
  "success": true,
  "canInvite": true,
  "inviteeName": "محمد أحمد"
}
```

**Response (لا يمكن الإرسال - دعوة معلقة):**
```json
{
  "success": true,
  "canInvite": false,
  "reason": "لديك دعوة معلقة مع هذا الطالب. يجب انتظار الرد أولاً",
  "pendingInvitation": {
    "id": 123,
    "isOutgoing": true
  }
}
```

**Response (لا يمكن الإرسال - الطالب لديه دعوة من شخص آخر):**
```json
{
  "success": true,
  "canInvite": false,
  "reason": "الطالب لديه دعوة معلقة بالفعل"
}
```

#### عرض تفاصيل مجموعة دعوات مع حالات المدعوين

**Endpoint:** `GET /api/game/invitations/group/:invitationId`

**الوصف:** يعرض تفاصيل جميع الدعوات المرسلة لنفس الوقت مع حالة كل مدعو (قبل/رفض/في انتظار/منتهية).

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "invitationGroupId": 123,
    "totalInvited": 4,
    "questionsCount": 10,
    "createdAt": "2025-10-29T20:44:05.213Z",
    "expiresAt": "2025-10-29T20:47:05.213Z",
    "canStartGame": true,
    "invitations": [
      {
        "id": 123,
        "inviteeId": 58,
        "inviteeName": "محمد أحمد",
        "status": "accepted",
        "statusMessage": "تم قبول الدعوة",
        "createdAt": "2025-10-29T20:44:05.213Z",
        "expiresAt": "2025-10-29T20:47:05.213Z",
        "acceptedAt": "2025-10-29T20:44:30.000Z",
        "rejectedAt": null
      },
      {
        "id": 124,
        "inviteeId": 59,
        "inviteeName": "أحمد علي",
        "status": "accepted",
        "statusMessage": "تم قبول الدعوة",
        "createdAt": "2025-10-29T20:44:05.213Z",
        "expiresAt": "2025-10-29T20:47:05.213Z",
        "acceptedAt": "2025-10-29T20:45:00.000Z",
        "rejectedAt": null
      },
      {
        "id": 125,
        "inviteeId": 60,
        "inviteeName": "سارة محمود",
        "status": "rejected",
        "statusMessage": "تم رفض الدعوة",
        "createdAt": "2025-10-29T20:44:05.213Z",
        "expiresAt": "2025-10-29T20:47:05.213Z",
        "acceptedAt": null,
        "rejectedAt": "2025-10-29T20:45:30.000Z"
      },
      {
        "id": 126,
        "inviteeId": 61,
        "inviteeName": "علي حسن",
        "status": "expired",
        "statusMessage": "الدعوة منتهية الصلاحية",
        "createdAt": "2025-10-29T20:44:05.213Z",
        "expiresAt": "2025-10-29T20:47:05.213Z",
        "acceptedAt": null,
        "rejectedAt": null
      }
    ],
    "summary": {
      "accepted": 2,
      "rejected": 1,
      "pending": 0,
      "expired": 1
    }
  }
}
```

**ملاحظات:**
- `canStartGame`: `true` إذا انتهت 3 دقائق وكان هناك طلاب قبلوا الدعوة
- بعد 3 دقائق، الطلاب الذين قبلوا الدعوة يمكنهم اللعب حتى لو لم يرد الباقون

#### عرض تفاصيل آخر دعوة مرسلة

**Endpoint:** `GET /api/game/invitations/latest-outgoing`

**الوصف:** يعرض تفاصيل آخر دعوة أرسلها الطالب مع حالات جميع المدعوين.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "invitationGroupId": 123,
    "totalInvited": 4,
    "questionsCount": 10,
    "lessonIds": [44, 46],
    "lessonNames": [
      { "id": 44, "name": "الرياضيات - الدرس الأول" },
      { "id": 46, "name": "الرياضيات - الدرس الثاني" }
    ],
    "createdAt": "2025-10-29T20:44:05.213Z",
    "expiresAt": "2025-10-29T20:47:05.213Z",
    "canStartGame": true,
    "invitations": [
      {
        "id": 123,
        "inviteeId": 58,
        "inviteeName": "محمد أحمد",
        "status": "accepted",
        "statusMessage": "تم قبول الدعوة",
        "lessonIds": [44, 46],
        "acceptedAt": "2025-10-29T20:44:30.000Z"
      },
      {
        "id": 124,
        "inviteeId": 59,
        "inviteeName": "أحمد علي",
        "status": "accepted",
        "statusMessage": "تم قبول الدعوة",
        "lessonIds": [44, 46],
        "acceptedAt": "2025-10-29T20:45:00.000Z"
      },
      {
        "id": 125,
        "inviteeId": 60,
        "inviteeName": "سارة محمود",
        "status": "rejected",
        "statusMessage": "تم رفض الدعوة",
        "lessonIds": [44, 46],
        "rejectedAt": "2025-10-29T20:45:30.000Z"
      },
      {
        "id": 126,
        "inviteeId": 61,
        "inviteeName": "علي حسن",
        "status": "expired",
        "statusMessage": "الدعوة منتهية الصلاحية",
        "lessonIds": [44, 46]
      }
    ],
    "summary": {
      "accepted": 2,
      "rejected": 1,
      "pending": 0,
      "expired": 1
    }
  }
}
```

**ملاحظات:**
- يعرض آخر دعوة مرسلة تلقائياً
- يشمل جميع المدعوين في نفس المجموعة
- يعرض أسماء الدروس المختارة
- إذا لم توجد دعوات، يرجع `data: null`

**Real-time Updates:**
- يتم تحديث البيانات تلقائياً عند قبول/رفض أي دعوة من المجموعة
- استخدم Socket.IO event `game:latest_outgoing_updated` للحصول على التحديثات الفورية

#### جلب آخر دعوة واردة

**Endpoint:** `GET /api/game/invitations/latest`

**الوصف:** يعرض آخر دعوة واردة للطالب (pending فقط).

**Headers:**
```
Authorization: Bearer <student_token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 123,
    "inviterId": 66,
    "inviterName": "احمد هريدي",
    "lessonIds": [44, 46],
    "lessonNames": [
      { "id": 44, "name": "الرياضيات - الدرس الأول" },
      { "id": 46, "name": "الرياضيات - الدرس الثاني" }
    ],
    "questionsCount": 10,
    "status": "pending",
    "createdAt": "2025-10-29T20:44:05.213Z",
    "expiresAt": "2025-10-29T20:47:05.213Z"
  }
}
```

**ملاحظات:**
- يعرض آخر دعوة pending فقط (لم تُقبل/تُرفض/تنتهي)
- يشمل أسماء الدروس المختارة
- إذا لم توجد دعوات معلقة، يرجع `data: null`

**Real-time Updates:**
- يتم تحديث البيانات تلقائياً عند استقبال دعوة جديدة
- يتم تحديث البيانات عند قبول/رفض الدعوة
- يتم تحديث البيانات عند انتهاء صلاحية الدعوة
- استخدم Socket.IO event `game:latest_incoming_updated` للحصول على التحديثات الفورية

#### جلب الدعوات الواردة
```http
GET /api/game/invitations/incoming
Authorization: Bearer TOKEN
```

#### جلب الدعوات الصادرة
```http
GET /api/game/invitations/outgoing
Authorization: Bearer TOKEN
```

#### قبول الدعوة

**Endpoint:** `POST /api/game/accept/:invitationId`

**الوصف:** يقبل الطالب دعوة واردة وينشئ غرفة اللعبة.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Parameters:**
- `invitationId` (path parameter): معرف الدعوة

**Response (نجح القبول):**
```json
{
  "success": true,
  "message": "تم قبول الدعوة وإنشاء غرفة اللعبة",
  "data": {
    "roomId": 123,
    "player1Id": 66,
    "player2Id": 58,
    "questionsCount": 10,
    "timePerQuestion": 120,
    "totalTime": 1200
  }
}
```

**Response (فشل - الدعوة منتهية):**
```json
{
  "success": false,
  "message": "انتهت صلاحية الدعوة ولم يقبلها أي طالب آخر"
}
```

**Response (فشل - تم قبولها مسبقاً):**
```json
{
  "success": false,
  "message": "تم قبول هذه الدعوة مسبقاً"
}
```

**ملاحظات:**
- بعد قبول الدعوة، يتم إنشاء غرفة لعبة تلقائياً
- يتم إرسال تحديثات real-time للطالب المرسل (inviter) والطالب المستلم (invitee)
- بعد 3 دقائق، يمكن قبول الدعوة فقط إذا كان هناك طلاب آخرون قبلوا من نفس المجموعة

#### رفض الدعوة

**Endpoint:** `POST /api/game/reject/:invitationId`

**الوصف:** يرفض الطالب دعوة واردة.

**Headers:**
```
Authorization: Bearer <student_token>
```

**Parameters:**
- `invitationId` (path parameter): معرف الدعوة

**Response (نجح الرفض):**
```json
{
  "success": true,
  "message": "تم رفض الدعوة"
}
```

**Response (فشل - تم رفضها مسبقاً):**
```json
{
  "success": false,
  "message": "تم رفض هذه الدعوة مسبقاً"
}
```

**Response (فشل - الدعوة غير موجودة):**
```json
{
  "success": false,
  "message": "الدعوة غير موجودة أو تم التعامل معها مسبقاً"
}
```

**ملاحظات:**
- بعد رفض الدعوة، لا يمكن قبولها مرة أخرى
- يتم إرسال تحديثات real-time للطالب المرسل (inviter) والطالب المستلم (invitee)

### إدارة الغرف

#### جلب تفاصيل الغرفة
```http
GET /api/game/room/:roomId
Authorization: Bearer TOKEN
```

#### جلب أسئلة الغرفة
```http
GET /api/game/room/:roomId/questions
Authorization: Bearer TOKEN
```

#### تسجيل إجابة اللاعب
```http
POST /api/game/room/:roomId/answer
Authorization: Bearer TOKEN
Content-Type: application/json

{
  "questionId": 1,
  "answer": "أ",
  "timeTaken": 45
}
```

#### جلب نتيجة اللعبة
```http
GET /api/game/room/:roomId/result
Authorization: Bearer TOKEN
```

### الإحصائيات

#### جلب إحصائيات اللاعب
```http
GET /api/game/stats
Authorization: Bearer TOKEN
```

## WebSocket Events

### تسجيل دخول المستخدم
```javascript
socket.emit('user:join', {
  userId: 58,
  name: 'اسم الطالب'
});
```

### إرسال دعوة (متعددة الطلاب)
```javascript
socket.emit('game:send_invitation', {
  inviteeIds: [59, 60, 61],
  lessonIds: [1, 2, 3],
  questionsCount: 10
});
```

**الحد الأقصى:** 8 طلاب في المرة الواحدة

### قبول الدعوة
```javascript
socket.emit('game:accept_invitation', {
  invitationId: 1
});
```

### رفض الدعوة
```javascript
socket.emit('game:reject_invitation', {
  invitationId: 1
});
```

### بدء اللعبة
```javascript
socket.emit('game:start', {
  roomId: 1
});
```

### إرسال إجابة
```javascript
socket.emit('game:submit_answer', {
  roomId: 1,
  questionId: 1,
  answer: 'أ',
  timeTaken: 45
});
```

### طلب السؤال التالي
```javascript
socket.emit('game:next_question', {
  roomId: 1,
  currentQuestionOrder: 1
});
```

## WebSocket Events المستلمة

### دعوة واردة
```javascript
socket.on('game:invitation_received', (data) => {
  console.log('دعوة جديدة:', data);
});
```

### تأكيد إرسال الدعوات المتعددة
```javascript
socket.on('game:invitations_sent', (data) => {
  console.log('تم إرسال الدعوات:', data);
  // data contains:
  // - totalInvited: عدد الطلاب المدعوين
  // - successfulInvitations: عدد الدعوات الناجحة
  // - failedInvitations: عدد الدعوات الفاشلة
  // - invitations: مصفوفة بالتفاصيل لكل دعوة
});
```

### تحديث حالة دعوة (Real-time)
```javascript
socket.on('game:invitation_status_updated', (data) => {
  console.log('تحديث حالة دعوة:', data);
  // data contains:
  // - invitationId: معرف الدعوة
  // - inviteeId: معرف الطالب المدعو
  // - inviteeName: اسم الطالب المدعو
  // - status: حالة الدعوة (accepted/rejected/pending)
  // - acceptedAt: وقت القبول
  // - rejectedAt: وقت الرفض
});
```

### تحديث بيانات آخر دعوة مرسلة (Real-time)
```javascript
socket.on('game:latest_outgoing_updated', (data) => {
  console.log('تحديث آخر دعوة مرسلة:', data);
  // data contains نفس بنية استجابة GET /api/game/invitations/latest-outgoing
  // يتم إرسال هذا التحديث تلقائياً عند قبول/رفض أي دعوة من آخر مجموعة دعوات مرسلة
});
```

### تحديث آخر دعوة واردة (Real-time)
```javascript
socket.on('game:latest_incoming_updated', (data) => {
  console.log('تحديث آخر دعوة واردة:', data);
  // data contains نفس بنية استجابة GET /api/game/invitations/latest
  // {
  //   success: true,
  //   data: {
  //     id: 123,
  //     inviterId: 66,
  //     inviterName: "احمد هريدي",
  //     lessonIds: [44, 46],
  //     lessonNames: [...],
  //     questionsCount: 10,
  //     status: "pending",
  //     createdAt: "...",
  //     expiresAt: "..."
  //   }
  // }
  // أو data: null إذا لم توجد دعوات معلقة
  // يتم إرسال هذا التحديث تلقائياً عند:
  // - استقبال دعوة جديدة
  // - قبول/رفض دعوة
  // - انتهاء صلاحية دعوة
});
```

### إنشاء غرفة
```javascript
socket.on('game:room_created', (data) => {
  console.log('تم إنشاء الغرفة:', data);
});
```

### سؤال جديد
```javascript
socket.on('game:question', (data) => {
  console.log('سؤال جديد:', data);
});
```

### انتهاء الوقت
```javascript
socket.on('game:time_up', (data) => {
  console.log('انتهى الوقت:', data);
});
```

### تسليم الخصم
```javascript
socket.on('game:opponent_submitted', (data) => {
  console.log('سلم الخصم:', data);
});
```

### انتهاء اللعبة
```javascript
socket.on('game:finished', (data) => {
  console.log('انتهت اللعبة:', data);
});
```

## قواعد اللعبة

### 1. التوقيت
- كل سؤال له دقيقتان (120 ثانية)
- إجمالي وقت اللعبة = عدد الأسئلة × 2 دقيقة

### 2. النتيجة
- النتيجة = عدد الإجابات الصحيحة
- في حالة التعادل، الفائز هو الأسرع

### 3. التسليم
- يمكن للاعبين التسليم في أي وقت
- إذا سلم أحد اللاعبين، ينتظر الآخر
- إذا انتهى الوقت، يتم التسليم تلقائياً

## الأمان

### 1. المصادقة
- جميع الـ APIs تتطلب مصادقة الطالب
- WebSocket يتطلب تسجيل دخول المستخدم

### 2. الصلاحيات
- الطلاب يمكنهم فقط إرسال دعوات لطلاب آخرين
- الطلاب يمكنهم فقط الوصول لغرفهم الخاصة

### 3. التحقق من البيانات
- التحقق من وجود الدروس في بنك الأسئلة
- التحقق من عدم وجود دعوات معلقة
- التحقق من صحة البيانات المدخلة

## الأداء

### 1. الفهرسة
- فهارس على المعرفات الرئيسية
- فهارس على التواريخ والحالات

### 2. التنظيف
- تنظيف تلقائي للدعوات المنتهية الصلاحية
- تنظيف دوري للبيانات القديمة

### 3. التخزين المؤقت
- تخزين مؤقت لأسئلة الغرفة
- تخزين مؤقت لإحصائيات اللاعبين

## مراقبة النظام

### 1. السجلات
- سجل جميع أحداث اللعبة
- سجل أخطاء النظام
- سجل إحصائيات الأداء

### 2. المقاييس
- عدد الألعاب النشطة
- عدد المستخدمين المتصلين
- متوسط وقت اللعبة

## استكشاف الأخطاء

### 1. مشاكل شائعة
- **الدعوة لا تصل**: تحقق من اتصال WebSocket
- **الغرفة لا تبدأ**: تحقق من صحة معرف الغرفة
- **الأسئلة لا تظهر**: تحقق من وجود أسئلة في الدروس

### 2. أدوات التشخيص
- API للتحقق من حالة النظام
- سجلات مفصلة للأحداث
- أدوات مراقبة الأداء

## التطوير المستقبلي

### 1. ميزات مقترحة
- أنواع ألعاب مختلفة
- نظام تصنيف اللاعبين
- بطولات دورية
- نظام المكافآت

### 2. تحسينات الأداء
- تحسين استعلامات قاعدة البيانات
- تحسين استخدام الذاكرة
- تحسين سرعة الاستجابة

## الدعم الفني

للحصول على الدعم الفني أو الإبلاغ عن مشاكل، يرجى التواصل مع فريق التطوير.


