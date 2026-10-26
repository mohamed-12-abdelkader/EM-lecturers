import { HttpError } from '../../../../utils';
import { classifyStudent, isExamClosed, shouldAutoNotify, type StudentStanding } from './cohorts';
import type { ExamCohort } from './constants';
import { canonicalParentPhone } from './phone';
import { dayStart, nextScheduledAt } from './schedule';
import { cohortEnabled, mergeParentsExamConfig, templateForCohort, type ParentsExamConfig } from './settings';
import type { ExamState, ParentsExamStore, StudentState } from './store';
import { renderParentExamMessage } from './templates';

function standingOf(student: StudentState, passPercentage: number): StudentStanding {
  return classifyStudent({
    attemptStatus: student.attemptStatus,
    obtained: student.obtained,
    total: student.total,
    passPercentage,
  });
}

async function recordStudent(
  store: ParentsExamStore,
  exam: ExamState,
  student: StudentState,
  cohort: ExamCohort,
  now: Date,
  immediate: boolean,
  template?: string | null,
): Promise<'inserted' | 'skipped' | 'duplicate'> {
  const existing = await store.findNotification(exam.id, student.studentId, cohort);
  if (existing) return 'duplicate';
  const phone = canonicalParentPhone(student.parentPhone);
  const body = renderParentExamMessage({
    cohort,
    studentName: student.studentName,
    examTitle: exam.title,
    score: student.obtained,
    total: student.total,
    template,
  });
  if (!phone) {
    await store.insertNotification({
      examId: exam.id,
      teacherId: exam.teacherId,
      studentId: student.studentId,
      cohort,
      parentPhone: null,
      body,
      status: 'skipped',
      skipReason: 'invalid_phone',
      readyAt: now,
      immediate: false,
    });
    return 'skipped';
  }
  const inserted = await store.insertNotification({
    examId: exam.id,
    teacherId: exam.teacherId,
    studentId: student.studentId,
    cohort,
    parentPhone: phone,
    body,
    status: 'scheduled',
    skipReason: null,
    readyAt: now,
    immediate,
  });
  return inserted ? 'inserted' : 'duplicate';
}

export async function placePending(
  store: ParentsExamStore,
  now = store.now(),
  forceExamId?: number,
): Promise<number> {
  return store.transaction(async () => {
    await store.lockPace();
    const service = await store.getService();
    const config = service?.config;
    if (!config) return 0;
    const tz = config.quiet_hours.tz;
    const start = dayStart(now, tz);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const rows = await store.listUnqueued(now, 200);
    const byTeacher = new Map<number, typeof rows>();
    for (const row of rows) {
      const exam = await store.getExam(row.examId);
      if (!exam) continue;
      const forced = exam.id === forceExamId;
      if (!forced && (!exam.enabled || exam.paused)) continue;
      const bucket = byTeacher.get(exam.teacherId) ?? [];
      bucket.push(row);
      byTeacher.set(exam.teacherId, bucket);
    }

    let placed = 0;
    for (const [teacherId, teacherRows] of byTeacher) {
      let daily = await store.countPlacedOnDay(teacherId, start, end);
      let last = await store.lastSlot(teacherId);
      let session: { sessionSlug: string; serviceId: number } | null = null;
      for (const row of teacherRows) {
        if (daily >= config.daily_cap) {
          await store.defer(row.id, end);
          continue;
        }
        const slot = nextScheduledAt({
          now,
          lastSlot: row.immediate ? null : last,
          intervalSeconds: config.interval_seconds,
          jitterSeconds: row.immediate ? 0 : config.jitter_seconds,
          quietHours: config.quiet_hours,
          dailyCount: daily,
          dailyCap: config.daily_cap,
          immediate: row.immediate,
        });
        if (!slot.ok) {
          await store.defer(row.id, end);
          continue;
        }
        if (!session) {
          try {
            session = await store.pickSession(teacherId, row.parentPhone);
          } catch {
            break;
          }
        }
        const jobId = await store.enqueueJob({
          sessionSlug: session.sessionSlug,
          serviceId: session.serviceId,
          to: row.parentPhone || '',
          body: row.body,
          scheduledAt: slot.at,
          triggerType: row.immediate ? 'parents_exam_test' : `parents_exam_${row.cohort}`,
          examId: row.examId,
          studentId: row.studentId,
          cohort: row.cohort,
          notificationId: row.id,
          immediate: row.immediate,
        });
        await store.attachJob(row.id, jobId, slot.at);
        if (!row.immediate) last = slot.at;
        daily += 1;
        placed += 1;
      }
    }
    return placed;
  });
}

