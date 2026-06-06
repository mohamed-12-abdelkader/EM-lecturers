## نظام الصلاحيات للمدرس (Teacher Permissions)

يوضّح هذا المستند واجهات برمجة التطبيقات المتعلقة بمنح صلاحيات المواد للمدرسين، وجلب محتوى المواد، وإضافة الأسئلة للمراجعة.

- جميع المسارات تعمل تحت البادئة: `/api`
- المصادقة: JWT عبر ترويسة `Authorization: Bearer <TOKEN>`
- الأدوار المدعومة: `admin`, `teacher`

### المصادقة (JWT)
أرسل التوكن في كل طلب محمي:

```
Authorization: Bearer <YOUR_TOKEN>
```

---

### نقاط النهاية (الأدمن)

1) منح مدرس لمادة

- POST `/admin/assign-subject`
- الدور المطلوب: admin
- الجسم:

```json
{
  "teacherId": 5,
  "subjectId": 12
}
```

- الاستجابة (201):

```json
{
  "success": true,
  "message": "تم تعيين المدرس للمادة بنجاح",
  "data": {
    "id": 123,
    "teacher_id": 5,
    "subject_id": 12,
    "can_edit": true,
    "can_delete": false,
    "can_create_content": true,
    "can_view": true,
    "assigned_by": 1,
    "assigned_at": "2025-01-01T00:00:00.000Z"
  }
}
```

2) جلب مواد مدرس معيّن

- GET `/admin/teachers/:id/subjects`
- الدور المطلوب: admin
- الاستجابة (200):

```json
{ "success": true, "data": [ { "subject_id": 12, "subject_name": "Math" } ] }
```

3) جلب الأسئلة المعلّقة للمراجعة

- GET `/admin/questions/pending`
- الدور المطلوب: admin
- الاستجابة (200):

```json
{ "success": true, "data": [ { "id": 77, "status": "pending", "lesson_id": 10, "question_text": "..." } ] }
```

4) الموافقة على سؤال معلّق

- PUT `/admin/questions/:id/approve`
- الدور المطلوب: admin
- الاستجابة (200):

```json
{ "success": true, "message": "تمت الموافقة على السؤال", "data": { "id": 77, "status": "approved" } }
```

5) رفض سؤال معلّق

- PUT `/admin/questions/:id/reject`
- الدور المطلوب: admin
- الاستجابة (200):

```json
{ "success": true, "message": "تم رفض السؤال", "data": { "id": 77, "status": "rejected" } }
```

---

### نقاط النهاية (المدرس)

1) جلب جميع مواد المدرس الحالي

- GET `/teacher/subjects`
- الدور المطلوب: teacher
- الاستجابة (200):

```json
{ "success": true, "data": [ { "id": 12, "name": "Math" } ] }
```

2) جلب محتوى مادة (فصول، دروس، أسئلة معتمدة فقط)

- GET `/teacher/subjects/:id/content`
- الدور المطلوب: teacher (ويجب أن يكون مكلّفاً بهذه المادة)
- الاستجابة (200):

```json
{
  "success": true,
  "data": {
    "chapters": [ { "id": 1, "name": "Chapter 1" } ],
    "lessons": [ { "id": 10, "name": "Lesson 1" } ],
    "questions": [ { "id": 77, "status": "approved", "lesson_id": 10 } ]
  }
}
```

3) إضافة سؤال اختيار من متعدد (MCQ) لدرس (حالة السؤال = pending)

- POST `/teacher/lessons/:id/questions`
- الدور المطلوب: teacher (ويجب أن يكون مكلّفاً بمادة هذا الدرس)
- الجسم:

```json
{
  "question_text": "What is 2 + 3?",
  "options": ["4", "5", "6", "7"]
}
```

- الاستجابة (201):

```json
{
  "success": true,
  "message": "تم إضافة السؤال للمراجعة",
  "data": { "id": 99, "status": "pending", "lesson_id": 10 }
}
```

ملاحظة: يتم إظهار الأسئلة فقط بعد موافقة الأدمن (status = approved).

---

### أمثلة سريعة (cURL)

تعيين مدرس لمادة (Admin):

```bash
curl -X POST "http://localhost:8000/api/admin/assign-subject" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"teacherId":5,"subjectId":12}'
```

جلب مواد المدرس (Teacher):

```bash
curl -X GET "http://localhost:8000/api/teacher/subjects" \
  -H "Authorization: Bearer TEACHER_TOKEN"
```

إضافة سؤال لدرس (Teacher):

```bash
curl -X POST "http://localhost:8000/api/teacher/lessons/10/questions" \
  -H "Authorization: Bearer TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question_text":"What is 2 + 3?","options":["4","5","6","7"]}'
```

اعتماد سؤال (Admin):

```bash
curl -X PUT "http://localhost:8000/api/admin/questions/99/approve" \
  -H "Authorization: Bearer ADMIN_TOKEN"
```

---

### ملاحظات تنفيذية
- يتم التأكد من أن المدرس لا يرى إلا المواد المكلف بها عبر جدول `teacher_subjects`.
- عند إضافة سؤال من قبل المدرس تكون حالته `pending` ولا يظهر ضمن جلب الأسئلة في محتوى المادة إلا بعد الموافقة.
- جميع الاستجابات بصيغة JSON مع مفاتيح `success`, `message`, `data` حيثما ينطبق.



