# نظام SEO متعدد المستأجرين (Multi-Tenant SEO)

> **دليل التنفيذ الكامل:** [`tenant-seo-system-ar.md`](./tenant-seo-system-ar.md)

توثيق واجهات الـ API لدعم أرشفة منصات المدرسين على Subdomains مثل `https://mohamedahmed.emlectures.com`.

## Migration

```bash
npm run migrate up
```

الملف: `migrations/1773700000000_tenant_seo_system.sql`

يضيف:

- `tenant_seo_settings` — حقول SEO الموسّعة
- `courses.slug`, `seo_title`, `seo_description`, `seo_keywords`
- `course_seo_stats` — زيارات وبحث
- `seo_search_logs` — trending/suggestions
- فهارس Full-Text Search على `tenants` و `courses`

---

## هيكل الملفات

| الملف | الدور |
|-------|------|
| `src/services/seo/slug.ts` | توليد slugs (عربي → latin) |
| `src/services/seo/cache.ts` | Cache in-memory لنتائج البحث والـ sitemap |
| `src/services/seo/types.ts` | أنواع TypeScript |
| `src/services/seo/urls.ts` | بناء canonical URLs |
| `src/services/seo/jsonLd.ts` | Schema.org JSON-LD |
| `src/services/seo/tenantSeoSettings.ts` | إعدادات SEO + slugs للكورسات |
| `src/services/seo/metadata.ts` | OpenGraph, Twitter, Canonical ديناميكي |
| `src/services/seo/publicPages.ts` | صفحة المدرس + صفحة الكورس |
| `src/services/seo/sitemap.ts` | Sitemap XML لكل tenant |
| `src/services/seo/robots.ts` | robots.txt لكل tenant |
| `src/services/seo/search.ts` | بحث، اقتراحات، trending، popular |
| `src/services/seo/hooks.ts` | إعادة بناء sitemap عند التعديل |
| `src/controllers/tenantsPublic.ts` | مسارات public لكل subdomain |
| `src/controllers/seoPublic.ts` | بحث عام على الموقع الرئيسي |
| `src/controllers/adminTenants.ts` | `PATCH /admin/tenants/:id/seo` |

---

## مسارات Tenant (Public)

Base: `/api/tenants/public/:subdomain`

### صفحة المنصة (Home)

`GET /api/tenants/public/:subdomain`

### صفحة المدرس (Indexable)

`GET /api/tenants/public/:subdomain/teacher`

يرجع: اسم المدرس، نبذة، صورة، تخصص، مواد/صفوف، عدد الطلاب/كورسات، أحدث كورسات، تقييمات، سوشيال + `metadata` للـ SSR.

### صفحة الكورس

`GET /api/tenants/public/:subdomain/course/:slug`

مثال slug: `alkimiaa-llthanawya-alama` أو `chemistry-secondary`

### SEO Bundle كامل

`GET /api/tenants/public/:subdomain/seo`

```json
{
  "seoTitle": "...",
  "seoDescription": "...",
  "seoKeywords": [],
  "canonicalUrl": "https://teacher.emlectures.com",
  "ogTitle": "...",
  "ogDescription": "...",
  "ogImage": "https://...",
  "twitterTitle": "...",
  "twitterDescription": "...",
  "favicon": "...",
  "robotsIndex": true,
  "robotsFollow": true
}
```

### Metadata ديناميكي لكل صفحة

`GET /api/tenants/public/:subdomain/seo/metadata?page=home|teacher|course|courses&slug=`

يرجع: `canonicalUrl`, `openGraph`, `twitter`, `jsonLd[]` (Organization, WebSite, Person, Course, BreadcrumbList, FAQPage).

### Sitemap

`GET /api/tenants/public/:subdomain/sitemap.xml`

يشمل: Home, Teacher, Courses list, كل الكورses، المحاضرات المجانية، Blog (إن `tenant_settings.data.blog.enabled`).

### Robots

`GET /api/tenants/public/:subdomain/robots.txt`

### بحث داخل المنصة

`GET /api/tenants/public/:subdomain/search?q=&specialty=&subject=&grade=&stage=&keywords=`

---

## مسارات البحث العام (Main Site)

Base: `/api/seo`

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/search` | Full-text search (مدرس + كورس) |
| GET | `/search/suggestions?q=` | اقتراحات |
| GET | `/search/trending` | أكثر عمليات البحث |
| GET | `/popular/teachers` | أشهر المدرسين |
| GET | `/popular/courses` | أشهر الكورسات |

ترتيب النتائج: تطابق الاسم → FTS rank → عدد الطلاب → الزيارات → التقييم → آخر تحديث.

---

## Admin — تعديل SEO يدوياً

`PATCH /api/admin/tenants/:id/seo`

```json
{
  "seo_title": "...",
  "seo_meta_description": "...",
  "seo_keywords": ["كيمياء", "ثانوية"],
  "canonical_url": "https://teacher.emlectures.com",
  "og_title": "...",
  "og_description": "...",
  "og_image": "https://...",
  "twitter_title": "...",
  "twitter_description": "...",
  "favicon_url": "https://...",
  "robots_index": true,
  "robots_follow": true,
  "auto_generate": false
}
```

عند التعديل اليدوي يُعطّل `auto_generate` تلقائياً ما لم تُمرّره صراحة.

---

## التحديث التلقائي

يُعاد توليد SEO و sitemap تلقائياً عند:

- `PATCH /api/admin/tenants/:id` (اسم المنصة، bio، مالك...)
- إنشاء / تعديل / حذف كورس (`POST/PATCH/DELETE /api/course`)

---

## Frontend (Next.js) — SSR/SSG

1. **Middleware**: resolve subdomain من Host header.
2. **Home** (`/`): `GET .../seo/metadata?page=home`
3. **Teacher** (`/teacher`): `GET .../teacher`
4. **Course** (`/course/[slug]`): `GET .../course/:slug`
5. **`<head>`**: استخدم `metadata` من الـ API (title, canonical, og, twitter, jsonLd).
6. **sitemap.xml / robots.txt**: proxy من Next أو fetch مباشر من API.

---

## Slugs

- تُولَّد تلقائياً من عنوان الكورس مع transliteration للعربية.
- فريدة per `teacher_id`.
- fallback: `course-{id}`

---

## Cache

In-memory TTL:

- Search: 5 دقائق
- Sitemap: 1 ساعة (يُبطل عند تعديل الكورس/المنصة)
- Popular/Trending: 10–15 دقيقة

For production multi-instance: استبدل `cache.ts` بـ Redis.