export async function notifyFinalizedAttempt(
  store: ParentsExamStore,
  examId: number,
  studentId: number,
): Promise<'enqueued' | 'skipped' | 'ignored'> {
  const now = store.now();
  const service = await store.getService();
  if (!service) return 'ignored';
  const exam = await store.getExam(examId);
  if (!exam) return 'ignored';
  const student = await store.getEligibleStudent(examId, studentId);
  if (!student) return 'ignored';
  const prefs = exam.teacherId ? await store.getTeacherPrefs(exam.teacherId) : null;
  const pass = prefs?.pass_percentage ?? 50;
  const cohort = standingOf(student, pass);
  const existing = cohort === 'in_progress' ? null : await store.findNotification(examId, studentId, cohort);
  const ok = shouldAutoNotify({
    serviceEnabled: true,
    autoSend: Boolean(prefs?.auto_send),
    examEnabled: exam.enabled,
    cohort,
    cohortEnabled: cohort === 'in_progress' || !prefs ? false : cohortEnabled(prefs, cohort),
    examClosed: isExamClosed(exam, now),
    alreadyRecorded: Boolean(existing),
  });
  if (!ok || cohort === 'in_progress') return 'ignored';
  const recorded = await recordStudent(
    store,
    exam,
    student,
    cohort,
    now,
    false,
    templateForCohort(prefs, cohort),
  );
  if (recorded === 'skipped') return 'skipped';
  if (recorded === 'duplicate') return 'ignored';
  await placePending(store, now);
  return 'enqueued';
}

export async function safeNotifyFinalized(
  store: ParentsExamStore,
  examId: number,
  studentId: number,
): Promise<void> {
  try {
    await notifyFinalizedAttempt(store, examId, studentId);
  } catch (err) {
    console.error('parents exam notify hook failed', err);
  }
}

export async function sweepClosedExams(
  store: ParentsExamStore,
  now = store.now(),
): Promise<{ exams: number; inserted: number }> {
  const service = await store.getService();
  const exams = service ? await store.listClosedUnswept(now) : [];
  let inserted = 0;
  if (service) {
    for (const exam of exams) {
      const prefs = await store.getTeacherPrefs(exam.teacherId);
      const audience = await store.loadAudience(exam.id);
      let pending = false;
      for (const student of audience) {
        const cohort = standingOf(student, prefs.pass_percentage);
        if (cohort !== 'absent') continue;
        const result = await recordStudent(
          store,
          exam,
          student,
          'absent',
          now,
          false,
          templateForCohort(prefs, 'absent'),
        );
        if (result === 'inserted') inserted += 1;
        if (result === 'duplicate') continue;
        const row = await store.findNotification(exam.id, student.studentId, 'absent');
        if (!row) pending = true;
      }
      if (!pending) await store.markAbsentSwept(exam.id, now);
    }
  }
  if (service) await placePending(store, now);
  return { exams: exams.length, inserted };
}

