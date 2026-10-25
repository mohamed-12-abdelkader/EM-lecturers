import type { ExamCohort } from './constants';
import { DEFAULT_PARENTS_EXAM_CONFIG, DEFAULT_TEACHER_EXAM_PREFS, type ParentsExamConfig, type TeacherExamPrefs } from './settings';
import type {
  EnqueueJobInput,
  ExamState,
  NotificationState,
  ParentsExamStore,
  ServiceState,
  StudentState,
  UpcomingSend,
} from './store';

export interface MemoryJob {
  id: number;
  sessionSlug: string;
  to: string;
  body: string;
  scheduledAt: Date;
  triggerType: string;
  immediate: boolean;
  status: string;
  examId: number;
  studentId: number;
}

/**
 * In-memory store for tests. Production uses {@link PgParentsExamStore}.
 */
export class MemoryParentsExamStore implements ParentsExamStore {
  service: ServiceState | null;
  exams = new Map<number, ExamState>();
  students = new Map<number, StudentState[]>();
  notifications: NotificationState[] = [];
  jobs: MemoryJob[] = [];
  teacherPrefs = new Map<number, TeacherExamPrefs>();
  failGetService = false;
  private seq = 1;
  private jobSeq = 1;
  private clock = new Date('2026-10-23T12:00:00.000Z');

  constructor(config: ParentsExamConfig = { ...DEFAULT_PARENTS_EXAM_CONFIG, jitter_seconds: 0, quiet_hours: { ...DEFAULT_PARENTS_EXAM_CONFIG.quiet_hours, enabled: false } }) {
    this.service = {
      id: 1,
      isEnabled: true,
      config,
      readySessions: 1,
    };
    this.teacherPrefs.set(1, {
      ...DEFAULT_TEACHER_EXAM_PREFS,
      auto_send: true,
      notify_passed: true,
      notify_failed: true,
      notify_absent: true,
    });
  }

  setNow(date: Date) {
    this.clock = date;
  }

