"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantContextMiddleware = void 0;
exports.clientFacingHost = clientFacingHost;
exports.resolveSubdomainFromHost = resolveSubdomainFromHost;
exports.requireDefaultTenantMiddleware = requireDefaultTenantMiddleware;
const jwt = __importStar(require("jsonwebtoken"));
const pool_1 = __importDefault(require("../db/pool"));
const utils_1 = require("../utils");
const RESERVED = new Set(['www', 'api', 'app', 'admin', 'default', 'mail', 'ftp', 'cdn']);
function hostWithoutPort(host) {
    if (!host)
        return '';
    return host.split(':')[0].trim().toLowerCase();
}
/** Host as seen by the browser (supports reverse proxies that set X-Forwarded-Host). */
function clientFacingHost(req) {
    const xf = (req.get('x-forwarded-host') || '').split(',')[0].trim();
    if (xf)
        return xf;
    return req.get('host') || req.hostname || '';
}
/**
 * Resolve tenant slug from Host + optional X-Tenant-Subdomain (for API host or localhost).
 */
function resolveSubdomainFromHost(host, rootDomain) {
    const hostname = hostWithoutPort(host);
    if (!hostname)
        return 'default';
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
        return '';
    }
    // Dev: teacher.<anything>.localhost → tenant slug "teacher" (not bare localhost)
    if (hostname.endsWith('.localhost')) {
        const sub = hostname.slice(0, -'.localhost'.length);
        if (!sub || RESERVED.has(sub))
            return '';
        return sub.toLowerCase();
    }
    const root = rootDomain.trim().toLowerCase();
    if (!root)
        return 'default';
    if (hostname === root || hostname === `www.${root}`)
        return 'default';
    if (!hostname.endsWith(`.${root}`)) {
        return 'default';
    }
    const sub = hostname.slice(0, -(root.length + 1));
    if (!sub || RESERVED.has(sub))
        return 'default';
    return sub.toLowerCase();
}
function isApiLoginPost(req) {
    if (req.method !== 'POST')
        return false;
    const path = (req.originalUrl || '').split('?')[0];
    return path === '/api/login' || path.endsWith('/api/login');
}
function isStudentRegisterPost(req) {
    if (req.method !== 'POST')
        return false;
    const path = (req.originalUrl || '').split('?')[0];
    return (path === '/api/user/register' ||
        path.endsWith('/api/user/register') ||
        path === '/api/users/register' ||
        path.endsWith('/api/users/register'));
}
/**
 * When the resolved tenant is `default` (localhost without header, api.* host, root domain),
 * allow POST /api/login JSON body to specify which teacher platform to authenticate against.
 */
function loginBodyTenantSlug(req) {
    if (!isApiLoginPost(req))
        return null;
    const body = req.body;
    if (!body || typeof body !== 'object')
        return null;
    const raw = body.subdomain ?? body.tenant_subdomain;
    if (raw == null || typeof raw !== 'string')
        return null;
    const s = raw.trim().toLowerCase();
    if (!s || RESERVED.has(s))
        return null;
    return s;
}
function registerBodyTenantSlug(req) {
    if (!isStudentRegisterPost(req))
        return null;
    const body = req.body;
    if (!body || typeof body !== 'object')
        return null;
    const raw = body.subdomain ?? body.tenant_subdomain ?? body.tenantSubdomain ?? body.subDomain;
    if (raw == null || typeof raw !== 'string')
        return null;
    const s = raw.trim().toLowerCase();
    if (!s || RESERVED.has(s))
        return null;
    return s;
}
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]']);
function hostIsLoopbackOrBareLocal(host) {
    const h = hostWithoutPort(host);
    return LOOPBACK_HOSTS.has(h);
}
/**
 * Next (and similar) proxies often call the API with Host 127.0.0.1 while the browser sends
 * Origin / Referer with the real tenant host (e.g. omar-mohamed.localhost:3000).
 */
function tenantSlugFromBrowserOriginOrReferer(req, rootDomain) {
    const candidates = [req.get('referer'), req.get('origin')].filter(Boolean);
    for (const raw of candidates) {
        try {
            const hostname = new URL(raw).hostname.toLowerCase();
            if (hostname.endsWith('.localhost')) {
                const sub = hostname.slice(0, -'.localhost'.length);
                if (sub && !RESERVED.has(sub))
                    return sub.toLowerCase();
            }
            const root = rootDomain.trim().toLowerCase();
            if (root && hostname.endsWith(`.${root}`)) {
                const sub = hostname.slice(0, -(root.length + 1));
                if (sub && !RESERVED.has(sub))
                    return sub.toLowerCase();
            }
        }
        catch {
            /* malformed URL */
        }
    }
    return null;
}
/**
 * Fallback for localhost/default host requests:
 * if Authorization token contains tid, resolve tenant by tid automatically.
 */
