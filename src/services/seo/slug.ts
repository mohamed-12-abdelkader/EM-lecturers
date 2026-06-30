const ARABIC_CHAR_MAP: Record<string, string> = {
  '\u0627': 'a',
  '\u0623': 'a',
  '\u0625': 'i',
  '\u0622': 'a',
  '\u0628': 'b',
  '\u062a': 't',
  '\u0629': 'h',
  '\u062b': 'th',
  '\u062c': 'j',
  '\u062d': 'h',
  '\u062e': 'kh',
  '\u062f': 'd',
  '\u0630': 'th',
  '\u0631': 'r',
  '\u0632': 'z',
  '\u0633': 's',
  '\u0634': 'sh',
  '\u0635': 's',
  '\u0636': 'd',
  '\u0637': 't',
  '\u0638': 'z',
  '\u0639': 'a',
  '\u063a': 'gh',
  '\u0641': 'f',
  '\u0642': 'q',
  '\u0643': 'k',
  '\u0644': 'l',
  '\u0645': 'm',
  '\u0646': 'n',
  '\u0647': 'h',
  '\u0648': 'w',
  '\u0649': 'a',
  '\u064a': 'y',
  '\u0644\u0644': 'll',
  '\u0627\u0644': 'al',
};

const ARABIC_WORD_MAP: Record<string, string> = {
  '\u0643\u064a\u0645\u064a\u0627\u0621': 'chemistry',
  '\u0627\u0644\u0643\u064a\u0645\u064a\u0627\u0621': 'chemistry',
  '\u0631\u064a\u0627\u0636\u064a\u0627\u062a': 'mathematics',
  '\u0627\u0644\u0631\u064a\u0627\u0636\u064a\u0627\u062a': 'mathematics',
  '\u0641\u064a\u0632\u064a\u0627\u0621': 'physics',
  '\u0627\u0644\u0641\u064a\u0632\u064a\u0627\u0621': 'physics',
  '\u0627\u0644\u062b\u0627\u0646\u0648\u064a\u0629': 'secondary',
  '\u0644\u0644\u062b\u0627\u0646\u0648\u064a\u0629': 'secondary',
  '\u0627\u0644\u0639\u0627\u0645\u0629': 'general',
};

function transliterateArabic(text: string): string {
  let normalized = text.trim();
  for (const [word, latin] of Object.entries(ARABIC_WORD_MAP)) {
    normalized = normalized.replace(new RegExp(word, 'g'), ` ${latin} `);
  }

  let out = '';
  for (const ch of normalized) {
    if (ARABIC_CHAR_MAP[ch]) {
      out += ARABIC_CHAR_MAP[ch];
      continue;
    }
    out += ch;
  }
  return out;
}

/** SEO-friendly slug from Arabic or Latin titles. */
export function slugifyTitle(title: string, maxLen = 120): string {
  const transliterated = transliterateArabic(title);
  const slug = transliterated
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug || !/[a-z0-9]/.test(slug)) return '';
  return slug.slice(0, maxLen);
}

export function fallbackSlug(prefix: string, id: number): string {
  return `${prefix}-${id}`;
}
