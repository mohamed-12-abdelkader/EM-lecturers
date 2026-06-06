# API تقارير المدرس عن الطلاب

## نظرة عامة

هذا API يسمح للمدرس بجلب تقارير شاملة عن جميع الطلاب المشتركين في كورساته، مع تفاصيل كاملة عن:
- الكورسات المشترك فيها
- المحاضرات التي شاهدها
- الامتحانات التي أدّاها
- الدرجات التي حصل عليها

---

## Authentication

جميع APIs تتطلب token مصادقة في header:
```
Authorization: Bearer <token>
```

**الصلاحيات:** `teacher` فقط

---

## 📋 APIs

### 1. جلب جميع الطلاب المشتركين في كورسات المدرس

**GET** `/api/course/teacher/students`

**الوصف:** يجلب قائمة بجميع الطلاب المشتركين في أي من كورسات المدرس

**Request:**
```
GET /api/course/teacher/students
Authorization: Bearer <TEACHER_TOKEN>
```

**Response (200 OK):**
```json
{
  "students": [
    {
      "id": 78,
      "name": "أحمد محمد",
      "email": "ahmed@example.com",
      "phone": "01234567890",
      "courses_count": 3
    },
    {
      "id": 79,
      "name": "فاطمة علي",
      "email": "fatima@example.com",
      "phone": "01234567891",
      "courses_count": 2
    }
  ],
  "total": 2
}
```

**ملاحظات:**
- `courses_count`: عدد الكورسات التي اشترك فيها الطالب مع هذا المدرس
- القائمة مرتبة حسب اسم الطالب

**أخطاء محتملة:**

- **401 Unauthorized** - غير مصرح:
```json
{
  "message": "Unauthorized"
}
```

---

### 2. جلب تقرير مفصل لطالب معين

**GET** `/api/course/teacher/students/:studentId/report`

**الوصف:** يجلب تقرير شامل عن طالب معين يتضمن:
- معلومات الطالب الأساسية
- تفاصيل كل كورس مشترك فيه:
  - عدد المحاضرات الكلي
  - عدد المحاضرات المشاهدة
  - قائمة المحاضرات مع حالة المشاهدة
  - عدد الفيديوهات المشاهدة
  - امتحانات المحاضرات (أدّاها أم لا، الدرجة)
  - امتحانات الكورس (أدّاها أم لا، الدرجة، عدد المحاولات)
  - إحصائيات شاملة

**Request:**
```
GET /api/course/teacher/students/78/report
Authorization: Bearer <TEACHER_TOKEN>
```

