import { pgParentsExamStore } from './pgStore';
import {
  getSettingsView,
  notifyFinalizedAttempt,
  previewExam,
  queueViewFromSettings,
  safeNotifyFinalized,
  saveSettings,
  sendCohorts,
  sweepClosedExams,
  testSend,
} from './engine';
import type { ExamCohort } from './constants';
import type { ParentsExamConfig, QuietHoursConfig } from './settings';

export function onAttemptFinalized(examId: number, studentId: number): Promise<void> {
  return safeNotifyFinalized(pgParentsExamStore, examId, studentId);
}

export function runParentsExamSweep() {
  return sweepClosedExams(pgParentsExamStore);
}

export const ParentsExamNotifyService = {
  getSettings: () => getSettingsView(pgParentsExamStore),
  saveSettings: (patch: Partial<ParentsExamConfig> & { quiet_hours?: Partial<QuietHoursConfig> }) =>
    saveSettings(pgParentsExamStore, patch),
  queue: async () => queueViewFromSettings(await getSettingsView(pgParentsExamStore)),
  listExams: (limit = 50) => pgParentsExamStore.listExams(limit),
  setExamEnabled: (examId: number, enabled: boolean) =>
    pgParentsExamStore.setExamEnabled(examId, enabled),
  pause: (examId: number) => pgParentsExamStore.setExamPaused(examId, true),
  resume: (examId: number) => pgParentsExamStore.setExamPaused(examId, false),
  cancelPending: (examId: number) => pgParentsExamStore.cancelPending(examId),
  preview: (examId: number) => previewExam(pgParentsExamStore, examId),
  testSend: (examId: number, studentId: number, cohort: ExamCohort) =>
    testSend(pgParentsExamStore, examId, studentId, cohort),
  sendCohorts: (
    examId: number,
    flags: { passed?: boolean; failed?: boolean; absent?: boolean },
  ) => sendCohorts(pgParentsExamStore, examId, flags),
  notifyFinalized: (examId: number, studentId: number) =>
    notifyFinalizedAttempt(pgParentsExamStore, examId, studentId),
};