export async function testSend(
  store: ParentsExamStore,
  examId: number,
  studentId: number,
  cohort: ExamCohort,
): Promise<{ jobId: number | null; scheduledAt: Date | null; notificationId: number }> {
  const service = await store.getService();
  if (!service) throw new HttpError(404, 'خدمة إشعارات أولياء الأمور غير موجودة');
  const exam = await store.getExam(examId);
  if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
  const prefs = await store.getTeacherPrefs(exam.teacherId);
  const student = await store.getEligibleStudent(examId, studentId);
  if (!student) throw new HttpError(404, 'الطالب مش ضمن المستحقين للامتحان');
  const actual = standingOf(student, prefs.pass_percentage);
  if (actual === 'in_progress') throw new HttpError(400, 'الطالب لسه ما سلّمش الامتحان');
  if (actual !== cohort) throw new HttpError(400, 'حالة الطالب مختلفة عن الاختيار');
  const phone = canonicalParentPhone(student.parentPhone);
  if (!phone) throw new HttpError(400, 'رقم ولي الأمر غير صالح');
  const now = store.now();
  const body = renderParentExamMessage({
    cohort,
    studentName: student.studentName,
    examTitle: exam.title,
    score: student.obtained,
    total: student.total,
    template: templateForCohort(prefs, cohort),
  });
  let row = await store.findNotification(examId, studentId, cohort);
  if (row?.status === 'sent') throw new HttpError(409, 'الرسالة اتبعتت قبل كده');
  if (row?.status === 'scheduled' && !row.immediate) {
    throw new HttpError(409, 'الطالب متجدول بالفعل في الطابور');
  }
  if (row && (row.status === 'cancelled' || row.status === 'skipped' || row.jobId == null)) {
    await store.reopenNotification(row.id, { parentPhone: phone, body, readyAt: now, immediate: true });
  } else if (!row) {
    row = await store.insertNotification({
      examId,
      teacherId: exam.teacherId,
      studentId,
      cohort,
      parentPhone: phone,
      body,
      status: 'scheduled',
      skipReason: null,
      readyAt: now,
      immediate: true,
    });
  }
  if (!row) throw new HttpError(409, 'الرسالة متسجلة بالفعل');
  await placePending(store, now);
  const fresh = await store.findNotification(examId, studentId, cohort);
  if (!fresh?.jobId) throw new HttpError(429, 'الرسالة اتأجلت بسبب الحد اليومي أو عدم وجود رقم جاهز');
  return {
    jobId: fresh.jobId,
    scheduledAt: fresh.scheduledAt,
    notificationId: fresh.id,
  };
}

export async function sendCohorts(
  store: ParentsExamStore,
  examId: number,
  flags: { passed?: boolean; failed?: boolean; absent?: boolean },
): Promise<{ inserted: number; skipped: number; duplicates: number }> {
  const service = await store.getService();
  if (!service) throw new HttpError(404, 'إعدادات الإرسال غير موجودة');
  if (!flags.passed && !flags.failed && !flags.absent) {
    throw new HttpError(400, 'اختار حالة واحدة على الأقل');
  }
  const exam = await store.getExam(examId);
  if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
  const prefs = await store.getTeacherPrefs(exam.teacherId);
  if (!exam.enabled) throw new HttpError(400, 'إشعارات الامتحان متوقفة');
  const now = store.now();
  const closed = isExamClosed(exam, now);
  const audience = await store.loadAudience(examId);
  let inserted = 0;
  let skipped = 0;
  let duplicates = 0;
  for (const student of audience) {
    const cohort = standingOf(student, prefs.pass_percentage);
    if (cohort === 'in_progress') continue;
    if (cohort === 'passed' && !flags.passed) continue;
    if (cohort === 'failed' && !flags.failed) continue;
    if (cohort === 'absent' && (!flags.absent || !closed)) continue;
    const result = await recordStudent(
      store,
      exam,
      student,
      cohort,
      now,
      false,
      templateForCohort(prefs, cohort),
    );
    if (result === 'inserted') inserted += 1;
    else if (result === 'skipped') skipped += 1;
    else duplicates += 1;
  }
  await placePending(store, now);
  return { inserted, skipped, duplicates };
}

