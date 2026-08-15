# رفع ملفات الكورس للمدرس — Course Files API

ملفات مرفقة على **مستوى الكورس** (ليست داخل محاضرة).  
المدرس يرفع الملف + الاسم، والطالب المشترك يعرضه داخل الموقع عبر رابط Bunny CDN.

Base: `/api/course`  
Auth: **Bearer Token**

**Migration:** `1776600000000_create_course_files.sql`

---

## نظرة عامة

| Method | Path | الدور | الوصف |
|--------|------|--------|--------|
| `POST` | `/:courseId/files` | مدرس / أكاديمية / مدرس أكاديمية مسند | رفع ملف للكورس |
| `GET` | `/:courseId/files` | طالب مشترك أو مدير الكورس | قائمة ملفات الكورس |
| `DELETE` | `/:courseId/files/:fileId` | مدرس / أكاديمية / مدرس أكاديمية مسند | حذف ملف |

---

## الصلاحيات

| الدور | رفع / حذف | عرض |
|--------|-----------|------|
| `teacher` | كورساته فقط | نعم |
| `academy` | كورسات الأكاديمية | نعم |
| `academy_teacher` | الكورسات المسندة إليه فقط | نعم |
| `admin` | نعم | نعم |
| `student` | لا | إذا كان مشتركًا (أو الكورس مجاني) |

رفض الصلاحية: **403**

---

## 1) رفع ملف — للمدرس

`POST /api/course/:courseId/files`

**Content-Type:** `multipart/form-data`  
**حد الحجم:** 50MB

### الحقول

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `file` | نعم* | الملف (PDF / صورة / مستند) |
| `name` | نعم | اسم العرض للطالب |
| `filename` | لا | بديل عن `name` |
| `file_url` | بديل عن `file` | رابط جاهز إن لم ترفع ملفًا |

\* إما `file` أو `file_url`

### التخزين

الرفع يحاول بالترتيب:

1. **Bunny CDN** — رابط عام HTTPS للعرض داخل الموقع (iframe / فتح الملف)
2. **محلي** `/uploads/course-files/...` — لو Bunny فشل (يُعرض عبر رابط الـ API)

Cloudinary غير مستخدم هنا لأن الحساب معطّل (`cloud_name is disabled`).

### مثال cURL

```bash
curl -X POST "https://api.example.com/api/course/21/files" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -F "file=@/path/to/notes.pdf" \
  -F "name=ملزمة الباب الأول"
```

### مثال Frontend (FormData)

```js
const form = new FormData();
form.append('file', selectedFile);      // File object
form.append('name', 'ملزمة الباب الأول');

const res = await fetch(`/api/course/${courseId}/files`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form, // لا تضع Content-Type يدويًا
});
```

### Response `201`

```json
{
  "success": true,
  "message": "تم إضافة الملف بنجاح",
  "file": {
    "id": 1,
    "course_id": 21,
    "name": "ملزمة الباب الأول",
    "file_url": "https://cdn.example.com/media/AbCdEfGh123456.pdf",
    "file_size": 245760,
    "file_type": "application/pdf",
    "uploaded_by": 5,
    "created_at": "2026-08-15T10:00:00.000Z",
    "updated_at": "2026-08-15T10:00:00.000Z"
  }
}
```

بعد النجاح يُرسل إشعار `file_added` للطلاب المشتركين.

### أخطاء الرفع

| Status | المعنى |
|--------|--------|
| `400` | `name` ناقص، أو لم يُرسل `file` ولا `file_url`، أو معرف الكورس غير صحيح |
| `403` | المدرس لا يدير هذا الكورس |
| `404` | الكورس غير موجود |
| `413` | الملف أكبر من 50MB |
| `502` | فشل الرفع على Bunny والمحلي معًا |

---

## 2) قائمة الملفات

`GET /api/course/:courseId/files`

- **المدرس:** يجب أن يدير الكورس.
- **الطالب:** يجب أن يكون مشتركًا (enrollment نشط وغير محظور) أو الكورس مجاني.

### Response `200`

```json
{
  "success": true,
  "files": [
    {
      "id": 1,
      "course_id": 21,
      "name": "ملزمة الباب الأول",
      "file_url": "https://cdn.example.com/media/AbCdEfGh123456.pdf",
      "file_size": 245760,
      "file_type": "application/pdf",
      "uploaded_by": 5,
      "created_at": "2026-08-15T10:00:00.000Z",
      "updated_at": "2026-08-15T10:00:00.000Z"
    }
  ]
}
```

الترتيب: الأحدث أولًا.

لعرض الملف داخل الموقع استخدم `file_url` (رابط Bunny عام).

---

## 3) حذف ملف — للمدرس

`DELETE /api/course/:courseId/files/:fileId`

### Response `200`

```json
{
  "success": true,
  "message": "تم حذف الملف",
  "file": {
    "id": 1,
    "course_id": 21,
    "name": "ملزمة الباب الأول",
    "file_url": "https://cdn.example.com/media/...",
    "file_size": 245760,
    "file_type": "application/pdf",
    "uploaded_by": 5,
    "created_at": "2026-08-15T10:00:00.000Z",
    "updated_at": "2026-08-15T10:00:00.000Z"
  }
}
```

| Status | المعنى |
|--------|--------|
| `403` | ليس لديك صلاحية |
| `404` | الملف غير موجود أو لا يتبع هذا الكورس |

---

## Database

جدول: `course_files`

| Column | Type | الوصف |
|--------|------|--------|
| `id` | serial | المعرف |
| `course_id` | int | الكورس |
| `name` | text | اسم العرض |
| `file_url` | text | رابط عام (Bunny أو `/uploads/...`) |
| `file_size` | int? | الحجم بالبايت |
| `file_type` | varchar? | MIME type |
| `uploaded_by` | int? | من رفع الملف |
| `created_at` / `updated_at` | timestamptz | التواريخ |

---

## الفرق عن ملفات المحاضرة

| | ملفات الكورس (هذا الـ API) | ملفات المحاضرة |
|--|---------------------------|----------------|
| المسار | `/api/course/:courseId/files` | `/api/course/lecture/:lectureId/files` |
| المستوى | الكورس بالكامل | محاضرة واحدة |
| الرفع | `multipart` + `name` → Bunny CDN | غالبًا `file_url` + `filename` في JSON |

---

## ملاحظات Frontend للمدرس

1. استخدم `FormData` وليس JSON.
2. اسم حقل الملف يجب أن يكون `file`.
3. اعرض القائمة من `GET` بـ `name` كعنوان و`file_url` كرابط فتح/معاينة داخل الموقع.
4. PDF يمكن عرضه في iframe عبر `file_url`.
5. للطالب: استدعِ `GET` بعد تفعيل/اشتراك الكورس وإلا `403`.
6. استخدم `file_url` كما هو للعرض داخل الموقع (iframe / رابط فتح).
