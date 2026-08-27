# OCR Question Extraction And Passage Questions API

This document explains the OCR question extraction APIs and the new passage/image support for questions.

The feature supports:

- Extracting raw text from PDF/image files.
- Extracting structured questions, options, passages, and question images from PDF/image files.
- Importing extracted questions into Question Bank V2.
- Creating passage-based questions in the teacher private question library.
- Attaching teacher questions to a passage.
- Storing question images on teacher questions and Question Bank V2 questions.

All routes are mounted under the global `/api` prefix.

## Authentication

OCR endpoints require one of these roles:

```txt
teacher | admin | employee
```

Teacher private-library endpoints require:

```txt
teacher
```

Use:

```http
Authorization: Bearer <TOKEN>
```

If the token includes `tid`, no tenant header is required.

---

## Environment Variables

Required for OCR extraction:

```env
MISTRAL_API_KEY=
MISTRAL_OCR_MODEL=mistral-ocr-latest
MISTRAL_CHAT_MODEL=mistral-large-latest
MISTRAL_API_BASE_URL=https://api.mistral.ai/v1
```

Required if `include_question_images=true` and OCR returns image snippets that need CDN upload:

```env
BUNNY_STORAGE_ZONE_NAME=
BUNNY_STORAGE_PUBLIC_HOSTNAME=
BUNNY_ACCESS_KEY=
BUNNY_MEDIA_PATH=
```

---

## Main OCR Endpoints

```http
POST /api/ocr/extract-text
POST /api/ocr/extract-questions
POST /api/ocr/import-question-bank-v2
POST /api/question-bank-v2/lesson/:lessonId/import-extraction
```

The lesson import endpoint accepts the same extraction payload shapes as `/api/ocr/import-question-bank-v2`, but `lessonId` comes from the URL instead of the body.

---

## 1. Extract Text From PDF Or Image

Extracts OCR text and page markdown from a PDF or image.

```http
POST /api/ocr/extract-text
Content-Type: multipart/form-data
```

### Form Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | File | Yes | PDF or image file. |

Supported file types:

```txt
application/pdf
image/png
image/jpeg
image/webp
image/gif
image/avif
image/bmp
image/tiff
```

Max file size:

```txt
MISTRAL_OCR_MAX_FILE_SIZE_MB (default 512 MB; 0 = unlimited at app level)
```

Large PDFs are auto-batched (50 pages per OCR call). Raise reverse-proxy body limits in production as well.

### Example

```bash
curl -X POST "http://localhost:8000/api/ocr/extract-text" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/home/user/Downloads/questions.pdf"
```

### Response

```json
{
  "success": true,
  "data": {
    "filename": "questions.pdf",
    "mime_type": "application/pdf",
    "document_type": "pdf",
    "model": "mistral-ocr-latest",
    "page_count": 2,
    "text": "النص المستخرج...",
    "pages": [
      {
        "index": 0,
        "markdown": "محتوى الصفحة...",
        "images": []
      }
    ],
    "usage_info": {}
  }
}
```

---

## 2. Extract Questions, Options, Passages, And Images

Extracts structured question data from a PDF or image.

```http
POST /api/ocr/extract-questions
Content-Type: multipart/form-data
```

### Form Fields

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `file` | File | Yes* | - | PDF or single image (`files` for multiple images). |
| `files` | File[] | Yes* | - | Multiple images as one document. |
| `subject` | string | Recommended | - | اسم المادة. يفعّل `ARABIC_HIGH_ACCURACY_MODE` للغة العربية، و`STANDARD_EXTRACTION_MODE` لباقي المواد. عند وجود قطعة قراءة تُملأ `passages[]` و`content_type=reading_passage`. |
| `infer_correct_answer` | boolean | No | `false` | If true, AI may infer the correct answer if it is not explicit. |
| `include_question_images` | boolean | No | `true` | If true, OCR extracts image annotations and uploads linked question images when possible. |
| `start_page` / `end_page` | number | No | - | PDF page range (1-based). |

\* ارفع `file` أو `files`.

### Example

```bash
curl -X POST "http://localhost:8000/api/ocr/extract-questions" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/home/user/Downloads/questions.pdf" \
  -F "subject=اللغة العربية" \
  -F "infer_correct_answer=true" \
  -F "include_question_images=true"
```

### Response

