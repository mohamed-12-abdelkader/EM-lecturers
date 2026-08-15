# إنشاء المنصات — للأدمن فقط

التسجيل الذاتي العام **معطّل**. إنشاء المنصات يتم عبر حساب **admin** فقط.

---

## Endpoint المعتمد

`POST /api/super/tenants`  
Auth: **Bearer Token** — دور `admin` فقط  
Middleware: `default` tenant

### مثال JSON

```http
POST /api/super/tenants
Authorization: Bearer <ADMIN_TOKEN>
Content-Type: application/json
```

```json
{
  "subdomain": "ahmed-physics",
  "display_name": "مستر أحمد",
  "specialty": "الفيزياء",
  "bio": "...",
  "is_active": true,
  "owner": {
    "name": "أحمد",
    "email": "ahmed@example.com",
    "password": "secret123",
    "subject": "الفيزياء",
    "grade_ids": [4, 5, 6]
  }
}
```

يدعم أيضًا `multipart/form-data` لرفع `avatar` / `favicon` / `og_image` / `hero_image`.

Response: `201`

```json
{
  "success": true,
  "tenant": { "id": 12, "subdomain": "ahmed-physics", "..." : "..." }
}
```

---

## المسار العام (معطّل)

| Method | Path | النتيجة |
|--------|------|---------|
| `POST` | `/api/tenants/public/register` | **403** `PUBLIC_SIGNUP_DISABLED` |
| `GET` | `/api/tenants/public/signup-info` | `enabled: false` + توجيه للأدمن |

```json
{
  "success": false,
  "message": "إنشاء المنصات متاح للأدمن فقط عبر لوحة الإدارة",
  "code": "PUBLIC_SIGNUP_DISABLED",
  "admin_endpoint": "POST /api/super/tenants"
}
```

باقي endpoints العامة (مثل قراءة منصة بالـ subdomain، SEO، grades للتسجيل الطلابي) ما زالت تعمل كما هي.

---

## Frontend

- احذف أو أخفِ صفحة التسجيل الذاتي لإنشاء منصة.
- استخدم لوحة الأدمن مع `POST /api/super/tenants` فقط.
