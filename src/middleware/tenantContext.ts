import { Request, RequestHandler } from 'express';
import * as jwt from 'jsonwebtoken';
import pool from '../db/pool';
import { config, logger } from '../utils';

export type ResolvedTenant = {
  id: number;
  subdomain: string;
  display_name: string;
  specialty: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  seo_title: string | null;
  seo_meta_description: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  owner_user_id: number | null;
};

const RESERVED = new Set(['www', 'api', 'app', 'admin', 'default', 'mail', 'ftp', 'cdn']);

function hostWithoutPort(host: string | undefined): string {
  if (!host) return '';
  return host.split(':')[0].trim().toLowerCase();
}

/** Host as seen by the browser (supports reverse proxies that set X-Forwarded-Host). */
export function clientFacingHost(req: Request): string {
  const xf = (req.get('x-forwarded-host') || '').split(',')[0].trim();
  if (xf) return xf;
  return req.get('host') || req.hostname || '';
}

/**
 * Resolve tenant slug from Host + optional X-Tenant-Subdomain (for API host or localhost).
 */
export function resolveSubdomainFromHost(host: string, rootDomain: string): string {
  const hostname = hostWithoutPort(host);
  if (!hostname) return 'default';

  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return '';
  }

  // Dev: teacher.<anything>.localhost → tenant slug "teacher" (not bare localhost)
  if (hostname.endsWith('.localhost')) {
    const sub = hostname.slice(0, -'.localhost'.length);
    if (!sub || RESERVED.has(sub)) return '';
    return sub.toLowerCase();
  }

  const root = rootDomain.trim().toLowerCase();
  if (!root) return 'default';

  if (hostname === root || hostname === `www.${root}`) return 'default';

  if (!hostname.endsWith(`.${root}`)) {
    return 'default';
  }

  const sub = hostname.slice(0, -(root.length + 1));
  if (!sub || RESERVED.has(sub)) return 'default';
  return sub.toLowerCase();
}

function isApiLoginPost(req: Request): boolean {
  if (req.method !== 'POST') return false;
  const path = (req.originalUrl || '').split('?')[0];
  return path === '/api/login' || path.endsWith('/api/login');
}

function isStudentRegisterPost(req: Request): boolean {
  if (req.method !== 'POST') return false;
  const path = (req.originalUrl || '').split('?')[0];
  return (
    path === '/api/user/register' ||
    path.endsWith('/api/user/register') ||
    path === '/api/users/register' ||
    path.endsWith('/api/users/register')
  );
}

/**
 * When the resolved tenant is `default` (localhost without header, api.* host, root domain),
 * allow POST /api/login JSON body to specify which teacher platform to authenticate against.
 */
function loginBodyTenantSlug(req: Request): string | null {
  if (!isApiLoginPost(req)) return null;
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return null;
  const raw = body.subdomain ?? body.tenant_subdomain;
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || RESERVED.has(s)) return null;
  return s;
}

function registerBodyTenantSlug(req: Request): string | null {
  if (!isStudentRegisterPost(req)) return null;
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== 'object') return null;
  const raw = body.subdomain ?? body.tenant_subdomain ?? body.tenantSubdomain ?? body.subDomain;
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.trim().toLowerCase();
  if (!s || RESERVED.has(s)) return null;
  return s;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '0.0.0.0', '[::1]']);

function hostIsLoopbackOrBareLocal(host: string): boolean {
  const h = hostWithoutPort(host);
  return LOOPBACK_HOSTS.has(h);
}

/**
 * Next (and similar) proxies often call the API with Host 127.0.0.1 while the browser sends
 * Origin / Referer with the real tenant host (e.g. omar-mohamed.localhost:3000).
 */
function tenantSlugFromBrowserOriginOrReferer(req: Request, rootDomain: string): string | null {
  const candidates = [req.get('referer'), req.get('origin')].filter(Boolean) as string[];
  for (const raw of candidates) {
    try {
      const hostname = new URL(raw).hostname.toLowerCase();
      if (hostname.endsWith('.localhost')) {
        const sub = hostname.slice(0, -'.localhost'.length);
        if (sub && !RESERVED.has(sub)) return sub.toLowerCase();
      }
      const root = rootDomain.trim().toLowerCase();
      if (root && hostname.endsWith(`.${root}`)) {
        const sub = hostname.slice(0, -(root.length + 1));
        if (sub && !RESERVED.has(sub)) return sub.toLowerCase();
      }
    } catch {
      /* malformed URL */
    }
  }
  return null;
}

/**
 * Fallback for localhost/default host requests:
 * if Authorization token contains tid, resolve tenant by tid automatically.
 */
