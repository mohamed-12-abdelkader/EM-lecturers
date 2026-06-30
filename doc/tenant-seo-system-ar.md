# نظام SEO متعدد المستأجرين — دليل التنفيذ

> **الجمهور:** Backend، Frontend (Next.js)، SEO Technical  
> **السياق:** كل مدرس له منصة مستقلة على Subdomain مثل `https://mohamedahmed.emlectures.com`  
> **الموقع الرئيسي:** `https://emlectures.com`  
> **توثيق API مختصر:** [`tenant-seo-api-ar.md`](./tenant-seo-api-ar.md)

---

## 1. نظرة عامة

تم بناء طبقة SEO كاملة على مستوى الـ **API** لدعم فهرسة منصات المدرسين في Google. النظام يوفّر:

- بيانات SEO موسّعة لكل Tenant في قاعدة البيانات
- صفحات عامة (Public) للمدرس والكورس — جاهزة للـ SSR/SSG
- Sitemap XML و `robots.txt` منفصلين لكل منصة
- Metadata ديناميكي: Canonical، OpenGraph، Twitter Cards، JSON-LD
- بحث Full-Text مع اقتراحات وترند وقوائم شعبية
- تحديث تلقائي عند تغيير بيانات المنصة أو الكورسات
- Slugs صديقة لمحركات البحث (عربي → لاتيني)

```mermaid
flowchart TB
  subgraph Frontend[Next.js — مسؤولية الفرونت]
    SSR[SSR / SSG Pages]
    HEAD[head: title, og, twitter, jsonLd]
    PROXY[sitemap.xml / robots.txt proxy]
  end

  subgraph API[emOnline-api-2]
    TP[tenantsPublic Controller]
    SP[seoPublic Controller]
    AD[adminTenants SEO]
  end

  subgraph Services[src/services/seo]
    META[metadata.ts]
    PAGES[publicPages.ts]
    MAP[sitemap.ts]
    SRCH[search.ts]
    HOOKS[hooks.ts]
  end

  subgraph DB[(PostgreSQL)]
    TSS[tenant_seo_settings]
    CRS[courses.slug + FTS]
    LOGS[seo_search_logs]
  end

  SSR --> TP
  HEAD --> META
  PROXY --> MAP
  TP --> PAGES
  TP --> META
  SP --> SRCH
  AD --> TSS
  HOOKS --> MAP
  PAGES --> DB
  META --> DB
  SRCH --> DB
```

---

## 2. خريطة المتطلبات (25 نقطة)

| # | المتطلب | الحالة | أين يُنفَّذ |
|---|---------|--------|-------------|
| 1 | بيانات SEO لكل Tenant في DB | ✅ | `tenant_seo_settings` + أعمدة `tenants` |
| 2 | صفحة عامة للمدرس | ✅ | `GET /api/tenants/public/:subdomain/teacher` |
| 3 | صفحة عامة للكورس `/course/:slug` | ✅ | `GET /api/tenants/public/:subdomain/course/:slug` |
| 4 | Sitemap XML لكل Tenant | ✅ | `GET /api/tenants/public/:subdomain/sitemap.xml` |
| 5 | robots.txt لكل Tenant | ✅ | `GET /api/tenants/public/:subdomain/robots.txt` |
| 6 | API SEO كامل للفرونت | ✅ | `GET .../seo` و `.../seo/metadata` |
| 7 | JSON-LD (Schema.org) | ✅ | `src/services/seo/jsonLd.ts` |
| 8 | Canonical URL | ✅ | `metadata.canonicalUrl` |
| 9 | OpenGraph | ✅ | `metadata.openGraph` |
| 10 | Twitter Cards | ✅ | `metadata.twitter` |
| 11 | Dynamic Metadata لكل صفحة | ✅ | `?page=home\|teacher\|course\|courses` |
| 12 | تحديث SEO تلقائي عند تغيير المنصة | ✅ | `SeoHooks.onTenantProfileChanged` |
| 13 | Slugs SEO-friendly | ✅ | `src/services/seo/slug.ts` |
| 14 | Search API | ✅ | `/api/seo/search` + `.../:subdomain/search` |
| 15 | Full-Text Search + ترتيب ذكي | ✅ | `src/services/seo/search.ts` |
| 16 | Search Suggestions | ✅ | `GET /api/seo/search/suggestions` |
| 17 | Trending Search | ✅ | `GET /api/seo/search/trending` |
| 18 | Popular Teachers | ✅ | `GET /api/seo/popular/teachers` |
| 19 | Popular Courses | ✅ | `GET /api/seo/popular/courses` |
| 20 | Cache لنتائج البحث | ✅ | `src/services/seo/cache.ts` (in-memory) |
| 21 | إعادة بناء Sitemap تلقائياً | ✅ | `SeoHooks` عند CRUD كورس / patch tenant |
| 22 | SSR/Static Rendering | ⚠️ فرونت | الـ API يجهّز البيانات؛ التنفيذ في Next.js |
| 23 | عدم كسر النظام الحالي | ✅ | مسارات جديدة فقط؛ المسارات القديمة كما هي |
| 24 | Clean Architecture | ✅ | `services/seo/*` + controllers منفصلة |
| 25 | Production Ready | ✅ | TypeScript، hooks، migration، توثيق |

