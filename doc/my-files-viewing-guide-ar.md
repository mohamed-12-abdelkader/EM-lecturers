# ملفاتي — دليل عرض الملفات وقراءة المحتوى

دليل منفصل يشرح **كيف ترجع الملفات من الـ API** و**كيف تفتحها وتشوف محتواها** في الواجهة (Frontend).

> للتوثيق الكامل (رفع، حذف، تصنيفات، قيود): راجع [`my-files-api.md`](./my-files-api.md)

---

## Base URL

```txt
http://localhost:8000/api/teacher
```

كل المسارات أدناه تبدأ بـ `/files`.

---

## المصادقة

```http
Authorization: Bearer <ACCESS_TOKEN>
```

| الدور | الصلاحية |
|-------|----------|
| `teacher` | ملفاته فقط |
| `admin` | يمكن إضافة `?teacher_id=5` |

---

## 1) كيف ترجع الملفات من الـ API؟

بعد **الرفع** أو عند **جلب قائمة** أو **ملف واحد**، كل ملف يُرجَع بنفس الشكل تقريباً عبر `serializeFile`.

### مثال — بعد الرفع أو `GET /files/:id`

```json
{
  "success": true,
  "data": {
    "id": 12,
    "teacherId": 5,
    "name": "ملخص الكيمياء",
    "description": "الفصل الأول",
    "fileUrl": "https://res.cloudinary.com/.../media/uuid.pdf",
    "fileKey": "media/uuid",
    "storageProvider": "cloudinary",
    "fileSize": 2516582,
    "fileSizeLabel": "2.4 MB",
    "fileExtension": "pdf",
    "mimeType": "application/pdf",
    "categoryId": 3,
    "categoryName": "كيمياء",
    "downloadsCount": 0,
    "previewType": "pdf",
    "icon": "pdf",
    "viewerComponent": "pdf-viewer",
    "canPreviewInline": true,
    "viewUrl": "/api/teacher/files/12/view",
    "openUrl": "/api/teacher/files/12/view",
    "contentUrl": "/api/teacher/files/12/content",
    "downloadUrl": "/api/teacher/files/12/download",
    "absoluteViewUrl": "http://localhost:8000/api/teacher/files/12/view",
    "absoluteContentUrl": "http://localhost:8000/api/teacher/files/12/content",
    "absoluteDownloadUrl": "http://localhost:8000/api/teacher/files/12/download",
    "createdAt": "2026-03-15T10:00:00.000Z",
    "updatedAt": "2026-03-15T10:00:00.000Z"
  }
}
```

### مثال — `GET /files` (قائمة)

```json
{
  "success": true,
  "data": {
    "items": [ { "... نفس حقول الملف أعلاه ..." } ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 45,
      "totalPages": 3
    }
  }
}
```

---

## 2) شرح الحقول المهمة للعرض

| الحقل | المعنى | ماذا تفعل به في الواجهة |
|-------|--------|---------------------------|
| `id` | معرف الملف | تستخدمه في كل مسارات `/files/:id/...` |
| `previewType` | نوع العرض | يحدد **كيف** تفتح الملف (انظر الجدول التالي) |
| `canPreviewInline` | هل يُعرض داخل الموقع؟ | `true` → iframe/img؛ `false` → تحميل فقط |
| `viewerComponent` | مكوّن الواجهة المقترح | `pdf-viewer` \| `image-viewer` \| `download-only` |
| `viewUrl` / `openUrl` | مسار العرض النسبي | للطلب من نفس الدومين مع `Authorization` |
| `absoluteViewUrl` | رابط العرض الكامل | للـ iframe مع `access_token` في الاستعلام |
| `contentUrl` | مسار استخراج النص | لملفات PDF فقط |
| `downloadUrl` | مسار التحميل | يرجع JSON فيه `downloadUrl` موقّع/مباشر |
| `fileUrl` | رابط التخزين الخام | **لا تستخدمه مباشرة** للعرض — استخدم `viewUrl` |
| `storageProvider` | أين محفوظ الملف | `cloudinary` \| `local` \| `s3` |