```json
{
  "success": true,
  "data": {
    "filename": "questions.pdf",
    "mime_type": "application/pdf",
    "document_type": "pdf",
    "page_count": 2,
    "question_count": 3,
    "ocr_model": "mistral-ocr-latest",
    "chat_model": "mistral-large-latest",
    "infer_correct_answer": true,
    "subject": "اللغة العربية",
    "extraction_mode": "ARABIC_HIGH_ACCURACY_MODE",
    "passages": [
      {
        "passage_id": "passage_1",
        "title": "نص القراءة",
        "content": "النص الكامل للقطعة..."
      }
    ],
    "extracted_images": [
      {
        "image_id": "page-0-image-0",
        "page_index": 0,
        "image_type": "diagram",
        "short_description": "رسم بياني",
        "summary": "رسم يوضح العلاقة بين السرعة والزمن",
        "extracted_text": null
      }
    ],
    "questions": [
      {
        "number": 1,
        "source_number": "1",
        "passage_id": "passage_1",
        "question_text": "ما الفكرة الرئيسية في النص؟",
        "options": [
          { "label": "أ", "text": "الخيار الأول" },
          { "label": "ب", "text": "الخيار الثاني" },
          { "label": "ج", "text": "الخيار الثالث" },
          { "label": "د", "text": "الخيار الرابع" }
        ],
        "question_images": [],
        "correct_answer": "ب",
        "correct_answer_index": 1,
        "correct_answer_inferred": true
      }
    ],
    "notes": "ملاحظات اختيارية"
  }
}
```

### Important Response Rules

- `passages[].passage_id` is a temporary string ID, not a database ID.
- `questions[].passage_id` links the question to a temporary extracted passage.
- **أسئلة متعددة النقاط** (مثل سؤال 2 فيه (1) و(2) باختيارات منفصلة): يُستخرج كل نقطة كسؤال مستقل، و`question_text` يجمع التمهيد + نص النقطة في سؤال واحد مكتمل (`source_number` مثل `2-1`, `2-2`). لا يُستخدم `passage` للتمهيد في هذه الحالة.
- `correct_answer_index` is zero-based:

```txt
أ = 0
ب = 1
ج = 2
د = 3
```

- `options` are either empty or contain **2–5** choices (e.g. 3 or 5 in English exams).
- If OCR returns incomplete option text, the API normalizes `null` option text to an empty string.
- If `include_question_images=true`, linked images may include `image_url` after upload to Bunny CDN.

---

## 3. Import Extracted Questions Into Question Bank V2

This endpoint saves extracted OCR JSON into Question Bank V2 tables:

- `question_passages`
- `questions_v2`
- `question_options`
- `question_media`

```http
POST /api/ocr/import-question-bank-v2
Content-Type: application/json
```

### Request Body

يدعم أحد الأشكال التالية:

**أ) ناتج `extract-questions` كامل (موصى به):**

```json
{
  "lesson_id": 101,
  "success": true,
  "data": {
    "filename": "questions.pdf",
    "passages": [
      {
        "passage_id": "passage_1",
        "title": "نص القراءة",
        "content": "النص الكامل للقطعة..."
      }
    ],
    "questions": [
      {
        "number": 1,
        "source_number": "1",
        "passage_id": "passage_1",
        "question_text": "ما الفكرة الرئيسية؟",
        "options": [
          { "label": "أ", "text": "الخيار الأول" },
          { "label": "ب", "text": "الخيار الثاني" },
          { "label": "ج", "text": "الخيار الثالث" },
          { "label": "د", "text": "الخيار الرابع" }
        ],
        "question_images": [],
        "correct_answer": "ب",
        "correct_answer_index": 1,
        "correct_answer_inferred": true
      }
    ]
  }
}
```

**ب) الصيغة القديمة:**

```json
{
  "lesson_id": 101,
  "extraction": {
    "passages": [
      {
        "passage_id": "passage_1",
        "title": "نص القراءة",
        "content": "النص الكامل للقطعة..."
      }
    ],
    "questions": [
      {
        "number": 1,
        "source_number": "1",
        "passage_id": "passage_1",
        "question_text": "ما الفكرة الرئيسية؟",
        "options": [
          { "label": "أ", "text": "الخيار الأول" },
          { "label": "ب", "text": "الخيار الثاني" },
          { "label": "ج", "text": "الخيار الثالث" },
          { "label": "د", "text": "الخيار الرابع" }
        ],
        "question_images": [],
        "correct_answer": "ب",
        "correct_answer_index": 1,
        "correct_answer_inferred": true
      }
    ]
  }
}
```

