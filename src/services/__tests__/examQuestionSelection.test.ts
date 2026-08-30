import { describe, expect, it } from 'vitest';

import { orderItemsByIds, selectAttemptQuestions } from '../examAccessPolicy';

describe('exam question selection helpers', () => {
  it('keeps resume order from stored attempt ids', () => {
    const questions = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const stored = [4, 1, 3];
    expect(orderItemsByIds(questions, stored).map((q) => q.id)).toEqual([4, 1, 3]);
  });

  it('does not exceed the available bank size', () => {
    expect(selectAttemptQuestions([1, 2], 10, 'ordered')).toEqual([1, 2]);
  });
});