**Response (200 OK):**
```json
{
  "student": {
    "id": 78,
    "name": "أحمد محمد",
    "email": "ahmed@example.com",
    "phone": "01234567890"
  },
  "courses": [
    {
      "courseId": 6,
      "courseTitle": "فيزياء 3 ثانوي",
      "totalLectures": 15,
      "watchedLecturesCount": 10,
      "notWatchedLecturesCount": 5,
      "watchedLectures": [
        {
          "lectureId": 1,
          "lectureTitle": "المحاضرة الأولى",
          "viewedAt": "2025-01-10T10:00:00.000Z"
        },
        {
          "lectureId": 2,
          "lectureTitle": "المحاضرة الثانية",
          "viewedAt": "2025-01-12T14:30:00.000Z"
        }
      ],
      "allLectures": [
        {
          "lectureId": 1,
          "lectureTitle": "المحاضرة الأولى",
          "isWatched": true,
          "viewedAt": "2025-01-10T10:00:00.000Z"
        },
        {
          "lectureId": 2,
          "lectureTitle": "المحاضرة الثانية",
          "isWatched": true,
          "viewedAt": "2025-01-12T14:30:00.000Z"
        },
        {
          "lectureId": 3,
          "lectureTitle": "المحاضرة الثالثة",
          "isWatched": false,
          "viewedAt": null
        }
      ],
      "watchedVideosCount": 25,
      "totalVideoViews": 30,
      "lectureExams": [
        {
          "examId": 1,
          "examTitle": "امتحان المحاضرة الأولى",
          "lectureTitle": "المحاضرة الأولى",
          "type": "lecture_exam",
          "hasSubmitted": true,
          "totalGrade": 20,
          "obtainedGrade": 18,
          "passed": true,
          "submittedAt": "2025-01-15T10:00:00.000Z"
        },
        {
          "examId": 2,
          "examTitle": "امتحان المحاضرة الثانية",
          "lectureTitle": "المحاضرة الثانية",
          "type": "lecture_exam",
          "hasSubmitted": false,
          "totalGrade": null,
          "obtainedGrade": null,
          "passed": null,
          "submittedAt": null
        }
      ],
      "courseExams": [
        {
          "examId": 3,
          "examTitle": "امتحان نهاية الكورس",
          "questionsCount": 20,
          "durationMinutes": 60,
          "type": "course_exam",
          "hasAttempted": true,
          "attemptsCount": 2,
          "lastAttempt": {
            "attemptNumber": 2,
            "status": "submitted",
            "totalGrade": 20,
            "obtainedGrade": 16,
            "startedAt": "2025-01-20T10:00:00.000Z",
            "submittedAt": "2025-01-20T11:00:00.000Z"
          },
          "allAttempts": [
            {
              "attemptNumber": 2,
              "status": "submitted",
              "totalGrade": 20,
              "obtainedGrade": 16,
              "startedAt": "2025-01-20T10:00:00.000Z",
              "submittedAt": "2025-01-20T11:00:00.000Z"
            },
            {
              "attemptNumber": 1,
              "status": "submitted",
              "totalGrade": 20,
              "obtainedGrade": 14,
              "startedAt": "2025-01-18T09:00:00.000Z",
              "submittedAt": "2025-01-18T10:00:00.000Z"
            }
          ]
        },
        {
          "examId": 4,
          "examTitle": "امتحان الفصل الأول",
          "questionsCount": 15,
          "durationMinutes": 45,
          "type": "course_exam",
          "hasAttempted": false,
          "attemptsCount": 0,
          "lastAttempt": null,
          "allAttempts": []
        }
      ],
      "statistics": {
        "totalExams": 4,
        "submittedExams": 2,
        "notSubmittedExams": 2,
        "totalLectures": 15,
        "watchedLecturesCount": 10,
        "notWatchedLecturesCount": 5,
        "averageGrade": 85.0,
        "totalObtainedGrade": 34,
        "totalMaxGrade": 40
      }
    }
  ],
  "overallStatistics": {
    "totalCourses": 1,
    "totalLectures": 15,
    "watchedLectures": 10,
    "totalExams": 4,
    "submittedExams": 2,
    "overallAverageGrade": 85.0
  }
}
```

**شرح الحقول:**

#### معلومات الطالب:
- `id`: معرف الطالب
- `name`: اسم الطالب
- `email`: البريد الإلكتروني
- `phone`: رقم الهاتف

#### معلومات الكورس:
- `courseId`: معرف الكورس
- `courseTitle`: عنوان الكورس
- `totalLectures`: إجمالي عدد المحاضرات
- `watchedLecturesCount`: عدد المحاضرات المشاهدة
- `notWatchedLecturesCount`: عدد المحاضرات غير المشاهدة
- `watchedLectures`: قائمة المحاضرات المشاهدة مع موعد المشاهدة
- `allLectures`: قائمة جميع المحاضرات مع حالة المشاهدة
- `watchedVideosCount`: عدد الفيديوهات المختلفة المشاهدة
- `totalVideoViews`: إجمالي عدد مشاهدات الفيديوهات

#### امتحانات المحاضرات:
- `examId`: معرف الامتحان
- `examTitle`: عنوان الامتحان
- `lectureTitle`: عنوان المحاضرة
- `type`: نوع الامتحان (`lecture_exam`)
- `hasSubmitted`: هل أدّى الامتحان
- `totalGrade`: الدرجة الكلية
- `obtainedGrade`: الدرجة التي حصل عليها
- `passed`: هل نجح
- `submittedAt`: موعد التسليم

