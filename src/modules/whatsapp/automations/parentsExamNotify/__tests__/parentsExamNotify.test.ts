import { describe, expect, it } from 'vitest';

import { classifyStudent, isExamClosed, shouldAutoNotify } from '../cohorts';
import { safeNotifyFinalized, notifyFinalizedAttempt, sweepClosedExams, testSend, sendMissing } from '../engine';
import { MemoryParentsExamStore } from '../memoryStore';
import type { ExamState, StudentState } from '../store';
import { canonicalParentPhone } from '../phone';
import { dayStart, nextScheduledAt, zonedParts, zonedTimeToUtc } from '../schedule';
import { DEFAULT_PARENTS_EXAM_CONFIG } from '../settings';
import { DEFAULT_TEACHER_EXAM_PREFS } from '../settings';
import { renderParentExamMessage } from '../templates';
import { onParentsExamInbound } from '../handler';
import { selectOutboundClaim } from '../../../queue/selectOutboundClaim';
import { decideOwnedSession } from '../parentExamSession';

function exam(partial: Partial<ExamState> = {}): ExamState {
  return {
    id: 7,
    title: 'امتحان شامل',
    scope: 'course',
    isActive: true,
    visibilityEnd: null,
    enabled: true,
    paused: false,
    absentSweptAt: null,
    courseTitle: 'فيزياء',
    teacherId: 1,
    ...partial,
  };
}

function student(partial: Partial<StudentState> = {}): StudentState {
  return {
    studentId: 1,
    studentName: 'أحمد',
    parentPhone: '01001234567',
    attemptStatus: 'submitted',
    obtained: 8,
    total: 10,
    ...partial,
  };
}

function openStore() {
  const store = new MemoryParentsExamStore();
  store.seedExam(exam(), [
    student(),
    student({
      studentId: 2,
      studentName: 'منى',
      parentPhone: '01007654321',
      obtained: 2,
      total: 10,
    }),
    student({
      studentId: 3,
      studentName: 'سامي',
      parentPhone: '01001112233',
      attemptStatus: 'in_progress',
      obtained: null,
      total: null,
    }),
    student({
      studentId: 4,
      studentName: 'ليلى',
      parentPhone: '01005556677',
      attemptStatus: 'none',
      obtained: null,
      total: null,
    }),
    student({
      studentId: 5,
      studentName: 'بدون',
      parentPhone: 'abc',
      attemptStatus: 'none',
      obtained: null,
      total: null,
    }),
  ]);
  return store;
}

describe('parent exam templates and cohorts', () => {
  it('renders short Egyptian Arabic copy', () => {
    expect(
      renderParentExamMessage({ cohort: 'absent', studentName: 'أحمد', examTitle: 'الشامل' }),
    ).toBe('ولي أمر أحمد، أحمد ما دخلش امتحان «الشامل» خالص.');
    expect(
      renderParentExamMessage({
        cohort: 'failed',
        studentName: 'منى',
        examTitle: 'الشامل',
        score: 2,
        total: 10,
      }),
    ).toContain('للأسف ما نجحش');
    expect(
      renderParentExamMessage({
        cohort: 'passed',
        studentName: 'أحمد',
        examTitle: 'الشامل',
        score: 8,
        total: 10,
      }),
    ).toContain('ألف مبروك، نجح');
    expect(
      renderParentExamMessage({
        cohort: 'passed',
        studentName: 'أحمد',
        examTitle: 'الشامل',
        score: 8,
        total: 10,
        template: 'نتيجة {الاسم} في {الامتحان} هي {الدرجة} من {المجموع}',
      }),
    ).toBe('نتيجة أحمد في الشامل هي 8 من 10');
  });

  it('classifies submitted, in-progress, and never-started separately', () => {
    expect(
      classifyStudent({ attemptStatus: 'submitted', obtained: 8, total: 10, passPercentage: 50 }),
    ).toBe('passed');
    expect(
      classifyStudent({ attemptStatus: 'submitted', obtained: 2, total: 10, passPercentage: 50 }),
    ).toBe('failed');
    expect(
      classifyStudent({ attemptStatus: 'in_progress', obtained: null, total: null, passPercentage: 50 }),
    ).toBe('in_progress');
    expect(
      classifyStudent({ attemptStatus: 'none', obtained: null, total: null, passPercentage: 50 }),
    ).toBe('absent');
  });

  it('does not auto-notify an open exam absence or an in-progress attempt', () => {
    expect(isExamClosed({ isActive: true, visibilityEnd: new Date('2099-01-01') }, new Date())).toBe(
      false,
    );
    expect(
      shouldAutoNotify({
        serviceEnabled: true,
        autoSend: true,
        examEnabled: true,
        cohort: 'absent',
        cohortEnabled: true,
        examClosed: false,
        alreadyRecorded: false,
      }),
    ).toBe(false);
    expect(
      shouldAutoNotify({
        serviceEnabled: true,
        autoSend: true,
        examEnabled: true,
        cohort: 'in_progress',
        cohortEnabled: true,
        examClosed: true,
        alreadyRecorded: false,
      }),
    ).toBe(false);
    expect(canonicalParentPhone('01001234567')).toBe('201001234567');
    expect(canonicalParentPhone('abc')).toBeNull();
  });
});

