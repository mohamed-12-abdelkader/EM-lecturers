/**
 * Shared Arabic-aware search helpers for tenant/platform directory lookup.
 */

export function normalizeArabicForSearch(input: string): string {
  return String(input || '')
    .normalize('NFKC')
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\u0600-\u06FFa-zA-Z0-9\s-]/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** SQL expression that mirrors normalizeArabicForSearch letter folding. */
export function sqlNormalizeArabic(expr: string): string {
  return `translate(lower(COALESCE(${expr}, '')), 'أإآٱةىؤئ', 'ااااهييوي')`;
}

const ARABIC_SEARCH_STOPWORDS = new Set([
  'دكتور',
  'د',
  'مستر',
  'استاذ',
  'استاذه',
  'مع',
  'عايز',
  'عايزه',
  'عايزة',
  'اشترك',
  'منصه',
  'منصة',
  'مدرس',
  'مدرسه',
  'في',
  'على',
  'علي',
  'او',
  'و',
  'يا',
  'بتاع',
  'بتاعة',
  'mr',
  'dr',
]);

export function arabicTokenVariants(token: string): string[] {
  const base = normalizeArabicForSearch(token);
  if (!base) return [];
  const set = new Set<string>([base]);

  if (base.endsWith('يي') && base.length > 3) set.add(base.slice(0, -1));
  if (base.endsWith('ي') && !base.endsWith('يي') && base.length >= 3) set.add(`${base}ي`);

  if (base.startsWith('ال') && base.length > 3) set.add(base.slice(2));
  else if (!base.startsWith('ال')) set.add(`ال${base}`);

  return [...set].filter((t) => t.length >= 2);
}

export function extractSearchTokens(query: string): string[] {
  const normalized = normalizeArabicForSearch(query);
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !ARABIC_SEARCH_STOPWORDS.has(t));
  if (tokens.length) return tokens;
  return normalized.length >= 1 ? [normalized] : [];
}
