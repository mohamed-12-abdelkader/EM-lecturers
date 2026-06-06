## League API (دوري الصفوف)

يوضح هذا المستند واجهات برمجة التطبيقات الخاصة بنظام الدوريات (Leagues) كما تم تنفيذها في الخادم.

- مسار الأساس لجميع النقاط: `/api/leagues`
- الرفع يتم عبر الحقل `image` من نوع ملف (FormData)
- الصلاحيات:
  - إنشاء/تعديل/حذف: مسؤول فقط (admin) مع ترويسة مصادقة `Authorization: Bearer <token>`
  - العرض والقوائم: عام (بدون مصادقة)

### نموذج بيانات الدوري
- الاسم: `name` (مطلوب، نص)
- الصف الدراسي: `grade_id` (مطلوب، رقم من جدول `grades`)
- صورة: `image` (اختياري، ملف صورة png/jpg/jpeg/webp/gif)
- عدد المباريات: `matches_count` (مطلوب، رقم > 0)
- تاريخ البداية: `start_date` (مطلوب، ISO أو YYYY-MM-DD)
- تاريخ النهاية: `end_date` (مطلوب، يجب أن يكون بعد تاريخ البداية)
- الوصف: `description` (اختياري، نص)
- السعر: `price` (اختياري، رقم؛ إذا تُرك فارغاً يعتبر مجاني/NULL)

الحقول المرجعية في الاستجابة قد تتضمن كذلك: `id`, `grade_name`, `created_at`, `updated_at`, `image_url`.

---

### 1) إنشاء دوري جديد
- POST `/api/leagues`
- الحماية: Admin فقط
- النوع: `multipart/form-data`

الحقول في FormData:
- `name` (required)
- `grade_id` (required, number)
- `matches_count` (required, number)
- `start_date` (required, YYYY-MM-DD)
- `end_date` (required, YYYY-MM-DD, > start_date)
- `description` (optional)
- `price` (optional, number؛ اتركه فارغاً ليصبح مجاني)
- `image` (optional, file)

مثال cURL:
```bash
curl -X POST \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -F "name=دوري ثالثة ثانوي" \
  -F "grade_id=9" \
  -F "matches_count=10" \
  -F "start_date=2025-10-01" \
  -F "end_date=2025-12-15" \
  -F "description=وصف مختصر" \
  -F "price=99.99" \
  -F "image=@/path/to/image.png" \
  https://<host>/api/leagues
```

استجابة نجاح 201:
```json
{
  "id": 1,
  "name": "دوري ثالثة ثانوي",
  "grade_id": 9,
  "image_url": "https://.../media/abcd1234.png",
  "matches_count": 10,
  "start_date": "2025-10-01",
  "end_date": "2025-12-15",
  "description": "وصف مختصر",
  "price": 99.99,
  "created_by": 2,
  "created_at": "2025-09-11T10:00:00.000Z",
  "updated_at": "2025-09-11T10:00:00.000Z"
}
```

أخطاء محتملة 400:
```json
{ "message": "name, grade_id, matches_count, start_date, end_date are required" }
```
```json
{ "message": "end_date must be after start_date" }
```

---

### 2) عرض جميع الدوريات (أدمن فقط)
- GET `/api/leagues`
- الحماية: Admin فقط

مثال استجابة 200:
```json
[
  {
    "id": 1,
    "name": "دوري ثالثة ثانوي",
    "grade_id": 9,
    "grade_name": "الصف الثالث الثانوي",
    "image_url": "https://.../media/abcd1234.png",
    "matches_count": 10,
    "start_date": "2025-10-01",
    "end_date": "2025-12-15",
    "description": "وصف مختصر",
    "price": 99.99,
    "created_at": "2025-09-11T10:00:00.000Z",
    "updated_at": "2025-09-11T10:00:00.000Z"
  }
]
```

---

### 3) عرض الدوريات المتاحة للطالب حسب صفه
- GET `/api/leagues/student`
- الحماية: طالب فقط (Authorization: Bearer <token>)

يعيد جميع الدوريات المرتبطة بأي صف من صفوف الطالب (من جدول `user_grades`) ويضيف حقل `is_enrolled` لبيان حالة الاشتراك.

استجابة 200:
```json
[
  {
    "id": 1,
    "name": "دوري ثالثة ثانوي",
    "grade_id": 9,
    "grade_name": "الصف الثالث الثانوي",
    "image_url": "https://.../media/abcd1234.png",
    "matches_count": 10,
    "start_date": "2025-10-01",
    "end_date": "2025-12-15",
    "description": "وصف مختصر",
    "price": 99.99,
    "is_enrolled": false,
    "created_at": "2025-09-11T10:00:00.000Z",
    "updated_at": "2025-09-11T10:00:00.000Z"
  }
]
```

---

### 4) عرض تفاصيل دوري بالمعرف
- GET `/api/leagues/:id`
- الحماية: أدمن أو طالب مشترك في هذا الدوري