async function tokenTidTenantSlug(req: Request): Promise<string | null> {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, config.SECRET_KEY) as { tid?: unknown; id?: unknown };
    const tid = decoded?.tid;
    if (tid !== undefined && tid !== null) {
      const tenantId = Number(tid);
      if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
      const r = await pool.query<{ subdomain: string }>(
        `SELECT subdomain FROM tenants WHERE id = $1 LIMIT 1`,
        [tenantId],
      );
      return r.rows[0]?.subdomain ?? null;
    }

    // Backward compatibility for old tokens without tid:
    // derive tenant from user.id then map to tenant subdomain.
    const userId = Number(decoded?.id);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    const u = await pool.query<{ tenant_id: number | null }>(
      `SELECT tenant_id FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const tenantId = Number(u.rows[0]?.tenant_id);
    if (!Number.isInteger(tenantId) || tenantId <= 0) return null;
    const t = await pool.query<{ subdomain: string }>(
      `SELECT subdomain FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    return t.rows[0]?.subdomain ?? null;
  } catch {
    return null;
  }
}

export const tenantContextMiddleware: RequestHandler = async (req, res, next) => {
  try {
    const rawHost = clientFacingHost(req);
    const root = config.TENANT_ROOT_DOMAIN || '';
    let slug = resolveSubdomainFromHost(rawHost, root);

    if (slug === '') {
      const headerSlug = (req.get('x-tenant-subdomain') || '').trim().toLowerCase();
      slug = headerSlug && !RESERVED.has(headerSlug) ? headerSlug : 'default';
    }

    // Next.js rewrites: browser is tenant.localhost but API sees Host 127.0.0.1 — use Origin / Referer.
    if (hostIsLoopbackOrBareLocal(rawHost)) {
      const fromBrowser = tenantSlugFromBrowserOriginOrReferer(req, root);
      if (fromBrowser && !RESERVED.has(fromBrowser)) slug = fromBrowser;
    }

    if (slug === 'default') {
      const fromLogin = loginBodyTenantSlug(req);
      if (fromLogin) slug = fromLogin;
      else {
        const fromRegister = registerBodyTenantSlug(req);
        if (fromRegister) slug = fromRegister;
      }
      if (slug === 'default') {
        const fromTokenTid = await tokenTidTenantSlug(req);
        if (fromTokenTid && !RESERVED.has(fromTokenTid)) slug = fromTokenTid;
      }
    }

    const result = await pool.query<ResolvedTenant>(
      `SELECT id, subdomain, display_name, specialty, bio, avatar_url, is_active,
              seo_title, seo_meta_description, favicon_url, og_image_url, owner_user_id
       FROM tenants WHERE subdomain = $1 LIMIT 1`,
      [slug],
    );

    if (!result.rowCount) {
      return res.status(404).json({
        success: false,
        code: 'TENANT_NOT_FOUND',
        message: 'المنصة غير موجودة لهذا العنوان',
      });
    }

    const tenant = result.rows[0];

    if (tenant.subdomain !== 'default' && tenant.owner_user_id) {
      const { TeacherPlatformSubscriptionsService } = await import(
        '../services/teacherPlatformSubscriptions.js'
      );
      await TeacherPlatformSubscriptionsService.syncSubscriptionLifecycle();
      const access = await TeacherPlatformSubscriptionsService.getPlatformAccessState(
        tenant.owner_user_id,
      );

      if (!access.allowed) {
        return res.status(403).json({
          success: false,
          code: 'PLATFORM_SUBSCRIPTION_SUSPENDED',
          message:
            'تم إيقاف هذه المنصة لعدم تجديد اشتراك المدرس. يرجى التواصل مع إدارة المنصة.',
        });
      }

      if (!tenant.is_active && access.phase === 'grace') {
        await pool.query(
          `UPDATE tenants SET is_active = true, updated_at = NOW() WHERE id = $1`,
          [tenant.id],
        );
        tenant.is_active = true;
      }
    }

    if (!tenant.is_active) {
      return res.status(403).json({
        success: false,
        code: 'TENANT_INACTIVE',
        message: 'هذه المنصة غير مفعلة حالياً',
      });
    }

    (req as Request).tenant = tenant;
    next();
  } catch (e) {
    logger.error({ err: e }, 'tenantContextMiddleware');
    return res.status(500).json({ success: false, message: 'Tenant resolution failed' });
  }
};

export function requireDefaultTenantMiddleware(): RequestHandler {
  return (req, res, next) => {
    const tenant = (req as Request).tenant;
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
