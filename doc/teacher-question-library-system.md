# نظام مكتبة أسئلة المدرّس — التوثيق الكامل

> **Base URL:** `/api/teacher/questions`  
> **Controller:** `src/controllers/teacherQuestions.ts`  
> **Migration الحالية:** `migrations/1772300000000_teacher_questions_flat_lessons.sql`

---

## 1. نظرة عامة

مكتبة أسئلة المدرّس هي **مكتبة خاصة** لكل مدرّس لحفظ وإدارة أسئلته خارج بنك الأسئلة العام للمنصة. كل مدرّس يرى ويعدّل مكتبته فقط.

### الهيكل الحالي

```
مكتبة المدرّس (teacher_id)
  └── دروس (teacher_question_lessons)
        ├── أسئلة مستقلة (teacher_questions) — passage_id = null
        └── قطع قراءة (teacher_question_passages) — اختياري
              └── أسئلة مرتبطة بالقطعة (teacher_questions) — passage_id = id القطعة
```

### ما الذي تغيّر؟

| النظام القديم | النظام الحالي |
|---------------|---------------|
| فصول → دروس → أجزاء → أسئلة | **دروس → أسئلة** مباشرة |
| `chapter_id`, `part_id` | `teacher_id`, `lesson_id` |
| جداول `teacher_question_chapters`, `teacher_question_parts` | **محذوفة** |

> **ملاحظة:** بنك الأسئلة العام للمنصة (`/api/question-bank-v2`) نظام منفصل تمامًا (بنوك → مواد → فصول → دروس). هذا الملف يخص **مكتبة المدرّس الخاصة** فقط.

---

## 2. مخطط العلاقات

```mermaid
erDiagram
    users ||--o{ teacher_question_lessons : owns
    teacher_question_lessons ||--o{ teacher_questions : contains
    teacher_question_lessons ||--o{ teacher_question_passages : contains
    teacher_question_passages ||--o{ teacher_questions : links

    users {
        int id PK
    }
    teacher_question_lessons {
        int id PK
        int teacher_id FK
        text title
        timestamp created_at
    }
    teacher_question_passages {
        int id PK
        int lesson_id FK
        text title
        text content
        int order_index
    }
    teacher_questions {
        int id PK
        int lesson_id FK
        int passage_id FK_nullable
        text question_text
        text question_type
        jsonb choices
        text answer
        text image_url
        int correct_answer_index
        text explanation
        text difficulty_level
        int points
    }
```

---

## 3. قاعدة البيانات

### 3.1 `teacher_question_lessons`

| العمود | النوع | الوصف |
|--------|-------|-------|
| `id` | SERIAL PK | معرف الدرس |
| `teacher_id` | INTEGER FK → `users(id)` | مالك المكتبة |
| `title` | TEXT | عنوان الدرس |
| `created_at` | TIMESTAMP | تاريخ الإنشاء |

**Cascade:** حذف المدرّس → حذف دروسه. حذف الدرس → حذف أسئله وقطعه.

**Index:** `idx_teacher_question_lessons_teacher_id`

---

### 3.2 `teacher_question_passages`

قطع قراءة (نص + أسئلة مرتبطة). **اختيارية** — ليست كل الدروس تحتاج قطعًا.

| العمود | النوع | الوصف |
|--------|-------|-------|
| `id` | SERIAL PK | معرف القطعة |
| `lesson_id` | INTEGER FK → `teacher_question_lessons(id)` | الدرس التابع له |
| `title` | TEXT (nullable) | عنوان القطعة |
| `content` | TEXT | نص القطعة (مطلوب) |
| `order_index` | INTEGER | ترتيب العرض (افتراضي 0) |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | يُحدَّث تلقائيًا عبر trigger |

**Index:** `idx_teacher_question_passages_lesson_id`

---

### 3.3 `teacher_questions`

