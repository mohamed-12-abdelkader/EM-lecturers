# Teacher Creative Chatbot API

API documentation for integrating the teacher creative chatbot. The feature allows a teacher to generate Arabic social media text posts and full creative images for social media.

## Base URL

Production:

```txt
https://YOUR_API_DOMAIN/api/teacher/creative-chatbot
```

Local:

```txt
http://localhost:8000/api/teacher/creative-chatbot
```

## Authentication

All endpoints require a teacher access token:

```http
Authorization: Bearer <TEACHER_TOKEN>
```

The token must belong to a user with role:

```txt
teacher
```

If the JWT contains `tid`, no tenant header is required. Otherwise, client integrations may need the normal tenant context used by the platform.

## Supported Values

### Platforms

```txt
facebook | instagram | whatsapp | tiktok | general
```

### Tones

```txt
friendly | professional | motivational | promotional
```

### Aspect Ratios

```txt
1:1 | 4:5 | 9:16 | 16:9
```

### Image Languages

```txt
arabic | english | mixed
```

## Endpoints

```http
GET  /options
POST /chat
POST /chat/execute
POST /chat/new
GET  /chat/messages?session_id=
POST /posts
POST /images
GET  /history
GET  /generations/:id
```

### Conversational mode (recommended)

The chatbot now discusses marketing ideas and draft posts **before** generating.

1. `POST /chat` — discuss, get ideas/drafts (`executed: false`)
2. Confirm with `نفّذ` in chat, or call `POST /chat/execute`
3. Only then a post/image generation is created

Direct `POST /posts` and `POST /images` remain available for immediate generation.

#### Chat request

```http
POST /chat
Authorization: Bearer <TEACHER_TOKEN>
Content-Type: multipart/form-data
```

Fields: `message`, optional `session_id`, `preferred_output` (`post|image|auto`), `platform`, `tone`, `aspect_ratio`, `language_mode`, `force_execute`, `references[]`

#### Chat response (discussion)

```json
{
  "message": "تم الرد بنجاح",
  "reply": "ممكن نبدأ بثلاث أفكار...",
  "session_id": 12,
  "ideas": ["فكرة 1", "فكرة 2"],
  "draft_post": "مسودة للمنشور...",
  "image_concept": null,
  "suggested_action": "generate_post",
  "ready_to_execute": true,
  "executed": false,
  "generation": null,
  "actions": {
    "can_execute": true,
    "can_generate_post": true,
    "can_generate_image": false
  }
}
```

---

## 1. Get Options

Returns supported request types, platforms, tones, aspect ratios, image languages, and upload limits.

```http
GET /options
```

### Example

```bash
curl "http://localhost:8000/api/teacher/creative-chatbot/options" \
  -H "Authorization: Bearer $TOKEN"
```

### Response

```json
{
  "request_types": [
    { "value": "post", "label_ar": "منشور نصي" },
    { "value": "image", "label_ar": "تصميم صورة" }
  ],
  "platforms": [
    {
      "value": "facebook",
      "label_ar": "فيسبوك",
      "description_ar": "منشور واضح مناسب للنسخ والنشر على صفحة المدرس أو جروب الطلاب."
    },
    {
      "value": "instagram",
      "label_ar": "إنستجرام",
      "description_ar": "نص قصير وجذاب مناسب للكابشن مع هاشتاجات قليلة."
    },
    {
      "value": "whatsapp",
      "label_ar": "واتساب",
      "description_ar": "رسالة مختصرة ومباشرة تصلح للإرسال في الجروبات."
    },
    {
      "value": "tiktok",
      "label_ar": "تيك توك",
      "description_ar": "نص سريع وحماسي يصلح كفكرة فيديو أو وصف قصير."
    },
    {
      "value": "general",
      "label_ar": "عام",
      "description_ar": "صياغة عامة يمكن تعديلها لأي منصة."
    }
  ],
  "tones": [
    { "value": "friendly", "label_ar": "ودود وبسيط" },
    { "value": "professional", "label_ar": "احترافي" },
    { "value": "motivational", "label_ar": "تحفيزي" },
    { "value": "promotional", "label_ar": "تسويقي" }
  ],
  "aspect_ratios": [
    {
      "value": "1:1",
      "label_ar": "مربع",
      "description_ar": "مناسب لفيسبوك وإنستجرام."
    },
    {
      "value": "4:5",
      "label_ar": "بوست رأسي",
      "description_ar": "مناسب لمنشورات إنستجرام وفيسبوك."
    },
    {
      "value": "9:16",
      "label_ar": "ستوري/ريلز",
      "description_ar": "مناسب للقصص والفيديوهات القصيرة."
    },
    {
      "value": "16:9",
      "label_ar": "أفقي",
      "description_ar": "مناسب للغلاف أو العرض."
    }
  ],
  "languages": [
    {
      "value": "arabic",
      "label_ar": "عربي",
      "description_ar": "اكتب النصوص داخل التصميم بالعربية."
    },
    {
      "value": "english",
      "label_ar": "إنجليزي",
      "description_ar": "اكتب النصوص داخل التصميم بالإنجليزية."
    },
    {
      "value": "mixed",
      "label_ar": "مختلط",
      "description_ar": "استخدم العربية والإنجليزية عند الحاجة."
    }
  ],
  "default_language": "arabic",
  "uploads": {
    "field_name": "references",
    "max_files": 4,
    "max_file_size_mb": 8,
    "allowed_types": ["image/*"]
  }
}
```

