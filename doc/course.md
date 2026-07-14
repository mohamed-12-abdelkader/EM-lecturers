# �� توثيق API الكورسات والمحاضرات

---

## 1. إنشاء كورس جديد
- **المسار:**  
  `POST /course`
- **الصلاحية:** مدرس فقط (Teacher)
- **Content-Type:** `multipart/form-data` أو `application/json`
- **Body:**
  ```
  title: "كورس فيزياء ثانوي"
  price: 150
  description: "شرح شامل لمنهج الفيزياء"
  grade_ids: [4, 5, 6]     # مفضل — أكتر من صف
  # أو للتوافق مع القديم:
  # grade_id: 4
  avatar: [ملف صورة - اختياري]
  is_free: false
  ```
- **ملاحظات الصفوف:**
  - `grade_ids` مصفوفة أرقام (أو نص `"4,5,6"` / JSON `"[4,5,6]"` في multipart)
  - الكورس يظهر لكل الصفوف المختارة عند الطالب/الفلاتر
  - `grade_id` في الرد = أول صف (للتوافق مع الشات والقديم)
  - الرد يتضمن أيضاً `grade_ids` و `grades: [{id, name}, ...]`
- **ملاحظات الصورة:**
  - أنواع الصور المسموحة: JPG, JPEG, PNG, GIF, WEBP
  - الحجم الأقصى: 5MB
  - اسم الحقل: `avatar`
- **الاستجابة:**
  ```json
  {
    "course": {
      "id": 1,
      "title": "كورس فيزياء ثانوي",
      "price": "150.00",
      "description": "شرح شامل لمنهج الفيزياء",
      "grade_id": 4,
      "grade_ids": [4, 5, 6],
      "grades": [
        { "id": 4, "name": "أولى ثانوي" },
        { "id": 5, "name": "تانية ثانوي" },
        { "id": 6, "name": "تالتة ثانوي" }
      ],
      "teacher_id": 5,
      "avatar": "...",
      "created_at": "2024-06-01T12:34:56.000Z"
    }
  }
  ```

---

## 2. تعديل كورس
- **المسار:**  
  `PUT /course/:id`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **Content-Type:** `multipart/form-data` أو `application/json`
- **Body:** (أرسل فقط الحقول التي تريد تعديلها)
  ```
  title: "اسم جديد (اختياري)"
  price: 200
  description: "وصف جديد (اختياري)"
  grade_ids: [4, 5]   # أو grade_id: 4
  avatar: [ملف صورة جديد - اختياري]
  ```
  - **ملاحظات الصورة:**

  - إذا تم رفع صورة جديدة، سيتم حذف الصورة القديمة تلقائياً
  - أنواع الصور المسموحة: JPG, JPEG, PNG, GIF, WEBP
  - الحجم الأقصى: 5MB


- **الاستجابة:**
  ```json
  {
    "course": {
      "id": 1,
      "title": "اسم جديد",
      "price": "200.00",
      "description": "وصف جديد",
      "grade_id": 4,
      "teacher_id": 5,
      "avatar": "http://localhost:8000/uploads/course-1234567890-123456789.jpg",
      "created_at": "2024-06-01T12:34:56.000Z"
    }
  }
  ```


---

## 3. حذف كورس
- **المسار:**  
  `DELETE /course/:id`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **الاستجابة:**
  ```json
  {
    "message": "Course deleted successfully"
  }
  ```

---

## 4. عرض كل كورسات المدرس مع إمكانية الفلترة حسب الصف
- **المسار:**  
  `GET /course/my-courses`
- **الصلاحية:** مدرس فقط (Teacher)
- **الاستعلام (اختياري):**
  - `grade_id` (فلترة حسب الصف)
  - مثال: `/course/my-courses?grade_id=4`
- **الاستجابة:**
  ```json
  {
    "courses": [
      {
        "id": 1,
        "title": "كورس فيزياء أولى ثانوي",
        "price": "150.00",
        "description": "شرح شامل لمنهج الفيزياء",
        "grade_id": 4,
        "created_at": "2024-06-01T12:34:56.000Z"
      }
    ]
  }
  ```

---

## 5. عرض كورسات مدرس لطالب (حسب صف الطالب)
- **المسار:**  
  `GET /course/teacher/:teacherId`
- **الصلاحية:** طالب فقط (Student)
- **الوصف:** يعرض جميع الكورسات التي يقدمها مدرس معين ومخصصة لنفس صف الطالب.
- **الاستجابة:**
  ```json
  {
    "courses": [
      {
        "id": 1,
        "title": "كورس فيزياء أولى ثانوي",
        "price": "150.00",
        "description": "شرح شامل لمنهج الفيزياء",
        "grade_id": 4,
        "created_at": "2024-06-01T12:34:56.000Z",
        "is_activated": true
      }
    ]
  }
  ```