| العمود | النوع | الوصف |
|--------|-------|-------|
| `id` | SERIAL PK | معرف السؤال |
| `lesson_id` | INTEGER FK → `teacher_question_lessons(id)` | الدرس (مطلوب) |
| `passage_id` | INTEGER FK → `teacher_question_passages(id)` ON DELETE SET NULL | القطعة (اختياري) |
| `question_text` | TEXT | نص السؤال |
| `question_type` | TEXT | `choice` أو `text` |
| `choices` | JSONB | مصفوفة اختيارات (للسؤال الاختياري) |
| `answer` | TEXT | الإجابة النصية أو نص الإجابة الصحيحة |
| `image_url` | TEXT | رابط صورة السؤال (اختياري) |
| `correct_answer_index` | INTEGER | فهرس الإجابة الصحيحة (0-based) |
| `explanation` | TEXT | شرح الإجابة |
| `difficulty_level` | TEXT | `easy` / `medium` / `hard` (افتراضي `medium`) |
| `points` | INTEGER | الدرجة (افتراضي 1) |
| `created_at` | TIMESTAMP | |

**Index:** `idx_teacher_questions_lesson_id`, `idx_teacher_questions_passage_id`

---

## 4. المصادقة والصلاحيات

| Endpoint | المصادقة | الدور |
|----------|----------|-------|
| كل المسارات ما عدا `public/*` | Bearer Token مطلوب | `teacher` |
| `GET /public/questions/:lesson_id` | **بدون** مصادقة | عام |

### قواعد الملكية

- كل عملية CRUD تتحقق أن `lesson.teacher_id === req.user.id`
- عند ربط سؤال بـ `passage_id`: يجب أن تكون القطعة داخل **نفس الدرس** ونفس المدرّس
- المدرّس **لا يرى** ولا يعدّل مكتبة مدرّس آخر

---

## 5. قائمة الـ Endpoints

| Method | Path | الوظيفة |
|--------|------|---------|
| **الدروس** | | |
| POST | `/lesson` | إنشاء درس |
| PUT | `/lesson/:id` | تعديل عنوان درس |
| DELETE | `/lesson/:id` | حذف درس (+ cascade) |
| GET | `/lessons` | قائمة دروس المدرّس + `questions_count` |
| **القطع** | | |
| POST | `/passage` | إنشاء قطعة + أسئلة مرتبطة |
| GET | `/passages/:lesson_id` | قطع درس مع أسئلتها |
| GET | `/passage/:id` | تفاصيل قطعة واحدة |
| **الأسئلة** | | |
| POST | `/question` | إضافة سؤال |
| PUT | `/question/:id` | تعديل سؤال |
| DELETE | `/question/:id` | حذف سؤال |
| GET | `/questions/:lesson_id` | كل أسئلة الدرس |
| POST | `/bulk` | إضافة أسئلة اختيارية دفعة واحدة |
| **عام** | | |
| GET | `/tree` | الشجرة الكاملة للمكتبة |
| GET | `/public/questions/:lesson_id` | أسئلة درس (بدون auth) |

---

## 6. تفاصيل الـ API

### 6.1 الدروس

#### إنشاء درس
```http
POST /api/teacher/questions/lesson
Authorization: Bearer {token}
Content-Type: application/json

{ "title": "الدرس الأول — الكهرباء" }
```

**Response `201`:**
```json
{
  "lesson": {
    "id": 1,
    "teacher_id": 5,
    "title": "الدرس الأول — الكهرباء",
    "created_at": "2026-06-16T10:00:00.000Z"
  }
}
```

#### قائمة الدروس
```http
GET /api/teacher/questions/lessons
Authorization: Bearer {token}
```

**Response `200`:**
```json
{
  "lessons": [
    {
      "id": 1,
      "teacher_id": 5,
      "title": "الدرس الأول — الكهرباء",
      "created_at": "2026-06-16T10:00:00.000Z",
      "questions_count": 12
    }
  ]
}
```

---

### 6.2 الأسئلة

