import { buildTenantPublicUrl } from '../../config/appUrls';

export function tenantBaseUrl(subdomain: string): string {
  return buildTenantPublicUrl(subdomain);
}

export function tenantCoursePath(slug: string): string {
  return `/course/${slug}`;
}

export function tenantCourseUrl(subdomain: string, slug: string): string {
  return `${tenantBaseUrl(subdomain)}${tenantCoursePath(slug)}`;
}

export function tenantHomePath(): string {
  return '/';
}

export function tenantCoursesListPath(): string {
  return '/courses';
}

export function tenantTeacherPath(): string {
  return '/teacher';
}

export function tenantFreeLecturePath(lectureId: number): string {
  return `/free-lectures/${lectureId}`;
}

export function tenantBlogPath(): string {
  return '/blog';
}

export function buildCanonicalUrl(subdomain: string, path: string): string {
  const base = tenantBaseUrl(subdomain);
  if (!path || path === '/') return base;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${base}${normalized}`;
}
