# 📚 توثيق API الكورسات والمدرسين

---

## 1. إنشاء كورس جديد
- **المسار:**  
  `POST /api/course`
- **الصلاحية:** مدرس فقط (Teacher)
- **Body (JSON):**
  ```json
  {
    "title": "كورس فيزياء أولى ثانوي",
    "price": 150,
    "description": "شرح شامل لمنهج الفيزياء",
    "grade_id": 4
  }
  ```
- **الاستجابة:**
  ```json
  {
    "course": {
      "id": 1,
      "title": "كورس فيزياء أولى ثانوي",
      "price": "150.00",
      "description": "شرح شامل لمنهج الفيزياء",
      "grade_id": 4,
      "teacher_id": 5,
      "created_at": "..."
    }
  }
  ```

---

## 2. تعديل كورس
- **المسار:**  
  `PUT /api/course/:id`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **Body (JSON):** (أرسل فقط الحقول التي تريد تعديلها)
  ```json
  {
    "title": "اسم جديد (اختياري)",
    "price": 200,
    "description": "وصف جديد (اختياري)",
    "grade_id": 4
  }
  ```
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
      "created_at": "..."
    }
  }
  ```

---

## 3. حذف كورس
- **المسار:**  
  `DELETE /api/course/:id`
- **الصلاحية:** المدرس صاحب الكورس فقط
- **الاستجابة:**
  ```json
  {
    "message": "Course deleted successfully"
  }
  ```

---

## 4. عرض كورسات مدرس لطالب (حسب صف الطالب)
- **المسار:**  
  `GET /api/course/teacher/:teacherId`
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
        "teacher_id": 5,
        "created_at": "..."
      }
    ]
  }
  ```

---

## 5. عرض كل كورسات المدرس مع إمكانية الفلترة حسب الصف
- **المسار:**  
  `GET /api/course/my-courses`
- **الصلاحية:** مدرس فقط (Teacher)
- **الاستعلام (اختياري):**
  - `grade_id` (فلترة حسب الصف)
  - مثال: `/api/course/my-courses?grade_id=4`
- **الاستجابة:**
  ```json
  {
    "courses": [
      {
        "id": 1,
        "title": "كورس فيزياء أولى ثانوي",
        "price": "150.00",
        "description": "شرح شامل لمنهج الفيزياء",
        "grade_id": 4
      }
    ]
  }
  ```

---

## 6. تسجيل مدرس جديد
- **المسار:**  
  `POST /api/teacher`
- **الصلاحية:** Admin فقط
- **Body (form-data أو JSON):**
  - الحقول المطلوبة: `name`, `email`, `password`, `grade_ids` (مكرر أو Array)، `description` (اختياري)، `subject` (اختياري)
- **الاستجابة:**
  ```json
  {
    "message": "Teacher created successfully",
    "teacherId": 5
  }
  ```

---

## 7. تسجيل طالب جديد
- **المسار:**  
  `POST /api/user/register`
- **Body (JSON):**
  ```json
  {
    "name": "mohamed ahmed",
    "phone": "01111272330",
    "password": "123456789",
    "grade_id": 1
  }
  ```
- **الاستجابة:**
  ```json
  {
    "user": {
      "id": 1,
      "name": "mohamed ahmed",
      "phone": "01111272330",
      "role": "student",
      "grade_id": 1
    },
    "token": "..."
  }
  ```

---

## 8. عرض جميع الصفوف الدراسية
- **المسار:**  
  `GET /api/utils/grades`
- **الاستجابة:**
  ```json
  {
    "grades": [
      { "id": 1, "name": "أولى إعدادي" },
      { "id": 2, "name": "ثانية إعدادي" }
      // ...
    ]
  }
  ```

---

## ملاحظات عامة
- جميع المسارات التي تتطلب صلاحية يجب إرسال توكن JWT في الهيدر:
  ```
  Authorization: Bearer <token>
  ```
- جميع الأسعار (`price`) ترجع كنص (string) من قاعدة البيانات.
- إذا أردت إضافة أو تعديل أي توثيق أو إضافة أمثلة أخرى، أخبرني بذلك! 