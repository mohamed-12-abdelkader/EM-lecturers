# روابط التواصل الاجتماعي لمنصة المدرس

عند **إنشاء** أو **تعديل** منصة مدرس، يمكن حفظ لينكات التواصل التالية على حساب المالك (`users`):

| الحقل | الوصف |
|--------|--------|
| `facebook_url` | لينك بيدج الفيسبوك |
| `instagram_url` | لينك حساب/بيدج الإنستجرام |
| `youtube_url` | لينك قناة اليوتيوب |
| `tiktok_url` | لينك حساب التيك توك |
| `whatsapp_number` | رقم الواتساب (أرقام فقط أو مع كود الدولة) |

---

## إنشاء منصة مدرس

`POST /api/super/tenants`  
Auth: `admin`

### JSON

```json
{
  "subdomain": "omar-mohamed",
  "display_name": "منصة أ. عمر",
  "owner": {
    "name": "عمر محمد",
    "email": "omar@example.com",
    "password": "secret123",
    "description": "مدرس فيزياء",
    "subject": "فيزياء",
    "facebook_url": "https://facebook.com/omar.physics",
    "instagram_url": "https://instagram.com/omar.physics",
    "youtube_url": "https://youtube.com/@omarphysics",
    "tiktok_url": "https://tiktok.com/@omarphysics",
    "whatsapp_number": "201012345678"
  }
}
```

### Multipart (flat fields)

| Field | مثال |
|-------|------|
| `owner_facebook_url` | `https://facebook.com/...` |
| `owner_instagram_url` | `https://instagram.com/...` |
| `owner_youtube_url` | `https://youtube.com/@...` |
| `owner_tiktok_url` | `https://tiktok.com/@...` |
| `owner_whatsapp_number` | `201012345678` |

أو JSON داخل `owner` بنفس شكل الحقول أعلاه.

---

## تعديل منصة مدرس

`PATCH /api/super/tenants/:id`  
Auth: `admin`

```json
{
  "owner": {
    "facebook_url": "https://facebook.com/omar.physics",
    "instagram_url": "https://instagram.com/omar.physics",
    "youtube_url": "https://youtube.com/@omarphysics",
    "tiktok_url": "https://tiktok.com/@omarphysics",
    "whatsapp_number": "201012345678"
  }
}
```

نفس الحقول المسطّحة في multipart: `owner_facebook_url`, `owner_instagram_url`, …

---

## تعديل مدرس مباشرة

| Endpoint | Auth |
|----------|------|
| `PUT /api/teacher/:id` | admin |
| `PUT /api/users/teachers/:id` | admin |
| `PUT /api/admin/teachers/:id` | admin |

Body مثال:

```json
{
  "facebook_url": "https://facebook.com/omar.physics",
  "instagram_url": "https://instagram.com/omar.physics",
  "youtube_url": "https://youtube.com/@omarphysics",
  "tiktok_url": "https://tiktok.com/@omarphysics",
  "whatsapp_number": "201012345678"
}
```

---

## القراءة العامة

تظهر الروابط في:

- `GET /api/tenants/public/:subdomain` → `teacher.facebook_url` … إلخ
- صفحات SEO العامة → `teacher` + `social_links`
- تفاصيل المدرس للطالب

`social_links` مثال:

```json
[
  { "type": "facebook", "url": "https://facebook.com/..." },
  { "type": "instagram", "url": "https://instagram.com/..." },
  { "type": "youtube", "url": "https://youtube.com/@..." },
  { "type": "tiktok", "url": "https://tiktok.com/@..." },
  { "type": "whatsapp", "url": "https://wa.me/201012345678" }
]
```

---

## ملاحظات للفرونت

- كل الحقول اختيارية.
- إرسال `""` أو `null` في التعديل يمسح القيمة (حسب المسار).
- رقم الواتساب يُفضَّل بصيغة دولية بدون `+` أو مسافات في العرض العام (`wa.me`).
- مصدر الحقيقة هو أعمدة `users` وليس `landing.contact`.
