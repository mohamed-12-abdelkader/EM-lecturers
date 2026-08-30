import { describe, expect, it } from 'vitest';

import {
  calculateRemainingSeconds,
  determineAnswerRelease,
  isPastExpiry,
  shouldPreventNewAttempt,
  type AttemptSnapshot,
} from '../examPolicies';

describe('determineAnswerRelease', () => {
  it('releases immediately when showAnswersImmediately is true', () => {
    const now = new Date('2025-01-10T10:00:00Z');
    const decision = determineAnswerRelease({ showAnswersImmediately: true }, null, now);
    expect(decision).toEqual({ release: true, reason: 'immediate' });
  });

  it('waits for the scheduled release date before revealing answers', () => {
    const releaseDate = '2025-01-12T10:00:00Z';
    const beforeDecision = determineAnswerRelease(
      { showAnswersLater: true, answersReleaseDate: releaseDate },
      null,
      new Date('2025-01-12T09:59:59Z'),
    );
    expect(beforeDecision.release).toBe(false);

    const afterDecision = determineAnswerRelease(
      { showAnswersLater: true, answersReleaseDate: releaseDate },
      null,
      new Date('2025-01-12T10:00:01Z'),
    );
    expect(afterDecision).toEqual({ release: true, reason: 'scheduled_release' });
  });

  it('releases after the exam expire date when mode is after_end', () => {
    const policy = {
      answersReleaseMode: 'after_end' as const,
      examExpireAt: '2025-01-10T18:00:00Z',
    };
    expect(
      determineAnswerRelease(policy, null, new Date('2025-01-10T17:59:59Z')).release,
    ).toBe(false);
    expect(determineAnswerRelease(policy, null, new Date('2025-01-10T18:00:00Z'))).toEqual({
      release: true,
      reason: 'after_end',
    });
  });

  it('releases after delayed hours from submit', () => {
    const attempt = {
      status: 'submitted' as const,
      submittedAt: '2025-01-10T08:00:00Z',
    };
    const policy = { answersReleaseMode: 'after_hours' as const, showAnswersAfterHours: 2 };
    expect(
      determineAnswerRelease(policy, attempt, new Date('2025-01-10T09:59:59Z')).release,
    ).toBe(false);
    expect(determineAnswerRelease(policy, attempt, new Date('2025-01-10T10:00:00Z'))).toEqual({
      release: true,
      reason: 'delayed_hours',
    });
  });

  it('still prefers immediate when the mode is immediate', () => {
    expect(
      determineAnswerRelease(
        { answersReleaseMode: 'immediate', examExpireAt: '2099-01-01T00:00:00Z' },
        null,
        new Date('2025-01-10T10:00:00Z'),
      ),
    ).toEqual({ release: true, reason: 'immediate' });
  });
});

describe('attempt orchestration', () => {
  const submittedAttempt: AttemptSnapshot = {
    status: 'submitted',
    attemptStartTime: '2025-01-10T08:00:00Z',
    submittedAt: '2025-01-10T08:30:00Z',
  };

  it('prevents a new attempt when multiple attempts are disabled', () => {
    const prevent = shouldPreventNewAttempt({
      allowMultipleAttempts: false,
      attempts: [submittedAttempt],
    });
    expect(prevent).toBe(true);
  });

  it('allows a new attempt when multiple attempts are enabled', () => {
    const prevent = shouldPreventNewAttempt({
      allowMultipleAttempts: true,
      attempts: [submittedAttempt],
    });
    expect(prevent).toBe(false);
  });
});

describe('time limit helpers', () => {
  it('computes the remaining seconds for an active attempt', () => {
    const reference = new Date('2025-01-10T17:00:00Z');
    const expireAt = new Date(reference.getTime() + 5 * 60 * 1000).toISOString();
    expect(calculateRemainingSeconds(expireAt, reference)).toBe(300);

    const afterExpiry = new Date(reference.getTime() + 6 * 60 * 1000);
    expect(calculateRemainingSeconds(expireAt, afterExpiry)).toBe(0);
  });

  it('detects when a submission occurs after the expiry time', () => {
    const expireAt = '2025-01-10T18:00:00Z';
    expect(isPastExpiry(expireAt, new Date('2025-01-10T17:59:59Z'))).toBe(false);
    expect(isPastExpiry(expireAt, new Date('2025-01-10T18:00:01Z'))).toBe(true);
  });
});