---

## 6. عرض الكورسات المشترك فيها الطالب
- **المسار:**
  `GET api/course/my-enrollments`
- **الصلاحية:** طالب فقط (Student)
- **الاستجابة:**
  ```json
  {
    "courses": [
      {
        "id": 1,
        "title": "كورس فيزياء أولى ثانوي",
        "price": "150.00",
        "description": "شرح شامل لمنهج الفيزياء",
        "teacher_id": 5,
        "created_at": "2024-06-01T12:34:56.000Z"
      }
    ]
  }
  ```

---

## 7. تفاصيل كورس مع المحاضرات والفيديوهات والملفات
- **المسار:**
  `GET /course/:courseId/details`
- **الصلاحية:** المدرس صاحب الكورس أو الطالب المشترك فقط
- **الاستجابة:**
  ```json
  {
    "course": {
      "id": 1,
      "title": "اللغة العربية",
      "description": "كورس شامل...",
      "price": 100,
      "teacher_id": 5,
      "created_at": "..."
    },
    "lectures": [
      {
        "id": 10,
        "course_id": 1,
        "title": "مقدمة الحروف",
        "description": "...",
        "position": 1,
        "created_at": "...",
        "videos": [
          {
            "id": 100,
            "lecture_id": 10,
            "video_url": "...",
            "title": "...",
            "position": 1
          }
        ],
        "files": [
          {
            "id": 200,
            "lecture_id": 10,
            "file_url": "...",
            "filename": "...",
            "uploaded_at": "..."
          }
        ]
      }
    ]
  }
  ```

---

## 8. إدارة المحاضرات (للأستاذ فقط)

### إضافة محاضرة جديدة
- **المسار:**
  `POST /course/:courseId/lectures`
- **Body (JSON):**
  ```json
  {
    "title": "عنوان المحاضرة",
    "description": "وصف المحاضرة (اختياري)",
    "position": 1
  }
  ```
- **الاستجابة:**
  ```json
  {
    "lecture": {
      "id": 1,
      "course_id": 5,
      "title": "عنوان المحاضرة",
      "description": "وصف المحاضرة",
      "position": 1,
      "created_at": "..."
    }
  }
  ```

### تعديل محاضرة
- **المسار:**
  `PUT /lecture/:lectureId`
- **Body (JSON):**
  ```json
  {
    "title": "عنوان جديد",
    "description": "وصف جديد",
    "position": 2
  }
  ```
- **الاستجابة:**
  ```json
  {
    "lecture": { ... }
  }
  ```

### حذف محاضرة
- **المسار:**
  `DELETE /lecture/:lectureId`
- **الاستجابة:**
  ```json
  {
    "message": "Lecture deleted successfully"
  }
  ```

---

## 9. إدارة فيديوهات وملفات المحاضرة (للأستاذ فقط)

### إضافة فيديو لمحاضرة
- **المسار:**
  `POST /lecture/:lectureId/videos`
- **Body (JSON):**
  ```json
  {
    "video_url": "https://...",
    "title": "عنوان الفيديو (اختياري)",
    "position": 1
  }
  ```
- **الاستجابة:**
  ```json
  {
    "video": { ... }
  }
  ```

### حذف فيديو من محاضرة
- **المسار:**
  `DELETE /lecture-video/:videoId`
- **الاستجابة:**
  ```json
  {
    "message": "Lecture video deleted successfully"
  }
  ```

### إضافة ملف PDF لمحاضرة
- **المسار:**
  `POST /lecture/:lectureId/files`
- **Body (JSON):**
  ```json
  {
    "file_url": "https://...",
    "filename": "اسم الملف.pdf"
  }
  ```
- **الاستجابة:**
  ```json
  {
    "file": { ... }
  }
  ```

### حذف ملف PDF من محاضرة
- **المسار:**
  `DELETE /lecture-file/:fileId`
- **الاستجابة:**
  ```json
  {
    "message": "Lecture file deleted successfully"
  }
  ```

---

## 10. عرض الطلاب المشتركين في كورس معين مع كود التفعيل المستخدم
- **المسار:**
  `GET /course/:courseId/enrollments`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **الاستجابة:**
  ```json
  {
    "students": [
      {
        "id": 7,
        "name": "أحمد علي",
        "email": "ahmed@example.com",
        "phone": "01000000000",
        "avatar": "رابط الصورة",
        "enrolled_at": "2024-01-15T10:30:00Z",
        "activation_code": "A1B2C3D4E5F6G7H8"
      }
    ]
  }
  ```

---

## 11. حذف طالب من كورس معين
- **المسار:**
  `DELETE /course/:courseId/student/:studentId`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **الوصف:** يحذف الطالب من الكورس ويحذف جميع البيانات المرتبطة به (الإجابات، المشاهدات، الحضور)