---

## 2. Generate Text Post

Generates Arabic social media post text.

```http
POST /posts
Content-Type: application/json
```

### Request Body

```json
{
  "prompt": "اكتب منشور عن بداية كورس فيزياء للصف الثالث الثانوي",
  "platform": "facebook",
  "tone": "promotional"
}
```

### Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | yes | Teacher request in Arabic. Maximum `3000` characters. |
| `platform` | string | no | One of `facebook`, `instagram`, `whatsapp`, `tiktok`, `general`. Defaults to `general`. |
| `tone` | string | no | One of `friendly`, `professional`, `motivational`, `promotional`. Defaults to `friendly`. |

### Example

```bash
curl -X POST "http://localhost:8000/api/teacher/creative-chatbot/posts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "اكتب منشور عن بداية كورس فيزياء للصف الثالث الثانوي",
    "platform": "facebook",
    "tone": "promotional"
  }'
```

### Response

```json
{
  "message": "تم توليد المنشور بنجاح",
  "post_text": "النص العربي الناتج...",
  "generation": {
    "id": 12,
    "teacher_id": 55,
    "request_type": "post",
    "prompt": "اكتب منشور عن بداية كورس فيزياء للصف الثالث الثانوي",
    "platform": "facebook",
    "tone": "promotional",
    "aspect_ratio": null,
    "status": "completed",
    "generated_text": "النص العربي الناتج...",
    "generated_image_url": null,
    "provider": "deepseek",
    "provider_model": "deepseek-chat",
    "provider_response": {},
    "logo_path": null,
    "error_message": null,
    "created_at": "2026-06-08T10:00:00.000Z",
    "updated_at": "2026-06-08T10:00:02.000Z",
    "completed_at": "2026-06-08T10:00:02.000Z"
  }
}
```

---

## 3. Generate Image

Generates a full Arabic social media design image.

```http
POST /images
Content-Type: multipart/form-data
```

### Form Fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `prompt` | string | yes | Teacher design request in Arabic. Maximum `3000` characters. |
| `platform` | string | no | One of `facebook`, `instagram`, `whatsapp`, `tiktok`, `general`. Defaults to `general`. |
| `aspect_ratio` | string | no | One of `1:1`, `4:5`, `9:16`, `16:9`. Defaults to `1:1`. |
| `language_mode` | string | no | One of `arabic`, `english`, `mixed`. Defaults to `arabic`. |
| `language` | string | no | Alias for `language_mode`. |
| `edit_last_design` | boolean | no | If true, edits the latest completed teacher design instead of starting fresh. Common Arabic/English edit phrases are also auto-detected. |
| `references` | file[] | no | Optional reference images. Repeat the same field for multiple files. |

### Upload Rules

```txt
field name: references
max files: 4
max file size: 8MB each
allowed type: image/*
```

### Example Without References

