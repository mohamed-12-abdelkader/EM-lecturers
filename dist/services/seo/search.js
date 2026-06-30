"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SeoSearchService = void 0;
const pool_1 = __importDefault(require("../../db/pool"));
const appUrls_1 = require("../../config/appUrls");
const cache_1 = require("./cache");
const urls_1 = require("./urls");
function normalizeQuery(q) {
    return (q ?? '').trim().slice(0, 120);
}
function cacheKey(prefix, filters) {
    return `${prefix}:${JSON.stringify(filters)}`;
}
async function logSearch(tenantId, query, filters, resultCount) {
    if (!query)
        return;
    await pool_1.default.query(`INSERT INTO seo_search_logs (tenant_id, query, filters, result_count)
     VALUES ($1, $2, $3::jsonb, $4)`, [tenantId, query, JSON.stringify(filters), resultCount]);
}
function rankTeacher(row, query) {
    const name = String(row.display_name ?? '').toLowerCase();
    const q = query.toLowerCase();
    let score = Number(row.fts_rank ?? 0) * 10;
    if (q && name === q)
        score += 100;
    else if (q && name.startsWith(q))
        score += 60;
    else if (q && name.includes(q))
        score += 30;
    score += Math.min(Number(row.students_count ?? 0) / 10, 20);
    score += Math.min(Number(row.courses_count ?? 0), 10);
    if (row.rating_average != null)
        score += Number(row.rating_average) * 2;
    return score;
}
function rankCourse(row, query) {
    const title = String(row.title ?? '').toLowerCase();
    const q = query.toLowerCase();
    let score = Number(row.fts_rank ?? 0) * 10;
    if (q && title === q)
        score += 100;
    else if (q && title.startsWith(q))
        score += 60;
    else if (q && title.includes(q))
        score += 30;
    score += Math.min(Number(row.students_count ?? 0) / 5, 25);
    score += Math.min(Number(row.view_count ?? 0) / 20, 15);
    if (row.rating_average != null)
        score += Number(row.rating_average) * 3;
    return score;
}
class SeoSearchService {
    static async search(filters) {
        const query = normalizeQuery(filters.q ?? filters.keywords);
        const key = cacheKey('search', { ...filters, q: query });
        const cached = (0, cache_1.seoCacheGet)(key);
        if (cached)
            return cached;
        const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
        const offset = Math.max(filters.offset ?? 0, 0);
        const teachers = await this.searchTeachers(query, filters, limit, offset);
        const courses = await this.searchCourses(query, filters, limit, offset);
        const items = [...teachers, ...courses]
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        const result = { items, total: items.length };
        (0, cache_1.seoCacheSet)(key, result, cache_1.SEO_CACHE_TTL.search);
        await logSearch(filters.tenant_id ?? null, query, filters, items.length);
        return result;
    }
    static async searchTeachers(query, filters, limit, offset) {
        const params = [];
        let i = 1;
        const where = ['t.is_active = TRUE', "t.subdomain <> 'default'"];
        if (filters.tenant_id) {
            where.push(`t.id = $${i++}`);
            params.push(filters.tenant_id);
        }
        if (filters.specialty) {
            where.push(`t.specialty ILIKE $${i++}`);
            params.push(`%${filters.specialty}%`);
        }
        if (filters.stage) {
            where.push(`EXISTS (
        SELECT 1 FROM teacher_grades tg
        JOIN grades g ON g.id = tg.grade_id
        JOIN users u ON u.id = tg.teacher_id
        WHERE u.tenant_id = t.id AND g.stage ILIKE $${i}
      )`);
            params.push(`%${filters.stage}%`);
            i++;
        }
        let rankExpr = '0::float';
        if (query) {
            params.push(query);
            where.push(`(
        t.seo_search_vector @@ plainto_tsquery('simple', $${i})
        OR t.display_name ILIKE $${i + 1}
        OR t.specialty ILIKE $${i + 1}
        OR t.bio ILIKE $${i + 1}
      )`);
            rankExpr = `ts_rank(t.seo_search_vector, plainto_tsquery('simple', $${i}))`;
            params.push(`%${query}%`);
            i += 2;
        }
        params.push(limit, offset);
        const res = await pool_1.default.query(`SELECT
         t.id,
         t.subdomain,
         t.display_name,
         t.specialty,
         t.avatar_url,
         t.updated_at,
         u.subject,
         ${rankExpr} AS fts_rank,
         (SELECT COUNT(DISTINCT e.user_id)
          FROM enrollments e
          JOIN courses c ON c.id = e.course_id
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS students_count,
         (SELECT COUNT(*) FROM courses c
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS courses_count,
         (SELECT AVG(cr.rating)::numeric(4,2)
          FROM course_ratings cr
          JOIN courses c ON c.id = cr.course_id
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS rating_average
       FROM tenants t
       LEFT JOIN users u ON u.id = t.owner_user_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${rankExpr} DESC, students_count DESC, t.updated_at DESC
       LIMIT $${i++} OFFSET $${i}`, params);
        return res.rows.map((row) => ({
            type: 'teacher',
            id: Number(row.id),
            title: String(row.display_name),
            subtitle: row.specialty ?? row.subject ?? null,
            slug: String(row.subdomain),
            subdomain: String(row.subdomain),
            avatar: row.avatar_url,
            specialty: row.specialty,
            subject: row.subject,
            students_count: Number(row.students_count ?? 0),
            courses_count: Number(row.courses_count ?? 0),
            rating_average: row.rating_average != null ? Number(row.rating_average) : null,
            view_count: 0,
            public_url: (0, appUrls_1.buildTenantPublicUrl)(String(row.subdomain)),
            score: rankTeacher(row, query),
            updated_at: row.updated_at ? String(row.updated_at) : null,
        }));
    }
    static async searchCourses(query, filters, limit, offset) {
        const params = [];
        let i = 1;
        const where = [
            '(c.is_visible IS NULL OR c.is_visible = TRUE)',
            'c.slug IS NOT NULL',
            "tn.subdomain <> 'default'",
            'tn.is_active = TRUE',
        ];
        if (filters.tenant_id) {
            where.push(`tn.id = $${i++}`);
            params.push(filters.tenant_id);
        }
        if (filters.subject) {
            where.push(`u.subject ILIKE $${i++}`);
            params.push(`%${filters.subject}%`);
        }
        if (filters.grade) {
            where.push(`g.name ILIKE $${i++}`);
            params.push(`%${filters.grade}%`);
        }
        if (filters.stage) {
            where.push(`g.stage ILIKE $${i++}`);
            params.push(`%${filters.stage}%`);
        }
        let rankExpr = '0::float';
        if (query) {
            params.push(query);
            where.push(`(
        c.seo_search_vector @@ plainto_tsquery('simple', $${i})
        OR c.title ILIKE $${i + 1}
        OR c.description ILIKE $${i + 1}
        OR c.slug ILIKE $${i + 1}
      )`);
            rankExpr = `ts_rank(c.seo_search_vector, plainto_tsquery('simple', $${i}))`;
            params.push(`%${query}%`);
            i += 2;
        }
        params.push(limit, offset);
        const res = await pool_1.default.query(`SELECT
         c.id,
         c.title,
         c.slug,
         c.avatar,
         c.updated_at,
         c.created_at,
         tn.subdomain,
         tn.display_name AS tenant_name,
         u.subject,
         g.name AS grade_name,
         g.stage,
         ${rankExpr} AS fts_rank,
         COALESCE(css.view_count, 0) AS view_count,
         (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
         (SELECT AVG(rating)::numeric(4,2) FROM course_ratings WHERE course_id = c.id) AS rating_average
       FROM courses c
       JOIN users u ON u.id = c.teacher_id
       JOIN tenants tn ON tn.id = u.tenant_id
       LEFT JOIN grades g ON g.id = c.grade_id
       LEFT JOIN course_seo_stats css ON css.course_id = c.id
       WHERE ${where.join(' AND ')}
       ORDER BY ${rankExpr} DESC, students_count DESC, view_count DESC, c.updated_at DESC NULLS LAST
       LIMIT $${i++} OFFSET $${i}`, params);
        return res.rows.map((row) => ({
            type: 'course',
            id: Number(row.id),
            title: String(row.title),
            subtitle: `${row.tenant_name}${row.grade_name ? ` — ${row.grade_name}` : ''}`,
            slug: String(row.slug),
            subdomain: String(row.subdomain),
            avatar: row.avatar,
            subject: row.subject,
            grade: row.grade_name,
            stage: row.stage,
            students_count: Number(row.students_count ?? 0),
            rating_average: row.rating_average != null ? Number(row.rating_average) : null,
            view_count: Number(row.view_count ?? 0),
            public_url: (0, urls_1.tenantCourseUrl)(String(row.subdomain), String(row.slug)),
            score: rankCourse(row, query),
            updated_at: row.updated_at ? String(row.updated_at) : String(row.created_at),
        }));
    }
    static async suggestions(q, tenantId) {
        const query = normalizeQuery(q);
        if (query.length < 2)
            return [];
        const key = cacheKey('suggestions', { q: query, tenant_id: tenantId });
        const cached = (0, cache_1.seoCacheGet)(key);
        if (cached)
            return cached;
        const params = [`%${query}%`, query];
        let tenantFilter = '';
        if (tenantId) {
            tenantFilter = 'AND t.id = $3';
            params.push(tenantId);
        }
        const res = await pool_1.default.query(`(SELECT display_name AS label FROM tenants t
        WHERE t.is_active = TRUE AND t.subdomain <> 'default'
          AND (display_name ILIKE $1 OR specialty ILIKE $1) ${tenantFilter}
        LIMIT 5)
       UNION ALL
       (SELECT c.title AS label FROM courses c
        JOIN users u ON u.id = c.teacher_id
        JOIN tenants t ON t.id = u.tenant_id
        WHERE (c.is_visible IS NULL OR c.is_visible = TRUE)
          AND t.is_active = TRUE
          AND (c.title ILIKE $1 OR c.slug ILIKE $1)
          ${tenantId ? 'AND t.id = $3' : ''}
        LIMIT 5)
       UNION ALL
       (SELECT label FROM (
          SELECT query AS label
          FROM seo_search_logs
          WHERE query ILIKE $1
          GROUP BY query
          ORDER BY COUNT(*) DESC
          LIMIT 5
        ) recent)`, params);
        const suggestions = [...new Set(res.rows.map((r) => r.label).filter(Boolean))].slice(0, 10);
        (0, cache_1.seoCacheSet)(key, suggestions, cache_1.SEO_CACHE_TTL.suggestions);
        return suggestions;
    }
    static async trending(tenantId, days = 7) {
        const key = `trending:${tenantId ?? 'all'}:${days}`;
        const cached = (0, cache_1.seoCacheGet)(key);
        if (cached)
            return cached;
        const params = [days];
        let tenantFilter = '';
        if (tenantId) {
            tenantFilter = 'AND tenant_id = $2';
            params.push(tenantId);
        }
        const res = await pool_1.default.query(`SELECT query, COUNT(*) AS hits
       FROM seo_search_logs
       WHERE created_at >= NOW() - ($1::int || ' days')::interval
         AND length(trim(query)) >= 2
         ${tenantFilter}
       GROUP BY query
       ORDER BY hits DESC, query ASC
       LIMIT 10`, params);
        const trending = res.rows.map((r) => r.query);
        (0, cache_1.seoCacheSet)(key, trending, cache_1.SEO_CACHE_TTL.trending);
        return trending;
    }
    static async popularTeachers(limit = 10) {
        const key = cacheKey('popular-teachers', { limit });
        const cached = (0, cache_1.seoCacheGet)(key);
        if (cached)
            return cached;
        const res = await pool_1.default.query(`SELECT
         t.id,
         t.subdomain,
         t.display_name,
         t.specialty,
         t.avatar_url,
         t.updated_at,
         u.subject,
         (SELECT COUNT(DISTINCT e.user_id)
          FROM enrollments e
          JOIN courses c ON c.id = e.course_id
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS students_count,
         (SELECT COUNT(*) FROM courses c
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS courses_count,
         (SELECT AVG(cr.rating)::numeric(4,2)
          FROM course_ratings cr
          JOIN courses c ON c.id = cr.course_id
          JOIN users ut ON ut.id = c.teacher_id
          WHERE ut.tenant_id = t.id) AS rating_average
       FROM tenants t
       LEFT JOIN users u ON u.id = t.owner_user_id
       WHERE t.is_active = TRUE AND t.subdomain <> 'default'
       ORDER BY students_count DESC, courses_count DESC, t.updated_at DESC
       LIMIT $1`, [Math.min(limit, 50)]);
        const items = res.rows.map((row) => ({
            type: 'teacher',
            id: Number(row.id),
            title: String(row.display_name),
            subtitle: row.specialty ?? row.subject ?? null,
            slug: String(row.subdomain),
            subdomain: String(row.subdomain),
            avatar: row.avatar_url,
            specialty: row.specialty,
            subject: row.subject,
            students_count: Number(row.students_count ?? 0),
            courses_count: Number(row.courses_count ?? 0),
            rating_average: row.rating_average != null ? Number(row.rating_average) : null,
            view_count: 0,
            public_url: (0, appUrls_1.buildTenantPublicUrl)(String(row.subdomain)),
            score: Number(row.students_count ?? 0),
            updated_at: row.updated_at ? String(row.updated_at) : null,
        }));
        (0, cache_1.seoCacheSet)(key, items, cache_1.SEO_CACHE_TTL.popular);
        return items;
    }
    static async popularCourses(limit = 10, tenantId) {
        const key = cacheKey('popular-courses', { limit, tenant_id: tenantId });
        const cached = (0, cache_1.seoCacheGet)(key);
        if (cached)
            return cached;
        const params = [Math.min(limit, 50)];
        let tenantFilter = '';
        if (tenantId) {
            tenantFilter = 'AND tn.id = $2';
            params.push(tenantId);
        }
        const res = await pool_1.default.query(`SELECT
         c.id,
         c.title,
         c.slug,
         c.avatar,
         c.updated_at,
         tn.subdomain,
         tn.display_name AS tenant_name,
         g.name AS grade_name,
         COALESCE(css.view_count, 0) AS view_count,
         (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e WHERE e.course_id = c.id) AS students_count,
         (SELECT AVG(rating)::numeric(4,2) FROM course_ratings WHERE course_id = c.id) AS rating_average
       FROM courses c
       JOIN users u ON u.id = c.teacher_id
       JOIN tenants tn ON tn.id = u.tenant_id
       LEFT JOIN grades g ON g.id = c.grade_id
       LEFT JOIN course_seo_stats css ON css.course_id = c.id
       WHERE (c.is_visible IS NULL OR c.is_visible = TRUE)
         AND c.slug IS NOT NULL
         AND tn.is_active = TRUE
         ${tenantFilter}
       ORDER BY students_count DESC, view_count DESC, c.updated_at DESC NULLS LAST
       LIMIT $1`, params);
        const items = res.rows.map((row) => ({
            type: 'course',
            id: Number(row.id),
            title: String(row.title),
            subtitle: `${row.tenant_name}${row.grade_name ? ` — ${row.grade_name}` : ''}`,
            slug: String(row.slug),
            subdomain: String(row.subdomain),
            avatar: row.avatar,
            grade: row.grade_name,
            students_count: Number(row.students_count ?? 0),
            rating_average: row.rating_average != null ? Number(row.rating_average) : null,
            view_count: Number(row.view_count ?? 0),
            public_url: (0, urls_1.tenantCourseUrl)(String(row.subdomain), String(row.slug)),
            score: Number(row.students_count ?? 0) + Number(row.view_count ?? 0) / 10,
            updated_at: row.updated_at ? String(row.updated_at) : null,
        }));
        (0, cache_1.seoCacheSet)(key, items, cache_1.SEO_CACHE_TTL.popular);
        return items;
    }
}
exports.SeoSearchService = SeoSearchService;
