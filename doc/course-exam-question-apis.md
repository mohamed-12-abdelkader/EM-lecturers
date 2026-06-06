# واجهات إدارة أسئلة امتحان الكورس الشامل

## نظرة عامة
توفر هذه الواجهات التحكم الكامل في أسئلة الامتحان الشامل للكورس: إنشاء الأسئلة (نصية أو بصور متعددة)، تعديلها، حذفها، وتحديد الإجابات الصحيحة. جميع المسارات تتطلب مصادقة `teacher` يملك الكورس (إلا إذا تم التنويه بخلاف ذلك).

> **ملاحظة:** الامتحان الشامل يختلف عن امتحان المحاضرة (`/api/questions/...`). هذا الملف يركز فقط على مسارات الكورس (`/api/course/...`).

---

## 1. إضافة سؤال صورة منفردة

**POST** `/api/course/course-exam/:examId/question-image`  
`Content-Type: multipart/form-data`

| الحقل | النوع | الحالة | الوصف |
|-------|-------|--------|-------|
| `text` | string | اختياري | نص يظهر أعلى الصورة |
| `image` | file | مطلوب | ملف الصورة (png/jpg/webp/gif) — يُرفع تلقائياً على Cloudinary وتعود قيمته كـ `https://res.cloudinary.com/...` |
| `choices` | JSON array | مطلوب | 4 اختيارات مع `text` و `is_correct` |

**Response**
```json
{
  "message": "Question added with image",
  "questionId": 321
}
```

---

## 2. إضافة صور متعددة دفعة واحدة

**POST** `/api/course/course-exam/:examId/questions/images`  
`Content-Type: multipart/form-data`

- يرفع حتى 10 صور في الطلب الواحد.  
- الحقل المقبول للملفات هو `images`.
- يمكن تمرير نصوص مرافقة باستخدام `texts` (JSON array بنفس الترتيب).

| الحقل | النوع | الحالة | الوصف |
|-------|-------|--------|-------|
| `images[]` | file[] | مطلوب | حتى 10 صور (يتم رفعها جميعاً على Cloudinary) |
| `texts` | JSON array | اختياري | نص لكل صورة بنفس الترتيب |

**Response**
```json
{
  "message": "Image questions added",
  "inserted": 3,
  "questionIds": [201, 202, 203]
}
```

> يتم إنشاء اختيارات افتراضية (`A/B/C/D`) لكل سؤال ويمكن تعديلها لاحقاً.

---

## 3. إضافة أسئلة نصية (bulk)

### 3.1 تنسيق موحّد `bulk_text`
**POST** `/api/course/course-exam/:examId/questions/text`

```json
{
  "bulk_text": "You were __________ to escape unharmed.\nA) unfortunately\nB) fortunately\nC) fortunate\nD) unfortunate"
}
```

### 3.2 المسار العام
**POST** `/api/course/course-exam/:examId/bulk-questions`  
يدعم:
- `questions`: مصفوفة JSON تحتوي نص السؤال والاختيارات.
- `bulk_text`: نفس التنسيق أعلاه.

**Response موحّد**
```json
{
  "message": "Text questions added",
  "success": true,
  "inserted": 5
}
```

> عند استخدام `bulk_text` يمكن كتابة الأسئلة المتتالية في سطر واحد مع ترتيب A/B/C/D وسيتم التعرف عليها تلقائياً.

---

## 4. جلب أسئلة الامتحان

### 4.1 للطلاب/المدرس (عرض عام)
**GET** `/api/course/course-exam/:examId/questions`  
يطبق صلاحيات الرؤية (الطلاب يشاهدون فقط إذا كانوا مسجلين في الكورس والامتحان ظاهر).

### 4.2 للمدرس فقط (لوحة الإدارة)
**GET** `/api/course/course-exam/:examId/questions/manage`

```json
{
  "questions": [
    {
      "id": 10,
      "text": "سؤال 1",
      "image": "1704733882000-question.png",
      "choices": [
        { "id": 51, "text": "A", "is_correct": false },
        { "id": 52, "text": "B", "is_correct": true },
        ...
      ]
    }
  ]
}
```

---

## 5. تعديل أو حذف الأسئلة

### 5.1 تعديل سؤال
**PATCH** `/api/course-exam-question/:questionId`  
`Content-Type: multipart/form-data`

- `text` (اختياري)  
- `choices` (اختياري) — إذا أرسلت يتم استبدالها بالكامل  
- `image` (اختياري) — استبدال صورة السؤال

**Response:** `{ "message": "تم تحديث السؤال بنجاح" }`

### 5.2 حذف سؤال
**DELETE** `/api/course/course-exam/question/:questionId`  
يحذف السؤال والاختيارات المرتبطة به.

### 5.3 تحديد الإجابة الصحيحة
**PATCH** `/api/course/course-exam/question/:questionId/correct-answer`

```json
{ "correct_choice_id": 15 }
```

**Response:** `{ "message": "تم تحديث الإجابة الصحيحة بنجاح" }`

---

## 6. نصائح واستخدامات
- استخدم `/questions/images` عند الحاجة لرفع دفعة كبيرة من الصور دفعة واحدة (يدويًا أو من موبايل).
- استخدم `/questions/text` لنسخ الأسئلة النصية الموجودة أصلاً في مستندات خارجية (تنسيق A/B/C/D).
- بعد الإضافة يمكنك تعديل أي سؤال (الصورة أو النص أو الاختيارات) بالمسارات المذكورة في القسم الخامس.
- تحقق دائماً من ملكية الكورس قبل استدعاء أي مسار؛ جميع الاستعلامات تتأكد أن `teacher_id` هو نفس المستخدم.

--- 

