# استيراد أسئلة من PDF لدرس في بنك الأسئلة

## نظرة عامة

نظام **مستقل** لإضافة أسئلة من ملف PDF إلى درس داخل بنك الأسئلة، بدون تعديل أي من أنظمة إضافة الأسئلة الحالية.

- رفع ملف PDF واحد وربطه بدرس محدد.
- تحويل **كل صفحة** في الـ PDF إلى **سؤال مستقل** من نوع صورة (Image-based Question).
- لا يتم استخدام OCR أو استخراج نص؛ كل سؤال = صورة الصفحة فقط.
- نوع السؤال: `image_mcq`، و`correct_answer` يُحدد لاحقاً من الواجهة.

---

## التدفق (Flow)

```
1. المستخدم (مدرس/أدمن) يختار درساً من بنك الأسئلة
2. يرفع ملف PDF واحد عبر POST /api/lesson-pdf-questions/lessons/:lessonId/import-pdf
3. الخادم:
   أ. يتحقق من وجود الدرس وصلاحية المستخدم
   ب. يحوّل كل صفحة في الـ PDF إلى صورة (Buffer) باستخدام pdf-to-img
   ج. يرفع كل صورة إلى Cloudinary ويحصل على رابط
   د. يُدخل لكل صفحة سطراً في جدول lesson_pdf_questions (lesson_id, image_url, correct_answer=null, order_index)
4. الاستجابة تحتوي على عدد الأسئلة المستوردة وقائمة الأسئلة
5. لاحقاً: المدرس يحدد الإجابة الصحيحة لكل سؤال عبر PATCH /pdf-questions/:id/correct-answer
```

---

## قاعدة البيانات

### جدول جديد فقط (بدون تعديل الجداول الحالية)

**الجدول:** `lesson_pdf_questions`

| العمود            | النوع         | الوصف |
|-------------------|---------------|--------|
| id                | SERIAL PK     | المعرّف |
| lesson_id         | INTEGER FK    | مرجع إلى `lessons(id)` |
| image_url         | TEXT NOT NULL | رابط صورة السؤال (Cloudinary) |
| correct_answer    | VARCHAR(1) NULL| أ/ب/ج/د أو A/B/C/D (يُحدد لاحقاً) |
| order_index       | INTEGER       | ترتيب الصفحة (0, 1, 2, ...) |
| source_file_name  | VARCHAR(500)  | اسم ملف الـ PDF الأصلي (اختياري) |
| created_at        | TIMESTAMP     | تاريخ الإنشاء |

**الفهارس:** `lesson_id`، `(lesson_id, order_index)`.

**الملف:** `migrations/1700000009100_create_lesson_pdf_questions.sql`

---

## الـ API

الـ Base path: **`/api/lesson-pdf-questions`**

### 1. استيراد PDF لدرس

**POST** `/lessons/:lessonId/import-pdf`

**الصلاحيات:** `teacher` أو `admin`

**Content-Type:** `multipart/form-data`

**الحقل المطلوب:** `pdf` (ملف واحد بصيغة PDF)

**الاستجابة (201):**
```json
{
  "success": true,
  "message": "تم استيراد 5 سؤال من الملف",
  "data": {
    "imported": 5,
    "questions": [
      {
        "id": 1,
        "lesson_id": 44,
        "image_url": "https://res.cloudinary.com/...",
        "correct_answer": null,
        "order_index": 0,
        "source_file_name": "exam.pdf",
        "created_at": "2025-02-02T..."
      }
    ]
  }
}
```

**أخطاء:** 400 (لا ملف أو ليس PDF)، 403 (لا صلاحية)، 404 (الدرس غير موجود).

---

### 2. جلب أسئلة PDF للدرس

**GET** `/lessons/:lessonId/pdf-questions`

**الصلاحيات:** `teacher` أو `admin` أو `student`

**الاستجابة (200):**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "lesson_id": 44,
      "image_url": "https://...",
      "correct_answer": null,
      "order_index": 0,
      "source_file_name": "exam.pdf",
      "created_at": "2025-02-02T..."
    }
  ]
}
```

---

### 3. تحديد الإجابة الصحيحة لسؤال PDF

**PATCH** `/pdf-questions/:questionId/correct-answer`

**الصلاحيات:** `teacher` أو `admin`

**Body (JSON):**
```json
{
  "correct_answer": "ب"
}
```

القيم المسموحة: `أ`، `ب`، `ج`، `د` أو `A`, `B`, `C`, `D`.

**الاستجابة (200):** نفس شكل عنصر السؤال مع تحديث `correct_answer`.

---

## الملفات المضافة (بدون تعديل الموجود)

| الملف | الوصف |
|--------|--------|
| `migrations/1700000009100_create_lesson_pdf_questions.sql` | إنشاء جدول `lesson_pdf_questions` |
| `src/services/lessonPdfQuestions.ts` | خدمة التحقق، تحويل PDF → صور، رفع، إدراج، وجلب وتحديث الإجابة |
| `src/controllers/lessonPdfQuestions.ts` | رفع PDF، استدعاء الخدمة، endpoints الجلب والتحديث |
| `src/routes.ts` | إضافة `router.use('/lesson-pdf-questions', lessonPdfQuestionsRouter)` |
| `src/utils.ts` | دالة `uploadBufferToCloudinary` لرفع الـ buffer كصورة |
| `package.json` | إضافة dependency: `pdf-to-img` |

---

## التشغيل

1. تشغيل الـ migration لإنشاء الجدول:
   ```bash
   pnpm run migrate up
   ```
   أو تنفيذ ملف الـ migration يدوياً على قاعدة البيانات.

2. تثبيت الحزمة إن لم تكن مثبتة:
   ```bash
   pnpm add pdf-to-img
   ```

3. الأنظمة الحالية (إضافة أسئلة نصية، bulk، صور، question-bank-v2، إلخ) **لا تُعدّل** وتستمر في العمل كما هي.