### قيم `previewType`

| القيمة | أنواع الملفات | العرض داخل الموقع | استخراج نص |
|--------|---------------|-------------------|------------|
| `pdf` | PDF | ✅ iframe / embed | ✅ عبر `/content` |
| `image` | jpg, png, webp | ✅ `<img>` | ❌ |
| `none` | doc, docx, xls, ppt, zip… | ❌ | ❌ — حمّل الملف |

---

## 3) أي مسار أستخدم لإيه؟

```
┌─────────────────────────────────────────────────────────────┐
│  عايز أبني شاشة عرض كاملة؟                                  │
│  → GET /files/:id/preview?includeText=true                  │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   previewType=pdf      previewType=image    previewType=none
          │                   │                   │
          ▼                   ▼                   ▼
   GET /view أو /open    GET /view أو /open    GET /download
   + GET /content        (صورة مباشرة)         (رابط تحميل)
   (نص PDF)
```

| الهدف | المسار | نوع الاستجابة |
|-------|--------|----------------|
| **رابط عرض جاهز (موصى به)** | `GET /files/:id/embed` | JSON فيه `recommendedIframeSrc` |
| بيانات جاهزة للواجهة + أزرار | `GET /files/:id/preview` | JSON |
| فتح الملف (iframe → redirect لـ CDN) | `GET /files/:id/open` | binary أو redirect |
| قراءة نص PDF | `GET /files/:id/content` | JSON فيه `content.text` |
| تحميل أي نوع | `GET /files/:id/download` | JSON فيه `downloadUrl` |

> `/open` داخل **iframe** يوجّه تلقائياً لرابط Cloudinary الموقّع (يعرض PDF أسرع).
> مع **fetch** يرجع الملف binary — استخدم `blob()` ثم `URL.createObjectURL`.

### `GET /files/:id/embed` — للفرونت

```http
GET /api/teacher/files/7/embed
Authorization: Bearer <TOKEN>
```

استخدم `data.recommendedIframeSrc` مباشرة في `<iframe src={...} />`.

```jsx
const res = await fetch(`${API}/teacher/files/${id}/embed`, {
  headers: { Authorization: `Bearer ${token}` },
});
const { recommendedIframeSrc } = (await res.json()).data;
// <iframe src={recommendedIframeSrc} style={{ width: '100%', height: '80vh' }} />
```

---

## 4) `GET /files/:id/preview` — الأنسب لبناء صفحة العرض

```http
GET /api/teacher/files/12/preview?includeText=true
Authorization: Bearer <TOKEN>
```

| Query | الافتراضي | الوصف |
|-------|-----------|--------|
| `includeText` | `false` | لو `true` وملف PDF → يستخرج النص في نفس الرد |

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "file": { "id": 12, "name": "ملخص الكيمياء", "previewType": "pdf", "...": "..." },
    "preview": {
      "type": "pdf",
      "mode": "inline",
      "viewerComponent": "pdf-viewer",
      "canPreviewInline": true,
      "canExtractText": true,
      "requiresAuthHeader": true,
      "iframeSupported": true
    },
    "display": {
      "icon": "pdf",
      "extensionLabel": "PDF",
      "fileSizeLabel": "2.4 MB",
      "badgeColor": "red"
    },
    "urls": {
      "view": "http://localhost:8000/api/teacher/files/12/view",
      "open": "http://localhost:8000/api/teacher/files/12/view",
      "content": "http://localhost:8000/api/teacher/files/12/content",
      "download": "http://localhost:8000/api/teacher/files/12/download"
    },
    "actions": {
      "primary": { "type": "view", "label": "عرض الملف", "url": "..." },
      "secondary": { "type": "content", "label": "قراءة النص", "url": "..." }
    },
    "content": {
      "text": "الفصل الأول...",
      "paragraphs": ["فقرة 1", "فقرة 2"],
      "pageCount": 8,
      "characterCount": 4200,
      "truncated": false,
      "supported": true
    }
  }
}
```

**استخدمه عندما:** تبني صفحة تفاصيل ملف وتريد كل شيء جاهز (أيقونة، حجم، أزرار، نص اختياري).

---

## 5) `GET /files/:id/open` — فتح الملف مباشرة

```http
GET /api/teacher/files/12/open
Authorization: Bearer <TOKEN>
```

- يرجع **جسم الملف** (bytes) وليس JSON
- `Content-Type`: حسب نوع الملف (`application/pdf`, `image/jpeg`, …)
- `Content-Disposition: inline` — المتصفح يعرضه بدل ما يحمّله
- **لا يزيد** `downloadsCount` (عكس `/download`)

### طريقة 1 — iframe (PDF) مع توكن في الاستعلام

مفيد لأن `<iframe>` لا يرسل `Authorization` header تلقائياً:

```http
GET /api/teacher/files/12/open?access_token=YOUR_JWT
```

```jsx
<iframe
  title="عرض الملف"
  src={`${API_BASE}/teacher/files/${fileId}/open?access_token=${token}`}
  style={{ width: '100%', height: '80vh', border: 0 }}
