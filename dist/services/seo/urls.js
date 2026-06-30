"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantBaseUrl = tenantBaseUrl;
exports.tenantCoursePath = tenantCoursePath;
exports.tenantCourseUrl = tenantCourseUrl;
exports.tenantHomePath = tenantHomePath;
exports.tenantCoursesListPath = tenantCoursesListPath;
exports.tenantTeacherPath = tenantTeacherPath;
exports.tenantFreeLecturePath = tenantFreeLecturePath;
exports.tenantBlogPath = tenantBlogPath;
exports.buildCanonicalUrl = buildCanonicalUrl;
const appUrls_1 = require("../../config/appUrls");
function tenantBaseUrl(subdomain) {
    return (0, appUrls_1.buildTenantPublicUrl)(subdomain);
}
function tenantCoursePath(slug) {
    return `/course/${slug}`;
}
function tenantCourseUrl(subdomain, slug) {
    return `${tenantBaseUrl(subdomain)}${tenantCoursePath(slug)}`;
}
function tenantHomePath() {
    return '/';
}
function tenantCoursesListPath() {
    return '/courses';
}
function tenantTeacherPath() {
    return '/teacher';
}
function tenantFreeLecturePath(lectureId) {
    return `/free-lectures/${lectureId}`;
}
function tenantBlogPath() {
    return '/blog';
}
function buildCanonicalUrl(subdomain, path) {
    const base = tenantBaseUrl(subdomain);
    if (!path || path === '/')
        return base;
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return `${base}${normalized}`;
}
