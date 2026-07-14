"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLocalUrl = getLocalUrl;
exports.getNgrokUrl = getNgrokUrl;
exports.getProductionUrl = getProductionUrl;
exports.getBaseUrl = getBaseUrl;
exports.getApiUrl = getApiUrl;
exports.isAllowedSubdomain = isAllowedSubdomain;
exports.getSocketUrl = getSocketUrl;
exports.buildFileUrl = buildFileUrl;
exports.rewriteLoopbackUrl = rewriteLoopbackUrl;
exports.getAllowedCorsOrigins = getAllowedCorsOrigins;
exports.isCorsOriginAllowed = isCorsOriginAllowed;
exports.getCorsOriginDelegate = getCorsOriginDelegate;
exports.rewriteResponseUrls = rewriteResponseUrls;
exports.buildTenantPublicUrl = buildTenantPublicUrl;
exports.getServerInfo = getServerInfo;
const utils_1 = require("../utils");
const LOOPBACK_URL_PATTERN = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?/i;
function stripTrailingSlash(url) {
    return url.replace(/\/+$/, '');
}
function normalizePath(path) {
    if (!path)
        return '';
    return path.startsWith('/') ? path : `/${path}`;
}
/** http://localhost:PORT */
function getLocalUrl() {
    const fromEnv = utils_1.config.LOCAL_URL?.trim();
    if (fromEnv)
        return stripTrailingSlash(fromEnv);
    return `http://localhost:${utils_1.config.PORT}`;
}
/** https://xxxx.ngrok-free.app (if configured) */
function getNgrokUrl() {
    const url = utils_1.config.NGROK_URL?.trim();
    return url ? stripTrailingSlash(url) : null;
}
/** Production public URL */
function getProductionUrl() {
    const url = (utils_1.config.PRODUCTION_URL || utils_1.config.FRONTEND_HOST || '').trim();
    return url ? stripTrailingSlash(url) : stripTrailingSlash(utils_1.config.FRONTEND_HOST);
}
/**
 * Public base URL returned to clients (no trailing slash).
 * development + USE_NGROK → NGROK_URL / BASE_URL
 * production → PRODUCTION_URL / BASE_URL / FRONTEND_HOST
 */
