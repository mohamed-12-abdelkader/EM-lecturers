# ملفات PDF للكورس — Course PDF Files

نظام رفع وعرض ملفات **PDF** على مستوى الكورس داخل المنصة.

المدرس يربط كل ملف بكورس محدد. الطالب المصرّح له يفتح الملف **داخل الموقع** عبر PDF Viewer، بدون تبويب خارجي وبدون رابط Cloudinary دائم.

> هذا التوثيق يستبدل السلوك القديم الذي كان يعيد `file_url` عام (Bunny).  
> مكتبة المدرس الخاصة (ملفاتي) منفصلة: [`my-files-api.md`](./my-files-api.md)

---

## الفكرة

كورس مثل «الكيمياء — الصف الثالث الثانوي» يمكن أن يحتوي على:

- مذكرة الشهر الأول.pdf
- مراجعة الوحدة الأولى.pdf
- امتحان شامل.pdf

كل ملف يظهر في صفحة الكورس. الضغط عليه يفتحه داخل المنصة.

---

## الفرق عن الأنظمة الأخرى

| | ملفات PDF للكورس (هذا الـ API) | ملفاتي | ملفات المحاضرة |
|--|-------------------------------|--------|----------------|
| المسار | `/api/courses/:courseId/files` | `/api/teacher/files` | `/api/course/lecture/:lectureId/files` |
| المستوى | الكورس بالكامل | مكتبة المدرس الخاصة | محاضرة واحدة |
| من يشاهد؟ | مدرس الكورس + الطلاب المصرّح لهم | المدرس فقط | حسب المحاضرة |
| النوع | PDF فقط | أنواع متعددة | متنوع |
| رابط التخزين للفرونت | **لا يُرجع** | قد يُرجع روابط عرض | غالباً `file_url` |

---

## Base URL

```txt
https://YOUR_API_DOMAIN/api
```

تطوير محلي:

```txt
http://localhost:8000/api
```

المسارات في الكود: `src/controllers/courseFiles.ts` عبر `src/routes.ts`

هناك مساران متكافئان للكورس (نفس المنطق):

- `/api/courses/:courseId/files` — المسار المفضّل
- `/api/course/:courseId/files` — توافق مع الـ API الحالي للمشروع

---

## المصادقة

كل الطلبات تتطلب توكن:

```http
Authorization: Bearer <ACCESS_TOKEN>
```

لعرض الملف داخل `iframe` يمكن تمرير التوكن في الاستعلام:

```txt
/api/course-files/:fileId/view?access_token=TOKEN
```

لا تضع Cloudinary API Secret أو أي بيانات تخزين في الفرونت.

---

## الصلاحيات

| الدور | رفع | عرض / قائمة | تعديل العنوان | حذف |
|--------|-----|-------------|---------------|-----|
| `teacher` | كورساته فقط | نعم | نعم | نعم |
| `academy` | كورسات الأكاديمية | نعم | نعم | نعم |
| `academy_teacher` | الكورسات المسندة إليه | نعم | نعم | نعم |
| `admin` | نعم | نعم | نعم | نعم |
| `student` | لا | إذا كان مشتركاً أو الكورس مجاني | لا | لا |

قواعد مهمة:

- التحقق كله في الـBackend. إخفاء الأزرار في الفرونت لا يكفي.
- صلاحية الملف تُحسب من `course_id` المخزَّن في قاعدة البيانات، وليس من `courseId` القادم من الفرونت (منع IDOR).
- مدرس لا يستطيع تعديل/حذف ملفات كورس مدرس آخر.
- طالب غير مشترك أو محظور أو منتهي الاشتراك → **403**

رسائل الرفض:

```json
{
  "success": false,
  "message": "ليس لديك صلاحية الوصول إلى هذا الملف"
}
```

| Status | المعنى |
|--------|--------|
| `401` | غير مسجّل دخول / توكن ناقص أو غير صالح |
| `403` | مسجّل لكن لا يملك صلاحية الكورس أو العملية |
| `404` | الكورس أو الملف غير موجود (أو محذوف) |

---

## Endpoints

| Method | Path | الدور | الوصف |
|--------|------|--------|--------|
| `POST` | `/courses/:courseId/files` | مدرس الكورس | رفع PDF |
| `GET` | `/courses/:courseId/files` | مدرس أو طالب مصرّح | قائمة ملفات الكورس |
| `GET` | `/course-files/:fileId` | مدرس أو طالب مصرّح | بيانات ملف واحد |
| `GET` | `/course-files/:fileId/view` | مدرس أو طالب مصرّح | عرض PDF بشكل آمن |
| `PATCH` | `/course-files/:fileId` | مدرس الكورس | تعديل title / description |
| `DELETE` | `/course-files/:fileId` | مدرس الكورس | حذف الملف |

