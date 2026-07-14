# Teacher Social Links API Documentation

## نظرة عامة
تم إضافة حقول التواصل الاجتماعي للمدرسين في النظام. يمكن للأدمن إضافة وتعديل روابط التواصل الاجتماعي للمدرسين، ويمكن للطلاب رؤية هذه المعلومات عند عرض تفاصيل المدرس.

## الحقول المضافة
- `facebook_url`: رابط صفحة الفيسبوك
- `instagram_url`: رابط حساب/بيدج الإنستجرام
- `youtube_url`: رابط قناة اليوتيوب  
- `tiktok_url`: رابط حساب التيك توك
- `whatsapp_number`: رقم الواتساب للتواصل

> توثيق إنشاء/تعديل المنصة: [`teacher-platform-social-links-ar.md`](./teacher-platform-social-links-ar.md)

## APIs المحدثة

### 1. تعديل بيانات المدرس (للأدمن)
**Endpoint:** `PUT /api/users/teachers/:id`  
**Authorization:** Admin only

#### Request Body
```json
{
  "name": "اسم المدرس",
  "email": "teacher@example.com",
  "phone": "01234567890",
  "description": "وصف المدرس",
  "subject": "المادة",
  "grade_ids": [1, 2, 3],
  "facebook_url": "https://facebook.com/teacher",
  "youtube_url": "https://youtube.com/teacher",
  "tiktok_url": "https://tiktok.com/@teacher",
  "whatsapp_number": "01234567890"
}
```

#### Response
```json
{
  "message": "تم تحديث بيانات المدرس بنجاح",
  "teacher": {
    "id": 1,
    "name": "اسم المدرس",
    "email": "teacher@example.com",
    "phone": "01234567890",
    "avatar": "avatar_url",
    "description": "وصف المدرس",
    "subject": "المادة",
    "facebook_url": "https://facebook.com/teacher",
    "youtube_url": "https://youtube.com/teacher",
    "tiktok_url": "https://tiktok.com/@teacher",
    "whatsapp_number": "01234567890",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

### 2. جلب تفاصيل المدرس (للطالب)
**Endpoint:** `GET /api/students/teacher/:teacherId/details`  
**Authorization:** Student only

#### Response
```json
{
  "teacher": {
    "id": 1,
    "name": "اسم المدرس",
    "email": "teacher@example.com",
    "phone": "01234567890",
    "avatar": "avatar_url",
    "created_at": "2024-01-01T00:00:00.000Z",
    "description": "وصف المدرس",
    "subject": "المادة",
    "facebook_url": "https://facebook.com/teacher",
    "youtube_url": "https://youtube.com/teacher",
    "tiktok_url": "https://tiktok.com/@teacher",
    "whatsapp_number": "01234567890"
  },
  "common_grades": [
    {
      "id": 1,
      "name": "الصف الأول الثانوي"
    }
  ],
  "courses": [
    {
      "id": 1,
      "title": "عنوان الكورس",
      "description": "وصف الكورس",
      "price": 100.00,
      "grade_id": 1,
      "avatar": "course_avatar_url",
      "is_enrolled": true
    }
  ]
}
```

### 3. جلب المدرسين المتاحين (للطالب)
**Endpoint:** `GET /api/students/available-teachers`  
**Authorization:** Student only

#### Response
```json
{
  "teachers": [
    {
      "id": 1,
      "name": "اسم المدرس",
      "avatar": "avatar_url",
      "subject": "المادة",
      "description": "وصف المدرس",
      "phone": "01234567890",
      "email": "teacher@example.com",
      "facebook_url": "https://facebook.com/teacher",
      "youtube_url": "https://youtube.com/teacher",
      "tiktok_url": "https://tiktok.com/@teacher",
      "whatsapp_number": "01234567890",
      "grades": [
        {
          "id": 1,
          "name": "الصف الأول الثانوي"
        }
      ]
    }
  ]
}
```

### 4. جلب المدرسين المسجل معهم الطالب
**Endpoint:** `GET /api/students/my-teachers`  
**Authorization:** Student only

#### Response
```json
{
  "teachers": [
    {
      "id": 1,
      "name": "اسم المدرس",
      "avatar": "avatar_url",
      "phone": "01234567890",
      "subject": "المادة",
      "facebook_url": "https://facebook.com/teacher",
      "youtube_url": "https://youtube.com/teacher",
      "tiktok_url": "https://tiktok.com/@teacher",
      "whatsapp_number": "01234567890",
      "courses": [
        {
          "id": 1,
          "title": "عنوان الكورس",
          "description": "وصف الكورس",
          "avatar": "course_avatar_url"
        }
      ]
    }
  ]
}
```

### 5. جلب جميع المدرسين (للأدمن)
**Endpoint:** `GET /api/users/teachers`  
**Authorization:** Admin only

#### Response
```json
{
  "teachers": [
    {
      "id": 1,
      "name": "اسم المدرس",
      "email": "teacher@example.com",
      "phone": "01234567890",
      "avatar": "avatar_url",
      "description": "وصف المدرس",
      "subject": "المادة",
      "facebook_url": "https://facebook.com/teacher",
      "youtube_url": "https://youtube.com/teacher",
      "tiktok_url": "https://tiktok.com/@teacher",
      "whatsapp_number": "01234567890",
      "created_at": "2024-01-01T00:00:00.000Z",
      "courses_count": 5,
      "students_count": 25,
      "grades": [
        {
          "id": 1,
          "name": "الصف الأول الثانوي"
        }
      ]
    }
  ],
  "total": 10,
  "message": "تم جلب جميع المدرسين"
}
```

## ملاحظات مهمة

1. **التحقق من صحة البيانات:** جميع حقول التواصل الاجتماعي اختيارية ويمكن أن تكون فارغة
2. **URLs:** يتم التحقق من صحة تنسيق URLs للفيسبوك واليوتيوب والتيك توك
3. **رقم الواتساب:** يمكن أن يكون أي نص، لا يتم التحقق من تنسيق معين
4. **الأمان:** فقط الأدمن يمكنه تعديل بيانات المدرسين
5. **الطلاب:** يمكن للطلاب رؤية معلومات التواصل الاجتماعي للمدرسين في صفوفهم فقط

## Migration
تم إنشاء migration file: `migrations/1700000000051_add_teacher_social_links.sql`

لتشغيل الـ migration:
```bash
npx node-pg-migrate up
```

