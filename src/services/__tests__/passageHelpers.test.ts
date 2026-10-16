import { describe, expect, it } from 'vitest';

import {
  attachPassageFields,
  bodyHasOwnField,
  buildPassagePayload,
  coalescePassageText,
  resolveOptionalPassageIdUpdate,
} from '../passageHelpers';

describe('passageHelpers', () => {
  describe('bodyHasOwnField / resolveOptionalPassageIdUpdate', () => {
    it('treats omitted passage_id as no change (partial update)', () => {
      expect(bodyHasOwnField({ question_text: 'x' }, ['passage_id', 'passageId'])).toBe(false);
      expect(resolveOptionalPassageIdUpdate({ question_text: 'x', points: 2 })).toEqual({
        present: false,
      });
    });

    it('accepts explicit null as unlink request', () => {
      expect(resolveOptionalPassageIdUpdate({ passage_id: null })).toEqual({
        present: true,
        value: null,
      });
    });

    it('accepts explicit passage id', () => {
      expect(resolveOptionalPassageIdUpdate({ passageId: 42 })).toEqual({
        present: true,
        value: 42,
      });
    });

    it('rejects invalid passage id', () => {
      expect(() => resolveOptionalPassageIdUpdate({ passage_id: 'abc' })).toThrow(
        'invalid_passage_id',
      );
    });
  });

  describe('coalescePassageText', () => {
    it('prefers non-empty snapshot over linked text', () => {
      expect(coalescePassageText('snapshot', 'linked')).toBe('snapshot');
    });

    it('falls back to linked when snapshot empty/null', () => {
      expect(coalescePassageText(null, 'linked')).toBe('linked');
      expect(coalescePassageText('   ', 'linked')).toBe('linked');
      expect(coalescePassageText('', 'قطعة عربية\nسطران')).toBe('قطعة عربية\nسطران');
    });

    it('returns null when both missing', () => {
      expect(coalescePassageText(null, null)).toBeNull();
      expect(coalescePassageText('  ', '')).toBeNull();
    });
  });

  describe('buildPassagePayload / attachPassageFields', () => {
    it('exposes stable passageText aliases on every question', () => {
      const passage = buildPassagePayload(7, 'نص طويل، مع ترقيم.', 'عنوان');
      expect(passage).toEqual({
        id: 7,
        text: 'نص طويل، مع ترقيم.',
        passageText: 'نص طويل، مع ترقيم.',
        content: 'نص طويل، مع ترقيم.',
        title: 'عنوان',
      });

      const row = attachPassageFields(
        { id: 1, teacher_question_id: 9, grade: 2 },
        passage,
      );
      expect(row.passageText).toBe('نص طويل، مع ترقيم.');
      expect(row.passageId).toBe(7);
      expect(row.passage?.content).toBe('نص طويل، مع ترقيم.');
    });

    it('leaves non-passage questions with null passage fields', () => {
      const row = attachPassageFields({ id: 2, question_text: 'عادي' }, null);
      expect(row.passage).toBeNull();
      expect(row.passageText).toBeNull();
      expect(row.passageId).toBeNull();
    });
  });
});
