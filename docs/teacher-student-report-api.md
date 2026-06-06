# تقرير المدرس عن طالب مشترك — بالاسم أو بالمعرّف

## نظرة عامة

المدرس يمكنه جلب **تقرير مفصل** لطالب مشترك في كورساته: عدد الكورسات، المحاضرات المشاهدة، الامتحانات المحلولة، الدرجات، ونسبة المشاهدة.

---

## 1. جلب التقرير بالاسم

```
GET /api/course/teacher/students/report-by-name?name=أحمد
```

**الصلاحية:** `teacher` فقط.

**Query:**

| المعامل | مطلوب | الوصف |
|--------|--------|--------|
| name   | نعم   | اسم الطالب (أو جزء منه) أو الإيميل — البحث غير حساس لحالة الأحرف |

**السلوك:**

- إذا وُجد **طالب واحد** مطابق → الاستجابة هي **التقرير المفصل** (نفس شكل القسم 3).
- إذا وُجد **أكثر من طالب** → تُرجع قائمة `matches` مع (id, name, email, courses_count) ورسالة توضيحية؛ استخدم `id` مع المسار `/teacher/students/:studentId/report` للحصول على التقرير.
- إذا لم يُوجد أي طالب → `404` مع رسالة "لا يوجد طالب مشترك معك بهذا الاسم".

**مثال طلب:**

```http
GET /api/course/teacher/students/report-by-name?name=محمد
Authorization: Bearer <teacher_token>
```

---

## 2. جلب التقرير بمعرّف الطالب

```
GET /api/course/teacher/students/:studentId/report
```

**الصلاحية:** `teacher` فقط. الطالب يجب أن يكون مشتركاً في كورس واحد على الأقل يخص هذا المدرس.

**الاستجابة (200):** نفس شكل التقرير المفصل أدناه.

---

## 3. شكل التقرير المفصل

```json
{
  "student": {
    "id": 10,
    "name": "أحمد محمد",
    "email": "ahmed@example.com",
    "phone": "01..."
  },
  "courses": [
    {
      "courseId": 5,
      "courseTitle": "رياضيات أولى ثانوي",
      "totalLectures": 12,
      "watchedLecturesCount": 8,
      "notWatchedLecturesCount": 4,
      "watchedVideosCount": 15,
      "totalVideoViews": 20,
      "watch_percentage": 72.5,
      "lectureExams": [ ... ],
      "courseExams": [ ... ],
      "statistics": {
        "totalExams": 5,
        "submittedExams": 4,
        "notSubmittedExams": 1,
        "totalLectures": 12,
        "watchedLecturesCount": 8,
        "notWatchedLecturesCount": 4,
        "averageGrade": 85.2,
        "totalObtainedGrade": 340,
        "totalMaxGrade": 400,
        "watch_percentage": 72.5
      },
      "allLectures": [ ... ],
      "watchedLectures": [ ... ]
    }
  ],
  "overallStatistics": {
    "totalCourses": 2,
    "totalLectures": 24,
    "watchedLectures": 16,
    "totalExams": 10,
    "submittedExams": 8,
    "overallAverageGrade": 82.5,
    "watch_percentage": 70.1
  }
}
```

**الحقول الرئيسية:**

- **student:** بيانات الطالب الأساسية.
- **courses:** لكل كورس مشترك فيه مع المدرس:
  - عدد المحاضرات وعدد ما شُوهد، عدد الفيديوهات المشاهدة، **نسبة المشاهدة** (`watch_percentage`) — متوسط نسبة إكمال الفيديوهات في هذا الكورس.
  - امتحانات المحاضرات (`lectureExams`) وامتحانات الكورس (`courseExams`) مع حالة الحل والدرجات.
  - **statistics:** إجماليات ودرجة متوسطة ونسبة مشاهدة للكورس.
- **overallStatistics:** إجمالي الكورسات، المحاضرات، الامتحانات المحلولة، الدرجة المتوسطة العامة، **نسبة المشاهدة العامة** (`watch_percentage`).

---

## 4. قائمة الطلاب (للمدرس)

```
GET /api/course/teacher/students
```

**الصلاحية:** `teacher` فقط.

**الاستجابة (200):** `{ "students": [ { "id", "name", "email", "phone", "courses_count" }, ... ], "total": N }` — كل الطلاب المشتركين في كورسات هذا المدرس.