استجابة 200:
```json
{
  "id": 1,
  "name": "دوري ثالثة ثانوي",
  "grade_id": 9,
  "grade_name": "الصف الثالث الثانوي",
  "image_url": "https://.../media/abcd1234.png",
  "matches_count": 10,
  "start_date": "2025-10-01",
  "end_date": "2025-12-15",
  "description": "وصف مختصر",
  "price": 99.99,
  "created_at": "2025-09-11T10:00:00.000Z",
  "updated_at": "2025-09-11T10:00:00.000Z"
}
```

غير موجود 404:
```json
{ "message": "League not found" }
```

ممنوع 403 (طالب غير مشترك):
```json
{ "message": "Forbidden: enroll to access league" }
```

---

### 5) تحديث دوري
- PUT `/api/leagues/:id`
- الحماية: Admin فقط
- النوع: `multipart/form-data`

كل الحقول اختيارية في التحديث. إن أرسلت `image` فسيتم رفع صورة جديدة.
التحقق: إذا أرسلت تاريخي بداية ونهاية معاً فـ `end_date` يجب أن يكون بعد `start_date`.

مثال cURL (تعديل الاسم وعدد المباريات فقط):
```bash
curl -X PUT \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -F "name=دوري 3 ثانوي (محدث)" \
  -F "matches_count=12" \
  https://<host>/api/leagues/1
```

استجابة 200:
```json
{
  "id": 1,
  "name": "دوري 3 ثانوي (محدث)",
  "grade_id": 9,
  "image_url": "https://.../media/abcd1234.png",
  "matches_count": 12,
  "start_date": "2025-10-01",
  "end_date": "2025-12-15",
  "description": "وصف مختصر",
  "price": 99.99,
  "created_at": "2025-09-11T10:00:00.000Z",
  "updated_at": "2025-09-11T11:00:00.000Z"
}
```

أخطاء محتملة 400:
```json
{ "message": "end_date must be after start_date" }
```

غير موجود 404:
```json
{ "message": "League not found" }
```

---

### 6) حذف دوري
- DELETE `/api/leagues/:id`
---

### 7) اشتراك الطالب في دوري (مجاني فقط حالياً)
- POST `/api/leagues/:id/join`
- الحماية: طالب فقط

القواعد:
- إذا كان الدوري مجاني (`price` NULL) يتم تفعيل الاشتراك مباشرة (`is_enrolled = true`).
- إذا كان الدوري مدفوع سيتم رفض الطلب بكود 402 مؤقتاً حتى إضافة الدفع لاحقاً.

استجابات متوقعة:
- 200:
```json
{ "success": true, "message": "تم الاشتراك في الدوري", "data": { "joined": true } }
```
- 402:
```json
{ "message": "هذا الدوري مدفوع" }
```
- 404:
```json
{ "message": "الدوري غير موجود" }
```
- الحماية: Admin فقط

استجابة 200:
```json
{ "success": true }
```

غير موجود 404:
```json
{ "message": "League not found" }
```

---

### 8) قائمة الطلاب المشتركين في دوري (أدمن فقط)
- GET `/api/leagues/:id/students`
- الحماية: Admin فقط

يعرض قائمة الطلاب المشتركين في دوري محدد مع بعض البيانات الأساسية.

استجابة 200:
```json
{
  "success": true,
  "data": [
    {
      "subscription_id": 12,
      "joined_at": "2025-09-12T10:22:33.000Z",
      "student_id": 45,
      "student_name": "طالب تجريبي",
      "student_email": "student@example.com",
      "grade_id": 9,
      "grade_name": "الصف الثالث الثانوي"
    }
  ]
}
```

أخطاء:
- 404: `{ "message": "League not found" }`
- 400: `{ "message": "Invalid league id" }`

### ملاحظات مهمة
---

## League Matches (مباريات الدوري)

### إنشاء مباراة جديدة في دوري (أدمن فقط)
- POST `/api/leagues/:id/matches`
- النوع: multipart/form-data
- الحقول:
  - `name` (مطلوب)
  - `description` (اختياري)
  - `image` (اختياري ملف صورة)
  - `is_visible` (اختياري، true/false)
  - `start_date` (مطلوب، YYYY-MM-DD)
  - `start_time` (مطلوب، HH:MM)
  - `end_time` (مطلوب، HH:MM) ويجب أن تكون بعد `start_time`

استجابة 201:
```json
{
  "id": 7,
  "league_id": 1,
  "name": "المباراة الأولى",
  "description": "وصف",
  "image_url": "https://...",
  "is_visible": true,
  "start_date": "2025-10-01",
  "start_time": "09:00",
  "end_time": "10:00",
  "created_at": "2025-09-12T10:00:00.000Z",
  "updated_at": "2025-09-12T10:00:00.000Z"
}
```

### عرض مباريات دوري معين
- GET `/api/leagues/:id/matches`
- الحماية:
  - أدمن: تعرض جميع المباريات
  - طالب: يشترط الاشتراك في الدوري وتعرض المباريات المرئية فقط

استجابة 200:
```json
[
  { "id": 7, "league_id": 1, "name": "المباراة الأولى", "description": "وصف", "image_url": null, "is_visible": true, "start_date": "2025-10-01", "start_time": "09:00", "end_time": "10:00", "is_ended": false, "created_at": "..." }
]
```