describe('parent exam schedule', () => {
  const quietOff = { ...DEFAULT_PARENTS_EXAM_CONFIG.quiet_hours, enabled: false };

  it('keeps gaps inside the interval and jitter window', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    const zero = nextScheduledAt({
      now,
      lastSlot: now,
      intervalSeconds: 30,
      jitterSeconds: 10,
      quietHours: quietOff,
      random: () => 0,
      dailyCount: 0,
      dailyCap: 10,
    });
    const full = nextScheduledAt({
      now,
      lastSlot: now,
      intervalSeconds: 30,
      jitterSeconds: 10,
      quietHours: quietOff,
      random: () => 0.999,
      dailyCount: 0,
      dailyCap: 10,
    });
    expect(zero.ok && full.ok).toBe(true);
    if (!zero.ok || !full.ok) return;
    expect(zero.at.getTime() - now.getTime()).toBe(30_000);
    expect(full.at.getTime() - now.getTime()).toBe(40_000);
  });

  it('spaces 50 recipients onto distinct times', () => {
    const now = new Date('2026-10-23T10:00:00.000Z');
    let last: Date | null = null;
    const stamps: number[] = [];
    for (let i = 0; i < 50; i += 1) {
      const slot = nextScheduledAt({
        now,
        lastSlot: last,
        intervalSeconds: 30,
        jitterSeconds: 10,
        quietHours: quietOff,
        random: () => (i % 3) / 3,
        dailyCount: i,
        dailyCap: 400,
      });
      expect(slot.ok).toBe(true);
      if (!slot.ok) return;
      stamps.push(slot.at.getTime());
      last = slot.at;
    }
    expect(new Set(stamps).size).toBe(50);
  });

  it('moves a quiet-hours slot to the next open minute and stops at the daily cap', () => {
    const now = zonedTimeToUtc(2026, 10, 23, 23, 30, 'Africa/Cairo');
    const slot = nextScheduledAt({
      now,
      lastSlot: null,
      intervalSeconds: 30,
      jitterSeconds: 0,
      quietHours: { enabled: true, start: '23:00', end: '08:00', tz: 'Africa/Cairo' },
      random: () => 0,
      dailyCount: 0,
      dailyCap: 10,
    });
    expect(slot.ok).toBe(true);
    if (!slot.ok) return;
    const parts = zonedParts(slot.at, 'Africa/Cairo');
    expect(parts.hour).toBe(8);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(24);

    const capped = nextScheduledAt({
      now,
      lastSlot: null,
      intervalSeconds: 30,
      jitterSeconds: 0,
      quietHours: quietOff,
      dailyCount: 400,
      dailyCap: 400,
    });
    expect(capped).toEqual({ ok: false, reason: 'capped' });
    const unlimited = nextScheduledAt({
      now,
      lastSlot: null,
      intervalSeconds: 30,
      jitterSeconds: 0,
      quietHours: quietOff,
      dailyCount: 5000,
      dailyCap: 0,
    });
    expect(unlimited.ok).toBe(true);
    expect(dayStart(now, 'Africa/Cairo').getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

describe('parent exam notify engine', () => {
  it('enqueues one paced job on submit and ignores a second finalize', async () => {
    const store = openStore();
    const first = await notifyFinalizedAttempt(store, 7, 1);
    const second = await notifyFinalizedAttempt(store, 7, 1);
    expect(first).toBe('enqueued');
    expect(second).toBe('ignored');
    expect(store.jobs).toHaveLength(1);
    expect(store.notifications.filter((row) => row.studentId === 1)).toHaveLength(1);
    expect(store.jobs[0].scheduledAt.getTime()).toBeGreaterThan(store.now().getTime());
  });

  it('queues the teacher message for passed, failed, and absent', async () => {
    const store = openStore();
    store.teacherPrefs.set(1, {
      ...DEFAULT_TEACHER_EXAM_PREFS,
      auto_send: true,
      notify_passed: true,
      notify_failed: true,
      notify_absent: true,
      template_passed: 'نجح {الاسم} في {الامتحان} بـ {الدرجة}/{المجموع}',
      template_failed: 'رسب {الاسم} في {الامتحان} بـ {الدرجة}/{المجموع}',
      template_absent: '{الاسم} ما دخلش {الامتحان}',
    });
    await notifyFinalizedAttempt(store, 7, 1);
    await notifyFinalizedAttempt(store, 7, 2);
    store.exams.get(7)!.isActive = false;
    await sweepClosedExams(store);
    expect(store.jobs.find((job) => job.studentId === 1)?.body).toBe(
      'نجح أحمد في امتحان شامل بـ 8/10',
    );
    expect(store.jobs.find((job) => job.studentId === 2)?.body).toBe(
      'رسب منى في امتحان شامل بـ 2/10',
    );
    expect(store.jobs.find((job) => job.studentId === 4)?.body).toBe('ليلى ما دخلش امتحان شامل');

    const testStore = openStore();
    testStore.teacherPrefs.set(1, {
      ...DEFAULT_TEACHER_EXAM_PREFS,
      template_passed: 'نجح {الاسم} في {الامتحان} بـ {الدرجة}/{المجموع}',
    });
    const test = await testSend(testStore, 7, 1, 'passed');
    expect(testStore.jobs.find((job) => job.id === test.jobId)?.body).toBe(
      'نجح أحمد في امتحان شامل بـ 8/10',
    );
  });

  it('does not enqueue an in-progress student', async () => {
    const store = openStore();
    expect(await notifyFinalizedAttempt(store, 7, 3)).toBe('ignored');
    expect(store.jobs).toHaveLength(0);
  });

  it('skips an invalid parent phone without creating a job', async () => {
    const store = openStore();
    store.students.get(7)![0] = student({ parentPhone: 'abc', attemptStatus: 'submitted' });
    expect(await notifyFinalizedAttempt(store, 7, 1)).toBe('skipped');
    expect(store.jobs).toHaveLength(0);
    expect(store.notifications[0].status).toBe('skipped');
    expect(store.notifications[0].skipReason).toBe('invalid_phone');
  });

  it('does not enqueue absences while the exam is still open', async () => {
    const store = openStore();
    store.exams.get(7)!.visibilityEnd = new Date('2099-01-01T00:00:00.000Z');
    const result = await sweepClosedExams(store);
    expect(result.inserted).toBe(0);
    expect(store.notifications.filter((row) => row.cohort === 'absent')).toHaveLength(0);
  });

  it('enqueues absences once after the exam closes', async () => {
    const store = openStore();
    store.exams.get(7)!.isActive = false;
    const first = await sweepClosedExams(store);
    const absent = store.notifications.filter((row) => row.cohort === 'absent');
    expect(first.inserted).toBe(1);
    expect(absent.map((row) => row.studentId).sort()).toEqual([4, 5]);
    expect(absent.find((row) => row.studentId === 4)?.jobId).not.toBeNull();
    expect(store.notifications.some((row) => row.studentId === 5 && row.status === 'skipped')).toBe(
      true,
    );
    const before = store.notifications.length;
    const second = await sweepClosedExams(store);
    expect(second.inserted).toBe(0);
    expect(store.notifications).toHaveLength(before);
  });

  it('does not create a second job when the daily cap is already hit', async () => {
    const store = openStore();
    store.service!.config.daily_cap = 1;
    await notifyFinalizedAttempt(store, 7, 1);
    await notifyFinalizedAttempt(store, 7, 2);
    expect(store.jobs).toHaveLength(1);
    expect(store.notifications.filter((row) => row.jobId == null && row.status === 'scheduled')).toHaveLength(
      1,
    );
  });

  it('sends a single immediate test message', async () => {
    const store = openStore();
    const result = await testSend(store, 7, 1, 'passed');
    expect(store.jobs).toHaveLength(1);
    expect(result.jobId).toBe(store.jobs[0].id);
    expect(store.jobs[0].sessionSlug).toBe('t1-01');
    expect(store.jobs[0].immediate).toBe(true);
    expect(store.jobs[0].scheduledAt.getTime()).toBe(store.now().getTime());
  });

  it('still returns when the notify hook throws', async () => {
    const store = openStore();
    store.failGetService = true;
    await expect(safeNotifyFinalized(store, 7, 1)).resolves.toBeUndefined();
  });

  it('does not enqueue when the teacher turns auto-send off', async () => {
    const store = openStore();
    store.teacherPrefs.set(1, {
      ...DEFAULT_TEACHER_EXAM_PREFS,
      auto_send: false,
      notify_passed: true,
      notify_failed: true,
      notify_absent: true,
    });
    expect(await notifyFinalizedAttempt(store, 7, 1)).toBe('ignored');
    expect(store.jobs).toHaveLength(0);
  });

  it('does not enqueue a muted exam', async () => {
    const store = openStore();
    store.exams.get(7)!.enabled = false;
    expect(await notifyFinalizedAttempt(store, 7, 1)).toBe('ignored');
    expect(store.jobs).toHaveLength(0);
  });

  it('sends missing parent messages for a muted past exam and skips anyone already sent', async () => {
    const store = openStore();
    store.exams.get(7)!.enabled = false;
    store.teacherPrefs.set(1, { ...DEFAULT_TEACHER_EXAM_PREFS, auto_send: false });
    const first = await sendMissing(store, 7);
    expect(first.placed).toBe(2);
    expect(store.jobs.map((job) => job.studentId).sort()).toEqual([1, 2]);
    store.notifications.find((row) => row.studentId === 1)!.status = 'sent';
    const second = await sendMissing(store, 7);
    expect(second.alreadySent).toBe(1);
    expect(second.notReady).toBeGreaterThan(0);
    expect(store.jobs.filter((job) => job.studentId === 1)).toHaveLength(1);
    store.exams.get(7)!.isActive = false;
    const afterClose = await sendMissing(store, 7);
    expect(store.jobs.some((job) => job.studentId === 4)).toBe(true);
    expect(store.jobs.some((job) => job.studentId === 5)).toBe(false);
    expect(afterClose.placed).toBeGreaterThan(0);
  });

  it('schedules again after a scheduled parent message is removed', async () => {
    const store = openStore();
    await notifyFinalizedAttempt(store, 7, 1);
    expect(store.notifications.filter((row) => row.studentId === 1)).toHaveLength(1);
    store.notifications = store.notifications.filter((row) => row.studentId !== 1);
    store.jobs = store.jobs.filter((job) => job.studentId !== 1);
    const again = await sendMissing(store, 7);
    expect(again.placed).toBeGreaterThan(0);
    expect(
      store.notifications.some((row) => row.studentId === 1 && row.status === 'scheduled'),
    ).toBe(true);
  });

  it('paces each teacher on their own number and cap', async () => {
    const store = openStore();
    store.service!.config.daily_cap = 1;
    store.teacherPrefs.set(2, {
      ...DEFAULT_TEACHER_EXAM_PREFS,
      auto_send: true,
      notify_passed: true,
      notify_absent: false,
    });
    store.seedExam(
      exam({ id: 8, teacherId: 2, title: 'امتحان تاني' }),
      [student({ studentId: 9, studentName: 'كريم', parentPhone: '01009876543' })],
    );
    await notifyFinalizedAttempt(store, 7, 1);
    await notifyFinalizedAttempt(store, 7, 2);
    await notifyFinalizedAttempt(store, 8, 9);
    expect(store.jobs.map((job) => job.sessionSlug).sort()).toEqual(['t1-01', 't2-01']);
    expect(store.jobs.filter((job) => job.sessionSlug === 't1-01')).toHaveLength(1);
    expect((await store.listExams(2)).map((row) => row.id)).toEqual([8]);
  });
});

describe('parents exam pace gate and inbound', () => {
  it('claims one paced job per session and still batches other services', () => {
    const others = [1, 2, 3, 4, 5].map((id) => ({
      id,
      sessionSlug: 'support',
      serviceKey: 'technical_support_bot',
      scheduledAt: id,
    }));
    const paced = [10, 11, 12, 13].map((id) => ({
      id,
      sessionSlug: 'parents-01',
      serviceKey: 'parents_exam_notify',
      scheduledAt: id,
    }));
    const claimed = selectOutboundClaim([...paced, ...others], {
      batchSize: 3,
      pacedServiceKey: 'parents_exam_notify',
    });
    expect(claimed.filter((job) => job.serviceKey === 'technical_support_bot')).toHaveLength(3);
    expect(claimed.filter((job) => job.serviceKey === 'parents_exam_notify')).toEqual([
      expect.objectContaining({ id: 10 }),
    ]);

    const twoSessions = selectOutboundClaim(
      [
        { id: 1, sessionSlug: 'a', serviceKey: 'parents_exam_notify', scheduledAt: 2 },
        { id: 2, sessionSlug: 'a', serviceKey: 'parents_exam_notify', scheduledAt: 1 },
        { id: 3, sessionSlug: 'b', serviceKey: 'parents_exam_notify', scheduledAt: 1 },
        { id: 4, sessionSlug: 'support', serviceKey: 'other', scheduledAt: 1 },
      ],
      { batchSize: 5, pacedServiceKey: 'parents_exam_notify' },
    );
    expect(twoSessions.map((job) => job.id).sort()).toEqual([2, 3, 4]);
  });

  it('handles a parent reply without sending anything back', async () => {
    const result = await onParentsExamInbound({
      sessionSlug: 'parents-01',
      fromPhone: '201001234567',
      body: 'تمام',
      waMessageId: 'm1',
      eventType: 'message.inbound',
      metadata: {},
      service: null,
      conversation: null,
    });
    expect(result).toEqual({ handled: true });
    expect(result.reply).toBeUndefined();
  });

  it('keeps a parent exam message on that teacher’s own ready session', () => {
    expect(
      decideOwnedSession({
        parentExam: true,
        teacherId: 21,
        jobSlug: 't21-01',
        slugReady: true,
        current: { sessionSlug: 't1290-01', serviceId: 2 },
      }),
    ).toEqual({ action: 'keep', slug: 't21-01' });

    expect(
      decideOwnedSession({
        parentExam: true,
        teacherId: 21,
        jobSlug: 't21-01',
        slugReady: false,
        current: { sessionSlug: 't21-02', serviceId: 2 },
      }),
    ).toEqual({ action: 'move', slug: 't21-02', serviceId: 2 });

    expect(
      decideOwnedSession({
        parentExam: true,
        teacherId: 21,
        jobSlug: 't21-01',
        slugReady: false,
        current: null,
      }),
    ).toEqual({ action: 'wait' });

    expect(
      decideOwnedSession({
        parentExam: false,
        teacherId: null,
        jobSlug: 'support-01',
        slugReady: false,
        current: null,
      }),
    ).toEqual({ action: 'keep', slug: 'support-01' });
  });
});