Aliases:

- `PATCH /api/course/:courseId/files/:fileId`
- `DELETE /api/course/:courseId/files/:fileId`
- نفس المسارات تحت `/api/courses/...`

---

## شكل بيانات الملف (Public)

الـAPI **لا يعيد** `file_url` ولا `file_key` ولا روابط Cloudinary.

```json
{
  "id": 12,
  "courseId": 21,
  "teacherId": 5,
  "title": "مراجعة الوحدة الأولى",
  "description": "مراجعة شاملة",
  "originalName": "review.pdf",
  "fileSize": 2450000,
  "mimeType": "application/pdf",
  "createdAt": "2026-08-20T08:00:00.000Z",
  "updatedAt": "2026-08-20T08:00:00.000Z",
  "viewUrl": "/api/course-files/12/view"
}
```

استخدم `viewUrl` فقط داخل PDF Viewer في المنصة.

حقل `files` ما زال موجوداً في قائمة الملفات بجانب `data` حتى لا ينكسر عميل قديم كان يقرأ `files`. المحتوى أصبح الشكل الآمن أعلاه (بدون رابط تخزين).

---

## 1) رفع ملف PDF

`POST /api/courses/:courseId/files`

**Content-Type:** `multipart/form-data`  
**حد الحجم:** من الإعداد `COURSE_PDF_MAX_FILE_SIZE_MB` (افتراضي **50MB**)  
**النوع المسموح:** PDF فقط

### الحقول

| Field | مطلوب | الوصف |
|-------|--------|--------|
| `file` | نعم | ملف PDF في الحقل `file` |
| `title` | نعم | عنوان العرض للطالب |
| `name` | لا | بديل عن `title` |
| `description` | لا | وصف اختياري |

لا يُقبل `file_url` من الفرونت.

### التحقق من الملف

1. الامتداد `.pdf`
2. MIME type (`application/pdf`)
3. توقيع الملف (magic bytes `%PDF-`) عبر `file-type`
4. الحد الأقصى للحجم من الإعداد المركزي

اسم الملف الأصلي يُحفظ في قاعدة البيانات فقط. اسم التخزين عشوائي (`UUID`).

### مثال cURL

```bash
curl -X POST "http://localhost:8000/api/courses/21/files" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -F "title=مراجعة الوحدة الأولى" \
  -F "description=مراجعة شاملة" \
  -F "file=@./review.pdf"
```

### مثال Frontend

```js
const form = new FormData();
form.append('file', selectedFile);
form.append('title', 'مراجعة الوحدة الأولى');
form.append('description', 'مراجعة شاملة');

const res = await fetch(`/api/courses/${courseId}/files`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form, // لا تضع Content-Type يدوياً
});

const json = await res.json();
// json.data.viewUrl → استخدمه في PDF Viewer
```

### Response `201`

```json
{
  "success": true,
  "message": "تم رفع الملف بنجاح",
  "data": {
    "id": 12,
    "courseId": 21,
    "teacherId": 5,
    "title": "مراجعة الوحدة الأولى",
    "description": "مراجعة شاملة",
    "originalName": "review.pdf",
    "fileSize": 2450000,
    "mimeType": "application/pdf",
    "createdAt": "2026-08-20T08:00:00.000Z",
    "updatedAt": "2026-08-20T08:00:00.000Z",
    "viewUrl": "/api/course-files/12/view"
  },
  "file": { }
}
```

`file` نسخة مطابقة من `data` للتوافق مع الرد القديم.

بعد النجاح يُرسل إشعار `file_added` للطلاب المشتركين.

### أخطاء الرفع

| Status | المعنى |
|--------|--------|
| `400` | لا يوجد ملف، أو ليس PDF، أو العنوان فارغ |
| `401` | غير مسجّل |
| `403` | المدرس لا يدير هذا الكورس |
| `404` | الكورس غير موجود |
| `413` | أكبر من الحد المسموح |
| `429` | تجاوز حد الرفع (rate limit) |
| `502` | فشل الرفع إلى التخزين |

---

## 2) قائمة ملفات الكورس

`GET /api/courses/:courseId/files`

- المدرس: يجب أن يدير الكورس.
- الطالب: اشتراك نشط وغير محظور، أو الكورس مجاني (`is_free`).

### Response `200`