function getBaseUrl() {
    if (utils_1.config.NODE_ENV === 'production') {
        const explicit = utils_1.config.BASE_URL?.trim();
        if (explicit)
            return stripTrailingSlash(explicit);
        return getProductionUrl();
    }
    if (utils_1.config.USE_NGROK) {
        const ngrok = getNgrokUrl();
        if (ngrok)
            return ngrok;
        const base = utils_1.config.BASE_URL?.trim();
        if (base)
            return stripTrailingSlash(base);
    }
    const base = utils_1.config.BASE_URL?.trim();
    if (base)
        return stripTrailingSlash(base);
    return getLocalUrl();
}
/** API root, e.g. https://xxxx.ngrok-free.app/api */
function getApiUrl() {
    const explicit = utils_1.config.API_URL?.trim();
    if (explicit)
        return stripTrailingSlash(explicit);
    return `${getBaseUrl()}/api`;
}
function isAllowedSubdomain(origin) {
    const root = utils_1.config.TENANT_ROOT_DOMAIN?.trim().toLowerCase();
    if (!root)
        return false;
    try {
        const { hostname } = new URL(origin);
        return (hostname === root ||
            hostname.endsWith(`.${root}`));
    }
    catch {
        return false;
    }
}
/** wss://xxxx.ngrok-free.app for Socket.IO */
function getSocketUrl() {
    return getBaseUrl().replace(/^https:/i, 'wss:').replace(/^http:/i, 'ws:');
}
/** Build absolute HTTPS URL for local uploads and relative paths */
function buildFileUrl(filePath) {
    if (filePath == null || filePath === '')
        return null;
    const trimmed = String(filePath).trim();
    if (!trimmed)
        return null;
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
        return rewriteLoopbackUrl(trimmed);
    }
    return `${getBaseUrl()}${normalizePath(trimmed)}`;
}
/** Replace localhost/127.0.0.1 absolute URLs with the current BASE_URL */
function rewriteLoopbackUrl(url) {
    if (!LOOPBACK_URL_PATTERN.test(url))
        return url;
    try {
        const parsed = new URL(url);
        const base = new URL(getBaseUrl());
        parsed.protocol = base.protocol;
        parsed.host = base.host;
        return parsed.toString();
    }
    catch {
        return url.replace(LOOPBACK_URL_PATTERN, getBaseUrl());
    }
}
function isExpoOrigin(origin) {
    return (origin.startsWith('exp://') ||
        origin.startsWith('exps://') ||
        origin.includes('expo.dev') ||
        origin.includes('expo.io'));
}
function isNgrokOrigin(origin) {
    return /\.ngrok(-free)?\.(app|io)$/i.test(origin) || origin.includes('ngrok');
}
/** CORS allow-list including Expo Go and ngrok during development */
function getAllowedCorsOrigins() {
    const configured = utils_1.config.CORS_ORIGIN.split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    const extras = [];
    const ngrok = getNgrokUrl();
    if (ngrok)
        extras.push(ngrok);
    const local = getLocalUrl();
    extras.push(local);
    if (utils_1.config.FRONTEND_HOST)
        extras.push(stripTrailingSlash(utils_1.config.FRONTEND_HOST));
    return [...new Set([...configured, ...extras])];
}
function isCorsOriginAllowed(origin) {
    const allowed = getAllowedCorsOrigins();
    if (allowed.includes("*"))
        return true;
    if (!origin) {
        return utils_1.config.NGROK_RELAX_CORS && utils_1.config.NODE_ENV === "development";
    }
    // Exact origins
    if (allowed.includes(origin)) {
        return true;
    }
    // Any *.next-edu.online
    if (isAllowedSubdomain(origin)) {
        return true;
    }
    if (utils_1.config.NODE_ENV === "development" && utils_1.config.NGROK_RELAX_CORS) {
        if (isExpoOrigin(origin) || isNgrokOrigin(origin)) {
            return true;
        }
    }
    return false;
}
function getCorsOriginDelegate() {
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
const URL_LIKE_KEYS = /(?:^|_)(url|uri|path|image|avatar|file|thumbnail|logo|cover|photo|media|attachment|href)$/i;
function shouldRewriteString(value) {
    if (value.startsWith('/uploads/'))
        return true;
    if (LOOPBACK_URL_PATTERN.test(value))
        return true;
    return false;
}
function rewriteValue(value) {
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
function rewriteResponseUrls(payload) {
    if (payload == null)
        return payload;
    if (typeof payload === 'string') {
        return (shouldRewriteString(payload) ? rewriteValue(payload) : payload);
    }
    if (Array.isArray(payload)) {
        return payload.map((item) => rewriteResponseUrls(item));
    }
    if (payload instanceof Date) {
        return payload.toISOString();
    }
    if (typeof payload === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(payload)) {
            if (typeof value === 'string' && (URL_LIKE_KEYS.test(key) || shouldRewriteString(value))) {
                result[key] = rewriteValue(value);
            }
            else {
                result[key] = rewriteResponseUrls(value);
            }
        }
        return result;
    }
    return payload;
}
/** Public URL for a teacher tenant landing (subdomain site). */
function buildTenantPublicUrl(subdomain) {
    const sub = subdomain.trim().toLowerCase();
    const root = utils_1.config.TENANT_ROOT_DOMAIN?.trim().toLowerCase();
    if (root) {
        const frontend = getProductionUrl();
        try {
            const base = new URL(frontend);
            return `${base.protocol}//${sub}.${root}`;
        }
        catch {
            return `https://${sub}.${root}`;
        }
    }
    if (utils_1.config.NODE_ENV === 'development') {
        const frontend = utils_1.config.FRONTEND_HOST?.trim() || 'http://localhost:3000';
        try {
            const base = new URL(frontend);
            const port = base.port ? `:${base.port}` : '';
            return `${base.protocol}//${sub}.localhost${port}`;
        }
        catch {
            return `http://${sub}.localhost:3000`;
        }
    }
    return `${getProductionUrl()}/${sub}`;
}
function getServerInfo() {
    return {
        app_env: utils_1.config.APP_ENV,
        node_env: utils_1.config.NODE_ENV,
        use_ngrok: utils_1.config.USE_NGROK,
        local_url: getLocalUrl(),
        ngrok_url: getNgrokUrl(),
        base_url: getBaseUrl(),
        api_url: getApiUrl(),
        socket_url: getSocketUrl(),
        production_url: getProductionUrl(),
        port: utils_1.config.PORT,
    };
}