export async function sendMissing(
  store: ParentsExamStore,
  examId: number,
): Promise<{ prepared: number; placed: number; alreadySent: number; skipped: number; notReady: number }> {
  const exam = await store.getExam(examId);
  if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
  const prefs = await store.getTeacherPrefs(exam.teacherId);
  const now = store.now();
  const closed = isExamClosed(exam, now);
  const audience = await store.loadAudience(examId);
  const notifications = await store.listNotifications(examId);
  let prepared = 0;
  let alreadySent = 0;
  let skipped = 0;
  let notReady = 0;

  for (const student of audience) {
    const cohort = standingOf(student, prefs.pass_percentage);
    if (cohort === 'in_progress' || (cohort === 'absent' && !closed)) {
      notReady += 1;
      continue;
    }
    const received = notifications.some(
      (row) => row.studentId === student.studentId && row.status === 'sent',
    );
    if (received) {
      alreadySent += 1;
      continue;
    }
    const row = notifications.find(
      (item) => item.studentId === student.studentId && item.cohort === cohort,
    );
    if (row?.status === 'scheduled') {
      prepared += 1;
      continue;
    }
    if (row?.status === 'cancelled') {
      const phone = canonicalParentPhone(student.parentPhone);
      if (!phone) {
        skipped += 1;
        continue;
      }
      await store.reopenNotification(row.id, {
        parentPhone: phone,
        body: renderParentExamMessage({
          cohort,
          studentName: student.studentName,
          examTitle: exam.title,
          score: student.obtained,
          total: student.total,
          template: templateForCohort(prefs, cohort),
        }),
        readyAt: now,
        immediate: false,
      });
      prepared += 1;
      continue;
    }
    if (row?.status === 'skipped') {
      skipped += 1;
      continue;
    }
    const result = await recordStudent(
      store,
      exam,
      student,
      cohort,
      now,
      false,
      templateForCohort(prefs, cohort),
    );
    if (result === 'inserted') prepared += 1;
    else if (result === 'skipped') skipped += 1;
    else alreadySent += 1;
  }

  const placed = await placePending(store, now, examId);
  return { prepared, placed, alreadySent, skipped, notReady };
}

export async function previewExam(store: ParentsExamStore, examId: number) {
  const exam = await store.getExam(examId);
  if (!exam) throw new HttpError(404, 'الامتحان غير موجود');
  const prefs = await store.getTeacherPrefs(exam.teacherId);
  const pass = prefs.pass_percentage;
  const now = store.now();
  const audience = await store.loadAudience(examId);
  const notifications = await store.listNotifications(examId);
  const counts = {
    passed: 0,
    failed: 0,
    absent: 0,
    inProgress: 0,
    missingPhone: 0,
    scheduled: notifications.filter((n) => n.status === 'scheduled').length,
    sent: notifications.filter((n) => n.status === 'sent').length,
    skipped: notifications.filter((n) => n.status === 'skipped').length,
  };
  const samples: Record<ExamCohort, Array<{ studentId: number; studentName: string; parentPhone: string | null }>> = {
    passed: [],
    failed: [],
    absent: [],
  };
  for (const student of audience) {
    const cohort = standingOf(student, pass);
    if (cohort === 'in_progress') {
      counts.inProgress += 1;
      continue;
    }
    counts[cohort] += 1;
    if (!canonicalParentPhone(student.parentPhone)) counts.missingPhone += 1;
    if (samples[cohort].length < 8) {
      samples[cohort].push({
        studentId: student.studentId,
        studentName: student.studentName,
        parentPhone: student.parentPhone,
      });
    }
  }
  return {
    exam,
    closed: isExamClosed(exam, now),
    passPercentage: pass,
    counts,
    samples,
  };
}

export async function getSettingsView(store: ParentsExamStore) {
  const service = await store.getService();
  if (!service) throw new HttpError(404, 'خدمة إشعارات أولياء الأمور غير موجودة');
  const now = store.now();
  const start = dayStart(now, service.config.quiet_hours.tz);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const sentToday = await store.sentOnDay(start, end);
  const placedToday = await store.countPlacedOnDay(null, start, end);
  return {
    serviceId: service.id,
    isEnabled: service.isEnabled,
    readySessions: service.readySessions,
    config: service.config,
    sentToday,
    placedToday,
    dailyCap: service.config.daily_cap,
    upcoming: await store.upcoming(15),
  };
}

export async function saveSettings(
  store: ParentsExamStore,
  patch: Partial<ParentsExamConfig> & { quiet_hours?: Partial<ParentsExamConfig['quiet_hours']> },
) {
  const service = await store.getService();
  if (!service) throw new HttpError(404, 'خدمة إشعارات أولياء الأمور غير موجودة');
  const next = mergeParentsExamConfig(service.config, patch);
  await store.saveConfig(next);
  return getSettingsView(store);
}

export function queueViewFromSettings(settings: Awaited<ReturnType<typeof getSettingsView>>) {
  return {
    sentToday: settings.sentToday,
    placedToday: settings.placedToday,
    dailyCap: settings.config.daily_cap,
    upcoming: settings.upcoming,
  };
}
