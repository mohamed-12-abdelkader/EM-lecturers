import { describe, expect, it } from 'vitest';

import { foldSingletonPassages } from '../expandMultiPartQuestions';

describe('foldSingletonPassages (legacy auto behavior)', () => {
  it('folds a singleton passage into the question', () => {
    const result = foldSingletonPassages(
      [{ passage_id: 'p1', title: null, content: 'نص قصير' }],
      [
        {
          number: 1,
          question_text: 'ماذا يعني؟',
          passage_id: 'p1',
          options: [
            { label: 'أ', text: '1' },
            { label: 'ب', text: '2' },
            { label: 'ج', text: '3' },
            { label: 'د', text: '4' },
          ],
        } as any,
      ],
    );
    expect(result.passages).toHaveLength(0);
    expect(result.questions[0].passage_id).toBeNull();
  });

  it('keeps multi-question passages', () => {
    const result = foldSingletonPassages(
      [{ passage_id: 'p1', title: 'النانو', content: 'قطعة طويلة…' }],
      [
        {
          number: 1,
          question_text: 'س1',
          passage_id: 'p1',
          options: [
            { label: 'أ', text: '1' },
            { label: 'ب', text: '2' },
            { label: 'ج', text: '3' },
            { label: 'د', text: '4' },
          ],
        } as any,
        {
          number: 2,
          question_text: 'س2',
          passage_id: 'p1',
          options: [
            { label: 'أ', text: '1' },
            { label: 'ب', text: '2' },
            { label: 'ج', text: '3' },
            { label: 'د', text: '4' },
          ],
        } as any,
      ],
    );
    expect(result.passages).toHaveLength(1);
    expect(result.questions.every((q) => q.passage_id === 'p1')).toBe(true);
  });
});
