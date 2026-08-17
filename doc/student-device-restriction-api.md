# تقييد أجهزة الطلاب — Device / IP Restriction API

نظام على مستوى **منصة المدرس** للتحكم في عدد الأجهزة المسموح للطالب بالدخول منها.

يعمل **للطلاب فقط**. المدرس / الأكاديمية / الأدمن غير مقيّدين.

الإعداد يُحفظ في `tenant_settings.data.student_device_limit`.

| القيمة | المعنى |
|--------|--------|
| `multiple_devices` | الدخول من أي جهاز. لا ربط IP ولا تحقق. |
| `single_device` | الحساب يرتبط بـ IP أول جهاز، ويُرفض الدخول من عنوان مختلف حتى يعيد المدرس تعيين الجهاز. |

**الافتراضي:** `single_device` (يحافظ على ربط `device_ip` الحالي إن وُجد).

الـ Frontend يمكنه إرسال `device_ip` (أو `registered_ip` / `ip`). الـ Backend هو المسؤول عن تطبيق القاعدة، ولا يعتمد على قيمة العميل إذا وصل الطلب من IP عام مختلف.

---

## 1) إعداد المنصة — للمدرس

Auth: `Authorization: Bearer <TEACHER_TOKEN>`  
الأدوار: `teacher` | `academy` (مالك المنصة)

### `GET /api/teacher/device-restriction-settings`

```json
{
  "success": true,
  "data": {
    "student_device_limit": "single_device",
    "single_device": true,
    "multiple_devices": false
  },
  "options": [
    {
      "value": "multiple_devices",
      "label_ar": "السماح للطالب باستخدام الحساب من أكثر من جهاز",
      "description_ar": "لا يتم ربط الحساب بعنوان IP. تسجيل الدخول مسموح من أي جهاز."
    },
    {
      "value": "single_device",
      "label_ar": "السماح للطالب باستخدام الحساب من جهاز واحد فقط",
      "description_ar": "يُربط الحساب بـ IP أول جهاز يسجّل منه الطالب، ويُرفض الدخول من عنوان مختلف حتى يعيد المدرس تعيين الجهاز."
    }
  ]
}
```

### `PUT /api/teacher/device-restriction-settings`

```json
{ "student_device_limit": "multiple_devices" }
```

```json
{
  "success": true,
  "message": "تم السماح بتسجيل الدخول من أكثر من جهاز",
  "data": {
    "student_device_limit": "multiple_devices",
    "single_device": false,
    "multiple_devices": true
  }
}
```

تغيير الإعداد **لا يمسح** IP الطلاب الحالي. يؤثر فقط على التحقق من اللحظة دي فصاعدًا.

---

## 2) قراءة الإعداد بدون تسجيل دخول

للشاشة العامة (تسجيل / دخول) لمعرفة هل المنصة مقيّدة بجهاز واحد.

### `GET /api/tenants/public/:subdomain/device-restriction-settings`

```json
{
  "success": true,
  "data": {
    "student_device_limit": "single_device",
    "single_device": true,
    "multiple_devices": false
  }
}
```

نفس الحقل يظهر أيضًا داخل:

`GET /api/tenants/public/:subdomain/registration-settings`

```json
{
  "success": true,
  "data": {
    "registration_mode": "self_registration",
    "self_registration_enabled": true,
    "student_device_limit": "single_device",
    "single_device": true
  }
}
```

---

## 3) تسجيل طالب جديد

### `POST /api/users/register`

نفس الـ API الحالي. أضف `device_ip` اختياريًا.

```json
{
  "phone": "01012345678",
  "password": "123456",
  "name": "أحمد",
  "parent_phone": "01098765432",
  "grade_id": 1,
  "device_ip": "197.54.10.20",
  "subdomain": "mo-adbo"
}
```

