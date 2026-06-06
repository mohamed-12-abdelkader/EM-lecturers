"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldPreventNewAttempt = exports.determineAnswerRelease = exports.isPastExpiry = exports.calculateRemainingSeconds = void 0;
const FINISHED_STATUSES = new Set(['submitted', 'late', 'expired']);
const toDate = (value) => {
    if (!value)
        return null;
    if (value instanceof Date)
        return Number.isNaN(value.getTime()) ? null : value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};
const calculateRemainingSeconds = (expireAt, referenceDate = new Date()) => {
    const expireDate = toDate(expireAt);
    if (!expireDate)
        return null;
    const diffInSeconds = Math.floor((expireDate.getTime() - referenceDate.getTime()) / 1000);
    return diffInSeconds <= 0 ? 0 : diffInSeconds;
};
exports.calculateRemainingSeconds = calculateRemainingSeconds;
const isPastExpiry = (expireAt, referenceDate = new Date()) => {
    const expireDate = toDate(expireAt);
    if (!expireDate)
        return false;
    return referenceDate.getTime() > expireDate.getTime();
};
exports.isPastExpiry = isPastExpiry;
const determineAnswerRelease = (policy, attempt, referenceDate = new Date()) => {
    if (policy?.showAnswersImmediately) {
        return { release: true, reason: 'immediate' };
    }
    if (policy?.showAnswersLater && policy.answersReleaseDate) {
        const releaseDate = toDate(policy.answersReleaseDate);
        if (releaseDate && referenceDate.getTime() >= releaseDate.getTime()) {
            return { release: true, reason: 'scheduled_release' };
        }
    }
    const delayHours = policy?.showAnswersAfterHours ?? 0;
    if (delayHours > 0 && attempt?.submittedAt) {
        const submittedAtDate = toDate(attempt.submittedAt);
        if (submittedAtDate) {
            const releaseAfter = new Date(submittedAtDate.getTime() + delayHours * 60 * 60 * 1000);
            if (referenceDate.getTime() >= releaseAfter.getTime()) {
                return { release: true, reason: 'delayed_hours' };
            }
        }
    }
    return { release: false };
};
exports.determineAnswerRelease = determineAnswerRelease;
const shouldPreventNewAttempt = ({ allowMultipleAttempts, attempts, activeAttempt, }) => {
    if (activeAttempt && activeAttempt.status === 'in_progress') {
        return false;
    }
    if (allowMultipleAttempts) {
        return false;
    }
    return attempts.some((attempt) => FINISHED_STATUSES.has(attempt.status));
};
exports.shouldPreventNewAttempt = shouldPreventNewAttempt;
