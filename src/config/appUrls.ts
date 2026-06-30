import type { CorsOptionsDelegate } from 'cors';
import type { Request } from 'express';
import { config } from '../utils';

const LOOPBACK_URL_PATTERN =
  /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i;

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  if (!path) return '';
  return path.startsWith('/') ? path : `/${path}`;
}

/** http://localhost:PORT */
export function getLocalUrl(): string {
  const fromEnv = config.LOCAL_URL?.trim();
  if (fromEnv) return stripTrailingSlash(fromEnv);
  return `http://localhost:${config.PORT}`;
}

/** https://xxxx.ngrok-free.app (if configured) */
export function getNgrokUrl(): string | null {
  const url = config.NGROK_URL?.trim();
  return url ? stripTrailingSlash(url) : null;
}

/** Production public URL */
export function getProductionUrl(): string {
  const url = (config.PRODUCTION_URL || config.FRONTEND_HOST || '').trim();
  return url ? stripTrailingSlash(url) : stripTrailingSlash(config.FRONTEND_HOST);
}

/**
 * Public base URL returned to clients (no trailing slash).
 * development + USE_NGROK → NGROK_URL / BASE_URL
 * production → PRODUCTION_URL / BASE_URL / FRONTEND_HOST
 */
export function getBaseUrl(): string {
  if (config.NODE_ENV === 'production') {
    const explicit = config.BASE_URL?.trim();
    if (explicit) return stripTrailingSlash(explicit);
    return getProductionUrl();
  }

  if (config.USE_NGROK) {
    const ngrok = getNgrokUrl();
    if (ngrok) return ngrok;
    const base = config.BASE_URL?.trim();
    if (base) return stripTrailingSlash(base);
  }

  const base = config.BASE_URL?.trim();
  if (base) return stripTrailingSlash(base);

  return getLocalUrl();
}

/** API root, e.g. https://xxxx.ngrok-free.app/api */
export function getApiUrl(): string {
  const explicit = config.API_URL?.trim();
  if (explicit) return stripTrailingSlash(explicit);
  return `${getBaseUrl()}/api`;
}

/** wss://xxxx.ngrok-free.app for Socket.IO */
export function getSocketUrl(): string {
  return getBaseUrl().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}

/** Build absolute HTTPS URL for local uploads and relative paths */
export function buildFileUrl(filePath: string | null | undefined): string | null {
  if (filePath == null || filePath === '') return null;

  const trimmed = String(filePath).trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
    return rewriteLoopbackUrl(trimmed);
  }

  return `${getBaseUrl()}${normalizePath(trimmed)}`;
}

/** Replace localhost/127.0.0.1 absolute URLs with the current BASE_URL */
export function rewriteLoopbackUrl(url: string): string {
  if (!LOOPBACK_URL_PATTERN.test(url)) return url;
  try {
    const parsed = new URL(url);
    const base = new URL(getBaseUrl());
    parsed.protocol = base.protocol;
    parsed.host = base.host;
    return parsed.toString();
  } catch {
    return url.replace(LOOPBACK_URL_PATTERN, getBaseUrl());
  }
}

function isExpoOrigin(origin: string): boolean {
  return (
    origin.startsWith('exp://') ||
    origin.startsWith('exps://') ||
    origin.includes('expo.dev') ||
    origin.includes('expo.io')
  );
}

function isNgrokOrigin(origin: string): boolean {
  return /\.ngrok(-free)?\.(app|io)$/i.test(origin) || origin.includes('ngrok');
}

/** CORS allow-list including Expo Go and ngrok during development */
export function getAllowedCorsOrigins(): string[] {
  const configured = config.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const extras: string[] = [];
  const ngrok = getNgrokUrl();
  if (ngrok) extras.push(ngrok);

  const local = getLocalUrl();
  extras.push(local);

  if (config.FRONTEND_HOST) extras.push(stripTrailingSlash(config.FRONTEND_HOST));

  return [...new Set([...configured, ...extras])];
}

export function isCorsOriginAllowed(origin: string | undefined): boolean {
  const allowed = getAllowedCorsOrigins();
  if (allowed.includes('*')) return true;
  if (!origin) return config.NGROK_RELAX_CORS && config.NODE_ENV === 'development';

  if (allowed.includes(origin)) return true;
  if (config.NODE_ENV === 'development' && config.NGROK_RELAX_CORS) {
    if (isExpoOrigin(origin) || isNgrokOrigin(origin)) return true;
  }
  return false;
}

export function getCorsOriginDelegate(): CorsOptionsDelegate<Request> {
  return (req, callback) => {
    const origin = req.header('Origin') || '';
    const allowed = isCorsOriginAllowed(origin || undefined);
    callback(null, {
      origin: allowed ? origin || true : false,
      credentials: true,
    });
  };
}

/** Keys commonly holding file/media URLs in API responses */
const URL_LIKE_KEYS =
  /(?:^|_)(url|uri|path|image|avatar|file|thumbnail|logo|cover|photo|media|attachment|href)$/i;

function shouldRewriteString(value: string): boolean {
  if (value.startsWith('/uploads/')) return true;
  if (LOOPBACK_URL_PATTERN.test(value)) return true;
  return false;
}

function rewriteValue(value: string): string {
  if (value.startsWith('/uploads/') || value.startsWith('/api/')) {
    const built = buildFileUrl(value);
    return built ?? value;
  }
  if (LOOPBACK_URL_PATTERN.test(value)) {
    return rewriteLoopbackUrl(value);
  }
  return value;
}

/** Deep-rewrite relative upload paths and loopback URLs in JSON payloads */
export function rewriteResponseUrls<T>(payload: T): T {
  if (payload == null) return payload;

  if (typeof payload === 'string') {
    return (shouldRewriteString(payload) ? rewriteValue(payload) : payload) as T;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => rewriteResponseUrls(item)) as T;
  }

  if (payload instanceof Date) {
    return payload.toISOString() as T;
  }

  if (typeof payload === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string' && (URL_LIKE_KEYS.test(key) || shouldRewriteString(value))) {
        result[key] = rewriteValue(value);
      } else {
        result[key] = rewriteResponseUrls(value);
      }
    }
    return result as T;
  }

  return payload;
}

/** Public URL for a teacher tenant landing (subdomain site). */
export function buildTenantPublicUrl(subdomain: string): string {
  const sub = subdomain.trim().toLowerCase();
  const root = config.TENANT_ROOT_DOMAIN?.trim().toLowerCase();

  if (root) {
    const frontend = getProductionUrl();
    try {
      const base = new URL(frontend);
      return `${base.protocol}//${sub}.${root}`;
    } catch {
      return `https://${sub}.${root}`;
    }
  }

  if (config.NODE_ENV === 'development') {
    const frontend = config.FRONTEND_HOST?.trim() || 'http://localhost:3000';
    try {
      const base = new URL(frontend);
      const port = base.port ? `:${base.port}` : '';
      return `${base.protocol}//${sub}.localhost${port}`;
    } catch {
      return `http://${sub}.localhost:3000`;
    }
  }

  return `${getProductionUrl()}/${sub}`;
}

export function getServerInfo() {
  return {
    app_env: config.APP_ENV,
    node_env: config.NODE_ENV,
    use_ngrok: config.USE_NGROK,
    local_url: getLocalUrl(),
    ngrok_url: getNgrokUrl(),
    base_url: getBaseUrl(),
    api_url: getApiUrl(),
    socket_url: getSocketUrl(),
    production_url: getProductionUrl(),
    port: config.PORT,
  };
}
