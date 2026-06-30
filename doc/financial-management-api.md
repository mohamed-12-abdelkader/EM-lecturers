# نظام الحسابات والمالية — Financial Management API

> **دليل شامل (عربي):** [`financial-accounting-system-ar.md`](./financial-accounting-system-ar.md)  
> **Base URL:** `/api/finance`  
> **السياق:** tenant `default` + دور `admin` أو `employee` بصلاحية مالية  
> **Legacy:** `/api/accounting` ما زال يعمل للتوافق

---

## المصادقة

```http
Authorization: Bearer <JWT>
X-Tenant-Subdomain: default
```

صلاحيات الموظف: `financial_management` | `accounting_management` | `manage_accounting` | `can_manage_accounting`

---

## الهيكل

```
teacher_subscription_plans     ← كتالوج الباقات (bronze/silver/gold/diamond)
teacher_custom_prices          ← سعر مخصص لكل مدرس
teacher_platform_subscriptions ← اشتراك المدرس
teacher_subscription_renewals  ← سجل التجديدات
platform_income                ← إيرادات (موجود مسبقاً)
platform_expenses              ← مصروفات (موجود مسبقاً)
platform_financial_transactions← سجل موحد للتقارير
platform_financial_audit_logs  ← سجل التدقيق
```

---

## 1. لوحة التحكم المالية

```http
GET /api/finance/dashboard?period=month
```

`period`: `today` | `week` | `month` | `year` | `all`

**Response:**

```json
{
  "success": true,
  "data": {
    "total_income": 15000,
    "total_expenses": 4000,
    "net_profit": 11000,
    "active_subscriptions": 12,
    "expired_subscriptions": 3,
    "renewal_revenue": 5000,
    "recent_renewals": [],
    "top_plans_by_revenue": [],
    "top_teachers_by_revenue": []
  }
}
```

---

## 2. باقات المدرسين

```http
GET  /api/finance/plans
PUT  /api/finance/plans/:id
```

**تعديل الباقة:**

```json
{
  "name_ar": "الباقة الاحترافية",
  "default_price": 1000,
  "duration_days": 30,
  "features": ["4 بثوث مباشرة شهرياً"]
}
```

الباقات الافتراضية:

| code | الاسم | السعر الافتراضي |
|------|-------|-----------------|
| bronze | الأساسية | 500 |
| silver | الاحترافية | 1000 |
| gold | المتقدمة | 1500 |
| diamond | الماسية | 2500 |

---

## 3. التسعير المخصص

```http
GET  /api/finance/custom-prices/resolve?teacher_id=5&plan_id=2
GET  /api/finance/custom-prices/teacher/:teacherId
POST /api/finance/custom-prices
DELETE /api/finance/custom-prices/:id
```

**تعيين سعر مخصص:**

```json
{
  "teacher_id": 5,
  "plan_id": 2,
  "custom_price": 700,
  "discount_reason": "عرض افتتاحي",
  "valid_from": "2026-01-01",
  "valid_until": "2026-12-31"
}
```

عند الاشتراك أو التجديد يُستخدم السعر المخصص تلقائياً إن وُجد.

---

## 4. الاشتراكات

```http
GET  /api/finance/subscriptions/expiring-soon?days=3
GET  /api/finance/subscriptions
GET  /api/finance/subscriptions/:id
POST /api/finance/subscriptions
PATCH /api/finance/subscriptions/:id/status
POST /api/finance/subscriptions/:id/renew
```

### قائمة المدرسين على وشك انتهاء الباقة (يومياً)

```http
GET /api/finance/subscriptions/expiring-soon?days=3&limit=50&offset=0
```

تُرجع الاشتراكات **النشطة** التي تنتهي خلال 3 أيام (افتراضياً)، مرتبة بأقرب تاريخ انتهاء.  
نفس القائمة تظهر في `GET /api/finance/dashboard` تحت `expiring_soon_subscriptions`.

**Response:**

```json
{
  "success": true,
  "data": {
    "days": 3,
    "as_of": "2026-06-16",
    "subscriptions": [
      {
        "id": 1,
        "subscription_number": "SUB-2026-000001",
        "teacher_name": "محمد",
        "plan_name": "الباقة المتقدمة",
        "ends_at": "2026-06-19",
        "days_remaining": 3
      }
    ],
    "total": 1,
    "limit": 50,
    "offset": 0
  }
}
```

### إشعار المدرس — باقة على وشك الانتهاء

```http
GET /api/teacher/subscription/expiry-alert
Authorization: Bearer <teacher_jwt>
```

> يعمل من **نطاق منصة المدرس** (مثل `teacher.localhost`) — لا يحتاج النطاق الافتراضي `default`.

