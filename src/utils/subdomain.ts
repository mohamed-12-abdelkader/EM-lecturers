/** Subdomains محجوزة — لا تُستخدم لمنصات المدرسين */
export const RESERVED_TENANT_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'default',
  'mail',
  'ftp',
  'cdn',
  'static',
  'assets',
  'support',
  'help',
  'blog',
  'status',
  'dev',
  'staging',
  'test',
]);

export const SUBDOMAIN_FORMAT_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeSubdomain(raw: string): string {
  return raw.trim().toLowerCase();
}

export type SubdomainValidationResult =
  | { ok: true; subdomain: string }
  | { ok: false; code: string; message: string };

export function validateSubdomain(raw: string): SubdomainValidationResult {
  const subdomain = normalizeSubdomain(raw);
  if (!subdomain) {
    return { ok: false, code: 'SUBDOMAIN_REQUIRED', message: 'النطاق الفرعي مطلوب' };
  }
  if (subdomain.length < 2) {
    return { ok: false, code: 'SUBDOMAIN_TOO_SHORT', message: 'النطاق الفرعي قصير جداً (حد أدنى حرفين)' };
  }
  if (subdomain.length > 63) {
    return { ok: false, code: 'SUBDOMAIN_TOO_LONG', message: 'النطاق الفرعي طويل جداً (حد أقصى 63 حرفاً)' };
  }
  if (!SUBDOMAIN_FORMAT_REGEX.test(subdomain)) {
    return {
      ok: false,
      code: 'SUBDOMAIN_INVALID_FORMAT',
      message: 'استخدم أحرفاً إنجليزية صغيرة وأرقاماً وشرطة (-) فقط',
    };
  }
  if (RESERVED_TENANT_SUBDOMAINS.has(subdomain)) {
    return { ok: false, code: 'SUBDOMAIN_RESERVED', message: 'هذا النطاق محجوز ولا يمكن استخدامه' };
  }
  if (subdomain.startsWith('deleted-')) {
    return { ok: false, code: 'SUBDOMAIN_INVALID', message: 'النطاق غير صالح' };
  }
  return { ok: true, subdomain };
}
