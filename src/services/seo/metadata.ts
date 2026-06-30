import { buildFileUrl } from '../../config/appUrls';
import pool from '../../db/pool';
import {
  buildBreadcrumbJsonLd,
  buildCourseJsonLd,
  buildFaqJsonLd,
  buildOrganizationJsonLd,
  buildTeacherJsonLd,
  buildWebSiteJsonLd,
} from './jsonLd';
import { TenantSeoSettingsService } from './tenantSeoSettings';
import type { PageSeoMetadata, SeoPageType, TenantSeoRecord } from './types';
import {
  buildCanonicalUrl,
  tenantBaseUrl,
  tenantCoursePath,
  tenantCoursesListPath,
  tenantTeacherPath,
} from './urls';
import { PublicPagesService } from './publicPages';

function resolveTitle(tenant: TenantSeoRecord, override?: string | null): string {
  return override ?? tenant.og_title ?? tenant.seo_title ?? tenant.display_name;
}

function resolveDescription(tenant: TenantSeoRecord, override?: string | null): string {
  return (
    override ??
    tenant.og_description ??
    tenant.seo_meta_description ??
    tenant.bio ??
    tenant.display_name
  );
}

function resolveImage(tenant: TenantSeoRecord, override?: string | null): string | null {
  return buildFileUrl(override ?? tenant.og_image ?? tenant.og_image_url ?? tenant.avatar_url);
}

export class SeoMetadataService {
  static async getPageMetadata(
    subdomain: string,
    page: SeoPageType,
    options?: { slug?: string; lectureId?: number },
  ): Promise<PageSeoMetadata | null> {
    const tenant = await TenantSeoSettingsService.getBySubdomain(subdomain);
    if (!tenant) return null;

    const baseUrl = tenantBaseUrl(subdomain);
    let path = '/';
    let title = resolveTitle(tenant);
    let description = resolveDescription(tenant);
    let keywords = tenant.seo_keywords;
    let ogType = 'website';
    const jsonLd: Record<string, unknown>[] = [
      buildOrganizationJsonLd(tenant, baseUrl),
      buildWebSiteJsonLd(tenant, baseUrl),
    ];

    if (page === 'teacher') {
      path = tenantTeacherPath();
      const teacherPage = await PublicPagesService.getTeacherPage(subdomain);
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
        jsonLd.push(buildTeacherJsonLd(teacherPage, baseUrl));
      }
    } else if (page === 'course' && options?.slug) {
      path = tenantCoursePath(options.slug);
      const coursePage = await PublicPagesService.getCoursePage(subdomain, options.slug);
      if (coursePage) {
        title = coursePage.course.seo_title ?? `${coursePage.course.title} | ${tenant.display_name}`;
        description = coursePage.course.seo_description ?? coursePage.course.description ?? description;
        keywords = [...keywords, coursePage.course.title, ...(coursePage.course.seo_keywords ?? [])];
        ogType = 'article';
        jsonLd.push(buildCourseJsonLd(coursePage, baseUrl));
        jsonLd.push(buildBreadcrumbJsonLd(coursePage.breadcrumbs, baseUrl));
      }
    } else if (page === 'courses') {
      path = tenantCoursesListPath();
      title = `كورسات ${tenant.display_name}`;
      description = `استعرض جميع كورسات ${tenant.display_name} — ${tenant.specialty ?? 'تعليم أونلاين'}`;
    } else if (page === 'home') {
      path = '/';
    }

    const faqs = await this.loadFaqs(tenant.tenant_id);
    const faqLd = buildFaqJsonLd(faqs);
    if (faqLd) jsonLd.push(faqLd);

    const canonicalUrl =
      tenant.canonical_url && page === 'home'
        ? tenant.canonical_url
        : buildCanonicalUrl(subdomain, path);

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
        image: buildFileUrl(tenant.twitter_image ?? tenant.og_image ?? tenant.og_image_url),
      },
      favicon: buildFileUrl(tenant.favicon_url),
      jsonLd,
    };
  }

  static async getFullSeoBundle(subdomain: string) {
    const tenant = await TenantSeoSettingsService.getBySubdomain(subdomain);
    if (!tenant) return null;

    const baseUrl = tenantBaseUrl(subdomain);
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
        twitterDescription:
          tenant.twitter_description ?? tenant.og_description ?? tenant.seo_meta_description,
        twitterImage: buildFileUrl(tenant.twitter_image ?? tenant.og_image ?? tenant.og_image_url),
        favicon: buildFileUrl(tenant.favicon_url),
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

  private static async loadFaqs(tenantId: number): Promise<Array<{ question: string; answer: string }>> {
    const res = await pool.query<{ page: { faq?: Array<{ question?: string; answer?: string }> } }>(
      `SELECT page FROM tenant_landing_pages WHERE tenant_id = $1 LIMIT 1`,
      [tenantId],
    );
    const faq = res.rows[0]?.page?.faq;
    if (!Array.isArray(faq)) return [];
    return faq
      .filter((item) => item?.question && item?.answer)
      .map((item) => ({ question: String(item.question), answer: String(item.answer) }));
  }
}