#### إضافة سؤال اختياري مستقل (بدون قطعة)
```http
POST /api/teacher/questions/question
Authorization: Bearer {token}
Content-Type: application/json

{
  "lesson_id": 1,
  "question_text": "ما وحدة قياس التيار الكهربائي؟",
  "question_type": "choice",
  "choices": ["فولت", "أمبير", "أوم", "واط"],
  "answer": "أمبير",
  "correct_answer_index": 1,
  "explanation": "التيار يُقاس بالأمبير",
  "difficulty_level": "medium",
  "points": 1,
  "image_url": null,
  "passage_id": null
}
```

#### إضافة سؤال مقالي
```json
{
  "lesson_id": 1,
  "question_text": "اشرح قانون أوم.",
  "question_type": "text",
  "answer": "الجهد = التيار × المقاومة"
}
```

#### جلب أسئلة درس
```http
GET /api/teacher/questions/questions/1
Authorization: Bearer {token}
```

يرجع **كل** أسئلة الدرس (المستقلة + المرتبطة بقطع).

---

### 6.3 القطع (Passages)

#### إنشاء قطعة مع أسئلة
```http
POST /api/teacher/questions/passage
Authorization: Bearer {token}
Content-Type: application/json

{
  "lesson_id": 1,
  "title": "قطعة عن الطاقة المتجددة",
  "content": "النص الكامل للقطعة...",
  "questions": [
    {
      "question_text": "ما الفكرة الرئيسية للقطعة؟",
      "question_type": "choice",
      "choices": ["أ", "ب", "ج", "د"],
      "answer": "أ",
      "correct_answer_index": 0,
      "image_url": "https://cdn.example.com/q1.png",
      "explanation": "مذكورة في الفقرة الأولى",
      "difficulty_level": "medium",
      "points": 1
    }
  ]
}
```

**Response `201`:**
```json
{
  "success": true,
  "passage": {
    "id": 10,
    "lesson_id": 1,
    "title": "قطعة عن الطاقة المتجددة",
    "content": "...",
    "order_index": 0,
    "created_at": "...",
    "updated_at": "..."
  },
  "questions": [ { "id": 99, "lesson_id": 1, "passage_id": 10, "..." } ]
}
```

> العملية **transaction**: إما تُحفظ القطعة وكل أسئلتها، أو لا يُحفظ شيء.

---

### 6.4 الإضافة الجماعية (Bulk)

```http
POST /api/teacher/questions/bulk
Authorization: Bearer {token}
Content-Type: application/json

{
  "lesson_id": 1,
  "bulk_text": "ما المقصود بالتيار الكهربائي؟\nA) تدفق الشحنات\nB) قوة المغناطيس\nC) مقاومة الموصل\nD) فرق الجهد\n\nما وحدة قياس المقاومة؟\nA) فولت\nB) أمبير\nC) أوم\nD) واط"
}
```

#### تنسيق `bulk_text`

كل سؤال = **كتلة** مفصولة بسطر فارغ:

```
نص السؤال
A) الاختيار الأول
B) الاختيار الثاني
C) الاختيار الثالث
D) الاختيار الرابع

نص السؤال التالي
A) ...
...
```

**قواعد التحليل:**
- السطر الأول = نص السؤال
- الأسطر التالية = 4 اختيارات (يدعم `A)` أو `A.` أو `A:` أو `A-`)
- يُنشأ نوع السؤال `choice` تلقائيًا
- **لا** يُحدَّد `correct_answer_index` — يُعدَّل لاحقًا عبر PUT
- إذا فشل أي كتلة: يرجع `400` مع أرقام الكتل الخاطئة ولا يُدخل أي سؤال

**Response `201`:**
```json
{ "success": true, "inserted": 2 }
```

---

### 6.5 الشجرة الكاملة (`/tree`)

```http
GET /api/teacher/questions/tree
Authorization: Bearer {token}
```