---

## 3. قاعدة البيانات

### 3.1 Migration

```bash
npm run migrate up
```

الملف: `migrations/1773700000000_tenant_seo_system.sql`

### 3.2 جدول `tenant_seo_settings`

| العمود | النوع | الوصف |
|--------|-------|--------|
| `tenant_id` | PK → tenants | معرّف المنصة |
| `seo_keywords` | TEXT[] | كلمات مفتاحية |
| `canonical_url` | TEXT | الرابط الأساسي |
| `og_title` | TEXT | Open Graph title |
| `og_description` | TEXT | Open Graph description |
| `og_image` | TEXT | صورة OG |
| `twitter_title` | TEXT | Twitter Card title |
| `twitter_description` | TEXT | Twitter description |
| `twitter_image` | TEXT | صورة Twitter |
| `robots_index` | BOOLEAN | السماح بالفهرسة (افتراضي true) |
| `robots_follow` | BOOLEAN | السماح بمتابعة الروابط (افتراضي true) |
| `auto_generate` | BOOLEAN | توليد SEO تلقائياً عند التعديل |
| `sitemap_xml` | TEXT | cache لملف الـ sitemap |
| `sitemap_generated_at` | TIMESTAMPTZ | آخر توليد |

### 3.3 أعمدة `tenants` (موجودة مسبقاً + مدمجة)

| العمود | يُستخدم كـ |
|--------|------------|
| `seo_title` | seoTitle |
| `seo_meta_description` | seoDescription |
| `favicon_url` | favicon |
| `og_image_url` | fallback لصورة OG |

### 3.4 أعمدة `courses` (جديدة)

| العمود | الوصف |
|--------|--------|
| `slug` | مسار URL صديق للSEO — فريد per `teacher_id` |
| `seo_title` | عنوان SEO للكورس |
| `seo_description` | وصف SEO |
| `seo_keywords` | كلمات مفتاحية |
| `updated_at` | آخر تحديث (trigger تلقائي) |
| `seo_search_vector` | متجه FTS للبحث |

### 3.5 جداول مساعدة

- **`course_seo_stats`** — `view_count`, `search_hits` لكل كورس
- **`seo_search_logs`** — سجل عمليات البحث (trending + suggestions)

### 3.6 Full-Text Search

- فهرس GIN على `tenants.seo_search_vector`
- فهرس GIN على `courses.seo_search_vector`
- Triggers لتحديث المتجهات عند INSERT/UPDATE

---

## 4. هيكل الكود

```
src/
├── services/seo/
│   ├── slug.ts              # transliteration عربي → latin + slugify
│   ├── cache.ts             # in-memory cache (TTL)
│   ├── types.ts             # TypeScript interfaces
│   ├── urls.ts              # بناء canonical ومسارات الصفحات
│   ├── jsonLd.ts            # Schema.org: Organization, WebSite, Person, Course, Breadcrumb, FAQ
│   ├── tenantSeoSettings.ts # قراءة/كتابة إعدادات SEO + slugs الكورسات
│   ├── metadata.ts          # PageSeoMetadata ديناميكي (OG, Twitter, Canonical)
│   ├── publicPages.ts       # بيانات صفحة المدرس والكورس
│   ├── sitemap.ts           # توليد XML + invalidation
│   ├── robots.ts            # robots.txt لكل tenant
│   ├── search.ts            # FTS + suggestions + trending + popular
│   └── hooks.ts             # ربط مع tenant patch و course CRUD
├── controllers/
│   ├── tenantsPublic.ts     # مسارات public لكل subdomain (موسّعة)
│   ├── seoPublic.ts         # بحث عام على الموقع الرئيسي
│   └── adminTenants.ts      # PATCH /admin/tenants/:id/seo
└── routes.ts                # router.use('/seo', seoPublicRouter)
```

### الملفات المعدّلة (بدون كسر التوافق)

