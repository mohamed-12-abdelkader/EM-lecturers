# ملفات الكورس — Course Files API

ملفات مرفقة على **مستوى الكورس** (ليست تابعة لمحاضرة معينة).  
المدرس يرفع الملف + الاسم، والطالب المشترك يعرضها ويحمّلها عبر الرابط.

Base path: `/api/course`  
Auth: Bearer Token

---

## نظرة عامة

| Method | Path | الدور | الوصف |
|--------|------|--------|--------|
| `POST` | `/:courseId/files` | مدرس / أكاديمية / مدرس أكاديمية مسند | رفع ملف للكورس |
| `GET` | `/:courseId/files` | طالب مشترك أو مدير الكورس | عرض ملفات الكورس |
| `DELETE` | `/:courseId/files/:fileId` | مدرس / أكاديمية / مدرس أكاديمية مسند | حذف ملف |

**Migration:** `1775700000000_create_course_files.sql`

---

## الصلاحيات

| الدور | رفع / حذف | عرض |
|--------|-----------|------|
| `teacher` | كورساته فقط | نعم |
| `academy` | كورسات الأكاديمية | نعم |
| `academy_teacher` | الكورسات المسندة إليه فقط | نعم |
| `admin` | نعم | نعم |
| `student` | لا | إذا كان مشتركًا في الكورس (أو الكورس مجاني) |

عند رفض الصلاحية: **403**

---

## 1) رفع ملف للكورس

`POST /api/course/:courseId/files`

**Content-Type:** `multipart/form-data`

### الحقول

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `file` | نعم* | الملف المرفوع (حتى 50MB) |
| `name` | نعم | اسم العرض للطالب |
| `filename` | لا | بديل عن `name` |
| `file_url` | بديل عن `file` | رابط جاهز إن لم ترفع ملفًا |

\* إما `file` أو `file_url`

### مثال (cURL)

```bash
curl -X POST "https://api.example.com/api/course/21/files" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@/path/to/notes.pdf" \
  -F "name=ملزمة الباب الأول"
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
    "file_url": "https://res.cloudinary.com/.../notes.pdf",
    "file_size": 245760,
    "file_type": "application/pdf",
    "uploaded_by": 5,
    "created_at": "2026-08-10T10:00:00.000Z",
    "updated_at": "2026-08-10T10:00:00.000Z"
  }
}
```

### أخطاء شائعة

| Status | المعنى |
|--------|--------|
| `400` | اسم الملف ناقص، أو لم يُرسل `file` ولا `file_url` |
| `403` | ليس لديك صلاحية إدارة هذا الكورس |
| `404` | الكورس غير موجود |
| `500` | فشل رفع الملف للتخزين |

بعد الرفع الناجح يُرسل إشعار `file_added` للطلاب المشتركين في الكورس.

### التخزين

- الملف يُحفظ على السيرفر تحت `uploads/course-files/`.
- في قاعدة البيانات يُخزَّن المسار مثل: `/uploads/course-files/course-file-....pdf`
- الـ API يعيد الرابط مطلقًا تلقائيًا عبر middleware الروابط.

---

## 2) عرض ملفات الكورس

`GET /api/course/:courseId/files`

### للطالب

يجب أن يكون مشتركًا في الكورس (enrollment نشط وغير محظور)، أو أن يكون الكورس مجانيًا (`is_free = true`).

### للمدرس / الأكاديمية

يجب أن يملك صلاحية إدارة الكورس.

### Response `200`

```json
{
  "success": true,
  "files": [
    {
      "id": 1,
      "course_id": 21,
      "name": "ملزمة الباب الأول",
      "file_url": "https://res.cloudinary.com/.../notes.pdf",
      "file_size": 245760,
      "file_type": "application/pdf",
      "uploaded_by": 5,
      "created_at": "2026-08-10T10:00:00.000Z",
      "updated_at": "2026-08-10T10:00:00.000Z"
    }
  ]
}
```

الترتيب: الأحدث أولًا.

لعرض الملف للطالب في الواجهة استخدم `file_url` مباشرة (رابط التحميل/المعاينة).

---

## 3) حذف ملف

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
    "file_url": "https://...",
    "file_size": 245760,
    "file_type": "application/pdf",
    "uploaded_by": 5,
    "created_at": "2026-08-10T10:00:00.000Z",
    "updated_at": "2026-08-10T10:00:00.000Z"
  }
}
```

### أخطاء

| Status | المعنى |
|--------|--------|
| `403` | ليس لديك صلاحية |
| `404` | الملف غير موجود أو لا يتبع هذا الكورس |

---

## شكل السجل (Database)

جدول: `course_files`

| Column | Type | الوصف |
|--------|------|--------|
| `id` | serial | المعرف |
| `course_id` | int | الكورس |
| `name` | text | اسم العرض |
| `file_url` | text | رابط الملف المخزَّن |
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
| الرفع | `multipart` + `name` | غالبًا `file_url` + `filename` في JSON |

---

## ملاحظات Frontend

1. عند الرفع استخدم `FormData` وليس JSON.
2. حقل الملف يجب أن يكون اسمه `file`.
3. اعرض قائمة الملفات من `GET` باستخدام `name` كعنوان و`file_url` كرابط فتح/تحميل.
4. للطالب: استدعِ الـ API فقط بعد التأكد من تفعيل الكورس، وإلا ستحصل على `403`.