| وضع المنصة | السلوك |
|------------|--------|
| `multiple_devices` | لا يُحفظ IP. التسجيل كالمعتاد. `ip_registered: false` |
| `single_device` + تم إرسال/اكتشاف IP | يُحفظ كـ IP أساسي. `ip_registered: true` |
| `single_device` + لا يوجد IP | الحساب يُنشأ و`registered_ip = null`. يُربط عند أول Login |

Response `201`:

```json
{
  "success": true,
  "ip_registered": true,
  "user": {
    "id": 123,
    "name": "أحمد",
    "phone": "01012345678",
    "role": "student",
    "device_ip": "197.54.10.20"
  },
  "token": "..."
}
```

الطالب **لا يستطيع** تغيير `registered_ip` بنفسه لاحقًا (`PUT /api/users/me` لا يقبل الحقل).

---

## 4) تسجيل الدخول

### `POST /api/login`

نفس الـ API الحالي. أضف `device_ip` اختياريًا (مستحسن مع `single_device`).

```json
{
  "phone": "01012345678",
  "password": "123456",
  "device_ip": "197.54.10.20",
  "subdomain": "mo-adbo"
}
```

يقبل أيضًا: `email` أو `student_code` بدل `phone`.

### إذا `multiple_devices`

الدخول ينجح كالمعتاد. لا تحقق IP.  
`ip_registered` يكون `false`.

### إذا `single_device`

| حالة الحساب | النتيجة |
|-------------|---------|
| IP محفوظ = IP الدخول | دخول ناجح |
| IP محفوظ ≠ IP الدخول | **403** `ACCOUNT_IP_MISMATCH` |
| لا يوجد IP محفوظ + وُجد IP للدخول | دخول ناجح + حفظ IP (`ip_registered: true`) |
| لا يوجد IP محفوظ + لا يوجد IP | دخول ناجح بدون ربط |

نجاح:

```json
{
  "success": true,
  "ip_registered": false,
  "user": {
    "id": 123,
    "name": "أحمد",
    "phone": "01012345678",
    "role": "student",
    "must_change_password": false
  },
  "token": "...",
  "token_type": "Bearer",
  "expires_in": 900,
  "tenant": { "id": 5, "subdomain": "mo-adbo", "display_name": "..." }
}
```

رفض بسبب جهاز مختلف — **هذا الكود هو اللي الفرونت يعالجه**:

```json
{
  "success": false,
  "code": "ACCOUNT_IP_MISMATCH",
  "message": "هذا الحساب مرتبط بجهاز آخر، ولا يُسمح بتسجيل الدخول من هذا الجهاز."
}
```

تعذر تحديد العنوان:

```json
{
  "success": false,
  "code": "DEVICE_IP_REQUIRED",
  "message": "تعذر تحديد عنوان الجهاز. أعد المحاولة."
}
```

---

## 5) إعادة تعيين جهاز طالب — للمدرس

يؤثر على **هذا الطالب فقط**. باقي الطلاب كما هم. إعداد المنصة لا يتغير.

Auth: `Authorization: Bearer <TEACHER_TOKEN>`  
الأدوار: `teacher` | `academy` | `academy_teacher`  
الطالب يجب أن يكون على نفس منصة المدرس (`tenant`).

### `POST /api/users/students/allow-device`

المسار الذي يستخدمه الفرونت للسماح للطالب بجهاز جديد. `PATCH` على نفس المسار مدعوم أيضًا.

```json
{ "student_id": 40 }
```

أو برقم الهاتف:

```json
{ "phone": "01012345678" }
```

يقبل أيضًا: `studentId` / `id` / `student_phone`.

```json
{
  "success": true,
  "message": "تم السماح للطالب باستخدام جهاز آخر بنجاح",
  "data": {
    "student_id": 40,
    "student_name": "أحمد",
    "student_phone": "01012345678",
    "old_device_ip": "197.54.10.20",
    "old_ip": "197.54.10.20",
    "new_device_ip": null,
    "registered_ip": null,
    "note": "يمكن للطالب الآن تسجيل الدخول من الجهاز الجديد. سيتم حفظ IP الجهاز الجديد تلقائياً عند أول تسجيل دخول.",
    "updated_at": "2026-08-15T12:30:00.000Z"
  }
}
```