```bash
curl -X POST "http://localhost:8000/api/teacher/creative-chatbot/images" \
  -H "Authorization: Bearer $TOKEN" \
  -F "prompt=صمم بوست جذاب للإعلان عن بداية كورس فيزياء للصف الثالث الثانوي" \
  -F "platform=facebook" \
-F "aspect_ratio=1:1" \
-F "language_mode=arabic"
```

### Example With References

```bash
curl -X POST "http://localhost:8000/api/teacher/creative-chatbot/images" \
  -H "Authorization: Bearer $TOKEN" \
  -F "prompt=اعمل تصميم إعلان عن حصة مراجعة نهائية في الرياضيات" \
  -F "platform=instagram" \
  -F "aspect_ratio=4:5" \
  -F "references=@/home/user/Pictures/sample-design.png"
```

### Example Edit Latest Design

```bash
curl -X POST "http://localhost:8000/api/teacher/creative-chatbot/images" \
  -H "Authorization: Bearer $TOKEN" \
  -F "prompt=عدّل التصميم السابق وخلي العنوان أكبر" \
  -F "edit_last_design=true"
```

### Response

```json
{
  "message": "تم توليد الصورة بنجاح",
  "image_url": "https://res.cloudinary.com/.../image.png",
  "generation": {
    "id": 13,
    "teacher_id": 55,
    "request_type": "image",
    "prompt": "اعمل تصميم إعلان عن حصة مراجعة نهائية في الرياضيات",
    "platform": "instagram",
    "tone": null,
    "aspect_ratio": "4:5",
    "language_mode": "arabic",
    "edited_generation_id": null,
    "status": "completed",
    "generated_text": "مراجعة نهائية في الرياضيات\nشرح منظم وتدريب مكثف\nاحجز مكانك",
    "generated_image_url": "https://res.cloudinary.com/.../image.png",
    "provider": "openai",
    "provider_model": "gpt-image-1",
    "provider_response": {},
    "logo_path": "/server/path/to/logo.png",
    "error_message": null,
    "created_at": "2026-06-08T10:00:00.000Z",
    "updated_at": "2026-06-08T10:00:20.000Z",
    "completed_at": "2026-06-08T10:00:20.000Z",
    "references": []
  },
  "references": []
}
```

### Response With References

```json
{
  "references": [
    {
      "id": 1,
      "generation_id": 13,
      "teacher_id": 55,
      "file_url": "https://res.cloudinary.com/.../reference.png",
      "original_name": "sample-design.png",
      "mime_type": "image/png",
      "file_size": 123456,
      "created_at": "2026-06-08T10:00:00.000Z"
    }
  ]
}
```

---

## 4. Get History

Returns previous post/image generations for the logged-in teacher.

```http
GET /history?limit=20&offset=0
```

### Query Params

| Param | Type | Required | Description |
| --- | --- | --- | --- |
| `limit` | number | no | Default `20`, max `100`. |
| `offset` | number | no | Default `0`. |

### Example

```bash
curl "http://localhost:8000/api/teacher/creative-chatbot/history?limit=10&offset=0" \
  -H "Authorization: Bearer $TOKEN"
```

### Response

```json
{
  "generations": [
    {
      "id": 13,
      "teacher_id": 55,
      "request_type": "image",
      "prompt": "اعمل تصميم إعلان عن حصة مراجعة نهائية في الرياضيات",
      "platform": "instagram",
      "tone": null,
      "aspect_ratio": "4:5",
      "status": "completed",
      "generated_text": "مراجعة نهائية في الرياضيات\nشرح منظم وتدريب مكثف\nاحجز مكانك",
      "generated_image_url": "https://res.cloudinary.com/.../image.png",
      "provider": "openai",
      "provider_model": "gpt-image-1",
      "error_message": null,
      "created_at": "2026-06-08T10:00:00.000Z",
      "updated_at": "2026-06-08T10:00:20.000Z",
      "completed_at": "2026-06-08T10:00:20.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "offset": 0,
    "total": 1,
    "has_more": false
  }
}
```

---

## 5. Get Single Generation

Returns one generation by id, including reference images.

```http
GET /generations/:id
```

### Example