- **الاستجابة:**
  ```json
  {
    "message": "Student removed from course successfully",
    "details": {
      "course_id": 1,
      "course_title": "كورس فيزياء أولى ثانوي",
      "student_id": 7,
      "student_name": "أحمد علي"
    }
  }
  ```
- **ملاحظات:**
  - يتم حذف الطالب من جدول `enrollments`
  - يتم حذف جميع إجابات الطالب في امتحانات الكورس
  - يتم حذف جميع إجابات الطالب في امتحانات المحاضرات
  - يتم حذف جميع مشاهدات المحاضرات للطالب
  - يتم حذف جميع سجلات الحضور للطالب

---

## 12. فتح كورس لطالب معين
- **المسار:**
  `POST /course/:courseId/open-for-student/:studentId`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **الوصف:** يفتح كورس معين لطالب محدد مباشرة بدون الحاجة لكود تفعيل
- **الاستجابة:**
  ```json
  {
    "message": "Course opened for student successfully",
    "details": {
      "course_id": 1,
      "course_title": "كورس فيزياء أولى ثانوي",
      "student_id": 7,
      "student_name": "أحمد علي",
      "student_email": "ahmed@example.com",
      "enrolled_at": "2024-01-15T10:30:00Z"
    }
  }
  ```
- **ملاحظات:**
  - يتم إضافة الطالب مباشرة لجدول `enrollments`
  - يتم إنشاء إشعار للطالب بإضافة الكورس
  - لا يمكن فتح الكورس لطالب مشترك بالفعل
  - الطالب يجب أن يكون موجود في النظام

---

## أمثلة على الاستخدام

### إنشاء كورس مع صورة باستخدام cURL
```bash
curl -X POST \
  http://localhost:8000/api/course \
  -H "Authorization: Bearer YOUR_TEACHER_TOKEN" \
  -F "title=كورس فيزياء أولى ثانوي" \
  -F "price=150" \
  -F "description=شرح شامل لمنهج الفيزياء" \
  -F "grade_id=4" \
  -F "avatar=@/path/to/course-image.jpg"
```

**ملاحظة مهمة:** في `multipart/form-data`، الأرقام يتم إرسالها كنصوص، لكن النظام يحولها تلقائياً إلى أرقام.

### تعديل كورس مع صورة جديدة
```bash
curl -X PUT \
  http://localhost:8000/api/course/1 \
  -H "Authorization: Bearer YOUR_TEACHER_TOKEN" \
  -F "title=اسم جديد للكورس" \
  -F "price=200" \
  -F "avatar=@/path/to/new-image.jpg"
```

### إنشاء كورس بدون صورة
```bash
curl -X POST \
  http://localhost:8000/api/course \
  -H "Authorization: Bearer YOUR_TEACHER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "كورس فيزياء أولى ثانوي",
    "price": 150,
    "description": "شرح شامل لمنهج الفيزياء",
    "grade_id": 4
  }'
```

## ملاحظات مهمة

### الصور
- ✅ **أنواع مسموحة:** JPG, JPEG, PNG, GIF, WEBP
- ✅ **الحجم الأقصى:** 5MB
- ✅ **التخزين:** في مجلد `uploads/`
- ✅ **الوصول:** عبر URL كامل مع Base URL
- ✅ **الحذف التلقائي:** عند تحديث الصورة أو حذف الكورس

### الأمان
- 🔒 **الصلاحيات:** فقط المدرس صاحب الكورس
- 🔒 **التحقق:** من نوع وحجم الملف
- 🔒 **التنظيف:** حذف الملفات في حالة الخطأ

### الأخطاء المحتملة
- **400 Bad Request:** بيانات غير صحيحة أو ملف غير مسموح
- **401 Unauthorized:** توكن غير صحيح
- **404 Not Found:** الكورس غير موجود أو لا يخص المدرس
- **413 Payload Too Large:** حجم الملف أكبر من 5MB

## ملاحظات عامة
- جميع المسارات التي تتطلب صلاحية يجب إرسال توكن JWT في الهيدر:
  ```
  Authorization: Bearer <token>
  ```
- جميع الأسعار (`price`) ترجع كنص (string) من قاعدة البيانات.
- إذا أردت إضافة أو تعديل أي توثيق أو إضافة أمثلة أخرى، أخبرني بذلك!

---

### لتشغيل migration يدويًا:
نفذ الأمر التالي من مجلد المشروع:
```sh
pnpm exec node-pg-migrate up
```
أو إذا كان لديك سكريبت npm مخصص في `package.json` مثل:
```json
"scripts": {
  "migrate": "node-pg-migrate up"
}
```
يمكنك تشغيل:
```sh
<code_block_to_apply_changes_from>
```

---

هل تريد أنفذ لك أمر `pnpm exec node-pg-migrate up` الآن مباشرة؟
