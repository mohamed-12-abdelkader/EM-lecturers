import fs from 'node:fs/promises';
import path from 'node:path';
import { RequestHandler } from 'express';
import * as jwt from 'jsonwebtoken';
import pool from '../../../db/pool';
import {
  clientFacingHost,
  resolveSubdomainFromHost,
} from '../../../middleware/tenantContext';
import { config, logger } from '../../../utils';
import { myFilesConfig, resolveLocalFilePath } from '../config';
import { mimeTypeFromExtension } from '../utils/googleDriveLink';

const UUID_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

const LEGACY_FILENAME = /^[0-9a-f-]+\.[a-z0-9]+$/i;

function hostIsLoopbackOrBareLocal(host: string): boolean {
  const h = host.split(':')[0].trim().toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '0.0.0.0' || h === '[::1]';
}

function tenantSlugFromBrowserOriginOrReferer(req: Parameters<RequestHandler>[0], rootDomain: string): string | null {
  const candidates = [req.get('referer'), req.get('origin')].filter(Boolean) as string[];
  for (const raw of candidates) {
    try {
      const hostname = new URL(raw).hostname.toLowerCase();
      if (hostname.endsWith('.localhost')) {
        const sub = hostname.slice(0, -'.localhost'.length);
        if (sub) return sub.toLowerCase();
      }
      const root = rootDomain.trim().toLowerCase();
      if (root && hostname.endsWith(`.${root}`)) {
        const sub = hostname.slice(0, -(root.length + 1));
        if (sub) return sub.toLowerCase();
      }
    } catch {
      /* malformed URL */
    }
  }
  return null;
}

async function tokenTidTenantSlug(req: Parameters<RequestHandler>[0]): Promise<string | null> {
  const auth = req.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken =
    (typeof req.query.access_token === 'string' && req.query.access_token) ||
    (typeof req.query.token === 'string' && req.query.token);
  const jwtToken = token || queryToken || '';
  if (!jwtToken) return null;

  try {
    const decoded = jwt.verify(jwtToken, config.SECRET_KEY) as { tid?: unknown; id?: unknown };
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

async function resolveRequestTenantId(req: Parameters<RequestHandler>[0]): Promise<number | null> {
  const rawHost = clientFacingHost(req);
  const root = config.TENANT_ROOT_DOMAIN || '';
  let slug = resolveSubdomainFromHost(rawHost, root);

  if (slug === '') {
    const headerSlug = (req.get('x-tenant-subdomain') || '').trim().toLowerCase();
    slug = headerSlug || 'default';
  }

  if (hostIsLoopbackOrBareLocal(rawHost)) {
    const fromBrowser = tenantSlugFromBrowserOriginOrReferer(req, root);
    if (fromBrowser) slug = fromBrowser;
  }

  if (slug === 'default') {
    const fromToken = await tokenTidTenantSlug(req);
    if (fromToken) slug = fromToken;
  }

  const result = await pool.query<{ id: number }>(
    `SELECT id FROM tenants WHERE subdomain = $1 AND is_active = true LIMIT 1`,
    [slug],
  );
  return result.rows[0]?.id ?? null;
}

function isValidFilename(filename: string): boolean {
  if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }
  const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
  if (!myFilesConfig.allowedExtensions.has(ext)) return false;
  return UUID_FILENAME.test(filename) || LEGACY_FILENAME.test(filename);
}

export const teacherLibraryStaticMiddleware: RequestHandler = async (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  try {
    const relativePath = req.path.replace(/^\/+/, '');
    const segments = relativePath.split('/').filter(Boolean);

    let tenantIdFromPath: number | null = null;
    let filename: string | null = null;

    if (segments.length === 2) {
      tenantIdFromPath = Number(segments[0]);
      filename = segments[1];
      if (!Number.isInteger(tenantIdFromPath) || tenantIdFromPath <= 0) {
        return res.status(404).end();
      }
    } else if (segments.length === 1) {
      filename = segments[0];
    } else {
      return res.status(404).end();
    }

    if (!filename || !isValidFilename(filename)) {
      return res.status(400).json({ success: false, message: 'Invalid file name' });
    }

    if (tenantIdFromPath != null) {
      const requestTenantId = await resolveRequestTenantId(req);
      if (!requestTenantId || requestTenantId !== tenantIdFromPath) {
        return res.status(403).json({ success: false, message: 'Forbidden: tenant mismatch' });
      }
    }

    const fileKey =
      tenantIdFromPath != null ? `${tenantIdFromPath}/${filename}` : filename;
    const filePath = resolveLocalFilePath(fileKey);

    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).end();
    }

    const ext = path.extname(filename).replace(/^\./, '').toLowerCase();
    const contentType = mimeTypeFromExtension(ext);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (req.method === 'HEAD') {
      const stat = await fs.stat(filePath);
      res.setHeader('Content-Length', String(stat.size));
      return res.status(200).end();
    }

    return res.sendFile(path.resolve(filePath));
  } catch (error) {
    logger.error({ err: error }, 'teacherLibraryStaticMiddleware');
    return res.status(500).end();
  }
};
