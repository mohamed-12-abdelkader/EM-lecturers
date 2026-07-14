# ملفاتي — إضافة روابط Google Drive

## الإضافة (بدل رفع ملف)

```http
POST /api/teacher/files
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

```json
{
  "name": "ملخص الكيمياء",
  "driveUrl": "https://drive.google.com/file/d/FILE_ID/view",
  "description": "اختياري",
  "categoryId": 1,
  "fileExtension": "pdf"
}
```

| الحقل | مطلوب | الوصف |
|-------|--------|--------|
| `name` | نعم | اسم العرض |
| `driveUrl` | نعم | رابط Google Drive |
| `description` | لا | وصف |
| `categoryId` | لا | التصنيف |
| `fileExtension` | لا | الامتداد إن لم يكن في الاسم |

### روابط مدعومة

- `https://drive.google.com/file/d/.../view`
- `https://drive.google.com/open?id=...`
- `https://docs.google.com/document/d/.../edit`
- `https://docs.google.com/spreadsheets/d/.../edit`
- `https://docs.google.com/presentation/d/.../edit`

---

## إضافة عدة روابط

```http
POST /api/teacher/files/bulk-links
```

```json
{
  "categoryId": 1,
  "links": [
    { "name": "ملف 1", "driveUrl": "https://drive.google.com/file/d/.../view" },
    { "name": "ملف 2", "driveUrl": "https://drive.google.com/file/d/.../view" }
  ]
}
```

---

## الاستجابة عند الجلب

كل ملف في القائمة أو التفاصيل يتضمن:

```json
{
  "id": 7,
  "name": "ملخص الكيمياء",
  "sourceType": "drive",
  "driveUrl": "https://drive.google.com/file/d/FILE_ID/view",
  "drivePreviewUrl": "https://drive.google.com/file/d/FILE_ID/preview",
  "driveViewUrl": "https://drive.google.com/file/d/FILE_ID/view",
  "fileUrl": "https://drive.google.com/file/d/FILE_ID/view",
  "storageProvider": "google_drive",
  "viewerComponent": "drive-embed",
  "canPreviewInline": true
}
```

| الحقل | الوصف |
|-------|--------|
| `driveUrl` | رابط الملف على Google Drive |
| `drivePreviewUrl` | للعرض داخل iframe |
| `driveViewUrl` | لفتح الملف في Drive |

---

## العرض

```http
GET /api/teacher/files/:id/embed
```

استخدم `recommendedIframeSrc` أو `drivePreviewUrl` في iframe:

```html
<iframe src="https://drive.google.com/file/d/FILE_ID/preview" width="100%" height="600" />
```

`GET /api/teacher/files/:id/open` يوجّه تلقائياً لمعاينة Drive.

---

## تحديث رابط

```http
PUT /api/teacher/files/:id
```

```json
{
  "name": "اسم جديد",
  "driveUrl": "https://drive.google.com/file/d/NEW_ID/view"
}
```

---

## Migration

```bash
npm run migrate up
```

ملف: `migrations/1774000000000_teacher_files_google_drive.sql`

يضيف `source_type` و `drive_url` لجدول `teacher_files`.

---

## ملاحظات

- الملفات القديمة المرفوعة على Cloudinary تبقى `sourceType: "upload"`.
- تأكد أن الملف على Drive **مشارك** (Anyone with the link) حتى يظهر في iframe.
- رفع الملفات مباشرة (`multipart`) لم يعد هو الطريقة الافتراضية — استخدم `driveUrl`.
