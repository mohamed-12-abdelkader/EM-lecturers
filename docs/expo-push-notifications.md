# نظام Expo Push Notifications (الموبايل)

نظام إرسال إشعارات Push لتطبيق الموبايل عبر **Expo Push Notifications**، بجانب نظام الإشعارات الحالي دون استبداله أو التأثير على APIs الويب.

---

## 1. تخزين Expo Push Token

### API: تسجيل/تحديث التوكن

```
POST /api/notifications/push-token
Authorization: Bearer <token>
Content-Type: application/json
```

**الصلاحية:** أي مستخدم مسجل (student, teacher, admin).

**Body:**

| الحقل      | النوع   | مطلوب | الوصف |
|------------|--------|--------|--------|
| token      | string | نعم   | Expo Push Token (مثل `ExponentPushToken[xxxxx]`) |
| device_id  | string | لا    | معرف الجهاز (اختياري، لتحديث توكن نفس الجهاز) |

**مثال:**

```json
{
  "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
  "device_id": "device-uuid-optional"
}
```

**الاستجابة (200):**

```json
{
  "message": "Push token saved successfully"
}
```

**أخطاء:** `400` عند token فارغ أو بصيغة غير صالحة.

- إذا أرسل المستخدم نفس الـ token مرة أخرى، يتم تحديث `updated_at` فقط.
- إذا أرسل token جديد (جهاز آخر)، يُضاف سطر جديد؛ يمكن للمستخدم أن يملك أكثر من توكن (أكثر من جهاز).

---

## 2. خدمة الإرسال (Backend)

الخدمة الموحدة في **`src/services/expoPushService.ts`**:

- **`sendPushNotification(userId, title, body, data?)`**  
  إرسال إشعار لمستخدم واحد (يُجلب توكناته من DB ثم الإرسال عبر Expo).

- **`sendPushNotificationToMany(userIds, title, body, data?)`**  
  إرسال إشعار لعدة مستخدمين (مناسب للإرسال الجماعي).

- **معالجة الأخطاء:** التوكنات غير الصالحة (مثل `DeviceNotRegistered`) تُسجّل في الـ log ويتم حذفها من قاعدة البيانات تلقائياً.

- **Logs:** في حال فشل الإرسال يُسجّل في الـ console مع البادئة `[ExpoPush]`.

---

## 3. الربط مع نظام الإشعارات الحالي

- بعد **حفظ الإشعار في قاعدة البيانات** في أي مكان (من `NotificationService` أو من الـ controllers)، يتم استدعاء **Expo Push** بشكل إضافي.
- **لم يتم تعديل** منطق الـ APIs الحالية ولا طريقة جلب الإشعارات من DB للويب.
- الإشعارات تُقرأ كما هي من جدول `notifications`؛ Push للموبايل إضافة فقط.

---

## 4. متغير البيئة (اختياري)

```
EXPO_ACCESS_TOKEN=<your-expo-access-token>
```

إذا كان الإرسال يتطلب مصادقة (Push Notifications مع Expo الحسابي)، ضع التوكن في `.env`. إن لم يُضبط، يعمل الـ client بدون access token (مناسب للتطوير).

---

## 5. إشعارات الرسائل الموحّدة (متوافقة مع Expo Push)

**API:** `GET /api/notifications/messages`

**الصلاحية:** طالب أو مدرس فقط.

**الاستخدام:** يجمع كل إشعارات الرسائل في مكان واحد:
- **دعم فني:** رسائل الشات من الأدمن/البوت (طالب أو مدرس).
- **دردشة مباشرة:** رسائل بين الطالب والمدرس.
- **جروب:** رسائل في مجموعات الكورس/الصف.

**Query:** `limit` (اختياري، افتراضي 30)، `offset` (اختياري، افتراضي 0).

**شكل كل عنصر (متوافق مع بيانات Expo Push):**

