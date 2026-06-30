# بنك الأسئلة — طبقة الكتب (Books)

> جزء من التوثيق الرئيسي: [`questionBank.md`](./questionBank.md)  
> **دليل إدارة المادة الكامل:** [`question-bank-subject-management.md`](./question-bank-subject-management.md)

## الهيكل

```
مادة (subjects)
  └── كتاب (subject_books)        ← عدة كتب لنفس المادة
        └── فصل (chapters)        ← نفس الفصول في كل الكتب (مشتركة)
              └── درس (lessons)   ← نفس الدروس في كل الكتب (مشتركة)
                    └── أسئلة     ← مختلفة لكل كتاب (مرتبطة بـ lesson_id الخاص بذلك الكتاب)
```

**أمثلة:** فيزياء → «كتاب الامتحان»، «كتاب نيوتن» — نفس الفصول والدروس، أسئلة مختلفة لكل كتاب.

### سلوك تلقائي

| الحدث | ماذا يحدث |
|--------|-----------|
| إنشاء **كتاب ثانٍ** في المادة | يُنسَخ هيكل الفصول والدروس من أول كتاب (بدون أسئلة) |
| إضافة **فصل** لأي كتاب | يُضاف تلقائياً لباقي كتب نفس المادة |
| إضافة **درس** لأي فصل | يُضاف تلقائياً للفصل المتوازي في باقي الكتب |
| تعديل / حذف فصل أو درس | ينعكس على كل الكتب في المادة |

> الأسئلة تُضاف على `lesson_id` الخاص بالكتاب — لذلك كل كتاب يحتفظ بأسئلته الخاصة فقط.

## قاعدة البيانات

**جدول `subject_books`**

| العمود | النوع | الوصف |
|--------|------|--------|
| `id` | SERIAL | PK |
| `subject_id` | INTEGER | FK → subjects |
| `name` | TEXT | اسم الكتاب (فريد داخل المادة) |
| `description` | TEXT | |
| `image_url` | TEXT | |
| `order_num` | INTEGER | ترتيب العرض |
| `is_active` | BOOLEAN | |
| `created_by` | INTEGER | |
| `created_at` / `updated_at` | TIMESTAMP | |

**تعديل `chapters`:** عمود `book_id` → FK → `subject_books`

**Migration:** `migrations/1772700000000_question_bank_subject_books.sql`

- الفصول الموجودة تُنقل إلى كتاب **«كتاب عام»** لكل مادة
- تفرد اسم الفصل أصبح على مستوى **الكتاب** `(book_id, LOWER(name))`

---

## APIs — إدارة (Admin / Employee)

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/api/subjects/:subjectId/books` | قائمة الكتب |
| POST | `/api/subjects/:subjectId/books` | إنشاء كتاب |
| PUT | `/api/books/:id` | تعديل |
| DELETE | `/api/books/:id` | حذف (+ فصول cascade) |
| GET | `/api/books/:id/with-chapters` | كتاب + فصول + دروس |

### POST — إنشاء كتاب

```http
POST /api/subjects/5/books
Authorization: Bearer <token>
Content-Type: multipart/form-data

name=كتاب الامتحان
description=أسئلة الترم الأول
order_num=1
image=<file>
```

**Response 201:**

```json
{
  "success": true,
  "message": "تم إنشاء الكتاب بنجاح",
  "data": {
    "id": 3,
    "subject_id": 5,
    "name": "كتاب الامتحان",
    "order_num": 1,
    "is_active": true
  }
}
```

---

## APIs — الفصول (محدّث)

| Method | Path | ملاحظة |
|--------|------|--------|
| POST | `/api/books/:bookId/chapters` | **المفضّل** |
| POST | `/api/subjects/:subjectId/chapters` | Legacy — `book_id` أو أول كتاب |

---

## APIs — الطالب

| Method | Path |
|--------|------|
| GET | `/api/question-banks/student/subjects/:subjectId/books` |
| GET | `/api/question-banks/student/books/:bookId/chapters` |
| GET | `/api/question-banks/student/subjects/:subjectId/chapters` | legacy flat |

---

## APIs — المدرّس / عرض الشجرة

| Method | Path |
|--------|------|
| GET | `/api/teacher/subjects` | كل مادة فيها `books[]` + `chapters[]` flat |
| GET | `/api/teacher/subjects/:id/content` | `books`, `chapters`, `lessons`, `questions` |
| GET | `/api/subjects/:id/with-books` | Admin/Teacher |
| GET | `/api/question-banks/:id/with-subjects` | بنك كامل مع `books` nested |

---

## طلبات موافقة الموظف

نوع كيان جديد: `entity_type = book` في [`question_bank_admin_change_requests_api.md`](./question_bank_admin_change_requests_api.md)

---

## التوافق مع الإصدارات السابقة

| السلوك | الحالة |
|--------|--------|
| `chapters.subject_id` | ما زال موجوداً للاستعلامات |
| `subjects[].chapters` في API | قائمة مسطّحة (كل الكتب) |
| إنشاء فصل بدون كتاب | يرفض إن لم يوجد كتاب |
| Frontend قديم يتخطى الكتب | يعمل عبر `/subjects/:id/chapters` |

---

## سير العمل

1. إنشاء مادة
2. إنشاء كتاب أو أكثر
3. `POST /api/books/:bookId/chapters`
4. `POST /api/chapters/:chapterId/lessons`
5. إضافة أسئلة — [`question-bank-v2-api.md`](./question-bank-v2-api.md)
