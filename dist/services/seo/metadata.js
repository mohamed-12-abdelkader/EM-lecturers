"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoMetadataService = void 0;
const appUrls_1 = require("../../config/appUrls");
const pool_1 = __importDefault(require("../../db/pool"));
const jsonLd_1 = require("./jsonLd");
const tenantSeoSettings_1 = require("./tenantSeoSettings");
const urls_1 = require("./urls");
const publicPages_1 = require("./publicPages");
function resolveTitle(tenant, override) {
    return override ?? tenant.og_title ?? tenant.seo_title ?? tenant.display_name;
}
function resolveDescription(tenant, override) {
    return (override ??
        tenant.og_description ??
        tenant.seo_meta_description ??
        tenant.bio ??
        tenant.display_name);
}
function resolveImage(tenant, override) {
    return (0, appUrls_1.buildFileUrl)(override ?? tenant.og_image ?? tenant.og_image_url ?? tenant.avatar_url);
}
class SeoMetadataService {
    static async getPageMetadata(subdomain, page, options) {
        const tenant = await tenantSeoSettings_1.TenantSeoSettingsService.getBySubdomain(subdomain);
        if (!tenant)
            return null;
        const baseUrl = (0, urls_1.tenantBaseUrl)(subdomain);
        let path = '/';
        let title = resolveTitle(tenant);
        let description = resolveDescription(tenant);
        let keywords = tenant.seo_keywords;
        let ogType = 'website';
        const jsonLd = [
            (0, jsonLd_1.buildOrganizationJsonLd)(tenant, baseUrl),
            (0, jsonLd_1.buildWebSiteJsonLd)(tenant, baseUrl),
        ];
        if (page === 'teacher') {
            path = (0, urls_1.tenantTeacherPath)();
            const teacherPage = await publicPages_1.PublicPagesService.getTeacherPage(subdomain);
            if (teacherPage) {
                title = `${teacherPage.teacher?.name ?? tenant.display_name} | ${tenant.specialty ?? 'مدرس'}`;
                description =
                    teacherPage.tenant.bio ??
                        teacherPage.teacher?.description ??
                        description;
                keywords = [
                    ...keywords,
                    teacherPage.teacher?.name ?? '',
                    teacherPage.teacher?.subject ?? '',
                    ...teacherPage.grades.map((g) => g.name),
                ].filter(Boolean);
                jsonLd.push((0, jsonLd_1.buildTeacherJsonLd)(teacherPage, baseUrl));
            }
        }
        else if (page === 'course' && options?.slug) {
            path = (0, urls_1.tenantCoursePath)(options.slug);
            const coursePage = await publicPages_1.PublicPagesService.getCoursePage(subdomain, options.slug);
            if (coursePage) {
                title = coursePage.course.seo_title ?? `${coursePage.course.title} | ${tenant.display_name}`;
                description = coursePage.course.seo_description ?? coursePage.course.description ?? description;
                keywords = [...keywords, coursePage.course.title, ...(coursePage.course.seo_keywords ?? [])];
                ogType = 'article';
                jsonLd.push((0, jsonLd_1.buildCourseJsonLd)(coursePage, baseUrl));
                jsonLd.push((0, jsonLd_1.buildBreadcrumbJsonLd)(coursePage.breadcrumbs, baseUrl));
            }
        }
        else if (page === 'courses') {
            path = (0, urls_1.tenantCoursesListPath)();
            title = `كورسات ${tenant.display_name}`;
            description = `استعرض جميع كورسات ${tenant.display_name} — ${tenant.specialty ?? 'تعليم أونلاين'}`;
        }
        else if (page === 'home') {
            path = '/';
        }
        const faqs = await this.loadFaqs(tenant.tenant_id);
        const faqLd = (0, jsonLd_1.buildFaqJsonLd)(faqs);
        if (faqLd)
            jsonLd.push(faqLd);
        const canonicalUrl = tenant.canonical_url && page === 'home'
            ? tenant.canonical_url
            : (0, urls_1.buildCanonicalUrl)(subdomain, path);
        return {
            page,
            path,
            canonicalUrl,
            title,
            description: description.slice(0, 320),
            keywords: [...new Set(keywords.filter(Boolean))],
            robots: { index: tenant.robots_index, follow: tenant.robots_follow },
            openGraph: {
                title: tenant.og_title ?? title,
                description: (tenant.og_description ?? description).slice(0, 320),
                url: canonicalUrl,
                type: ogType,
                image: resolveImage(tenant),
                siteName: tenant.display_name,
                locale: 'ar_EG',
            },
            twitter: {
                card: 'summary_large_image',
                title: tenant.twitter_title ?? tenant.og_title ?? title,
                description: (tenant.twitter_description ?? tenant.og_description ?? description).slice(0, 200),
                image: (0, appUrls_1.buildFileUrl)(tenant.twitter_image ?? tenant.og_image ?? tenant.og_image_url),
            },
            favicon: (0, appUrls_1.buildFileUrl)(tenant.favicon_url),
            jsonLd,
        };
    }
    static async getFullSeoBundle(subdomain) {
        const tenant = await tenantSeoSettings_1.TenantSeoSettingsService.getBySubdomain(subdomain);
        if (!tenant)
            return null;
        const baseUrl = (0, urls_1.tenantBaseUrl)(subdomain);
        const home = await this.getPageMetadata(subdomain, 'home');
        const teacher = await this.getPageMetadata(subdomain, 'teacher');
        return {
            tenant: {
                subdomain: tenant.subdomain,
                display_name: tenant.display_name,
                public_url: baseUrl,
            },
            seo: {
                seoTitle: tenant.seo_title,
                seoDescription: tenant.seo_meta_description,
                seoKeywords: tenant.seo_keywords,
                canonicalUrl: tenant.canonical_url ?? baseUrl,
                ogTitle: tenant.og_title ?? tenant.seo_title,
                ogDescription: tenant.og_description ?? tenant.seo_meta_description,
                ogImage: resolveImage(tenant),
                twitterTitle: tenant.twitter_title ?? tenant.og_title ?? tenant.seo_title,
                twitterDescription: tenant.twitter_description ?? tenant.og_description ?? tenant.seo_meta_description,
                twitterImage: (0, appUrls_1.buildFileUrl)(tenant.twitter_image ?? tenant.og_image ?? tenant.og_image_url),
                favicon: (0, appUrls_1.buildFileUrl)(tenant.favicon_url),
                robotsIndex: tenant.robots_index,
                robotsFollow: tenant.robots_follow,
            },
            pages: {
                home,
                teacher,
            },
            jsonLd: home?.jsonLd ?? [],
        };
    }
    static async loadFaqs(tenantId) {
        const res = await pool_1.default.query(`SELECT page FROM tenant_landing_pages WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
        const faq = res.rows[0]?.page?.faq;
        if (!Array.isArray(faq))
            return [];
        return faq
            .filter((item) => item?.question && item?.answer)
            .map((item) => ({ question: String(item.question), answer: String(item.answer) }));
    }
}
exports.SeoMetadataService = SeoMetadataService;
