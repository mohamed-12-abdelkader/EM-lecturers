import type { ExamCohort } from './constants';
import type { ParentsExamConfig } from './settings';

export interface ServiceState {
  id: number;
  isEnabled: boolean;
  config: ParentsExamConfig;
  readySessions: number;
}

export interface ExamState {
  id: number;
  title: string;
  scope: 'course' | 'public';
  isActive: boolean;
  visibilityEnd: Date | null;
  enabled: boolean;
  paused: boolean;
  absentSweptAt: Date | null;
  courseTitle: string | null;
  teacherId: number;
  scheduledCount?: number;
  sentCount?: number;
  skippedCount?: number;
}

export interface StudentState {
  studentId: number;
  studentName: string;
  parentPhone: string | null;
  attemptStatus: 'none' | 'in_progress' | 'submitted';
  obtained: number | null;
  total: number | null;
}

export type NotificationStatus = 'scheduled' | 'sent' | 'skipped' | 'cancelled';

export interface NotificationState {
  id: number;
  examId: number;
  teacherId: number;
  studentId: number;
  cohort: ExamCohort;
  parentPhone: string | null;
  body: string;
  jobId: number | null;
  status: NotificationStatus;
  scheduledAt: Date | null;
  skipReason: string | null;
  readyAt: Date;
  immediate: boolean;
}

export interface EnqueueJobInput {
  sessionSlug: string;
  serviceId: number;
  to: string;
  body: string;
  scheduledAt: Date;
  triggerType: string;
  examId: number;
  studentId: number;
  cohort: ExamCohort;
  notificationId: number;
  immediate: boolean;
}

export interface UpcomingSend {
  notificationId: number;
  examId: number;
  examTitle: string;
  studentId: number;
  studentName: string;
  cohort: ExamCohort;
  parentPhone: string | null;
  scheduledAt: Date | null;
  status: NotificationStatus;
  immediate: boolean;
}

export interface ParentsExamStore {
  now(): Date;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  lockPace(): Promise<void>;
  getService(): Promise<ServiceState | null>;
  saveConfig(config: ParentsExamConfig): Promise<ServiceState>;
  getExam(examId: number): Promise<ExamState | null>;
  listExams(teacherId?: number): Promise<ExamState[]>;
  getTeacherPrefs(teacherId: number): Promise<import('./settings').TeacherExamPrefs>;
  saveTeacherPrefs(
    teacherId: number,
    prefs: import('./settings').TeacherExamPrefs,
  ): Promise<import('./settings').TeacherExamPrefs>;
  setExamEnabled(examId: number, enabled: boolean): Promise<ExamState>;
  setExamPaused(examId: number, paused: boolean): Promise<ExamState>;
  markAbsentSwept(examId: number, at: Date): Promise<void>;
  listClosedUnswept(now: Date): Promise<ExamState[]>;
  loadAudience(examId: number): Promise<StudentState[]>;
  getEligibleStudent(examId: number, studentId: number): Promise<StudentState | null>;
  findNotification(
    examId: number,
    studentId: number,
    cohort: ExamCohort,
  ): Promise<NotificationState | null>;
  listNotifications(examId: number): Promise<NotificationState[]>;
  reopenNotification(
    id: number,
    patch: { parentPhone: string; body: string; readyAt: Date; immediate: boolean },
  ): Promise<void>;
  insertNotification(row: {
    teacherId: number;
    examId: number;
    studentId: number;
    cohort: ExamCohort;
    parentPhone: string | null;
    body: string;
    status: NotificationStatus;
    skipReason: string | null;
    readyAt: Date;
    immediate: boolean;
  }): Promise<NotificationState | null>;
  listUnqueued(now: Date, limit: number): Promise<NotificationState[]>;
  attachJob(id: number, jobId: number, scheduledAt: Date): Promise<void>;
  defer(id: number, readyAt: Date): Promise<void>;
  countPlacedOnDay(teacherId: number | null, dayStart: Date, dayEnd: Date): Promise<number>;
  lastSlot(teacherId: number): Promise<Date | null>;
  pickSession(teacherId: number, phone: string | null): Promise<{ sessionSlug: string; serviceId: number }>;
  enqueueJob(input: EnqueueJobInput): Promise<number>;
  cancelPending(examId: number): Promise<{ notifications: number }>;
  sentOnDay(dayStart: Date, dayEnd: Date): Promise<number>;
  upcoming(limit: number): Promise<UpcomingSend[]>;
}