```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "courseId": 21,
      "teacherId": 5,
      "title": "مراجعة الوحدة الأولى",
      "description": "مراجعة شاملة",
      "originalName": "review.pdf",
      "fileSize": 2450000,
      "mimeType": "application/pdf",
      "createdAt": "2026-08-20T08:00:00.000Z",
      "updatedAt": "2026-08-20T08:00:00.000Z",
      "viewUrl": "/api/course-files/12/view"
    }
  ],
  "files": []
}
```

الترتيب: الأحدث أولاً. الملفات المحذوفة (soft delete) لا تظهر.

---

## 3) بيانات ملف واحد

`GET /api/course-files/:fileId`

نفس شكل `data` أعلاه بعد التحقق من صلاحية الكورس المرتبط بالملف.

لا تعتمد على `courseId` في الطلب. الـBackend يقرأ الملف ثم يتحقق من كورسه.

---

## 4) عرض PDF بشكل آمن

`GET /api/course-files/:fileId/view`

هذا هو المسار الذي يستخدمه PDF Viewer.

بعد التحقق من:

1. Authentication
2. وجود الملف
3. صلاحية الوصول للكورس المرتبط به

يتم تقديم الملف بأحد أسلوبين:

| الحالة | السلوك |
|--------|--------|
| افتراضي (react-pdf / fetch) | **Streaming** من الـBackend بدون تحميل الملف كاملاً في RAM |
| `iframe` أو `?redirect=1` | تحويل 302 إلى **Signed URL** قصير المدة |
| `?format=json` | JSON فيه `viewUrl` للبروكسي و`signedViewUrl` اختياري ومؤقت |

### Headers مهمة

```http
Content-Type: application/pdf
Content-Disposition: inline; filename*=UTF-8''review.pdf
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

### Rate limit

حد عرض/تحميل مناسب: 180 طلباً / 15 دقيقة لكل عميل.

### لا تفعل

```js
window.open(file.file_url); // لا يوجد file_url
window.open(cloudinaryUrl);
```

---

## 5) تعديل العنوان والوصف

`PATCH /api/course-files/:fileId`

```json
{
  "title": "مراجعة محدّثة",
  "description": "أضيفت أسئلة إضافية"
}
```

يمكن إرسال حقل واحد أو الاثنين. لا يمكن تغيير الملف نفسه من هنا.

### Response `200`

```json
{
  "success": true,
  "message": "تم تحديث الملف بنجاح",
  "data": { }
}
```

---

## 6) حذف ملف

`DELETE /api/course-files/:fileId`

أو `DELETE /api/courses/:courseId/files/:fileId` (يُرفض إذا الملف لا يتبع هذا الكورس).

الترتيب:

1. Soft delete في قاعدة البيانات (`deleted_at`) حتى يختفي فوراً من الواجهة
2. حذف الكائن من Cloudinary / التخزين
3. إذا فشل حذف التخزين: الملف يبقى مخفياً في DB ويُسجَّل الخطأ؛ لا يُعاد للواجهة

### Response `200`

```json
{
  "success": true,
  "message": "تم حذف الملف بنجاح"
}
```

---

## عرض PDF في React

### react-pdf (موصى به)

```tsx
import { Document, Page, pdfjs } from 'react-pdf';

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

<Document
  file={{
    url: `${API_BASE}/course-files/${file.id}/view`,
    httpHeaders: { Authorization: `Bearer ${token}` },
  }}
>
  <Page pageNumber={1} />
</Document>
```

`API_BASE` مثال: `http://localhost:8000/api`

### iframe

```tsx
<iframe
  title={file.title}
  src={`${API_BASE}/course-files/${file.id}/view?access_token=${token}`}
  style={{ width: '100%', height: '80vh', border: 0 }}
/>
```

### قائمة الملفات في صفحة الكورس

```tsx
const { data } = await api.get(`/courses/${courseId}/files`);
const files = data.data;

files.map((file) => (
  <button key={file.id} onClick={() => openViewer(file)}>
    {file.title}
  </button>
));
```

للطالب: استدعِ القائمة بعد تسجيل الدخول. إذا رجع `403` اعرض رسالة أنه غير مصرّح للكورس.

---

## الأمان

| إجراء | التطبيق |
|--------|---------|
| Authentication | `authMiddleware` الحالي |
| Authorization | ملكية/إدارة الكورس + اشتراك الطالب |
| منع IDOR | `course_id` يُقرأ من DB وليس من body |
| PDF فقط | امتداد + MIME + magic bytes |
| حجم أقصى | `COURSE_PDF_MAX_FILE_SIZE_MB` |
| أسماء تخزين | UUID عشوائي |
| اسم أصلي | يُحفظ بعد تنظيف المسارات والرموز الخطرة |
| أسرار التخزين | لا تُرجع للفرونت |
| المسار الحقيقي | لا يُكشف |
| تنفيذ ملفات | غير مسموح؛ PDF خام للعرض فقط |
| Rate limiting | على الرفع وعلى `/view` |