**Response `200`:**
```json
{
  "lessons": [
    {
      "id": 1,
      "teacher_id": 5,
      "title": "الدرس الأول",
      "created_at": "...",
      "questions": [
        {
          "id": 1,
          "lesson_id": 1,
          "passage_id": null,
          "question_text": "سؤال مستقل",
          "question_type": "choice",
          "choices": "[\"أ\",\"ب\",\"ج\",\"د\"]"
        }
      ],
      "passages": [
        {
          "id": 10,
          "lesson_id": 1,
          "title": "قطعة قراءة",
          "content": "...",
          "order_index": 0,
          "questions": [
            {
              "id": 2,
              "lesson_id": 1,
              "passage_id": 10,
              "question_text": "سؤال على القطعة"
            }
          ]
        }
      ]
    }
  ]
}
```

**ملاحظة للـ Frontend:**
- `lesson.questions` يحتوي **كل** أسئلة الدرس (بما فيها المرتبطة بقطع)
- `lesson.passages[].questions` نفس الأسئلة المفلترة حسب `passage_id`
- لعرض UI منظم: اعرض الأسئلة ذات `passage_id === null` كـ «أسئلة مستقلة»، والباقي داخل القطعة

---

### 6.6 المسار العام

```http
GET /api/teacher/questions/public/questions/:lesson_id
```

- **بدون** Bearer Token
- يرجع أسئلة الدرس مع `choices` مُحلَّلة كـ JSON array
- مناسب للعرض العام أو التضمين في امتحان/نشاط

---

## 7. أكواد الأخطاء الشائعة

| HTTP | الرسالة | السبب |
|------|---------|-------|
| 400 | العنوان مطلوب | `title` فارغ عند إنشاء/تعديل درس |
| 400 | lesson_id و bulk_text مطلوبان | bulk بدون حقول إلزامية |
| 400 | lesson_id غير صحيح | معرف غير صحيح |
| 400 | passage_id غير صحيح | معرف قطعة غير صحيح |
| 400 | هناك مشكلة في الأسئلة التالية: ... | تنسيق bulk خاطئ |
| 404 | الدرس غير موجود | درس ليس للمدرّس أو غير موجود |
| 404 | السؤال غير موجود | سؤال خارج ملكية المدرّس |
| 404 | القطعة غير موجودة | قطعة خارج ملكية المدرّس |
| 404 | القطعة غير موجودة داخل هذا الدرس | `passage_id` لا ينتمي لـ `lesson_id` |
| 401 | Unauthorized | token مفقود أو غير صالح |

---

## 8. سجل النشاط (Activity Log)

تُسجَّل العمليات التالية في `TeacherActivityLogService`:

| Action | Entity | متى |
|--------|--------|-----|
| `add_lesson` | lesson | POST `/lesson` |
| `edit_lesson` | lesson | PUT `/lesson/:id` |
| `delete_lesson` | lesson | DELETE `/lesson/:id` |
| `add_question` | question | POST `/question` |
| `edit_question` | question | PUT `/question/:id` |
| `delete_question` | question | DELETE `/question/:id` |

> إنشاء القطع والـ bulk **لا** يُسجَّل حاليًا في activity log.

---

## 9. التكامل مع OCR / استخراج الأسئلة

### التدفق الموصى به

```
1. POST /api/ocr/extract-questions  (رفع PDF/صورة)
        ↓
2. مراجعة النتائج في الواجهة
        ↓
3. لكل passage مستخرج:
   POST /api/teacher/questions/passage
   { lesson_id, title, content, questions: [...] }
        ↓
4. للأسئلة بدون passage:
   POST /api/teacher/questions/question
   { lesson_id, question_text, choices, image_url, ... }
```

### مثال Mapping (TypeScript)