| الحقل | الوصف |
|--------|--------|
| id | معرف فريد (مثل `support_student_1_5` أو `chat_12`) |
| type | `student_support` \| `teacher_support` \| `chat_message` |
| title | عنوان الإشعار |
| body | نص الرسالة أو معاينة |
| sender_name | اسم المرسل |
| created_at | تاريخ الإنشاء |
| unread_count | عدد غير المقروء (للدردشة) |
| data | **مطابق لـ payload الـ Expo:** `type`, `chat_id` أو `group_id`, `message_id`, `sender_id` — لاستخدامه في Deep Link عند فتح الإشعار |

- للدعم الفني: `data.type` = `student_support_chat` أو `teacher_support_chat`، و`data.chat_id`, `data.message_id`.
- للدردشة/الجروب: `data.type` = `group_message`، و`data.group_id`, `data.sender_id` (مطابق لـ Push المرسل عند رسالة جديدة في الجروب أو الدردشة المباشرة).

**مثال على شكل الريسبونس بعد التعديل:**

```json
{
  "notifications": [
    {
      "id": "support_student_1_42",
      "type": "student_support",
      "title": "دعم فني",
      "body": "تم حل مشكلتك. لو عندك أي استفسار اكتب هنا.",
      "sender_name": "رد تلقائي",
      "created_at": "2026-02-06T14:00:00.000Z",
      "unread_count": 0,
      "is_unread": false,
      "is_read": true,
      "read_at": "2026-02-06T14:05:00.000Z",
      "data": {
        "type": "student_support_chat",
        "chat_id": 1,
        "message_id": 42,
        "sender_id": 2
      },
      "chat_id": 1,
      "message_id": 42
    },
    {
      "id": "chat_12",
      "type": "chat_message",
      "title": "لديك 2 رسالة من أحمد",
      "body": "ممكن توضح سؤال رقم ٣؟",
      "sender_name": "أحمد",
      "created_at": "2026-02-06T13:50:00.000Z",
      "unread_count": 2,
      "is_unread": true,
      "is_read": false,
      "read_at": null,
      "data": {
        "type": "group_message",
        "group_id": 12,
        "sender_id": 10,
        "message_id": 99
      },
      "chat_group_id": 12,
      "chat_type": "direct",
      "group_name": "محادثة مع أحمد"
    }
  ],
  "pagination": {
    "limit": 30,
    "offset": 0,
    "total": 2,
    "has_more": false
  }
}
```

### Real-Time (Socket.IO)

عند وصول أي رسالة جديدة (دعم فني للطالب/المدرس، أو رسالة في دردشة/جروب)، يُبث للمستخدم حدث:

- **اسم الحدث:** `notifications:message`
- **الغرفة:** كل مستخدم متصل يكون في غرفة `user:${userId}` (يتم الانضمام تلقائياً عند الاتصال).
- **الشكل:** `{ notification: <عنصر واحد بنفس شكل عناصر GET /api/notifications/messages> }`

العميل يمكنه الاستماع لـ `notifications:message` وإضافة العنصر الجديد لقائمة الإشعارات أو تحديث العنصر إذا كان نفس الـ `id` (مثلاً نفس الشات/الجروب).

---

## 6. التبعيات

- **expo-server-sdk** (في `package.json`).
- تشغيل الـ migration لإنشاء جدول **`expo_push_tokens`**:

```bash
pnpm run migrate up
```

---

## 7. ملخص

| العنصر | الوصف |
|--------|--------|
| جدول DB | `expo_push_tokens` (user_id, token, device_id, created_at, updated_at) |
| API توكن | `POST /api/notifications/push-token` |
| API إشعارات رسائل | `GET /api/notifications/messages` (طالب/مدرس — دعم فني + دردشة + جروب، بتنسيق Expo) |
| خدمة الإرسال | `expoPushService.sendPushNotification` / `sendPushNotificationToMany` |
| الربط | يتم استدعاء Expo Push بعد كل إنشاء إشعار في النظام (بدون تغيير سلوك الويب) |
