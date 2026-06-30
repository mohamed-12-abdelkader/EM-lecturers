"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEO_CACHE_TTL = void 0;
exports.seoCacheGet = seoCacheGet;
exports.seoCacheSet = seoCacheSet;
exports.seoCacheDelete = seoCacheDelete;
exports.seoCacheDeletePrefix = seoCacheDeletePrefix;
const store = new Map();
function seoCacheGet(key) {
    const entry = store.get(key);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
    }
    return entry.value;
}
function seoCacheSet(key, value, ttlMs) {
    store.set(key, { value, expiresAt: Date.now() + ttlMs });
}
function seoCacheDelete(key) {
    store.delete(key);
}
function seoCacheDeletePrefix(prefix) {
    for (const key of store.keys()) {
        if (key.startsWith(prefix))
            store.delete(key);
    }
}
exports.SEO_CACHE_TTL = {
    search: 5 * 60 * 1000,
    suggestions: 3 * 60 * 1000,
    trending: 10 * 60 * 1000,
    popular: 15 * 60 * 1000,
    sitemap: 60 * 60 * 1000,
    metadata: 10 * 60 * 1000,
    publicPage: 5 * 60 * 1000,
};