  now(): Date {
    return this.clock;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  async lockPace(): Promise<void> {}

  async getService(): Promise<ServiceState | null> {
    if (this.failGetService) throw new Error('db down');
    return this.service;
  }

  async saveConfig(config: ParentsExamConfig): Promise<ServiceState> {
    if (!this.service) throw new Error('service missing');
    this.service = { ...this.service, config };
    return this.service;
  }

  async getExam(examId: number): Promise<ExamState | null> {
    return this.exams.get(examId) ?? null;
  }

  async listExams(teacherId?: number): Promise<ExamState[]> {
    return [...this.exams.values()]
      .filter((exam) => teacherId == null || exam.teacherId === teacherId)
      .sort((a, b) => b.id - a.id)
      .map((exam) => this.withQueueCounts(exam));
  }

  async getTeacherPrefs(teacherId: number): Promise<TeacherExamPrefs> {
    return this.teacherPrefs.get(teacherId) ?? { ...DEFAULT_TEACHER_EXAM_PREFS };
  }

  async saveTeacherPrefs(teacherId: number, prefs: TeacherExamPrefs): Promise<TeacherExamPrefs> {
    this.teacherPrefs.set(teacherId, prefs);
    return prefs;
  }

  async setExamEnabled(examId: number, enabled: boolean): Promise<ExamState> {
    const exam = this.requireExam(examId);
    exam.enabled = enabled;
    return exam;
  }

  async setExamPaused(examId: number, paused: boolean): Promise<ExamState> {
    const exam = this.requireExam(examId);
    exam.paused = paused;
    return exam;
  }

  async markAbsentSwept(examId: number, at: Date): Promise<void> {
    const exam = this.requireExam(examId);
    exam.absentSweptAt = at;
  }

  async listClosedUnswept(now: Date): Promise<ExamState[]> {
    const out: ExamState[] = [];
    for (const exam of this.exams.values()) {
      if (!exam.enabled || exam.absentSweptAt) continue;
      const prefs = await this.getTeacherPrefs(exam.teacherId);
      if (!prefs.auto_send || !prefs.notify_absent) continue;
      const closed = !exam.isActive || (exam.visibilityEnd != null && exam.visibilityEnd.getTime() <= now.getTime());
      if (closed) out.push(exam);
    }
    return out;
  }

  async loadAudience(examId: number): Promise<StudentState[]> {
    return this.students.get(examId) ?? [];
  }

  async getEligibleStudent(examId: number, studentId: number): Promise<StudentState | null> {
    return (this.students.get(examId) ?? []).find((s) => s.studentId === studentId) ?? null;
  }

  async findNotification(examId: number, studentId: number, cohort: ExamCohort) {
    return (
      this.notifications.find(
        (n) => n.examId === examId && n.studentId === studentId && n.cohort === cohort,
      ) ?? null
    );
  }

  async listNotifications(examId: number) {
    return this.notifications.filter((n) => n.examId === examId);
  }

  async reopenNotification(
    id: number,
    patch: { parentPhone: string; body: string; readyAt: Date; immediate: boolean },
  ) {
    const row = this.notifications.find((n) => n.id === id);
    if (!row) return;
    row.status = 'scheduled';
    row.jobId = null;
    row.scheduledAt = null;
    row.skipReason = null;
    row.parentPhone = patch.parentPhone;
    row.body = patch.body;
    row.readyAt = patch.readyAt;
    row.immediate = patch.immediate;
  }

  async insertNotification(row: {
    teacherId: number;
    examId: number;
    studentId: number;
    cohort: ExamCohort;
    parentPhone: string | null;
    body: string;
    status: NotificationState['status'];
    skipReason: string | null;
    readyAt: Date;
    immediate: boolean;
  }): Promise<NotificationState | null> {
    const exists = await this.findNotification(row.examId, row.studentId, row.cohort);
    if (exists) return null;
    const created: NotificationState = {
      id: this.seq++,
      jobId: null,
      scheduledAt: null,
      ...row,
    };
    this.notifications.push(created);
    return created;
  }

  async listUnqueued(now: Date, limit: number) {
    return this.notifications
      .filter(
        (n) =>
          n.status === 'scheduled' &&
          n.jobId == null &&
          n.readyAt.getTime() <= now.getTime(),
      )
      .sort((a, b) => Number(b.immediate) - Number(a.immediate) || a.id - b.id)
      .slice(0, limit);
  }

  async attachJob(id: number, jobId: number, scheduledAt: Date) {
    const row = this.notifications.find((n) => n.id === id);
    if (!row) return;
    row.jobId = jobId;
    row.scheduledAt = scheduledAt;
  }

  async defer(id: number, readyAt: Date) {
    const row = this.notifications.find((n) => n.id === id);
    if (row) row.readyAt = readyAt;
  }

  async countPlacedOnDay(teacherId: number | null, dayStart: Date, dayEnd: Date) {
    return this.notifications.filter((n) => {
      if (teacherId != null && n.teacherId !== teacherId) return false;
      if (n.status !== 'scheduled' && n.status !== 'sent') return false;
      if (!n.scheduledAt) return false;
      return n.scheduledAt >= dayStart && n.scheduledAt < dayEnd;
    }).length;
  }

  async lastSlot(teacherId: number) {
    let max: Date | null = null;
    for (const n of this.notifications) {
      if (n.teacherId !== teacherId) continue;
      if ((n.status !== 'scheduled' && n.status !== 'sent') || !n.scheduledAt) continue;
      if (!max || n.scheduledAt > max) max = n.scheduledAt;
    }
    return max;
  }

  async pickSession(teacherId: number) {
    if (!this.service?.isEnabled) throw new Error('service disabled');
    if (!this.service.readySessions) throw new Error('no session');
    return { sessionSlug: `t${teacherId}-01`, serviceId: 2 };
  }

  async enqueueJob(input: EnqueueJobInput) {
    const id = this.jobSeq++;
    this.jobs.push({
      id,
      sessionSlug: input.sessionSlug,
      to: input.to,
      body: input.body,
      scheduledAt: input.scheduledAt,
      triggerType: input.triggerType,
      immediate: input.immediate,
      status: 'pending',
      examId: input.examId,
      studentId: input.studentId,
    });
    return id;
  }

  async cancelPending(examId: number) {
    let notifications = 0;
    for (const n of this.notifications) {
      if (n.examId !== examId || n.status !== 'scheduled') continue;
      n.status = 'cancelled';
      notifications += 1;
      if (n.jobId) {
        const job = this.jobs.find((j) => j.id === n.jobId);
        if (job && (job.status === 'pending' || job.status === 'failed')) job.status = 'dead';
      }
    }
    return { notifications };
  }

  async sentOnDay(dayStart: Date, dayEnd: Date) {
    return this.notifications.filter(
      (n) =>
        n.status === 'sent' &&
        n.scheduledAt != null &&
        n.scheduledAt >= dayStart &&
        n.scheduledAt < dayEnd,
    ).length;
  }

  async upcoming(limit: number): Promise<UpcomingSend[]> {
    return this.notifications
      .filter((n) => n.status === 'scheduled' && n.scheduledAt)
      .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
      .slice(0, limit)
      .map((n) => ({
        notificationId: n.id,
        examId: n.examId,
        examTitle: this.exams.get(n.examId)?.title ?? '',
        studentId: n.studentId,
        studentName:
          (this.students.get(n.examId) ?? []).find((s) => s.studentId === n.studentId)?.studentName ??
          '',
        cohort: n.cohort,
        parentPhone: n.parentPhone,
        scheduledAt: n.scheduledAt,
        status: n.status,
        immediate: n.immediate,
      }));
  }

  seedExam(exam: ExamState, students: StudentState[]) {
    this.exams.set(exam.id, exam);
    this.students.set(exam.id, students);
  }

  private withQueueCounts(exam: ExamState): ExamState {
    const rows = this.notifications.filter((n) => n.examId === exam.id);
    return {
      ...exam,
      scheduledCount: rows.filter((n) => n.status === 'scheduled').length,
      sentCount: rows.filter((n) => n.status === 'sent').length,
      skippedCount: rows.filter((n) => n.status === 'skipped').length,
    };
  }

  private requireExam(examId: number): ExamState {
    const exam = this.exams.get(examId);
    if (!exam) throw new Error(`exam ${examId} missing`);
    return exam;
  }
}