```typescript
const { passages, questions } = ocrResponse.data;
const lessonId = selectedLessonId;

for (const passage of passages) {
  const linked = questions.filter((q) => q.passage_id === passage.passage_id);

  await api.post('/api/teacher/questions/passage', {
    lesson_id: lessonId,
    title: passage.title,
    content: passage.content,
    questions: linked.map((q) => ({
      question_text: q.question_text,
      question_type: q.options?.length ? 'choice' : 'text',
      choices: q.options?.map((o) => o.text) ?? null,
      answer: q.options?.[q.correct_answer_index ?? 0]?.text ?? q.correct_answer,
      image_url: q.question_images?.[0]?.image_url ?? null,
      correct_answer_index: q.correct_answer_index,
      difficulty_level: 'medium',
      points: 1,
    })),
  });
}

const standalone = questions.filter(
  (q) => !q.passage_id || !passages.some((p) => p.passage_id === q.passage_id),
);

for (const q of standalone) {
  await api.post('/api/teacher/questions/question', {
    lesson_id: lessonId,
    question_text: q.question_text,
    question_type: q.options?.length ? 'choice' : 'text',
    choices: q.options?.map((o) => o.text),
    answer: q.options?.[q.correct_answer_index ?? 0]?.text,
    image_url: q.question_images?.[0]?.image_url ?? null,
    correct_answer_index: q.correct_answer_index,
  });
}
```

**مراجع إضافية:**
- `doc/ocr-question-extraction-and-passages-api.md`
- `doc/ai-question-extraction-api.md`

---

## 10. تدفقات الواجهة (Frontend Flows)

### 10.1 شاشة المكتبة الرئيسية

```
GET /lessons
  → عرض قائمة الدروس + questions_count
  → زر «درس جديد» → POST /lesson
```

### 10.2 داخل الدرس

```
GET /questions/:lesson_id     → أسئلة مستقلة + كل الأسئلة
GET /passages/:lesson_id      → قطع + أسئلتها
  → إضافة سؤال → POST /question
  → إضافة bulk → POST /bulk
  → إضافة قطعة → POST /passage
  → تعديل/حذف → PUT/DELETE /question/:id
```

### 10.3 تحميل كامل للمكتبة (مثلاً offline cache)

```
GET /tree
  → دروس + أسئلة + قطع في طلب واحد
```

---

## 11. الإحصائيات في لوحة المدرّس

عدد أسئلة المكتبة يظهر في dashboard المدرّس (`src/controllers/teacher.ts`):

```sql
SELECT COUNT(*)
FROM teacher_questions q
JOIN teacher_question_lessons l ON q.lesson_id = l.id
WHERE l.teacher_id = $teacher_id
```

---

## 12. Migrations ذات الصلة

| الملف | الوصف |
|-------|-------|
| `1700000000002_teacher_questions_library.sql` | الإنشاء الأولي (النظام القديم) |
| `1772108600000_teacher_question_passages_and_images.sql` | القطع + حقول إضافية للأسئلة |
| `1772300000000_teacher_questions_flat_lessons.sql` | **التحويل للهيكل الحالي** (دروس مباشرة) |

لتطبيق migration الجديدة على بيئة موجودة:

```bash
npm run migrate
```

---

## 13. ملخص سريع للمطور

| المفهوم | القيمة |
|---------|--------|
| نقطة الدخول | `/api/teacher/questions` |
| الوحدة الأساسية | **الدرس** (`teacher_question_lessons`) |
| ربط السؤال | `lesson_id` (إلزامي) + `passage_id` (اختياري) |
| نوع السؤال | `choice` أو `text` |
| الاختيارات | JSON array في `choices` |
| الإجابة الصحيحة | `correct_answer_index` (0-based) و/أو `answer` |
| حذف الدرس | يحذف أسئله وقطعه (cascade) |
| حذف القطعة | يُبقي الأسئلة لكن `passage_id` → null |

---

## 14. مرجع API مختصر

للنسخة المختصرة من endpoints فقط، راجع أيضًا:

**`doc/teacher-questions-api.md`**
