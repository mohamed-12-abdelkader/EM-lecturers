# مشاركة الشاشة عبر تطبيق Expo الرسمي (EAS Project ID)

## الهدف

منع إصدار `screenShareToken` من المتصفح/عميل غير رسمي. مشاركة الشاشة في الميتنج تتم **فقط** من تطبيق الموبايل المرتبط بـ:

```
EAS Project ID = 5a2cf549-223a-473b-8c3b-d51796713eca
```

## إعداد السيرفر (`.env`)

```env
EAS_PROJECT_ID=5a2cf549-223a-473b-8c3b-d51796713eca
EXPO_APP_SCHEME=emlecturers
```

| متغير | الوصف |
|--------|--------|
| `EAS_PROJECT_ID` | معرّف مشروع EAS للتطبيق الرسمي |
| `EXPO_APP_SCHEME` | scheme الـ deep link بدون `://` |

## الـ API

```http
GET /api/meeting/:id/connection
Authorization: Bearer <TOKEN>
X-EAS-Project-Id: 5a2cf549-223a-473b-8c3b-d51796713eca
```

نفس المنطق على جلسات المجموعات إن وُجد مسار connection مشابه.

### من الويب (بدون هيدر التطبيق)

```json
{
  "participantToken": "...",
  "screenShareToken": null,
  "screenShareApp": {
    "requiresOfficialApp": true,
    "isOfficialApp": false,
    "easProjectId": "5a2cf549-223a-473b-8c3b-d51796713eca",
    "openAppUrl": "emlecturers://meeting/screen-share?meetingId=UUID&easProjectId=5a2cf549-223a-473b-8c3b-d51796713eca&action=screen_share",
    "requiredHeader": "X-EAS-Project-Id"
  },
  "isOwner": true
}
```

→ الويب يفتح `screenShareApp.openAppUrl`.

### من التطبيق الرسمي (مع الهيدر الصحيح)

```json
{
  "participantToken": "...",
  "screenShareToken": "eyJ...",
  "screenShareApp": {
    "requiresOfficialApp": true,
    "isOfficialApp": true,
    "easProjectId": "5a2cf549-223a-473b-8c3b-d51796713eca",
    "openAppUrl": "emlecturers://...",
    "requiredHeader": "X-EAS-Project-Id"
  },
  "isOwner": true
}
```

## تدفق الفرونت

```
1) المدرس يدخل الميتنج من الويب → /connection بدون X-EAS-Project-Id
2) يحصل على participantToken + screenShareToken=null + openAppUrl
3) عند الضغط على «مشاركة الشاشة» → window/location = openAppUrl
4) التطبيق يفتح ويرسل /connection مع:
     Authorization: Bearer ...
     X-EAS-Project-Id: 5a2cf549-223a-473b-8c3b-d51796713eca
5) السيرفر يتحقق أن الـ ID مطابق → يصدر screenShareToken
6) التطبيق يستخدم screenShareToken مع LiveKit لبث الشاشة
```

## هيدرات/Query مقبولة من التطبيق

| المصدر | الاسم |
|--------|--------|
| Header | `X-EAS-Project-Id` (موصى به) |
| Header | `X-Expo-Project-Id` |
| Query | `easProjectId` / `eas_project_id` / `projectId` |

## ملاحظة للتطبيق (Expo)

في `app.json` / `app.config`:

```json
{
  "expo": {
    "scheme": "emlecturers",
    "extra": {
      "eas": {
        "projectId": "5a2cf549-223a-473b-8c3b-d51796713eca"
      }
    }
  }
}
```

عند كل طلب API لمشاركة الشاشة:

```ts
headers: {
  Authorization: `Bearer ${token}`,
  'X-EAS-Project-Id': Constants.easConfig?.projectId
    ?? Constants.expoConfig?.extra?.eas?.projectId,
}
```
