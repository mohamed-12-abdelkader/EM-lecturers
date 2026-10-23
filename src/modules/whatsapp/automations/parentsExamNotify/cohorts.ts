import type { ExamCohort } from './constants';

export type StudentStanding = ExamCohort | 'in_progress';

export function isPassed(
  obtained: number | null | undefined,
  total: number | null | undefined,
  passPercentage: number,
): boolean {
  const max = Number(total ?? 0);
  const score = Number(obtained ?? 0);
  if (max <= 0) return false;
  return (score / max) * 100 >= passPercentage;
}

export function classifyStudent(input: {
  attemptStatus: 'none' | 'in_progress' | 'submitted';
  obtained: number | null;
  total: number | null;
  passPercentage: number;
}): StudentStanding {
  if (input.attemptStatus === 'submitted') {
    return isPassed(input.obtained, input.total, input.passPercentage) ? 'passed' : 'failed';
  }
  if (input.attemptStatus === 'in_progress') return 'in_progress';
  return 'absent';
}

export function isExamClosed(
  exam: { visibilityEnd: Date | null; isActive: boolean },
  now: Date,
): boolean {
  if (!exam.isActive) return true;
  if (exam.visibilityEnd && exam.visibilityEnd.getTime() <= now.getTime()) return true;
  return false;
}

export function shouldAutoNotify(input: {
  serviceEnabled: boolean;
  autoSend: boolean;
  examEnabled: boolean;
  cohort: StudentStanding;
  cohortEnabled: boolean;
  examClosed: boolean;
  alreadyRecorded: boolean;
}): boolean {
  if (!input.serviceEnabled || !input.autoSend || !input.examEnabled) return false;
  if (input.alreadyRecorded) return false;
  if (input.cohort === 'in_progress') return false;
  if (!input.cohortEnabled) return false;
  if (input.cohort === 'absent' && !input.examClosed) return false;
  return true;
}
