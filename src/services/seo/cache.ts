type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function seoCacheGet<T>(key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value as T;
}

export function seoCacheSet<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function seoCacheDelete(key: string): void {
  store.delete(key);
}

export function seoCacheDeletePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export const SEO_CACHE_TTL = {
  search: 5 * 60 * 1000,
  suggestions: 3 * 60 * 1000,
  trending: 10 * 60 * 1000,
  popular: 15 * 60 * 1000,
  sitemap: 60 * 60 * 1000,
  metadata: 10 * 60 * 1000,
  publicPage: 5 * 60 * 1000,
} as const;