async function tokenTidTenantSlug(req) {
    const auth = req.get('authorization') || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token)
        return null;
    try {
        const decoded = jwt.verify(token, utils_1.config.SECRET_KEY);
        const tid = decoded?.tid;
        if (tid !== undefined && tid !== null) {
            const tenantId = Number(tid);
            if (!Number.isInteger(tenantId) || tenantId <= 0)
                return null;
            const r = await pool_1.default.query(`SELECT subdomain FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
            return r.rows[0]?.subdomain ?? null;
        }
        // Backward compatibility for old tokens without tid:
        // derive tenant from user.id then map to tenant subdomain.
        const userId = Number(decoded?.id);
        if (!Number.isInteger(userId) || userId <= 0)
            return null;
        const u = await pool_1.default.query(`SELECT tenant_id FROM users WHERE id = $1 LIMIT 1`, [userId]);
        const tenantId = Number(u.rows[0]?.tenant_id);
        if (!Number.isInteger(tenantId) || tenantId <= 0)
            return null;
        const t = await pool_1.default.query(`SELECT subdomain FROM tenants WHERE id = $1 LIMIT 1`, [tenantId]);
        return t.rows[0]?.subdomain ?? null;
    }
    catch {
        return null;
    }
}
const tenantContextMiddleware = async (req, res, next) => {
    try {
        const rawHost = clientFacingHost(req);
        const root = utils_1.config.TENANT_ROOT_DOMAIN || '';
        let slug = resolveSubdomainFromHost(rawHost, root);
        if (slug === '') {
            const headerSlug = (req.get('x-tenant-subdomain') || '').trim().toLowerCase();
            slug = headerSlug && !RESERVED.has(headerSlug) ? headerSlug : 'default';
        }
        // Next.js rewrites: browser is tenant.localhost but API sees Host 127.0.0.1 — use Origin / Referer.
        if (hostIsLoopbackOrBareLocal(rawHost)) {
            const fromBrowser = tenantSlugFromBrowserOriginOrReferer(req, root);
            if (fromBrowser && !RESERVED.has(fromBrowser))
                slug = fromBrowser;
        }
        if (slug === 'default') {
            const fromLogin = loginBodyTenantSlug(req);
            if (fromLogin)
                slug = fromLogin;
            else {
                const fromRegister = registerBodyTenantSlug(req);
                if (fromRegister)
                    slug = fromRegister;
            }
            if (slug === 'default') {
                const fromTokenTid = await tokenTidTenantSlug(req);
                if (fromTokenTid && !RESERVED.has(fromTokenTid))
                    slug = fromTokenTid;
            }
        }
        const result = await pool_1.default.query(`SELECT id, subdomain, display_name, specialty, bio, avatar_url, is_active,
              seo_title, seo_meta_description, favicon_url, og_image_url, owner_user_id
       FROM tenants WHERE subdomain = $1 LIMIT 1`, [slug]);
        if (!result.rowCount) {
            return res.status(404).json({
                success: false,
                code: 'TENANT_NOT_FOUND',
                message: 'المنصة غير موجودة لهذا العنوان',
            });
        }
        const tenant = result.rows[0];
        if (!tenant.is_active) {
            return res.status(403).json({
                success: false,
                code: 'TENANT_INACTIVE',
                message: 'هذه المنصة غير مفعلة حالياً',
            });
        }
        req.tenant = tenant;
        next();
    }
    catch (e) {
        utils_1.logger.error({ err: e }, 'tenantContextMiddleware');
        return res.status(500).json({ success: false, message: 'Tenant resolution failed' });
    }
};
exports.tenantContextMiddleware = tenantContextMiddleware;
function requireDefaultTenantMiddleware() {
    return (req, res, next) => {
        const tenant = req.tenant;
        if (!tenant || tenant.subdomain !== 'default') {
            return res.status(403).json({
                success: false,
                code: 'SUPER_ADMIN_HOST_REQUIRED',
                message: 'إدارة المنصات متاحة فقط من النطاق الافتراضي للمنصة',
            });
        }
        next();
    };
}
