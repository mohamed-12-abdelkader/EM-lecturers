/** Public URL prefix for the image CDN (Express static). Reads env directly to avoid circular imports. */
export function getImageCdnPublicPrefix(): string {
  const raw = (process.env.IMAGE_CDN_PUBLIC_PREFIX || '/cdn').trim() || '/cdn';
  return `/${raw.replace(/^\/+|\/+$/g, '')}`;
}

/** Browser cache lifetime for CDN images (seconds). Default 30 days. */
export function getImageCdnMaxAgeSeconds(): number {
  const n = Number(process.env.IMAGE_CDN_MAX_AGE_SECONDS);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 60 * 60 * 24 * 30;
}
