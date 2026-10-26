import { pgParentsExamStore } from './pgStore';
import {
  getSettingsView,
  notifyFinalizedAttempt,
  previewExam,
  queueViewFromSettings,
  safeNotifyFinalized,
  saveSettings,
  sendCohorts,
  sendMissing,
  sweepClosedExams,
  testSend,
} from './engine';
import { HttpError } from '../../../../utils';
import type { ExamCohort } from './constants';
import type { ParentsExamConfig, QuietHoursConfig, TeacherExamPrefs } from './settings';

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
  listExams: (teacherId?: number) => pgParentsExamStore.listExams(teacherId),
  getTeacherPrefs: (teacherId: number) => pgParentsExamStore.getTeacherPrefs(teacherId),
  saveTeacherPrefs: (teacherId: number, prefs: TeacherExamPrefs) =>
    pgParentsExamStore.saveTeacherPrefs(teacherId, prefs),
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
  sendMissing: (examId: number) => sendMissing(pgParentsExamStore, examId),
  monitor: (input: {
    limit?: number;
    page?: number;
    status?: string | null;
    q?: string | null;
    cohort?: string | null;
  }) =>
    pgParentsExamStore.monitor({
      limit: input.limit ?? 50,
      page: input.page ?? 1,
      status: input.status,
      q: input.q,
      cohort: input.cohort,
    }),
  controlQueue: (input: {
    action: 'cancel' | 'send_now';
    ids?: number[];
    allMatching?: boolean;
    status?: string | null;
    q?: string | null;
    cohort?: string | null;
  }) => pgParentsExamStore.controlQueue(input),
  notifyFinalized: (examId: number, studentId: number) =>
    notifyFinalizedAttempt(pgParentsExamStore, examId, studentId),
  async assertOwned(teacherId: number, examId: number) {
    const exam = await pgParentsExamStore.getExam(examId);
    if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
    if (exam.teacherId !== teacherId) throw new HttpError(403, 'هذا الامتحان ليس لك');
    return exam;
  },
};