| الملف | التعديل |
|-------|---------|
| `src/controllers/courses.ts` | استدعاء `SeoHooks` بعد create/update/delete |
| `src/services/tenants.ts` | `SeoHooks.onTenantProfileChanged` بعد `patchTenant` |
| `src/services/publicTeacherPlatform.ts` | إرجاع `slug` في قائمة الكورسات |
| `src/routes.ts` | تسجيل `/api/seo` |

---

## 5. واجهات API

### 5.1 مسارات Tenant (Public — بدون مصادقة)

**Base:** `/api/tenants/public/:subdomain`

| Method | المسار | الوصف |
|--------|--------|--------|
| GET | `/` | Home bundle (موجود مسبقاً — موسّع بـ slug في الكورسات) |
| GET | `/teacher` | صفحة المدرس + metadata |
| GET | `/course/:slug` | صفحة كورس + metadata |
| GET | `/seo` | bundle SEO كامل للفرونت |
| GET | `/seo/metadata` | metadata ديناميكي (`?page=&slug=`) |
| GET | `/sitemap.xml` | Sitemap XML |
| GET | `/robots.txt` | robots.txt |
| GET | `/search` | بحث داخل المنصة |
| GET | `/courses` | قائمة كورسات (موجود) |
| GET | `/grades` | الصفوف (موجود) |
| GET | `/free-lectures` | محاضرات مجانية (موجود) |

**Sitemap العالمي (كل المنصات):** `GET /api/tenants/public/sitemap.xml` — كما كان.

### 5.2 مسارات البحث العام (Main Site)

**Base:** `/api/seo`

| Method | المسار | Query params |
|--------|--------|--------------|
| GET | `/search` | `q`, `specialty`, `subject`, `grade`, `stage`, `keywords`, `tenant_id`, `limit`, `offset` |
| GET | `/search/suggestions` | `q`, `tenant_id` |
| GET | `/search/trending` | `tenant_id`, `days` (افتراضي 7) |
| GET | `/popular/teachers` | `limit` |
| GET | `/popular/courses` | `limit`, `tenant_id` |

### 5.3 Admin

| Method | المسار | الوصف |
|--------|--------|--------|
| PATCH | `/api/admin/tenants/:id/seo` | تعديل SEO يدوياً |
| PATCH | `/api/admin/tenants/:id` | يُحدّث SEO تلقائياً إن `auto_generate=true` |

---

## 6. أمثلة Response

### 6.1 صفحة المدرس

`GET /api/tenants/public/mohamedahmed/teacher`

```json
{
  "success": true,
  "data": {
    "page": {
      "tenant": {
        "subdomain": "mohamedahmed",
        "display_name": "أ. محمد أحمد",
        "specialty": "كيمياء",
        "bio": "مدرس كيمياء للثانوية العامة",
        "avatar_url": "https://...",
        "public_url": "https://mohamedahmed.emlectures.com"
      },
      "teacher": {
        "name": "أ. محمد أحمد",
        "avatar": "https://...",
        "description": "...",
        "subject": "كيمياء",
        "facebook_url": "...",
        "youtube_url": "...",
        "tiktok_url": null,
        "whatsapp_number": "2010..."
      },
      "stats": {
        "students_count": 240,
        "courses_count": 12,
        "grades_count": 3
      },
      "ratings": {
        "average": 4.7,
        "count": 85
      },
      "grades": [{ "id": 1, "name": "الصف الثالث الثانوي", "slug": "grade-3", "stage": "secondary" }],
      "subjects": ["كيمياء", "الصف الثالث الثانوي"],
      "latest_courses": [
        {
          "id": 5,
          "slug": "alkimiaa-llthanawya-alama",
          "title": "الكيمياء للثانوية العامة",
          "students_count": 45,
          "rating_average": 4.8,
          "public_url": "https://mohamedahmed.emlectures.com/course/alkimiaa-llthanawya-alama"
        }
      ],
      "social_links": [
        { "type": "youtube", "url": "https://youtube.com/..." },
        { "type": "whatsapp", "url": "https://wa.me/2010..." }
      ]
    },
    "metadata": {
      "page": "teacher",
      "canonicalUrl": "https://mohamedahmed.emlectures.com/teacher",
      "title": "أ. محمد أحمد | كيمياء | EM Lectures",
      "openGraph": { "type": "website", "locale": "ar_EG", "...": "..." },
      "twitter": { "card": "summary_large_image", "...": "..." },
      "jsonLd": [
        { "@type": "Organization", "...": "..." },
        { "@type": "WebSite", "...": "..." },
        { "@type": "Person", "...": "..." }
      ]
    }
  }
}
```