/>
```

### طريقة 2 — fetch + Blob (أأمن — التوكن في Header)

```javascript
const API_BASE = 'http://localhost:8000/api';

async function openFileBlob(fileId, token) {
  const res = await fetch(`${API_BASE}/teacher/files/${fileId}/open`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('فشل فتح الملف');
  return URL.createObjectURL(await res.blob());
}

// PDF في iframe
const pdfUrl = await openFileBlob(12, token);
// <iframe src={pdfUrl} />

// صورة
const imgUrl = await openFileBlob(12, token);
// <img src={imgUrl} alt="ملف" />
```

### طريقة 3 — صورة مباشرة (إن كان الـ proxy يمرّر الهيدر)

```jsx
// يعمل فقط إذا الطلبات تمر عبر نفس الدومين مع cookies/header
<img src={`${API_BASE}/teacher/files/${fileId}/open`} alt={file.name} />
```

**Response `415`** — نوع لا يُعرض في المتصفح:

```json
{
  "success": false,
  "message": "لا يمكن عرض هذا النوع داخل الموقع. استخدم التحميل.",
  "data": { "preview": { "type": "none", "viewerComponent": "download-only" } }
}
```

---

## 6) `GET /files/:id/content` — قراءة محتوى PDF كنص

```http
GET /api/teacher/files/12/content
Authorization: Bearer <TOKEN>
```

**Response `200`:**

```json
{
  "success": true,
  "data": {
    "file": { "id": 12, "name": "ملخص الكيمياء", "previewType": "pdf" },
    "previewType": "pdf",
    "viewUrl": "/api/teacher/files/12/view",
    "contentUrl": "/api/teacher/files/12/content",
    "canPreviewInline": true,
    "content": {
      "text": "الفصل الأول\nمقدمة في الكيمياء العضوية...",
      "paragraphs": ["الفصل الأول مقدمة...", "التعريفات الأساسية..."],
      "pageCount": 8,
      "characterCount": 4521,
      "truncated": false,
      "supported": true
    }
  }
}
```

| حقل `content` | الوصف |
|---------------|--------|
| `text` | النص الكامل (أو مقطوع عند 200,000 حرف) |
| `paragraphs` | نفس النص مقسّم فقرات جاهز للعرض |
| `pageCount` | عدد صفحات PDF |
| `truncated` | `true` لو النص أطول من الحد |
| `supported` | `false` لغير PDF |

**للصور:**

```json
{
  "content": {
    "text": null,
    "supported": false,
    "message": "الصور تُعرض عبر مسار العرض وليس كنص مستخرج"
  }
}
```

**مثال React — تبويبان (عرض + نص):**

```jsx
function FileViewer({ fileId, token }) {
  const [tab, setTab] = useState('view'); // 'view' | 'text'
  const [text, setText] = useState('');

  useEffect(() => {
    if (tab !== 'text') return;
    fetch(`/api/teacher/files/${fileId}/content`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((j) => setText(j.data?.content?.text || ''));
  }, [tab, fileId, token]);

  return (
    <div>
      <button onClick={() => setTab('view')}>عرض</button>
      <button onClick={() => setTab('text')}>قراءة النص</button>
      {tab === 'view' ? (
        <iframe
          src={`/api/teacher/files/${fileId}/open?access_token=${token}`}
          style={{ width: '100%', height: '70vh' }}
        />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
      )}
    </div>
  );
}
```

---

## 7) `GET /files/:id/download` — تحميل (كل الأنواع)

```http
GET /api/teacher/files/12/download
Authorization: Bearer <TOKEN>
```

```json
{
  "success": true,
  "data": {
    "downloadUrl": "https://res.cloudinary.com/.../file.pdf",
    "fileName": "ملخص الكيمياء",
    "mimeType": "application/pdf",
    "downloadsCount": 3
  }
}
```

استخدمه لـ **docx, xlsx, ppt, zip** أو عندما `previewType === 'none'`.

```javascript
const { data } = await fetch(`/api/teacher/files/${id}/download`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());

window.open(data.downloadUrl, '_blank');
```

---

## 8) سيناريو كامل — من القائمة للعرض

### الخطوة 1: جلب القائمة

```http
GET /api/teacher/files?page=1&limit=20
```

### الخطوة 2: لكل عنصر في `items` — اعرض بطاقة

```javascript
function FileCard({ file, token }) {
  const openPreview = () => {
  if (!file.canPreviewInline) {
    // حمّل الملف
    window.location.href = `${API}/teacher/files/${file.id}/download`;
    return;
  }
  // افتح صفحة عرض
  router.push(`/teacher/files/${file.id}`);
};
```

### الخطوة 3: صفحة التفاصيل

```http
GET /api/teacher/files/12/preview?includeText=true
```

- لو `preview.viewerComponent === 'pdf-viewer'` → iframe على `/open`
- لو `image-viewer` → `<img>` من blob أو `/open`
- لو `download-only` → زر تحميل من `/download`
- لو PDF → تبويب "قراءة النص" من `data.content.paragraphs`

---

## 9) ملاحظات مهمة

1. **`fileUrl` ≠ رابط العرض**  
   `fileUrl` هو مكان التخزين (Cloudinary/S3/محلي). للعرض الآمن استخدم دائماً `/open` أو `/view`.

2. **التوكن في iframe**  
   المتصفح لا يرسل `Authorization` داخل iframe — استخدم `?access_token=` أو fetch+blob.

3. **CORS**  
   لو الفرونت على `localhost:3000` والـ API على `localhost:8000`، تأكد من `CORS_ORIGIN` في `.env`.

4. **الحد الأقصى لاستخراج النص**  
   PDF: 200,000 حرف — بعدها `truncated: true`.

5. **أنواع غير مدعومة للعرض المباشر**  
   Word, Excel, PowerPoint, ZIP → `/download` فقط.

---

## 10) ملخص سريع

| نوع الملف | افتحه كده | اقرأ المحتوى كده |
|-----------|-----------|------------------|
| PDF | `GET /files/:id/open` في iframe | `GET /files/:id/content` |
| صورة | `GET /files/:id/open` في `<img>` | العرض بصري فقط |
| Word / Excel / PPT | `GET /files/:id/download` | غير متاح حالياً |
| أي ملف — بيانات UI | `GET /files/:id/preview` | `includeText=true` للـ PDF |

---

## مرجع المسارات

```http
GET /api/teacher/files              → قائمة (كل ملف فيها روابط العرض)
GET /api/teacher/files/:id          → ملف واحد + روابط
GET /api/teacher/files/:id/preview  → JSON كامل لبناء شاشة العرض
GET /api/teacher/files/:id/open     → فتح الملف (binary)
GET /api/teacher/files/:id/view     → نفس /open
GET /api/teacher/files/:id/content  → نص PDF
GET /api/teacher/files/:id/download → رابط تحميل
```
