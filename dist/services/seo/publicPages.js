"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicPagesService = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const publicTeacherPlatform_1 = require("../publicTeacherPlatform");
const urls_1 = require("./urls");
const cache_1 = require("./cache");
async function courseRatings(courseIds) {
    const map = new Map();
    if (!courseIds.length)
        return map;
    const res = await pool_1.default.query(`SELECT course_id, AVG(rating)::numeric(4,2) AS avg, COUNT(*)::text AS count
     FROM course_ratings
     WHERE course_id = ANY($1::int[])
     GROUP BY course_id`, [courseIds]);
    for (const row of res.rows) {
        map.set(row.course_id, { avg: Number(row.avg), count: Number(row.count) });
    }
    return map;
}
async function courseStudentCounts(courseIds) {
    const map = new Map();
    if (!courseIds.length)
        return map;
    const res = await pool_1.default.query(`SELECT e.course_id, COUNT(DISTINCT e.user_id)::text AS count
     FROM enrollments e
     WHERE e.course_id = ANY($1::int[])
     GROUP BY e.course_id`, [courseIds]);
    for (const row of res.rows) {
        map.set(row.course_id, Number(row.count));
    }
    return map;
}
function mapCourseRow(row, subdomain, ratings, students) {
    const id = Number(row.id);
    const slug = String(row.slug ?? `course-${id}`);
    const rating = ratings.get(id);
    return {
        id,
        slug,
        title: String(row.title),
        description: row.description ?? null,
        price: Number(row.price ?? 0),
        is_free: row.is_free === true,
        avatar: row.avatar ?? null,
        grade: row.grade_id
            ? {
                id: Number(row.grade_id),
                name: String(row.grade_name),
                slug: row.grade_slug ?? null,
            }
            : null,
        students_count: students.get(id) ?? 0,
        rating_average: rating?.avg ?? null,
        rating_count: rating?.count ?? 0,
        created_at: String(row.created_at),
        public_url: (0, urls_1.tenantCourseUrl)(subdomain, slug),
    };
}
class PublicPagesService {
    static async getTeacherPage(subdomainRaw) {
        const cacheKey = `teacher-page:${subdomainRaw.toLowerCase()}`;
        const cached = (0, cache_1.seoCacheGet)(cacheKey);
        if (cached)
            return cached;
        const platform = await (0, publicTeacherPlatform_1.resolveTeacherPlatformBySubdomain)(subdomainRaw);
        if (!platform)
            return null;
        const tenantRes = await pool_1.default.query(`SELECT display_name, specialty, bio, avatar_url FROM tenants WHERE id = $1 LIMIT 1`, [platform.tenant.id]);
        const tenantRow = tenantRes.rows[0];
        const teacherId = platform.teacher.id;
        const subdomain = platform.tenant.subdomain;
        const baseUrl = (0, urls_1.tenantBaseUrl)(subdomain);
        const [teacherRes, gradesRes, statsRes, coursesRes, ratingsRes] = await Promise.all([
            pool_1.default.query(`SELECT name, avatar, description, subject, facebook_url, youtube_url, tiktok_url, whatsapp_number
         FROM users WHERE id = $1 LIMIT 1`, [teacherId]),
            pool_1.default.query(`SELECT g.id, g.name, g.slug, g.stage
         FROM teacher_grades tg
         JOIN grades g ON g.id = tg.grade_id
         WHERE tg.teacher_id = $1 AND g.status = 'active'
         ORDER BY g.id`, [teacherId]),
            pool_1.default.query(`SELECT
           (SELECT COUNT(DISTINCT e.user_id)
            FROM enrollments e
            JOIN courses c ON c.id = e.course_id
            WHERE c.teacher_id = $1) AS students_count,
           (SELECT COUNT(*) FROM courses c WHERE c.teacher_id = $1
              AND (c.is_visible IS NULL OR c.is_visible = TRUE)) AS courses_count,
           (SELECT COUNT(*) FROM teacher_grades tg WHERE tg.teacher_id = $1) AS grades_count`, [teacherId]),
            pool_1.default.query(`SELECT c.id, c.title, c.description, c.price, c.avatar, c.grade_id, c.created_at,
                c.slug, COALESCE(c.is_free, FALSE) AS is_free,
                g.name AS grade_name, g.slug AS grade_slug
         FROM courses c
         LEFT JOIN grades g ON g.id = c.grade_id
         WHERE c.teacher_id = $1 AND (c.is_visible IS NULL OR c.is_visible = TRUE)
         ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
         LIMIT 12`, [teacherId]),
            pool_1.default.query(`SELECT AVG(cr.rating)::numeric(4,2) AS avg, COUNT(*)::text AS count
         FROM course_ratings cr
         JOIN courses c ON c.id = cr.course_id
         WHERE c.teacher_id = $1`, [teacherId]),
        ]);
        const teacher = teacherRes.rows[0] ?? null;
        const courseIds = coursesRes.rows.map((r) => Number(r.id));
        const [ratingsMap, studentsMap] = await Promise.all([
            courseRatings(courseIds),
            courseStudentCounts(courseIds),
        ]);
        const social_links = [];
        if (teacher?.facebook_url)
            social_links.push({ type: 'facebook', url: teacher.facebook_url });
        if (teacher?.youtube_url)
            social_links.push({ type: 'youtube', url: teacher.youtube_url });
        if (teacher?.tiktok_url)
            social_links.push({ type: 'tiktok', url: teacher.tiktok_url });
        if (teacher?.whatsapp_number) {
            social_links.push({
                type: 'whatsapp',
                url: `https://wa.me/${String(teacher.whatsapp_number).replace(/\D/g, '')}`,
            });
        }
        const subjects = [
            teacher?.subject,
            tenantRow?.specialty,
            ...gradesRes.rows.map((g) => g.name),
        ].filter(Boolean);
        const page = {
            tenant: {
                subdomain,
                display_name: tenantRow?.display_name ?? platform.tenant.display_name,
                specialty: tenantRow?.specialty ?? null,
                bio: tenantRow?.bio ?? null,
                avatar_url: tenantRow?.avatar_url ?? null,
                public_url: baseUrl,
            },
            teacher: teacher
                ? {
                    name: teacher.name,
                    avatar: teacher.avatar,
                    description: teacher.description,
                    subject: teacher.subject,
                    facebook_url: teacher.facebook_url,
                    youtube_url: teacher.youtube_url,
                    tiktok_url: teacher.tiktok_url,
                    whatsapp_number: teacher.whatsapp_number,
                }
                : null,
            stats: {
                students_count: Number(statsRes.rows[0]?.students_count ?? 0),
                courses_count: Number(statsRes.rows[0]?.courses_count ?? 0),
                grades_count: Number(statsRes.rows[0]?.grades_count ?? 0),
            },
            ratings: {
                average: ratingsRes.rows[0]?.avg != null ? Number(ratingsRes.rows[0].avg) : null,
                count: Number(ratingsRes.rows[0]?.count ?? 0),
            },
            grades: gradesRes.rows,
            subjects: [...new Set(subjects)],
            latest_courses: coursesRes.rows.map((row) => mapCourseRow(row, subdomain, ratingsMap, studentsMap)),
            social_links,
        };
        (0, cache_1.seoCacheSet)(cacheKey, page, cache_1.SEO_CACHE_TTL.publicPage);
        return page;
    }
    static async getCoursePage(subdomainRaw, slugRaw) {
        const slug = slugRaw.trim().toLowerCase();
        const cacheKey = `course-page:${subdomainRaw.toLowerCase()}:${slug}`;
        const cached = (0, cache_1.seoCacheGet)(cacheKey);
        if (cached)
            return cached;
        const platform = await (0, publicTeacherPlatform_1.resolveTeacherPlatformBySubdomain)(subdomainRaw);
        if (!platform)
            return null;
        const courseRes = await pool_1.default.query(`SELECT c.*, g.name AS grade_name, g.slug AS grade_slug, g.stage,
              COALESCE(css.view_count, 0) AS view_count
       FROM courses c
       LEFT JOIN grades g ON g.id = c.grade_id
       LEFT JOIN course_seo_stats css ON css.course_id = c.id
       WHERE c.teacher_id = $1 AND lower(c.slug) = $2
         AND (c.is_visible IS NULL OR c.is_visible = TRUE)
       LIMIT 1`, [platform.teacher.id, slug]);
        if (!courseRes.rowCount)
            return null;
        const row = courseRes.rows[0];
        const courseId = Number(row.id);
        const [ratingsMap, studentsMap] = await Promise.all([
            courseRatings([courseId]),
            courseStudentCounts([courseId]),
        ]);
        const subdomain = platform.tenant.subdomain;
        const summary = mapCourseRow(row, subdomain, ratingsMap, studentsMap);
        const page = {
            course: {
                ...summary,
                seo_title: row.seo_title,
                seo_description: row.seo_description,
                seo_keywords: Array.isArray(row.seo_keywords) ? row.seo_keywords : [],
                teacher_name: platform.teacher.name,
                teacher_avatar: platform.teacher.avatar,
                view_count: Number(row.view_count ?? 0),
            },
            tenant: {
                subdomain,
                display_name: platform.tenant.display_name,
                public_url: (0, urls_1.tenantBaseUrl)(subdomain),
            },
            breadcrumbs: [
                { name: platform.tenant.display_name, path: '/' },
                { name: 'الكورسات', path: '/courses' },
                { name: summary.title, path: (0, urls_1.tenantCoursePath)(summary.slug) },
            ],
        };
        (0, cache_1.seoCacheSet)(cacheKey, page, cache_1.SEO_CACHE_TTL.publicPage);
        return page;
    }
}
exports.PublicPagesService = PublicPagesService;