### تعديل مباراة (أدمن فقط)
- PUT `/api/leagues/matches/:matchId`
- النوع: multipart/form-data (يمكن إرسال صورة جديدة)
 - يمكن تعديل: `name`, `description`, `image`, `is_visible`, `start_date`, `start_time`, `end_time` (مع التحقق أن `end_time` > `start_time`)

استجابة 200: يعيد الكيان بعد التعديل.

### إظهار/إخفاء مباراة (أدمن فقط)
- PATCH `/api/leagues/matches/:matchId/toggle-visibility`

استجابة 200:
```json
{ "success": true, "data": { "id": 7, "is_visible": false, "...": "..." } }
```

### حذف مباراة (أدمن فقط)
### تفاصيل مباراة (أدمن أو طالب مشترك)
- GET `/api/leagues/matches/:matchId`
- الحماية:
  - أدمن: وصول كامل
  - طالب: يجب أن يكون مشتركًا في الدوري الخاص بالمباراة وأن تكون المباراة مرئية

استجابة 200:
```json
{
  "id": 7,
  "league_id": 1,
  "name": "المباراة الأولى",
  "description": "وصف",
  "image_url": null,
  "is_visible": true,
  "start_date": "2025-10-01",
  "start_time": "09:00",
  "end_time": "10:00",
  "is_ended": false,
  "created_at": "...",
  "updated_at": "..."
}
```

أخطاء:
- 403: `{ "message": "Forbidden: enroll to access match" }` أو `{ "message": "Forbidden: match hidden" }`
- 404: `{ "message": "Match not found" }`

- DELETE `/api/leagues/matches/:matchId`

استجابة 200:
```json
{ "success": true }
```
- الحقول المطلوبة في الإنشاء: `name`, `grade_id`, `matches_count`, `start_date`, `end_date`.
- صلاحية الصور: الامتدادات `jpeg|jpg|png|gif|webp` وبحجم أقصى 5MB.
- يتم رفع الصور إلى التخزين عبر BunnyCDN ويُعاد رابط `image_url` في الاستجابة.
- إذا كان `price` فارغاً أو غير مُرسل، يُخزن كـ NULL ويظهر كـ "Free" في الواجهة.

---

### 9) إلغاء اشتراك طالب في دوري (أدمن فقط)
- DELETE `/api/leagues/:id/students/:studentId`
- الحماية: Admin فقط

يقوم بإلغاء اشتراك الطالب فوراً عبر تعيين `is_active = false` في `league_students`.

استجابة 200:
```json
{ "success": true, "message": "تم إلغاء اشتراك الطالب" }
```

أخطاء:
- 404: `{ "message": "League not found" }`
- 404: `{ "message": "Subscription not found or already cancelled" }`
- 400: `{ "message": "Invalid ids" }`

## أسئلة MCQ لمباريات الدوري

> هذه الأسئلة منفصلة تمامًا عن أي نظام أسئلة آخر بالموقع.

### إضافة مجموعة أسئلة بنص حر (أدمن فقط)
- POST `/api/leagues/matches/:matchId/questions/bulk`
- body (JSON):
```json
{ "text": "السؤال الأول؟\nA) الخيار الأول\nB) الخيار الثاني\nC) الخيار الثالث\nD) الخيار الرابع\n\nالسؤال الثاني؟\nA) الخيار الأول\nB) الخيار الثاني\nC) الخيار الثالث\nD) الخيار الرابع" }
```
- استجابة 201: مصفوفة أسئلة بالشكل:
```json
[
  {
    "id": 26,
    "match_id": 38,
    "text": "...",
    "options": ["(أ) ...", "(ب) ...", "(ج) ...", "(د) ..."],
    "correct_answer": null,
    "image": null,
    "created_at": "...",
    "updated_at": "..."
  }
]
```

### إضافة سؤال واحد (أدمن فقط)
- POST `/api/leagues/matches/:matchId/questions`
- body (JSON): `{ text, option_a, option_b, option_c, option_d }`
- استجابة 201: كائن السؤال بنفس الشكل أعلاه.

### تعديل سؤال (أدمن فقط)
- PUT `/api/leagues/questions/:questionId`
- body (JSON): أي من `{ text, option_a, option_b, option_c, option_d }`
- استجابة 200: كائن السؤال بعد التعديل.

### حذف سؤال (أدمن فقط)
- DELETE `/api/leagues/questions/:questionId`
- استجابة 200: `{ "success": true }`

### رفع صورة لسؤال (أدمن فقط)
- POST `/api/leagues/questions/:questionId/image`
- النوع: multipart/form-data بحقل `image`
- استجابة 200: كائن السؤال مع `image` محدثة.

### تحديد الإجابة الصحيحة (أدمن فقط)
- POST `/api/leagues/questions/:questionId/correct-answer`
- body (JSON): `{ "correct_answer": "A" }` (أو B/C/D، أو null لإزالة)
- استجابة 200: كائن السؤال بعد تحديث الإجابة.


