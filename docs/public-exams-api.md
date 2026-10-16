# Public Exams API — امتحانات عامة حسب الصف الدراسي

امتحانات مستقلة عن الكورسات، مربوطة بصف دراسي (`grade_id`)، وتُعاد استخدام جداول وإعدادات **الامتحان الشامل** (`course_level_exams` + أسئلة + محاولات + تصحيح).

| | |
|--|--|
| **Base** | `/api/public-exams` |
| **Scope** | `course_level_exams.exam_scope = 'public'` |
| **أهلية الطالب** | `user_grades` (تحقق Backend إلزامي) |

الأسئلة تُدار عبر مسارات الامتحان العام أدناه (أو مسارات `/api/exams/:examId/...` لنفس `examId`)، لأن الملكية تعتمد على `teacher_id` وليس على الكورس.

---

## معلم / أدمن

### إنشاء

`POST /api/public-exams` — أدوار المحتوى (`teacher`, `academy`, …)

```json
{
  "title": "امتحان مهم على الوحدة الأولى",
  "description": "وصف اختياري",
  "gradeId": 3,
  "durationMinutes": 45,
  "questionsCount": 20,
  "isVisibleToStudents": false,
  "isActive": true,
  "attemptLimit": 1,
  "questionDisplayMode": "ordered",
  "answersReleaseMode": "immediate",
  "availableFrom": null,
  "visibilityEndDate": null
}
```

- افتراضيًا المسودة: `isVisibleToStudents: false`.
- نفس إعدادات الامتحان الشامل (مدة، محاولات، عرض أسئلة، إظهار إجابات، …).

### قائمة المعلم

`GET /api/public-exams/teacher?gradeId=`

### تفاصيل / تعديل / حذف

- `GET /api/public-exams/:examId`
- `PATCH /api/public-exams/:examId` — نفس الحقول + `description` / `gradeId`
- `DELETE /api/public-exams/:examId`

### نشر / إلغاء نشر

- `POST /api/public-exams/:examId/publish` → `is_visible_to_students=true`, `is_active=true`
- `POST /api/public-exams/:examId/unpublish` → `is_visible_to_students=false`

### تقارير

- `GET /api/public-exams/:examId/grades`
- `GET /api/public-exams/:examId/report?passPercentage=50`  
  الشريحة المستهدفة من `user_grades` (طلاب المنصة/المعلم لنفس الصف)، وليس من `enrollments`.

### إضافة أسئلة

#### قائمة أسئلة الامتحان

`GET /api/public-exams/:examId/questions`

#### من بنك الأسئلة

`POST /api/public-exams/:examId/questions/from-bank`

```json
{
  "questionIds": [101, 102, 103]
}
```

بديل عبر مسار الامتحانات العام (يُكتشف تلقائيًا كـ public/course):

`POST /api/exams/:examId/questions/from-bank`  
Body اختياري: `"type": "public-exam"` أو `"course-exam"`

#### من مكتبة أسئلة المدرس

`POST /api/public-exams/:examId/questions/from-teacher-library`

```json
{
  "questionIds": [11, 12]
}
```

أو بالصف / الدرس / القطعة:

```json
{ "gradeId": 3 }
```
```json
{ "lessonId": 55 }
```
```json
{ "passageId": 9 }
```

بديل: `POST /api/exams/:examId/questions/from-teacher-library`  
أو `POST /api/exams/course-level/:examId/questions/from-teacher-library`

---


## طالب

### قائمة الامتحانات العامة لصف الطالب

`GET /api/public-exams/student`

يُرجع المنشور والمتاح فقط للصفوف في `user_grades`، مع حالة المحاولات (`can_attempt`, `availability_status`, …) بنفس منطق الامتحان الشامل.

### أداء الامتحان

نفس محرك الكورس:

| Method | URL |
|--|--|
| `POST` | `/api/public-exams/:examId/start` |
| `POST` | `/api/public-exams/:examId/autosave` |
| `POST` | `/api/public-exams/:examId/submit` |
| `GET` | `/api/public-exams/:examId/my-report` |
| `GET` | `/api/public-exams/:examId/student-report` |

يمكن أيضًا استخدام `/api/exams/:examId/start|submit|…` لنفس الـ `examId`؛ الوصول يُرفض إن لم يطابق صف الطالب.

---

## قاعدة البيانات

Migration: `1779700000000_public_exams_grade_scope.sql`

- `exam_scope` ∈ (`course`, `public`)
- `grade_id`, `teacher_id`, `description`
- `course_id` nullable للامتحانات العامة
- CHECK: public ⇒ `course_id IS NULL` + `grade_id` + `teacher_id`

امتحانات الكورس الحالية تبقى `exam_scope='course'` دون تغيير سلوك.
