# وثائق API نظام الحسابات

جميع المسارات المذكورة تُبنى تحت البادئة **`/api/accounting`**.

## المصادقة والصلاحيات

- تمرير رمز **JWT** في الهيدر: `Authorization: Bearer <token>`
- الأدوار المدعومة للوصول لقسم الحسابات:
  - `admin` (وصول كامل)
  - `employee` بشرط امتلاك صلاحية إدارة الحسابات
- أي موظف بدون الصلاحية يحصل على:

```json
{
  "success": false,
  "message": "لا تملك صلاحية إدارة الحسابات"
}
```

## مفاتيح صلاحية إدارة الحسابات المقبولة

في الكود الحالي، الموظف يعتبر مخولًا إذا امتلك أي مفتاح من:

- `can_manage_accounting`
- `manage_accounting`
- `accounting_management`
- `financial_management`

> ملاحظة: منطق التحقق يدعم أيضًا أشكال تخزين permissions المختلفة (array/object/nested object).

---

## جداول النظام

### جدول `platform_income`

```sql
CREATE TABLE platform_income (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  source_id INTEGER,
  payment_method VARCHAR(50),
  transaction_date DATE NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `platform_expenses`

```sql
CREATE TABLE platform_expenses (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(50) NOT NULL,
  expense_type VARCHAR(50) NOT NULL,
  payment_method VARCHAR(50),
  transaction_date DATE NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `monthly_budget`

```sql
CREATE TABLE monthly_budget (
  id SERIAL PRIMARY KEY,
  month_year VARCHAR(7) NOT NULL,
  planned_income DECIMAL(10,2) DEFAULT 0,
  planned_expenses DECIMAL(10,2) DEFAULT 0,
  actual_income DECIMAL(10,2) DEFAULT 0,
  actual_expenses DECIMAL(10,2) DEFAULT 0,
  notes TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(month_year)
);
```

---

## Endpoints

## 1) إضافة مدخول

- **POST** `/api/accounting/income`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات

**Body:**

```json
{
  "title": "تحصيل رسوم كورس",
  "description": "دفعة الطالب أحمد",
  "amount": 500,
  "source_type": "course_payment",
  "source_id": 12,
  "payment_method": "online_payment",
  "transaction_date": "2026-03-31"
}
```

**استجابة ناجحة:** `201`

```json
{
  "message": "تم إضافة المدخول بنجاح",
  "income": {
    "id": 1
  }
}
```

---

## 2) إضافة مصروف

- **POST** `/api/accounting/expenses`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات

**Body:**

```json
{
  "title": "إيجار المكتب",
  "description": "شهر مارس",
  "amount": 3000,
  "category": "rent",
  "expense_type": "monthly",
  "payment_method": "bank_transfer",
  "transaction_date": "2026-03-31"
}
```

**استجابة ناجحة:** `201`

```json
{
  "message": "تم إضافة المصروف بنجاح",
  "expense": {
    "id": 7
  }
}
```

---

## 3) جلب المدخلات

- **GET** `/api/accounting/income`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات
- **Query اختياري:** `start_date`, `end_date`, `source_type`, `limit`, `offset`

**استجابة:** `200`

```json
{
  "income": []
}
```

---

## 4) جلب المصروفات

- **GET** `/api/accounting/expenses`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات
- **Query اختياري:** `start_date`, `end_date`, `category`, `limit`, `offset`

**استجابة:** `200`

```json
{
  "expenses": []
}
```

---

## 5) الإحصائيات المالية

- **GET** `/api/accounting/stats`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات
- **Query اختياري:** `start_date`, `end_date`

**استجابة:** `200`

```json
{
  "stats": {
    "total_income": 10000,
    "total_expenses": 4000,
    "net_profit": 6000
  }
}
```

---

## 6) إنشاء/تحديث ميزانية شهرية

- **POST** `/api/accounting/budget`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات

**Body:**

```json
{
  "month_year": "2026-03",
  "planned_income": 120000,
  "planned_expenses": 70000,
  "notes": "الخطة الشهرية"
}
```

**استجابة:** `200`

```json
{
  "message": "تم حفظ الميزانية بنجاح",
  "budget": {
    "id": 3
  }
}
```

---

## 7) جلب ميزانية شهرية

- **GET** `/api/accounting/budget/:monthYear`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات
- مثال: `GET /api/accounting/budget/2026-03`

**استجابة:** `200`

```json
{
  "budget": {
    "month_year": "2026-03"
  }
}
```

---

## 8) حذف مدخول

- **DELETE** `/api/accounting/income/:id`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات

**استجابة:** `200`

```json
{
  "message": "تم حذف المدخول بنجاح",
  "income": {
    "id": 1
  }
}
```

---

## 9) حذف مصروف

- **DELETE** `/api/accounting/expenses/:id`
- **الصلاحية:** `admin` أو `employee` بصلاحية إدارة الحسابات

**استجابة:** `200`

```json
{
  "message": "تم حذف المصروف بنجاح",
  "expense": {
    "id": 7
  }
}
```

---

## أخطاء شائعة

| HTTP | المعنى |
|------|--------|
| `400` | بيانات مطلوبة ناقصة |
| `401` | غير مصرح (token غير صالح/مفقود) |
| `403` | لا يملك صلاحية إدارة الحسابات |
| `404` | السجل غير موجود |
| `500` | خطأ داخلي في الخادم |

## ملاحظات تنفيذية

- تواريخ المعاملات تكون بصيغة `YYYY-MM-DD`.
- مبالغ الأموال تحفظ بدقة `DECIMAL(10,2)`.
- عند جلب ميزانية شهر، يتم تحديث القيم الفعلية تلقائيًا قبل الإرجاع.