#### امتحانات الكورس:
- `examId`: معرف الامتحان
- `examTitle`: عنوان الامتحان
- `questionsCount`: عدد الأسئلة
- `durationMinutes`: مدة الامتحان بالدقائق
- `type`: نوع الامتحان (`course_exam`)
- `hasAttempted`: هل حاول أداء الامتحان
- `attemptsCount`: عدد المحاولات
- `lastAttempt`: معلومات آخر محاولة
- `allAttempts`: قائمة بجميع المحاولات

#### الإحصائيات:
- `totalExams`: إجمالي عدد الامتحانات
- `submittedExams`: عدد الامتحانات المؤدّاة
- `notSubmittedExams`: عدد الامتحانات غير المؤدّاة
- `averageGrade`: متوسط الدرجة (نسبة مئوية)
- `totalObtainedGrade`: إجمالي الدرجات المحصلة
- `totalMaxGrade`: إجمالي الدرجات الكلية

#### الإحصائيات الشاملة:
- `totalCourses`: إجمالي عدد الكورسات
- `totalLectures`: إجمالي عدد المحاضرات
- `watchedLectures`: إجمالي عدد المحاضرات المشاهدة
- `totalExams`: إجمالي عدد الامتحانات
- `submittedExams`: إجمالي عدد الامتحانات المؤدّاة
- `overallAverageGrade`: المتوسط العام للدرجات

**أخطاء محتملة:**

- **400 Bad Request** - معرف طالب غير صحيح:
```json
{
  "message": "Invalid student ID"
}
```

- **404 Not Found** - الطالب غير موجود أو غير مشترك في كورسات المدرس:
```json
{
  "message": "Student not found or not enrolled in your courses"
}
```

- **403 Forbidden** - غير مصرح:
```json
{
  "message": "Forbidden: insufficient role"
}
```

---

## أمثلة استخدام

### مثال 1: جلب جميع الطلاب
```javascript
const getTeacherStudents = async (token) => {
  const response = await fetch('http://localhost:8000/api/course/teacher/students', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### مثال 2: جلب تقرير طالب معين
```javascript
const getStudentReport = async (studentId, token) => {
  const response = await fetch(`http://localhost:8000/api/course/teacher/students/${studentId}/report`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return await response.json();
};
```

### مثال 3: سيناريو كامل
```javascript
// 1. جلب جميع الطلاب
const { students } = await getTeacherStudents(teacherToken);
console.log(`Total students: ${students.length}`);

// 2. جلب تقرير لكل طالب
for (const student of students) {
  const report = await getStudentReport(student.id, teacherToken);
  
  console.log(`\nStudent: ${report.student.name}`);
  console.log(`Courses: ${report.overallStatistics.totalCourses}`);
  console.log(`Watched Lectures: ${report.overallStatistics.watchedLectures}`);
  console.log(`Submitted Exams: ${report.overallStatistics.submittedExams}`);
  console.log(`Average Grade: ${report.overallStatistics.overallAverageGrade}%`);
  
  // تفاصيل كل كورس
  report.courses.forEach(course => {
    console.log(`\n  Course: ${course.courseTitle}`);
    console.log(`    Lectures: ${course.watchedLecturesCount}/${course.totalLectures}`);
    console.log(`    Exams: ${course.statistics.submittedExams}/${course.statistics.totalExams}`);
    console.log(`    Average: ${course.statistics.averageGrade}%`);
  });
}
```

---

## ملاحظات مهمة

1. **الصلاحيات**: فقط المدرس يمكنه الوصول إلى تقارير طلابه
2. **البيانات**: التقرير يجمع بيانات من جداول متعددة:
   - `enrollments`: الاشتراكات
   - `lectures`: المحاضرات
   - `lecture_views`: مشاهدات المحاضرات
   - `video_views`: مشاهدات الفيديوهات
   - `exams`: امتحانات المحاضرات
   - `exam_submissions`: نتائج امتحانات المحاضرات
   - `course_level_exams`: امتحانات الكورس
   - `course_level_exam_attempts`: محاولات امتحانات الكورس

3. **الأداء**: التقرير المفصل قد يستغرق وقتاً أطول إذا كان الطالب مشترك في عدة كورسات

4. **الدرجات**: يتم حساب المتوسط بناءً على جميع الامتحانات المؤدّاة (محاضرات وكورسات)

