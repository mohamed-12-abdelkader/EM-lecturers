# API نظام المحاسبة للمنصة

## نظرة عامة

هذا API يتيح للادمن إدارة الحسابات المالية للمنصة، بما في ذلك المدخلات (الإيرادات) والمصروفات والميزانية الشهرية.

## الجداول

### جدول `platform_income` (المدخلات)
```sql
CREATE TABLE platform_income (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    source_type VARCHAR(50) NOT NULL, -- 'course_payment', 'subscription', 'other'
    source_id INTEGER, -- ID للكورس أو الاشتراك أو غيره
    payment_method VARCHAR(50), -- 'cash', 'bank_transfer', 'online_payment'
    transaction_date DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `platform_expenses` (المصروفات)
```sql
CREATE TABLE platform_expenses (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL,
    category VARCHAR(50) NOT NULL, -- 'hosting', 'marketing', 'salaries', 'maintenance', 'other'
    expense_type VARCHAR(50) NOT NULL, -- 'monthly', 'one_time', 'recurring'
    payment_method VARCHAR(50), -- 'cash', 'bank_transfer', 'check'
    transaction_date DATE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
```

### جدول `monthly_budget` (الميزانية الشهرية)
```sql
CREATE TABLE monthly_budget (
    id SERIAL PRIMARY KEY,
    month_year VARCHAR(7) NOT NULL, -- '2024-01'
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

## النقاط النهائية (Endpoints)

### 1. إضافة مدخول جديد

**POST** `/api/accounting/income`

**الصلاحيات المطلوبة:** `admin`

**البيانات المطلوبة:**
```json
{
  "title": "دفع كورس الرياضيات",
  "description": "دفع من الطالب أحمد محمد",
  "amount": 500.00,
  "source_type": "course_payment",
  "source_id": 1,
  "payment_method": "online_payment",
  "transaction_date": "2024-01-15"
}
```

**الاستجابة:**
```json
{
  "message": "تم إضافة المدخول بنجاح",
  "income": {
    "id": 1,
    "title": "دفع كورس الرياضيات",
    "description": "دفع من الطالب أحمد محمد",
    "amount": "500.00",
    "source_type": "course_payment",
    "source_id": 1,
    "payment_method": "online_payment",
    "transaction_date": "2024-01-15",
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**ملاحظات:**
- `source_type`: يمكن أن تكون `"course_payment"` أو `"subscription"` أو `"other"`
- `payment_method`: يمكن أن تكون `"cash"` أو `"bank_transfer"` أو `"online_payment"`
- `source_id`: ID للكورس أو الاشتراك (اختياري)

### 2. إضافة مصروف جديد

**POST** `/api/accounting/expenses`

**الصلاحيات المطلوبة:** `admin`

**البيانات المطلوبة:**
```json
{
  "title": "دفع استضافة الموقع",
  "description": "استضافة شهري",
  "amount": 200.00,
  "category": "hosting",
  "expense_type": "monthly",
  "payment_method": "bank_transfer",
  "transaction_date": "2024-01-15"
}
```

**الاستجابة:**
```json
{
  "message": "تم إضافة المصروف بنجاح",
  "expense": {
    "id": 1,
    "title": "دفع استضافة الموقع",
    "description": "استضافة شهري",
    "amount": "200.00",
    "category": "hosting",
    "expense_type": "monthly",
    "payment_method": "bank_transfer",
    "transaction_date": "2024-01-15",
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

**ملاحظات:**
- `category`: يمكن أن تكون `"hosting"` أو `"marketing"` أو `"salaries"` أو `"maintenance"` أو `"other"`
- `expense_type`: يمكن أن تكون `"monthly"` أو `"one_time"` أو `"recurring"`
- `payment_method`: يمكن أن تكون `"cash"` أو `"bank_transfer"` أو `"check"`

### 3. جلب المدخلات

**GET** `/api/accounting/income`

**الصلاحيات المطلوبة:** `admin`

**البارامترات الاختيارية:**
- `start_date`: تاريخ البداية (مثل: `2024-01-01`)
- `end_date`: تاريخ النهاية (مثل: `2024-01-31`)
- `source_type`: نوع المصدر (مثل: `course_payment`)
- `limit`: عدد النتائج (افتراضي: 50)
- `offset`: عدد النتائج للتخطي (افتراضي: 0)

**الاستجابة:**
```json
{
  "income": [
    {
      "id": 1,
      "title": "دفع كورس الرياضيات",
      "description": "دفع من الطالب أحمد محمد",
      "amount": "500.00",
      "source_type": "course_payment",
      "source_id": 1,
      "payment_method": "online_payment",
      "transaction_date": "2024-01-15",
      "created_by": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "created_by_name": "أحمد محمد"
    }
  ]
}
```

### 4. جلب المصروفات

**GET** `/api/accounting/expenses`

**الصلاحيات المطلوبة:** `admin`

**البارامترات الاختيارية:**
- `start_date`: تاريخ البداية (مثل: `2024-01-01`)
- `end_date`: تاريخ النهاية (مثل: `2024-01-31`)
- `category`: فئة المصروف (مثل: `hosting`)
- `limit`: عدد النتائج (افتراضي: 50)
- `offset`: عدد النتائج للتخطي (افتراضي: 0)

**الاستجابة:**
```json
{
  "expenses": [
    {
      "id": 1,
      "title": "دفع استضافة الموقع",
      "description": "استضافة شهري",
      "amount": "200.00",
      "category": "hosting",
      "expense_type": "monthly",
      "payment_method": "bank_transfer",
      "transaction_date": "2024-01-15",
      "created_by": 1,
      "created_at": "2024-01-15T10:30:00Z",
      "updated_at": "2024-01-15T10:30:00Z",
      "created_by_name": "أحمد محمد"
    }
  ]
}
```

### 5. جلب الإحصائيات المالية

**GET** `/api/accounting/stats`

**الصلاحيات المطلوبة:** `admin`

**البارامترات الاختيارية:**
- `start_date`: تاريخ البداية (مثل: `2024-01-01`)
- `end_date`: تاريخ النهاية (مثل: `2024-01-31`)

**الاستجابة:**
```json
{
  "stats": {
    "total_income": 5000.00,
    "total_expenses": 2000.00,
    "net_profit": 3000.00,
    "profit_margin": 60.0,
    "income_by_source": [
      {
        "source_type": "course_payment",
        "total": "4000.00"
      },
      {
        "source_type": "subscription",
        "total": "1000.00"
      }
    ],
    "expenses_by_category": [
      {
        "category": "hosting",
        "total": "800.00"
      },
      {
        "category": "marketing",
        "total": "1200.00"
      }
    ]
  }
}
```

### 6. إنشاء أو تحديث ميزانية شهرية

**POST** `/api/accounting/budget`

**الصلاحيات المطلوبة:** `admin`

**البيانات المطلوبة:**
```json
{
  "month_year": "2024-01",
  "planned_income": 10000.00,
  "planned_expenses": 5000.00,
  "notes": "ميزانية شهر يناير"
}
```

**الاستجابة:**
```json
{
  "message": "تم حفظ الميزانية بنجاح",
  "budget": {
    "id": 1,
    "month_year": "2024-01",
    "planned_income": "10000.00",
    "planned_expenses": "5000.00",
    "actual_income": "0.00",
    "actual_expenses": "0.00",
    "notes": "ميزانية شهر يناير",
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 7. جلب ميزانية شهرية

**GET** `/api/accounting/budget/:monthYear`

**الصلاحيات المطلوبة:** `admin`

**مثال:** `GET /api/accounting/budget/2024-01`

**الاستجابة:**
```json
{
  "budget": {
    "id": 1,
    "month_year": "2024-01",
    "planned_income": "10000.00",
    "planned_expenses": "5000.00",
    "actual_income": "8500.00",
    "actual_expenses": "4200.00",
    "notes": "ميزانية شهر يناير",
    "created_by": 1,
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 8. حذف مدخول

**DELETE** `/api/accounting/income/:id`

**الصلاحيات المطلوبة:** `admin`

**الاستجابة:**
```json
{
  "message": "تم حذف المدخول بنجاح",
  "income": {
    "id": 1,
    "title": "دفع كورس الرياضيات",
    "amount": "500.00"
  }
}
```

### 9. حذف مصروف

**DELETE** `/api/accounting/expenses/:id`

**الصلاحيات المطلوبة:** `admin`

**الاستجابة:**
```json
{
  "message": "تم حذف المصروف بنجاح",
  "expense": {
    "id": 1,
    "title": "دفع استضافة الموقع",
    "amount": "200.00"
  }
}
```

## أمثلة JavaScript

### إضافة مدخول جديد
```javascript
const addIncome = async () => {
  const response = await fetch('/api/accounting/income', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      title: 'دفع كورس الرياضيات',
      description: 'دفع من الطالب أحمد محمد',
      amount: 500.00,
      source_type: 'course_payment',
      source_id: 1,
      payment_method: 'online_payment',
      transaction_date: '2024-01-15'
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

### جلب الإحصائيات المالية
```javascript
const getFinancialStats = async () => {
  const response = await fetch('/api/accounting/stats?start_date=2024-01-01&end_date=2024-01-31', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  
  const data = await response.json();
  console.log('الإحصائيات المالية:', data.stats);
};
```

### إنشاء ميزانية شهرية
```javascript
const createBudget = async () => {
  const response = await fetch('/api/accounting/budget', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      month_year: '2024-01',
      planned_income: 10000.00,
      planned_expenses: 5000.00,
      notes: 'ميزانية شهر يناير'
    })
  });
  
  const data = await response.json();
  console.log(data);
};
```

## ملاحظات مهمة

1. **الصلاحيات:** جميع العمليات تتطلب صلاحيات `admin`
2. **التواريخ:** يجب أن تكون التواريخ بتنسيق `YYYY-MM-DD`
3. **المبالغ:** يتم تخزينها كـ `DECIMAL(10,2)` لضمان الدقة
4. **الميزانية:** يتم تحديث القيم الفعلية تلقائياً عند جلب الميزانية
5. **الحذف:** عند حذف مدخول أو مصروف، يتم حذفه نهائياً من قاعدة البيانات
6. **الفلترة:** يمكن فلترة النتائج حسب التاريخ والنوع والفئة
7. **الإحصائيات:** تشمل إجمالي المدخلات والمصروفات والربح الصافي ونسبة الربح
