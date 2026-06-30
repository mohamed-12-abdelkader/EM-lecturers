"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOrganizationJsonLd = buildOrganizationJsonLd;
exports.buildWebSiteJsonLd = buildWebSiteJsonLd;
exports.buildTeacherJsonLd = buildTeacherJsonLd;
exports.buildCourseJsonLd = buildCourseJsonLd;
exports.buildBreadcrumbJsonLd = buildBreadcrumbJsonLd;
exports.buildFaqJsonLd = buildFaqJsonLd;
const appUrls_1 = require("../../config/appUrls");
function absUrl(base, path) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base.replace(/\/+$/, '')}${p}`;
}
function buildOrganizationJsonLd(tenant, baseUrl) {
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: tenant.display_name,
        url: baseUrl,
        logo: (0, appUrls_1.buildFileUrl)(tenant.avatar_url ?? tenant.og_image_url),
        description: tenant.seo_meta_description ?? tenant.bio,
        sameAs: [],
    };
}
function buildWebSiteJsonLd(tenant, baseUrl) {
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
function buildTeacherJsonLd(page, baseUrl) {
    const teacher = page.teacher;
    return {
        '@context': 'https://schema.org',
        '@type': 'Person',
        name: teacher?.name ?? page.tenant.display_name,
        jobTitle: page.tenant.specialty ?? teacher?.subject ?? 'Teacher',
        description: page.tenant.bio ?? teacher?.description,
        image: (0, appUrls_1.buildFileUrl)(teacher?.avatar ?? page.tenant.avatar_url),
        url: baseUrl,
        knowsAbout: page.subjects.length ? page.subjects : page.grades.map((g) => g.name),
        aggregateRating: page.ratings.count > 0
            ? {
                '@type': 'AggregateRating',
                ratingValue: page.ratings.average,
                reviewCount: page.ratings.count,
            }
            : undefined,
    };
}
function buildCourseJsonLd(data, baseUrl) {
    const { course, tenant } = data;
    return {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: course.title,
        description: course.description ?? course.seo_description,
        url: course.public_url,
        image: (0, appUrls_1.buildFileUrl)(course.avatar),
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
        aggregateRating: course.rating_count > 0
            ? {
                '@type': 'AggregateRating',
                ratingValue: course.rating_average,
                reviewCount: course.rating_count,
            }
            : undefined,
    };
}
function buildBreadcrumbJsonLd(items, baseUrl) {
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
function buildFaqJsonLd(faqs) {
    if (!faqs.length)
        return null;
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
