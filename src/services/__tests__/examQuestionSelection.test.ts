import { describe, expect, it } from 'vitest';

import { orderItemsByIds, selectAttemptQuestions } from '../examAccessPolicy';
import {
  computeSelectionSeed,
  needsAttemptBeforeQuestions,
  pickQuestionIds,
} from '../examQuestionSelection';

describe('examAccessPolicy question selection helpers', () => {
  it('keeps resume order from stored attempt ids', () => {
    const questions = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const stored = [4, 1, 3];
    expect(orderItemsByIds(questions, stored).map((q) => q.id)).toEqual([4, 1, 3]);
  });

  it('does not exceed the available bank size', () => {
    expect(selectAttemptQuestions([1, 2], 10, 'ordered')).toEqual([1, 2]);
  });
});

describe('examQuestionSelection', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  it('ordered mode takes first N questions', () => {
    expect(pickQuestionIds(ids, 3, 'ordered', 1)).toEqual([1, 2, 3]);
  });

  it('random mode is stable for same seed', () => {
    const seed = computeSelectionSeed(5, 42, 1);
    const a = pickQuestionIds(ids, 4, 'random', seed);
    const b = pickQuestionIds(ids, 4, 'random', seed);
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
    expect(new Set(a).size).toBe(4);
  });

  it('different students get different random sets', () => {
    const a = pickQuestionIds(ids, 4, 'random', computeSelectionSeed(5, 1, 1));
    const b = pickQuestionIds(ids, 4, 'random', computeSelectionSeed(5, 2, 1));
    expect(a).not.toEqual(b);
  });

  it('needsAttemptBeforeQuestions detects random or subset', () => {
    expect(needsAttemptBeforeQuestions(40, 20, 'ordered')).toBe(true);
    expect(needsAttemptBeforeQuestions(20, 20, 'ordered')).toBe(false);
    expect(needsAttemptBeforeQuestions(20, 20, 'random')).toBe(true);
  });
});
