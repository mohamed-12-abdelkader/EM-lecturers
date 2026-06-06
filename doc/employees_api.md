# Employees & Permissions API Documentation

هذا المستند يشرح جميع واجهات التطبيقات (APIs) الخاصة بنظام الموظفين (Employees) والصلاحيات (Permissions). يُتيح هذا النظام للإدارة إنشاء حسابات فرعية (موظفين) ومنحهم صلاحيات مخصصة للدخول إلى ميزات محددة داخل النظام.

## المسار الأساسي (Base URL)
`/api/admin/employees` 
وكذلك `/api/employees`

---

## المصادقة والصلاحيات (Authentication)
كل هذه المسارات مخصصة للإدارة فقط ويجب إرسال رمز الـ Token الخاص بالأدمن في الهيدر:
`Authorization: Bearer <admin-token>`

---

## 1. إدارة الموظفين (Employee Management)

### 1.1 إنشاء موظف جديد
`POST /api/admin/employees`

يقوم بإنشاء حساب مستخدم جديد برول `employee`، وتخزين بياناته في جدول `employees` مع الصلاحيات التي تم تحديدها.

**طلب (Request):**
```json
{
  "name": "أحمد الموظف",
  "email": "ahmed.employee@domain.com",
  "password": "strongPassword123",
  "phone": "01012345678",
  "permissions": [
    "students_management",
    "question_bank_management"
  ]
}
```

**استجابة ناجحة:**
```json
{
  "message": "تم إنشاء الموظف بنجاح",
  "employee": {
    "id": 1,
    "user_id": 50,
    "name": "أحمد الموظف",
    "email": "ahmed.employee@domain.com",
    "phone": "01012345678",
    "permissions": ["students_management", "question_bank_management"],
    "is_active": true,
    "created_at": "...",
    "updated_at": "...",
    "user": {
      "id": 50,
      "email": "ahmed.employee@domain.com",
      "name": "أحمد الموظف",
      "role": "employee"
    }
  }
}
```

### 1.2 جلب كل الموظفين
`GET /api/admin/employees`

يُرجع قائمة بجميع الموظفين المُفعّلين (is_active = true) مساربةً مع بيانات الحساب الأساسية.

**استجابة ناجحة:**
```json
{
  "employees": [
    {
      "id": 1,
      "user_id": 50,
      "name": "أحمد الموظف",
      "email": "ahmed@domain.com",
      "phone": "01012345678",
      "permissions": ["..."],
      "is_active": true,
      "user_name": "أحمد الموظف",
      "user_email": "ahmed@domain.com",
      "user_role": "employee"
    }
  ]
}
```

### 1.3 جلب تفاصيل موظف معين
`GET /api/admin/employees/:id`

**استجابة ناجحة:**
نفس هيكل الموظف الموجود في قائمة (جلب كل الموظفين).

### 1.4 تعديل بيانات الموظف والصلاحيات
`PUT /api/admin/employees/:id`

تستخدم هذه الـ Endpoint لتعديل الاسم، الرقم، تفعيل/تعطيل الموظف، أو إعطائه/إزالة بعض الصلاحيات.

**طلب (Request):**
جميع الحقول اختيارية، أرسل فقط ما تريد تحديثه.
```json
{
  "name": "أحمد المُعَدل",
  "phone": "01000000000",
  "is_active": true,
  "permissions": [
    "students_management",
    "support_chat_management"
  ]
}
```

**استجابة ناجحة:**
```json
{
  "message": "تم تحديث بيانات الموظف بنجاح",
  "employee": { /* البيانات المحدثة */ }
}
```

### 1.5 تغيير كلمة مرور الموظف
`PUT /api/admin/employees/:id/password`

**طلب (Request):**
```json
{
  "new_password": "newStrongPassword456"
}
```

**استجابة ناجحة:**
```json
{
  "message": "تم تحديث كلمة المرور بنجاح",
  "user": {
    "id": 50,
    "email": "ahmed@domain.com",
    "name": "أحمد المُعَدل"
  }
}
```

### 1.6 مسح (إيقاف تفعيل) موظف
`DELETE /api/admin/employees/:id`

لا يُحذف الموظف فعليًا من قاعدة البيانات حفظًا للسجلات، بل يتم تغيير حالته `is_active = false`.

**استجابة ناجحة:**
```json
{
  "message": "تم حذف الموظف بنجاح",
  "employee": { /* ... */ }
}
```

### 1.7 تحديث صورة الموظف (Avatar)
`POST /api/admin/employees/:id/avatar`

يتم إرسال الصورة كـ `multipart/form-data` بحيث يكون مفتاح الملف باسم `avatar`.


---

## 2. نظام الـ Permissions Middleware للأمان والمبرمجين

عند إضافة قسم جديد في النظام يحتاج إلى ترخيص خاص (مثلاً: قسم الطُلاب)، نضع الـ Middleware الذي تم بناؤه حديثاً للحماية التلقائية.

### طريقة الاستخدام للمبرمجين:
1. السماح للموظفين والأدمن بالدخول للمسار عبر `authMiddleware(['admin', 'employee'])`.
2. حماية المسار بصلاحية معينة عبر `checkPermission('اسم_الصلاحية')`.

**مثال حقيقي مكتوب بـ Express Route:**
```typescript
import { checkPermission } from '../middleware/permissions';
import { authMiddleware } from '../middleware/authentication';

// يحتاج الموظف إلى صلاحية 'students_management' لكي يمر إلى الـ Controller
router.get(
  '/api/students',
  authMiddleware(['admin', 'employee']),
  checkPermission('students_management'),
  getStudentsListController
);
```

**مزايا النظام:**
إذا لم يكن الموظف يحمل الصلاحية المطلوبة، سيقوم الـ Middleware برفض الطلب تلقائياً بخطأ `403 Forbidden` (`رسالة: لا تملك الصلاحية للقيام بهذه العملية`). بينما يمر الـ `Admin` للمسار دائماً دون تعقيد.
