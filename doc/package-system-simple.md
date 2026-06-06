# نظام الباقات (Simplified)

## الهدف
إلغاء أي محتوى تحت “المادة” داخل الباقة:
- لا مجموعات (Groups)
- لا صلاحيات مدرس على مادة الباقة
- لا دروس/فيديوهات/واجبات/أسئلة/تسليم

النظام المطلوب:
- **Admin** ينشئ الباقة ويضيف فيها المواد
- **Student** يشترك/يفعل الباقة فقط (بالكود)

---

## البيانات الأساسية في قاعدة البيانات

### 1) الباقات
جدول: `packages`

### 2) مواد داخل الباقة
جدول: `package_subject_items`
- كل مادة هنا هي “مادة داخل باقة” (وليست مادة عامة)
- مرتبطة بـ `package_id`

### 3) تفعيل الباقة للطالب
جدول: `package_activation_codes` (الأكواد)
جدول: `package_activations` (تفعيل الطالب)

> التفعيل الصحيح للطالب يكون فقط إذا كان:
`package_activations.is_active = TRUE` و `activation_code_id IS NOT NULL`

---

## APIs الأساسية

### Admin
- إنشاء/إدارة الباقات: تحت `/api/packages/...`
- إنشاء/إدارة مواد الباقة: تحت `/api/package-subjects/...`

### Student
- تفعيل الباقة بالكود:
  - `POST /api/packages/activate`
  - Body:
```json
{ "package_id": 5, "code": "12345678" }
```

- عرض الباقات/الكورسات المشترك فيها الطالب (إن وجد):
  - `GET /api/course/my-enrollments`

---

## ملاحظة مهمة
تم تعطيل (unmount) جميع routers الخاصة بـ:
- Groups داخل مادة الباقة
- Lessons/Videos/Assignments/Questions/Submissions الخاصة بمادة الباقة

بالتالي لن تكون هناك APIs محتوى تحت المادة داخل الباقة.














