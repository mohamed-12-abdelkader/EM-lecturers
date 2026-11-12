import { describe, expect, it } from 'vitest';

import {
  buildQuestionExtractionPrompt,
  normalizeExtractionContentMode,
} from '../mistralQuestionExtraction.prompt';

describe('normalizeExtractionContentMode', () => {
  it('defaults to auto', () => {
    expect(normalizeExtractionContentMode(undefined)).toBe('auto');
    expect(normalizeExtractionContentMode('')).toBe('auto');
    expect(normalizeExtractionContentMode('weird')).toBe('auto');
  });

  it('accepts reading_passage aliases', () => {
    expect(normalizeExtractionContentMode('reading_passage')).toBe('reading_passage');
    expect(normalizeExtractionContentMode('passage')).toBe('reading_passage');
    expect(normalizeExtractionContentMode('قطعة')).toBe('reading_passage');
  });

  it('accepts general aliases', () => {
    expect(normalizeExtractionContentMode('general')).toBe('general');
    expect(normalizeExtractionContentMode('normal')).toBe('general');
  });
});

describe('buildQuestionExtractionPrompt content modes', () => {
  it('includes forced passage instructions without removing normal rules', () => {
    const prompt = buildQuestionExtractionPrompt('نص', 'file.pdf', {
      inferCorrectAnswer: false,
      contentMode: 'reading_passage',
      subject: 'اللغة العربية',
    });
    expect(prompt).toContain('READING_PASSAGE');
    expect(prompt).toContain('passages[]');
    expect(prompt).toContain('ARABIC_HIGH_ACCURACY_MODE');
  });

  it('includes general-only instructions', () => {
    const prompt = buildQuestionExtractionPrompt('text', 'file.pdf', {
      inferCorrectAnswer: false,
      contentMode: 'general',
    });
    expect(prompt).toContain('GENERAL');
    expect(prompt).toContain('passages = []');
  });
});
