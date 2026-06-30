import { buildFileUrl } from '../../config/appUrls';
import type { PublicCoursePage, PublicTeacherPage, TenantSeoRecord } from './types';

function absUrl(base: string, path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base.replace(/\/+$/, '')}${p}`;
}

export function buildOrganizationJsonLd(tenant: TenantSeoRecord, baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: tenant.display_name,
    url: baseUrl,
    logo: buildFileUrl(tenant.avatar_url ?? tenant.og_image_url),
    description: tenant.seo_meta_description ?? tenant.bio,
    sameAs: [],
  };
}

export function buildWebSiteJsonLd(tenant: TenantSeoRecord, baseUrl: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: tenant.display_name,
    url: baseUrl,
    description: tenant.seo_meta_description ?? tenant.bio,
    potentialAction: {
      '@type': 'SearchAction',
      target: `${baseUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

export function buildTeacherJsonLd(page: PublicTeacherPage, baseUrl: string) {
  const teacher = page.teacher;
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: teacher?.name ?? page.tenant.display_name,
    jobTitle: page.tenant.specialty ?? teacher?.subject ?? 'Teacher',
    description: page.tenant.bio ?? teacher?.description,
    image: buildFileUrl(teacher?.avatar ?? page.tenant.avatar_url),
    url: baseUrl,
    knowsAbout: page.subjects.length ? page.subjects : page.grades.map((g) => g.name),
    aggregateRating:
      page.ratings.count > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: page.ratings.average,
            reviewCount: page.ratings.count,
          }
        : undefined,
  };
}

export function buildCourseJsonLd(data: PublicCoursePage, baseUrl: string) {
  const { course, tenant } = data;
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.title,
    description: course.description ?? course.seo_description,
    url: course.public_url,
    image: buildFileUrl(course.avatar),
    provider: {
      '@type': 'Organization',
      name: tenant.display_name,
      url: tenant.public_url,
    },
    offers: {
      '@type': 'Offer',
      price: course.is_free ? 0 : course.price,
      priceCurrency: 'EGP',
      availability: 'https://schema.org/InStock',
    },
    aggregateRating:
      course.rating_count > 0
        ? {
            '@type': 'AggregateRating',
            ratingValue: course.rating_average,
            reviewCount: course.rating_count,
          }
        : undefined,
  };
}

export function buildBreadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
  baseUrl: string,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absUrl(baseUrl, item.path),
    })),
  };
}

export function buildFaqJsonLd(faqs: Array<{ question: string; answer: string }>) {
  if (!faqs.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}