---

## التخزين

يُستخدم نفس طبقة التخزين الموجودة في المشروع (`FileStorageService`):

| `FILE_STORAGE_PROVIDER` | السلوك |
|-------------------------|--------|
| `cloudinary` (افتراضي) | رفع raw، محاولة authenticated، عرض عبر بروكسي أو Signed URL |
| `local` | تخزين على السيرفر، العرض عبر Streaming |
| `s3` | رفع إلى S3 + رابط موقّع |

منطق الصلاحيات لا يتغير عند تبديل المزود.

مجلد Cloudinary الافتراضي: `course-pdfs`

---

## Environment Variables

كلها اختيارية ولها افتراضيات. نفس حساب Cloudinary الحالي كافٍ.

```env
FILE_STORAGE_PROVIDER=cloudinary
COURSE_PDF_MAX_FILE_SIZE_MB=50
COURSE_PDF_SIGNED_URL_TTL_SECONDS=300
COURSE_PDF_STORAGE_FOLDER=course-pdfs

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
CLOUDINARY_URL=
```

لا حاجة لحساب Cloudinary جديد.

إن كان الحساب لا يدعم ملفات `authenticated`، يتم الرفع كـ `upload` مع الإبقاء على البروكسي: الفرونت لا يحصل على الرابط الدائم.

---

## Database

**Migration:** `1777000000000_enhance_course_files_pdf.sql`  
تُطبَّق تلقائياً عند تشغيل السيرفر.

جدول: `course_files`

| Column | الوصف |
|--------|--------|
| `id` | المعرف |
| `course_id` | الكورس (`courses.id`) |
| `teacher_id` / `uploaded_by` | المدرس |
| `title` / `name` | عنوان العرض |
| `description` | وصف اختياري |
| `original_name` | اسم الملف الأصلي (بعد التنظيف) |
| `file_key` | public_id / مفتاح التخزين — داخلي |
| `file_url` | محدد تخزين داخلي — لا يُرجع للفرونت |
| `file_size` | الحجم بالبايت |
| `mime_type` | `application/pdf` |
| `storage_provider` | `cloudinary` / `local` / `s3` |
| `delivery_type` | `authenticated` أو `upload` |
| `upload_status` | حالة الرفع |
| `deleted_at` | soft delete |
| `created_at` / `updated_at` | التواريخ |

العلاقات:

- Course → has many CourseFiles
- CourseFile → belongs to Course و User/Teacher

---

## اختبار سريع

### رفع (مدرس)

```bash
curl -X POST "http://localhost:8000/api/courses/COURSE_ID/files" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -F "title=مراجعة الوحدة الأولى" \
  -F "file=@./review.pdf"
```

المتوقع: `201` و`data.viewUrl` بدون رابط Cloudinary.

ملف `.docx` أو صورة → `400`.  
مدرس كورس آخر → `403`.

### عرض (طالب مشترك)

```bash
curl -H "Authorization: Bearer STUDENT_TOKEN" \
  "http://localhost:8000/api/course-files/FILE_ID/view" \
  -o out.pdf
```

المتوقع: `200` وملف PDF.

طالب غير مشترك → `403`.  
طالب يحاول `POST` أو `DELETE` → `403`.

### تعديل وحذف (مدرس)

```bash
curl -X PATCH "http://localhost:8000/api/course-files/FILE_ID" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"عنوان جديد\"}"

curl -X DELETE "http://localhost:8000/api/course-files/FILE_ID" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

---

## ملفات الكود

| ملف | الدور |
|-----|--------|
| `src/controllers/courseFiles.ts` | Routes + multer + rate limit + view stream |
| `src/services/courseFiles.ts` | صلاحيات، رفع، حذف، تحقق PDF |
| `src/services/courseFiles.serialize.ts` | الشكل العام بدون أسرار تخزين |
| `src/config/courseFiles.ts` | الحجم الأقصى ومجلد التخزين |
| `src/modules/myFiles/services/fileStorage.service.ts` | Cloudinary / S3 / local |
| `migrations/1777000000000_enhance_course_files_pdf.sql` | أعمدة الجدول الجديدة |

لم يُغيَّر نظام Authentication ولا بنية قاعدة البيانات العامة.
