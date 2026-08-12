# Video Playback Settings API

يسمح للمدرس بتحديد طريقة عرض الفيديوهات على منصته:

| الوضع | القيمة | المعنى |
|--------|--------|--------|
| داخل الموقع | `website` | التشغيل العادي في المتصفح/الموقع |
| تطبيق الفيديوهات | `player_app` | حماية المحتوى — الرابط يُخفى من الموقع ويُشغَّل عبر التطبيق فقط |

الإعداد يُحفظ في `tenant_settings.data.video_playback_mode` (على مستوى المنصة).

---

## Teacher APIs

### `GET /api/teacher/video-playback-settings`

يتطلب: `Authorization: Bearer <TEACHER_TOKEN>`

```json
{
  "success": true,
  "data": {
    "video_playback_mode": "website",
    "allow_website_playback": true,
    "player_app_only": false
  },
  "options": [
    {
      "value": "website",
      "label_ar": "عرض داخل الموقع",
      "description_ar": "يشاهد الطالب الفيديو مباشرة من الموقع أو المتصفح."
    },
    {
      "value": "player_app",
      "label_ar": "عرض داخل تطبيق الفيديوهات",
      "description_ar": "لحماية المحتوى: يتم إخفاء رابط الفيديو من الموقع ويُشغَّل فقط عبر تطبيق عرض الفيديوهات."
    }
  ]
}
```

### `PUT /api/teacher/video-playback-settings`

```json
{ "video_playback_mode": "player_app" }
```

Response:

```json
{
  "success": true,
  "message": "تم تفعيل عرض الفيديوهات عبر التطبيق فقط",
  "data": {
    "video_playback_mode": "player_app",
    "allow_website_playback": false,
    "player_app_only": true
  }
}
```

---

## Public API

### `GET /api/tenants/public/:subdomain/video-playback-settings`

بدون تسجيل دخول — للفرونت/التطبيق لمعرفة الوضع الحالي.

```json
{
  "success": true,
  "data": {
    "video_playback_mode": "player_app",
    "allow_website_playback": false,
    "player_app_only": true
  }
}
```

---

## حماية رابط الفيديو

عند `player_app`:

- `GET /api/course/video/:videoId` **لا يُرجع** `video_url` لطلبات الموقع/الطالب العادية.
- تطبيق الفيديوهات يجب أن يرسل أحد الهيدرز:

```http
X-Client-Type: player_app
```

أو:

```http
X-Video-Client: player_app
```

عندها يُرجع الرابط كالمعتاد.

مثال رفض للموقع:

```json
{
  "video_url": null,
  "video_url_hidden": true,
  "video_playback_mode": "player_app",
  "player_app_only": true,
  "message": "هذا الفيديو متاح للتشغيل عبر تطبيق عرض الفيديوهات فقط. افتح التطبيق لمشاهدة المحتوى.",
  "code": "VIDEO_PLAYER_APP_REQUIRED"
}
```

المدرس / الأدمن يحصلون على الرابط دائماً (لإدارة المحتوى).

---

## قيم افتراضية

بدون إعداد صريح: `website` (عرض داخل الموقع).