يُظهر تنبيهاً للمدرس حسب حالة الاشتراك:

| المرحلة | `alert.type` | الوصف |
|---------|--------------|--------|
| قبل الانتهاء بـ 3 أيام | `subscription_expiring` | «باقتك على وشك الانتهاء» — `days_remaining` يتناقص يومياً |
| بعد الانتهاء (فترة سماح 3 أيام) | `subscription_grace_period` | «باقتك انتهت — الوضع الاستثنائي» — `grace_days_remaining` يتناقص |
| بعد انتهاء السماح بدون تجديد | `platform_suspended` | إيقاف تنشيط المنصة (`tenants.is_active = false`) |

**يختفي تلقائياً** بعد التجديد (يُعاد تفعيل المنصة عند الاشتراك/التجديد).

معاملات اختيارية: `?days=3` (نافذة التنبيه قبل الانتهاء)، `?grace_days=3` (فترة السماح).

```json
{
  "success": true,
  "data": {
    "show_alert": true,
    "alert": {
      "type": "subscription_grace_period",
      "subscription_id": 1,
      "plan_name": "الباقة المتقدمة",
      "ends_at": "2026-06-16",
      "grace_days_remaining": 2,
      "grace_period_days": 3,
      "platform_active": true,
      "message": "باقتك انتهت بالفعل وأنت الآن في الوضع الاستثنائي. في حالة عدم التجديد خلال يومين سيتم إيقاف منصتك بشكل نهائي."
    }
  }
}
```

إذا لا يوجد تنبيه: `"show_alert": false`, `"alert": null`.

### إنشاء اشتراك

```json
{
  "teacher_id": 5,
  "plan_id": 2,
  "starts_at": "2026-06-01",
  "ends_at": "2026-07-01",
  "payment_method": "bank_transfer",
  "notes": "دفع نقدي"
}
```

`ends_at` اختياري — إن لم يُرسل يُحسب من `duration_days` للباقة.

**يحدث تلقائياً:**
- حساب السعر (مخصص أو افتراضي)
- تسجيل إيراد في `platform_income`
- إنشاء فاتورة في `teacher_subscription_invoices`
- تحديث `users.subscription_package`
- سجل في `platform_financial_transactions`
- سجل تدقيق

### فواتير الاشتراك

```http
GET /api/finance/invoices?teacher_id=16
GET /api/finance/invoices/:id
GET /api/teacher/subscription/invoices
GET /api/teacher/subscription/invoices/:id
```

تُنشأ فاتورة تلقائياً عند كل اشتراك جديد أو تجديد.

### تجديد

```http
POST /api/finance/subscriptions/10/renew
```

```json
{
  "payment_method": "cash",
  "notes": "تجديد سنوي"
}
```

### فلاتر القائمة

| Query | الوصف |
|-------|--------|
| `status` | active / expired / suspended / cancelled |
| `teacher_id` | مدرس محدد |
| `search` | رقم الاشتراك أو اسم المدرس |
| `expiring_within_days` | اشتراكات تنتهي خلال X يوم |
| `limit` / `offset` | تصفح |

---

## 5. المصروفات

```http
POST   /api/finance/expenses
PUT    /api/finance/expenses/:id
DELETE /api/finance/expenses/:id
GET    /api/finance/expenses/list
```

**التصنيفات:**

`salaries` | `marketing` | `hosting` | `development` | `support` | `operational` | `maintenance` | `other`

```json
{
  "title": "استضافة سيرفر",
  "amount": 500,
  "category": "hosting",
  "expense_type": "monthly",
  "payment_method": "bank_transfer",
  "transaction_date": "2026-06-01"
}
```

---

## 6. التقارير

```http
GET /api/finance/reports/revenue?start_date=2026-01-01&group_by=plan
GET /api/finance/reports/expenses?start_date=2026-01-01
GET /api/finance/reports/profit
GET /api/finance/reports/subscriptions?expiring_within_days=7
```

`group_by` للإيرادات: `plan` | `teacher` | `day`

---

## 7. سجل التدقيق

```http
GET /api/finance/audit-logs?entity_type=teacher_custom_price&limit=50
```

يُسجَّل تلقائياً: إنشاء/تعديل/حذف إيراد، مصروف، سعر مخصص، اشتراك، تجديد.

---

## Migration

```txt
migrations/1772800000000_teacher_financial_system.sql
```

يُطبَّق تلقائياً عند تشغيل السيرفر.

---

## ملاحظات

- جدول `packages` الحالي خاص **بباقات الطلاب** — لم يُمس.
- باقات المدرسين في `teacher_subscription_plans` ومرتبطة بـ `users.subscription_package`.
- جاهز لربط بوابات الدفع لاحقاً عبر `payment_method` + webhooks.
