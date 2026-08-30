type NullableDate = string | Date | null | undefined;

const FINISHED_STATUSES = new Set<AttemptSnapshot['status']>(['submitted', 'late', 'expired']);

const toDate = (value: NullableDate): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export type AttemptSnapshot = {
  status: 'in_progress' | 'submitted' | 'late' | 'expired';
  attemptStartTime?: NullableDate;
  attemptExpireAt?: NullableDate;
  submittedAt?: NullableDate;
};

export type ReleaseDecision =
  | {
      release: true;
      reason: 'immediate' | 'scheduled_release' | 'delayed_hours' | 'after_end';
    }
  | { release: false };

type AnswerPolicy = {
  answersReleaseMode?: 'immediate' | 'after_end' | 'after_hours' | 'scheduled' | string | null;
  showAnswersImmediately?: boolean;
  showAnswersLater?: boolean;
  answersReleaseDate?: NullableDate;
  answersVisibleAt?: NullableDate;
  showAnswersAfterHours?: number | null;
  examExpireAt?: NullableDate;
};

type ShouldPreventParams = {
  allowMultipleAttempts: boolean;
  attempts: AttemptSnapshot[];
  activeAttempt?: AttemptSnapshot | null;
};

export const calculateRemainingSeconds = (
  expireAt: NullableDate,
  referenceDate: Date = new Date(),
): number | null => {
  const expireDate = toDate(expireAt);
  if (!expireDate) return null;
  const diffInSeconds = Math.floor((expireDate.getTime() - referenceDate.getTime()) / 1000);
  return diffInSeconds <= 0 ? 0 : diffInSeconds;
};

export const isPastExpiry = (expireAt: NullableDate, referenceDate: Date = new Date()): boolean => {
  const expireDate = toDate(expireAt);
  if (!expireDate) return false;
  return referenceDate.getTime() > expireDate.getTime();
};

const resolveReleaseMode = (policy: AnswerPolicy): string => {
  const mode = String(policy?.answersReleaseMode ?? '')
    .trim()
    .toLowerCase();
  if (mode === 'immediate' || mode === 'after_end' || mode === 'after_hours' || mode === 'scheduled') {
    return mode;
  }
  if (policy?.showAnswersImmediately) return 'immediate';
  if (policy?.showAnswersLater && (policy.answersReleaseDate || policy.answersVisibleAt)) {
    return 'scheduled';
  }
  if ((policy?.showAnswersAfterHours ?? 0) > 0) return 'after_hours';
  if (policy?.answersVisibleAt) return 'scheduled';
  return 'immediate';
};

export const determineAnswerRelease = (
  policy: AnswerPolicy,
  attempt: AttemptSnapshot | null,
  referenceDate: Date = new Date(),
): ReleaseDecision => {
  const mode = resolveReleaseMode(policy);

  if (mode === 'immediate') {
    return { release: true, reason: 'immediate' };
  }

  if (mode === 'after_end') {
    const expireAt = toDate(policy.examExpireAt);
    if (expireAt && referenceDate.getTime() >= expireAt.getTime()) {
      return { release: true, reason: 'after_end' };
    }
    return { release: false };
  }

  if (mode === 'scheduled' || policy?.showAnswersLater) {
    const releaseDate = toDate(policy.answersReleaseDate ?? policy.answersVisibleAt);
    if (releaseDate && referenceDate.getTime() >= releaseDate.getTime()) {
      return { release: true, reason: 'scheduled_release' };
    }
  }

  const delayHours = policy?.showAnswersAfterHours ?? 0;
  if ((mode === 'after_hours' || delayHours > 0) && attempt?.submittedAt) {
    const submittedAtDate = toDate(attempt.submittedAt);
    if (submittedAtDate && delayHours > 0) {
      const releaseAfter = new Date(submittedAtDate.getTime() + delayHours * 60 * 60 * 1000);
      if (referenceDate.getTime() >= releaseAfter.getTime()) {
        return { release: true, reason: 'delayed_hours' };
      }
    }
  }

  return { release: false };
};

export const shouldPreventNewAttempt = ({
  allowMultipleAttempts,
  attempts,
  activeAttempt,
}: ShouldPreventParams): boolean => {
  if (activeAttempt && activeAttempt.status === 'in_progress') {
    return false;
  }

  if (allowMultipleAttempts) {
    return false;
  }

  return attempts.some((attempt) => FINISHED_STATUSES.has(attempt.status));
};