### `POST /api/teacher/students/:studentId/reset-device`

بدون body.

```json
{
  "success": true,
  "message": "تم إعادة تعيين جهاز الطالب. يمكنه تسجيل الدخول من الجهاز الجديد.",
  "data": {
    "student_id": 40,
    "student_name": "أحمد",
    "student_phone": "01012345678",
    "old_ip": "197.54.10.20",
    "registered_ip": null,
    "ip_reset_at": "2026-08-15T12:30:00.000Z"
  }
}
```

بعد الـ reset: `registered_ip = null`. أول Login من الجهاز الجديد يحفظ الـ IP الجديد (إذا كان الوضع `single_device`).

### `GET /api/teacher/students/:studentId/device-logs`

سجل عمليات هذا الطالب:

| `action` | المعنى |
|----------|--------|
| `bind` | أول ربط IP |
| `rebind` | ربط بعد reset (يُسجَّل كـ `bind` عند أول دخول بعد التصفير) |
| `mismatch` | رفض دخول بسبب اختلاف IP |
| `reset` | المدرس/الأدمن صفّر الجهاز |

```json
{
  "success": true,
  "data": [
    {
      "id": 9,
      "student_id": 40,
      "tenant_id": 5,
      "old_ip": "197.54.10.20",
      "new_ip": null,
      "action": "reset",
      "performed_by": 12,
      "created_at": "2026-08-15T12:30:00.000Z"
    }
  ]
}
```

بيانات الطالب في قائمة/تفاصيل الطلاب تتضمن:

```json
{
  "registered_ip": "197.54.10.20",
  "device_ip": "197.54.10.20",
  "ip_registered_at": "2026-08-15T10:00:00.000Z",
  "ip_reset_at": null,
  "device_bound": true
}
```

- `GET /api/teacher/students`
- `GET /api/teacher/students/:studentId`

---

## 6) أدمن / موظف

نفس `POST` / `PATCH` `/api/users/students/allow-device`.

Auth: `admin` | `employee` (بدون تقييد tenant). المدرس يرى طلاب منصته فقط.

---

## ملاحظات Frontend

1. اعرض خيار الإعداد من `options` في `GET /api/teacher/device-restriction-settings`.
2. عند Login: إذا `code === "ACCOUNT_IP_MISMATCH"` اعرض الرسالة كما هي، ووجّه الطالب للتواصل مع المدرس لإعادة تعيين الجهاز.
3. أرسل `device_ip` في register/login إن أمكن. الـ Backend يستخدم IP الطلب إن كان عامًا.
4. لا تعتمد على الفرونت لمنع التجاوز؛ التحقق كله في الـ Backend.
5. `ip_registered: true` يعني تم ربط IP لأول مرة في هذا الطلب (عرض رسالة اختيارية مثل «تم ربط الحساب بهذا الجهاز»).
6. IPv4 و IPv6 مدعومان. المقارنة بعد تطبيع العنوان (`::ffff:x.x.x.x` يُعامل كـ IPv4).

---

## أكواد الأخطاء

| Code | HTTP | متى |
|------|------|-----|
| `ACCOUNT_IP_MISMATCH` | 403 | دخول من IP مختلف عن المربوط |
| `DEVICE_IP_REQUIRED` | 400 | الوضع جهاز واحد والحساب مربوط ولا يوجد IP للطلب |
| `STUDENT_NOT_FOUND` | 404 | الطالب غير موجود على منصة المدرس |
| `TENANT_FORBIDDEN` | 403 | المدرس لا يملك هذه المنصة |

---

## Migration

`migrations/1776900000000_student_device_restriction.sql`

- `users.registered_ip` (متزامن مع `device_ip`)
- `users.ip_registered_at`
- `users.ip_reset_at`
- جدول `student_ip_logs`