### Example Flow

Step 1: Extract:

```bash
curl -X POST "http://localhost:8000/api/ocr/extract-questions" \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/home/user/Downloads/questions.pdf" \
  -F "infer_correct_answer=true"
```

Step 2: Send the returned `data.passages` and `data.questions` to import:

```bash
curl -X POST "http://localhost:8000/api/ocr/import-question-bank-v2" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "lesson_id": 101,
    "extraction": {
      "passages": [],
      "questions": [
        {
          "number": 1,
          "question_text": "ما ناتج 2 + 2؟",
          "options": [
            { "label": "أ", "text": "3" },
            { "label": "ب", "text": "4" },
            { "label": "ج", "text": "5" },
            { "label": "د", "text": "6" }
          ],
          "correct_answer_index": 1,
          "question_images": []
        }
      ]
    }
  }'
```

### Response

```json
{
  "success": true,
  "message": "تم استيراد 1 سؤال",
  "data": {
    "passages": [
      {
        "temp_passage_id": "passage_1",
        "db_passage": {
          "id": 12,
          "lesson_id": 101,
          "title": "نص القراءة",
          "content": "النص الكامل للقطعة...",
          "order_index": 0
        }
      }
    ],
    "questions": [
      {
        "id": 250,
        "question_text": "ما الفكرة الرئيسية؟",
        "question_type": "text_only",
        "lesson_id": 101,
        "passage_id": 12,
        "options": []
      }
    ],
    "skipped": []
  }
}
```

---

## Question Bank V2 Passage/Image Support

Question Bank V2 already supports passages and question images.

### Tables

```txt
question_passages
questions_v2
question_options
question_media
```

### Relationship

```txt
lessons
  └── question_passages
        └── questions_v2
              ├── question_options
              └── question_media
```

### Important Columns

`questions_v2.passage_id` links a question to a passage.

`question_media.media_url` stores the question image URL.

`question_options.image_url` stores image options.

---

## Teacher Private Library Passage/Image Support

Teacher private questions now support passages and question images.

### New Table

```txt
teacher_question_passages
```

### Updated Table

`teacher_questions` now supports:

```txt
passage_id
image_url
correct_answer_index
explanation
difficulty_level
points
```

### Relationship

```txt
teacher_question_lessons (teacher_id)
  ├── teacher_question_passages
  │     └── teacher_questions
  └── teacher_questions without passage
```

---

## Teacher Passage Endpoints

```http
POST /api/teacher/questions/passage
GET  /api/teacher/questions/passages/:lesson_id
GET  /api/teacher/questions/passage/:id
POST /api/teacher/questions/question
```

---

## 4. Create Teacher Passage With Questions

Creates one passage and optional linked questions in the teacher private library.

```http
POST /api/teacher/questions/passage
Content-Type: application/json
```

### Request

```json
{
  "lesson_id": 3,
  "title": "قطعة عن الطاقة",
  "content": "النص الكامل للقطعة...",
  "questions": [
    {
      "question_text": "ما المقصود بالطاقة؟",
      "question_type": "choice",
      "choices": ["الخيار الأول", "الخيار الثاني", "الخيار الثالث", "الخيار الرابع"],
      "answer": "الخيار الأول",
      "image_url": "https://cdn.example.com/question-image.png",
      "correct_answer_index": 0,
      "explanation": "لأن النص يذكر ذلك صراحة.",
      "difficulty_level": "medium",
      "points": 1
    }
  ]
}
```

### Response

```json
{
  "success": true,
  "passage": {
    "id": 10,
    "lesson_id": 3,
    "title": "قطعة عن الطاقة",
    "content": "النص الكامل للقطعة...",
    "order_index": 0
  },
  "questions": [
    {
      "id": 99,
      "lesson_id": 3,
      "passage_id": 10,
      "question_text": "ما المقصود بالطاقة؟",
      "image_url": "https://cdn.example.com/question-image.png"
    }
  ]
}
```

---

## 5. List Teacher Passages By Lesson

```http
GET /api/teacher/questions/passages/:lesson_id
```

### Example

```bash
curl "http://localhost:8000/api/teacher/questions/passages/3" \
  -H "Authorization: Bearer $TOKEN"
```