### 6.2 SEO Bundle

`GET /api/tenants/public/mohamedahmed/seo`

```json
{
  "success": true,
  "data": {
    "tenant": {
      "subdomain": "mohamedahmed",
      "display_name": "أ. محمد أحمد",
      "public_url": "https://mohamedahmed.emlectures.com"
    },
    "seo": {
      "seoTitle": "أ. محمد أحمد | كيمياء | EM Lectures",
      "seoDescription": "منصة أ. محمد أحمد التعليمية...",
      "seoKeywords": ["أ. محمد أحمد", "كيمياء", "منصة تعليمية"],
      "canonicalUrl": "https://mohamedahmed.emlectures.com",
      "ogTitle": "...",
      "ogDescription": "...",
      "ogImage": "https://...",
      "twitterTitle": "...",
      "twitterDescription": "...",
      "favicon": "https://...",
      "robotsIndex": true,
      "robotsFollow": true
    },
    "pages": { "home": { "...": "..." }, "teacher": { "...": "..." } },
    "jsonLd": []
  }
}
```

### 6.3 بحث

`GET /api/seo/search?q=كيمياء&limit=10`

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "type": "teacher",
        "title": "أ. محمد أحمد",
        "subtitle": "كيمياء",
        "slug": "mohamedahmed",
        "students_count": 240,
        "rating_average": 4.7,
        "public_url": "https://mohamedahmed.emlectures.com",
        "score": 95.2
      },
      {
        "type": "course",
        "title": "الكيمياء للثانوية العامة",
        "slug": "alkimiaa-llthanawya-alama",
        "subdomain": "mohamedahmed",
        "students_count": 45,
        "view_count": 1200,
        "public_url": "https://mohamedahmed.emlectures.com/course/alkimiaa-llthanawya-alama",
        "score": 78.5
      }
    ],
    "total": 2
  }
}
```

---

## 7. Slugs

### القواعد

1. عند إنشاء كورس → يُولَّد `slug` من العنوان تلقائياً
2. Transliteration للعربية: `الكيمياء للثانوية العامة` → `alkimiaa-llthanawya-alama`
3. كلمات شائعة تُترجم مباشرة: `كيمياء` → `chemistry`, `ثانوية` → `secondary`
4. فريد per `teacher_id` — عند التعارض يُضاف `-2`, `-3`...
5. Fallback: `course-{id}` للكورسات القديمة

### الملف

`src/services/seo/slug.ts`

---

## 8. JSON-LD (Schema.org)

| النوع | متى يُضاف |
|-------|-----------|
| `Organization` | كل صفحة |
| `WebSite` + `SearchAction` | كل صفحة |
| `Person` | صفحة المدرس |
| `Course` | صفحة الكورس |
| `BreadcrumbList` | صفحة الكورس |
| `FAQPage` | إن وُجد `faq` في `tenant_landing_pages.page` |

---

## 9. Sitemap لكل Tenant

`GET /api/tenants/public/:subdomain/sitemap.xml`

### URLs المضمّنة

| المسار | الأولوية |
|--------|----------|
| `/` (Home) | 1.0 |
| `/teacher` | 0.9 |
| `/courses` | 0.9 |
| `/course/:slug` (كل كورس ظاهر) | 0.8 |
| `/free-lectures/:id` | 0.6 |
| `/blog` | 0.5 (إن `tenant_settings.data.blog.enabled`) |

### إعادة البناء التلقائي

يُبطل cache الـ sitemap ويُعاد توليده عند:

- `PATCH /api/admin/tenants/:id`
- `POST /api/course` (إنشاء كورس)
- `PATCH /api/course/:id` (تعديل كورس)
- `DELETE /api/course/:id` (حذف كورس)

المنطق في: `src/services/seo/hooks.ts`

---

## 10. التحديث التلقائي لبيانات SEO

عند تعديل بيانات المنصة (`display_name`, `bio`, `specialty`, بيانات المالك...) وإذا `auto_generate = true`:

1. يُعاد توليد `seo_title`, `seo_meta_description`
2. تُحدَّث `og_*`, `twitter_*`, `canonical_url`, `seo_keywords`
3. يُبطل sitemap cache

عند إنشاء/تعديل كورس:

1. يُولَّد/يُحدَّث `slug`
2. يُحدَّث `seo_title`, `seo_description` للكورس
3. يُبطل sitemap cache

---

## 11. Cache

| النوع | TTL | الملف |
|-------|-----|-------|
| نتائج البحث | 5 دقائق | `cache.ts` |
| Suggestions | 3 دقائق | `cache.ts` |
| Trending | 10 دقائق | `cache.ts` |
| Popular | 15 دقيقة | `cache.ts` |
| Sitemap XML | 1 ساعة | DB + memory |
| صفحات public | 5 دقائق | `cache.ts` |

> **ملاحظة إنتاج:** في بيئة multi-instance يُفضّل استبدال `cache.ts` بـ **Redis**.

---

## 12. إعدادات البيئة

| المتغير | الغرض |
|---------|--------|
| `TENANT_ROOT_DOMAIN` | `emlectures.com` — لبناء روابط Subdomain |
| `PRODUCTION_URL` / `FRONTEND_HOST` | URL الإنتاج |
| `BASE_URL` | URL الـ API للصور والملفات |

دالة بناء روابط المنصة: `buildTenantPublicUrl()` في `src/config/appUrls.ts`

---

## 13. تكامل Frontend (Next.js)

### 13.1 Middleware

```typescript
// استخراج subdomain من Host: mohamedahmed.emlectures.com → mohamedahmed
const host = request.headers.get('host') ?? '';
const subdomain = host.split('.')[0];
```

### 13.2 صفحات مقترحة

| Route في Next.js | API |
|------------------|-----|
| `/` | `GET /api/tenants/public/:subdomain` + `.../seo/metadata?page=home` |
| `/teacher` | `GET .../teacher` |
| `/course/[slug]` | `GET .../course/:slug` |
| `/courses` | `GET .../courses` |
| `/search` | `GET .../search` أو `/api/seo/search` |

### 13.3 حقن Metadata (مثال)

```tsx
// app/[tenant]/course/[slug]/page.tsx
export async function generateMetadata({ params }) {
  const res = await fetch(
    `${API}/tenants/public/${params.tenant}/seo/metadata?page=course&slug=${params.slug}`,
    { next: { revalidate: 300 } }
  );
  const { data } = await res.json();
  return {
    title: data.title,
    description: data.description,
    alternates: { canonical: data.canonicalUrl },
    openGraph: {
      title: data.openGraph.title,
      description: data.openGraph.description,
      url: data.openGraph.url,
      images: data.openGraph.image ? [data.openGraph.image] : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: data.twitter.title,
      description: data.twitter.description,
      images: data.twitter.image ? [data.twitter.image] : [],
    },
  };
}
```

### 13.4 JSON-LD

```tsx
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(metadata.jsonLd) }}
/>
```

### 13.5 Sitemap و Robots في Next.js

```typescript
// app/sitemap.ts — أو rewrite في next.config
// Proxy: https://mohamedahmed.emlectures.com/sitemap.xml
//   → https://api.emlectures.com/api/tenants/public/mohamedahmed/sitemap.xml
```

---

## 14. ترتيب البحث (Ranking)

النتائج تُرتَّب حسب **score** مركّب:

1. **تطابق الاسم** — تطابق كامل (+100) / يبدأ بـ (+60) / يحتوي (+30)
2. **FTS rank** — `ts_rank` من PostgreSQL
3. **عدد الطلاب** — من جدول `enrollments`
4. **عدد الزيارات** — من `course_seo_stats.view_count`
5. **التقييم** — من `course_ratings`
6. **آخر تحديث** — `updated_at`

---

## 15. ما لم يُنفَّذ في الـ API (مسؤولية الفرونت)

| البند | السبب |
|-------|--------|
| SSR/SSG فعلي للصفحات | يتم في مشروع Next.js المنفصل |
| عرض HTML للزائر | الـ API يرجع JSON فقط |
| Blog كامل | لا يوجد جدول blog؛ يُدعم في sitemap إن `blog.enabled` في settings |

---

## 16. خطوات التشغيل

```bash
# 1. تطبيق Migration
npm run migrate up

# 2. بناء المشروع
npm run build

# 3. تشغيل السيرفر
npm run dev

# 4. اختبار سريع
curl http://localhost:PORT/api/tenants/public/SUBDOMAIN/seo
curl http://localhost:PORT/api/tenants/public/SUBDOMAIN/sitemap.xml
curl http://localhost:PORT/api/seo/search?q=كيمياء
```

---

## 17. مراجع سريعة

- **Migration:** `migrations/1773700000000_tenant_seo_system.sql`
- **خدمات SEO:** `src/services/seo/`
- **مسارات Public:** `src/controllers/tenantsPublic.ts`
- **بحث عام:** `src/controllers/seoPublic.ts`
- **Admin SEO:** `PATCH /api/admin/tenants/:id/seo`
- **توثيق API مختصر:** [`tenant-seo-api-ar.md`](./tenant-seo-api-ar.md)