```bash
curl "http://localhost:8000/api/teacher/creative-chatbot/generations/13" \
  -H "Authorization: Bearer $TOKEN"
```

### Response

```json
{
  "generation": {
    "id": 13,
    "teacher_id": 55,
    "request_type": "image",
    "prompt": "اعمل تصميم إعلان عن حصة مراجعة نهائية في الرياضيات",
    "platform": "instagram",
    "tone": null,
    "aspect_ratio": "4:5",
    "status": "completed",
    "generated_text": "مراجعة نهائية في الرياضيات\nشرح منظم وتدريب مكثف\nاحجز مكانك",
    "generated_image_url": "https://res.cloudinary.com/.../image.png",
    "provider": "openai",
    "provider_model": "gpt-image-1",
    "provider_response": {},
    "logo_path": "/server/path/to/logo.png",
    "error_message": null,
    "created_at": "2026-06-08T10:00:00.000Z",
    "updated_at": "2026-06-08T10:00:20.000Z",
    "completed_at": "2026-06-08T10:00:20.000Z",
    "references": []
  }
}
```

---

## Error Responses

### Validation Error

```json
{
  "message": "Validation failed",
  "errors": []
}
```

### Unauthorized

```json
{
  "message": "Unauthorized"
}
```

### Forbidden

Returned when the authenticated user is not a teacher.

```json
{
  "message": "Forbidden: insufficient role"
}
```

### Generation Provider Error

```json
{
  "message": "OpenAI image generation failed: ..."
}
```

### Not Found

```json
{
  "message": "Generation not found"
}
```

## Frontend TypeScript Client

```ts
const API_BASE = 'http://localhost:8000/api';

export type TeacherCreativePlatform =
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'tiktok'
  | 'general';

export type TeacherCreativeTone =
  | 'friendly'
  | 'professional'
  | 'motivational'
  | 'promotional';

export type TeacherCreativeAspectRatio = '1:1' | '4:5' | '9:16' | '16:9';
export type TeacherCreativeLanguageMode = 'arabic' | 'english' | 'mixed';

export async function getTeacherCreativeOptions(token: string) {
  const res = await fetch(`${API_BASE}/teacher/creative-chatbot/options`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateTeacherCreativePost(
  token: string,
  data: {
    prompt: string;
    platform?: TeacherCreativePlatform;
    tone?: TeacherCreativeTone;
  },
) {
  const res = await fetch(`${API_BASE}/teacher/creative-chatbot/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateTeacherCreativeImage(
  token: string,
  data: {
    prompt: string;
    platform?: TeacherCreativePlatform;
    aspectRatio?: TeacherCreativeAspectRatio;
    languageMode?: TeacherCreativeLanguageMode;
    editLastDesign?: boolean;
    references?: File[];
  },
) {
  const form = new FormData();
  form.append('prompt', data.prompt);

  if (data.platform) form.append('platform', data.platform);
  if (data.aspectRatio) form.append('aspect_ratio', data.aspectRatio);
  if (data.languageMode) form.append('language_mode', data.languageMode);
  if (data.editLastDesign !== undefined) {
    form.append('edit_last_design', String(data.editLastDesign));
  }

  for (const file of data.references || []) {
    form.append('references', file);
  }

  const res = await fetch(`${API_BASE}/teacher/creative-chatbot/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTeacherCreativeHistory(
  token: string,
  params: { limit?: number; offset?: number } = {},
) {
  const search = new URLSearchParams();
  if (params.limit) search.set('limit', String(params.limit));
  if (params.offset) search.set('offset', String(params.offset));

  const res = await fetch(`${API_BASE}/teacher/creative-chatbot/history?${search.toString()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTeacherCreativeGeneration(token: string, id: number) {
  const res = await fetch(`${API_BASE}/teacher/creative-chatbot/generations/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

## Important Frontend Notes

- Do not set `Content-Type` manually for image generation. Let the browser set the multipart boundary automatically.
- The image endpoint can take longer than the text endpoint because it calls the image provider and uploads the result to media storage.
- Reference images are optional. If provided, use the exact field name `references`.
- Generated image Arabic text quality depends on the image provider. Keep requested text short and clear.
- API keys must never be exposed in frontend code.