### Response

```json
{
  "passages": [
    {
      "id": 10,
      "lesson_id": 3,
      "title": "قطعة عن الطاقة",
      "content": "النص الكامل للقطعة...",
      "questions": [
        {
          "id": 99,
          "passage_id": 10,
          "question_text": "ما المقصود بالطاقة؟"
        }
      ]
    }
  ]
}
```

---

## 6. Get Teacher Passage Details

```http
GET /api/teacher/questions/passage/:id
```

### Response

```json
{
  "passage": {
    "id": 10,
    "lesson_id": 3,
    "title": "قطعة عن الطاقة",
    "content": "النص الكامل للقطعة...",
    "questions": [
      {
        "id": 99,
        "passage_id": 10,
        "question_text": "ما المقصود بالطاقة؟"
      }
    ]
  }
}
```

---

## 7. Create Standalone Teacher Question Attached To Passage

The existing endpoint `POST /api/teacher/questions/question` now accepts optional passage and image fields.

```http
POST /api/teacher/questions/question
Content-Type: application/json
```

### Request

```json
{
  "lesson_id": 3,
  "passage_id": 10,
  "question_text": "ما الفكرة الرئيسية؟",
  "question_type": "choice",
  "choices": ["أ", "ب", "ج", "د"],
  "answer": "أ",
  "image_url": "https://cdn.example.com/question-image.png",
  "correct_answer_index": 0,
  "explanation": "الإجابة موجودة في بداية القطعة.",
  "difficulty_level": "medium",
  "points": 1
}
```

### Notes

- `passage_id` is optional.
- If `passage_id` is provided, it must belong to the same teacher and same `lesson_id`.
- `image_url` is optional and can be a CDN URL from OCR extraction.

---

## Recommended Frontend Flow: OCR To Teacher Library

1. Teacher uploads PDF/image.
2. Frontend calls:

```http
POST /api/ocr/extract-questions
```

3. Frontend groups returned questions by `passage_id`.
4. For each passage, frontend calls:

```http
POST /api/teacher/questions/passage
```

5. For questions without passage, frontend calls:

```http
POST /api/teacher/questions/question
```

### Mapping Example

```ts
const extracted = ocrResponse.data;

for (const passage of extracted.passages) {
  const linkedQuestions = extracted.questions.filter(
    (q) => q.passage_id === passage.passage_id,
  );

  await api.post('/api/teacher/questions/passage', {
    lesson_id,
    title: passage.title,
    content: passage.content,
    questions: linkedQuestions.map((q) => ({
      question_text: q.question_text,
      question_type: q.options.length ? 'choice' : 'text',
      choices: q.options.map((o) => o.text),
      answer:
        q.correct_answer_index != null
          ? q.options[q.correct_answer_index]?.text
          : q.correct_answer,
      image_url: q.question_images?.[0]?.image_url ?? null,
      correct_answer_index: q.correct_answer_index,
      difficulty_level: 'medium',
      points: 1,
    })),
  });
}
```

---

## Recommended Frontend Flow: OCR To Question Bank V2

1. Teacher/admin/employee uploads PDF/image.
2. Frontend calls:

```http
POST /api/ocr/extract-questions
```

3. Frontend reviews/edits the extracted JSON.
4. Frontend calls:

```http
POST /api/ocr/import-question-bank-v2
```

The backend creates real passage IDs and links questions to them.

---

## Common Errors

### Missing Mistral Key

```json
{
  "message": "MISTRAL_API_KEY is required"
}
```

### Invalid File Type

```json
{
  "message": "Only PDF and image files are supported"
}
```

### Provider Returned Invalid JSON

```json
{
  "success": false,
  "message": "OCR provider returned invalid question JSON",
  "errors": []
}
```

### No Permission For Lesson Import

```json
{
  "message": "ليس لديك صلاحية لإضافة أسئلة لهذا الدرس"
}
```

---

## Implementation Notes

- The current OCR implementation is synchronous.
- It does not use a queue or background worker.
- It returns extracted JSON first, then optionally imports it into Question Bank V2.
- Temporary extracted passage IDs like `passage_1` are converted to real DB IDs during import.
- Question Bank V2 passage data uses `question_passages`.
- Teacher private-library passage data uses `teacher_question_passages`.
- These two passage systems are separate and do not share IDs.
