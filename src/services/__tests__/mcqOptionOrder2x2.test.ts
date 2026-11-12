import { describe, expect, it } from 'vitest';

import {
  extractArabicMcqOptionsFromSlice,
  extractTwoByTwoGridOptionsFromSlice,
} from '../mistralQuestionExtraction';

describe('ترتيب الاختيارات أ ب ج د', () => {
  it('صف واحد مرقّم بالحروف', () => {
    const options = extractArabicMcqOptionsFromSlice(
      'أ) 15.39 g  ب) 25.65 g  ج) 41.04 g  د) 66.69 g',
    );
    expect(options.map((o) => `${o.label}:${o.text}`)).toEqual([
      expect.stringContaining('أ:'),
      expect.stringContaining('ب:'),
      expect.stringContaining('ج:'),
      expect.stringContaining('د:'),
    ]);
    expect(options[0].text).toContain('15.39');
    expect(options[1].text).toContain('25.65');
    expect(options[2].text).toContain('41.04');
    expect(options[3].text).toContain('66.69');
  });

  it('تحت بعض', () => {
    const options = extractArabicMcqOptionsFromSlice(`
أ) 15.39 g
ب) 25.65 g
ج) 41.04 g
د) 66.69 g
`);
    expect(options.map((o) => o.label)).toEqual(['أ', 'ب', 'ج', 'د']);
    expect(options[0].text).toContain('15.39');
    expect(options[3].text).toContain('66.69');
  });

  it('شبكة 2×2 مع حروف حتى لو OCR LTR (ب ثم أ)', () => {
    const slice = `
1) محلول من هيدروكسيد الباريوم
ب) 25.65 g    أ) 15.39 g
د) 66.69 g    ج) 41.04 g
`;
    const options = extractArabicMcqOptionsFromSlice(slice);
    expect(options.map((o) => o.label)).toEqual(['أ', 'ب', 'ج', 'د']);
    expect(options.find((o) => o.label === 'أ')?.text).toContain('15.39');
    expect(options.find((o) => o.label === 'ب')?.text).toContain('25.65');
    expect(options.find((o) => o.label === 'ج')?.text).toContain('41.04');
    expect(options.find((o) => o.label === 'د')?.text).toContain('66.69');
  });

  it('شبكة 2×2 بدون حروف — يعيد تخطيط LTR إلى أ ب / ج د', () => {
    const options = extractTwoByTwoGridOptionsFromSlice(`
سؤال كيمياء عن تركيز محلول هيدروكسيد الباريوم يحتاج كتلة معينة
25.65 g    15.39 g
66.69 g    41.04 g
`);
    expect(options).toEqual([
      { label: 'أ', text: '15.39 g' },
      { label: 'ب', text: '25.65 g' },
      { label: 'ج', text: '41.04 g' },
      { label: 'د', text: '66.69 g' },
    ]);
  });
});
