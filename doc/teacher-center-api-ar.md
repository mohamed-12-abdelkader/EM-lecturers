# نظام إدارة سنتر المدرس (Teacher Center)

Base path: `/api/teacher/center`  
Auth: Bearer token — أدوار `teacher` أو `admin`  
للأدمن يمكن تمرير `teacher_id` في query أو body.

---

## نظرة عامة

المدرس يدير سنتره الخاص:

1. **المجموعات** — اسم + أيام الحضور + قيمة الاشتراك الشهري
2. **الطلاب** — اسم + رقم + رقم ولي الأمر (اختياري) + كود سنتر + QR
3. **الماليات الشهرية** — فتح شهر، تحديد من جدد، حالات: `paid` / `unpaid` / `partial` / `exempt`
4. **الحضور** — يدوي أو بمسح QR + تقارير غياب/حضور

---

## Dashboard

### `GET /dashboard`

ملخص: عدد المجموعات/الطلاب، مالية الشهر الحالي، حضور اليوم.

---

## المجموعات

### `POST /groups`

```json
{
  "name": "مجموعة السبت والثلاثاء",
  "days": ["السبت", "الثلاثاء"],
  "monthly_fee": 300,
  "grade_id": 1,
  "subject_id": null,
  "start_time": "16:00",
  "end_time": "18:00",
  "notes": null
}
```

| الحقل | مطلوب | الوصف |
|--------|--------|--------|
| `name` | نعم | اسم المجموعة |
| `days` | نعم | أيام الحضور (مصفوفة) |
| `monthly_fee` | نعم | قيمة الاشتراك الشهري |
| `grade_id` | لا | الصف الدراسي |
| `subject_id` | لا | المادة |
| `start_time` / `end_time` | لا | وقت الحصة |

### `GET /groups` — قائمة (دعم `search`, `status`, `page`, `limit`)
### `GET /groups/:groupId`
### `PATCH /groups/:groupId`
### `DELETE /groups/:groupId` — soft delete

---

## الطلاب

### `POST /groups/:groupId/students`

إنشاء طالب داخل مجموعة + QR + اشتراك الشهر الحالي.

```json
{
  "full_name": "أحمد محمد",
  "phone": "01012345678",
  "parent_phone": "01098765432",
  "payment_status": "unpaid",
  "amount_paid": 0,
  "exemption_reason": null
}
```

`payment_status` عند الإنشاء:

| القيمة | المعنى |
|--------|--------|
| `paid` | دفع كامل |
| `unpaid` | لم يدفع (افتراضي) |
| `partial` | دفع جزئي — أرسل `amount_paid` |
| `exempt` | معفي من المصاريف — يمكن `exemption_reason` |

يمكن إرسال `name` بدل `full_name`.

| `full_name` | نعم | اسم الطالب |
| `phone` | نعم | رقم الطالب |
| `parent_phone` | لا | رقم ولي الأمر |

### باقي مسارات الطلاب

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/groups/:groupId/students` | طلاب المجموعة |
| GET | `/students` | كل الطلاب (`group_id`, `search`, `is_active`) |
| GET | `/students/:studentId` | تفاصيل |
| PATCH | `/students/:studentId` | تعديل |
| DELETE | `/students/:studentId` | حذف ناعم |
| GET | `/students/:studentId/qr` | QR code |
| POST | `/students/:studentId/groups/:groupId` | إضافة لمجموعة أخرى |
| DELETE | `/students/:studentId/groups/:groupId` | إزالة من مجموعة |

---

## الماليات الشهرية

### `POST /billing/months` — فتح شهر جديد

ينشئ اشتراك لكل طالب نشط في كل مجموعة.

```json
{
  "year": 2026,
  "month": 7,
  "renewed_student_ids": [1, 5, 9],
  "default_status": "unpaid",
  "notes": "شهر يوليو"
}
```

- `renewed_student_ids`: الطلاب اللي جددوا → حالتهم `paid`
- الباقي يأخذون `default_status` (افتراضي `unpaid`)

### `GET /billing/months`
### `GET /billing/months/:year/:month`

فلاتر: `group_id`, `status`, `search`  
الرد: قائمة الاشتراكات + ملخص (`expected`, `collected`, `remaining`, عدادات الحالات).

### `PATCH /billing/subscriptions/:subscriptionId`

```json
{ "status": "partial", "amount_paid": 150 }
```

أو:

```json
{ "status": "exempt", "exemption_reason": "طالب متفوق" }
```

### `POST /billing/subscriptions/bulk`

```json
{
  "updates": [
    { "subscription_id": 10, "status": "paid" },
    { "subscription_id": 11, "status": "unpaid" }
  ]
}
```

### `POST /billing/payments` — تسجيل دفعة

```json
{
  "student_id": 1,
  "group_id": 2,
  "subscription_id": 10,
  "year": 2026,
  "month": 7,
  "amount": 150,
  "method": "cash"
}
```

`method`: `cash` | `transfer` | `vodafone_cash` | `other`

### `GET /billing/payments` — سجل الدفعات

---

## الحضور

### يدوي — `POST /attendance/manual`

```json
{
  "group_id": 1,
  "student_id": 5,
  "attendance_date": "2026-07-12",
  "status": "present",
  "notes": null
}
```

`status`: `present` | `absent` | `late` | `excused`

### جماعي — `POST /attendance/bulk`

```json
{
  "group_id": 1,
  "attendance_date": "2026-07-12",
  "records": [
    { "student_id": 5, "status": "present" },
    { "student_id": 6, "status": "absent" }
  ]
}
```

### مسح QR — `POST /attendance/scan`

```json
{
  "group_id": 1,
  "qr_token": "uuid-from-student-qr",
  "attendance_date": "2026-07-12",
  "status": "present"
}
```

أو أرسل `qr_payload` (نص الـ QR بالكامل).

### استعلام

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/attendance?group_id=&date=` | حضور يوم لمجموعة |
| GET | `/attendance/students/:studentId?from=&to=&group_id=` | سجل طالب |
| GET | `/reports/attendance/student/:studentId?group_id=&from=&to=` | تقرير غياب/حضور لطالب |
| GET | `/reports/attendance/group/:groupId?from=&to=` | ملخص المجموعة |

---

## Migration

ملف: `migrations/1774200000000_teacher_center_mgmt.sql`

الجداول: `tc_groups`, `tc_students`, `tc_student_groups`, `tc_qr_codes`, `tc_billing_months`, `tc_monthly_subscriptions`, `tc_payments`, `tc_attendance`, `tc_activity_logs`

تشغيل:

```bash
npm run migrate up
```

---

## تدفق مقترح للفرونت

1. إنشاء مجموعة (اسم + أيام + اشتراك)
2. إضافة طلاب للمجموعة مع حالة الدفع الابتدائية
3. عرض/طباعة QR لكل طالب
4. بداية كل شهر: `POST /billing/months` مع `renewed_student_ids`
5. تحديث حالات الدفع أو تسجيل دفعات جزئية
6. تسجيل الحضور يدوياً أو بالسكان يوم الحصة
7. فتح تقرير الحضور للطالب عند الحاجة
