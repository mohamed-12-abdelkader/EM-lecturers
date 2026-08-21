import { randomUUID } from 'node:crypto';
import { HttpError } from '../../../utils';
import { ActivityLogsRepository } from '../repositories/activityLogs.repository';
import { ExamsRepository } from '../repositories/exams.repository';
import { GroupsRepository } from '../repositories/groups.repository';
import { StudentsRepository } from '../repositories/students.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import type { SubscriptionStatus } from '../types';
import { PublicStudentCardService } from './publicStudentCard.service';
import { buildStudentQr } from '../utils/studentQr';

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export class GroupsService {
  static async create(
    teacherId: number,
    actorUserId: number,
    input: {
      name: string;
      grade_id?: number | null;
      subject_id?: number | null;
      days: string[];
      start_time?: string | null;
      end_time?: string | null;
      monthly_fee: number;
      study_start_date?: string | null;
      notes?: string | null;
      status?: 'active' | 'paused';
    },
  ) {
    const group = await GroupsRepository.create({
      teacherId,
      name: input.name.trim(),
      gradeId: input.grade_id,
      subjectId: input.subject_id,
      days: input.days,
      startTime: input.start_time,
      endTime: input.end_time,
      monthlyFee: input.monthly_fee,
      studyStartDate: input.study_start_date,
      notes: input.notes,
      status: input.status,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'group.create',
      entityType: 'tc_groups',
      entityId: group.id,
      meta: { name: group.name },
    });

    return GroupsRepository.findById(group.id, teacherId);
  }

  static async update(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    input: Partial<{
      name: string;
      grade_id: number | null;
      subject_id: number | null;
      days: string[];
      start_time: string | null;
      end_time: string | null;
      monthly_fee: number;
      study_start_date: string | null;
      notes: string | null;
      status: 'active' | 'paused';
    }>,
  ) {
    const existing = await GroupsRepository.findById(groupId, teacherId);
    if (!existing) throw new HttpError(404, 'المجموعة غير موجودة');

    const updated = await GroupsRepository.update(groupId, teacherId, {
      name: input.name?.trim(),
      gradeId: input.grade_id,
      subjectId: input.subject_id,
      days: input.days,
      startTime: input.start_time,
      endTime: input.end_time,
      monthlyFee: input.monthly_fee,
      studyStartDate: input.study_start_date,
      notes: input.notes,
      status: input.status,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'group.update',
      entityType: 'tc_groups',
      entityId: groupId,
    });

    return updated;
  }

  static async remove(teacherId: number, actorUserId: number, groupId: number) {
    const ok = await GroupsRepository.softDelete(groupId, teacherId);
    if (!ok) throw new HttpError(404, 'المجموعة غير موجودة');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'group.delete',
      entityType: 'tc_groups',
      entityId: groupId,
    });

    return { success: true };
  }

  static list(teacherId: number, opts: Parameters<typeof GroupsRepository.list>[1]) {
    return GroupsRepository.list(teacherId, opts);
  }

  static get(teacherId: number, groupId: number) {
    return GroupsRepository.findById(groupId, teacherId);
  }
}

export class StudentsService {
  static async createInGroup(
    teacherId: number,
    actorUserId: number,
    groupId: number,
    input: {
      full_name: string;
      phone: string;
      parent_phone?: string | null;
      notes?: string | null;
      payment_status?: SubscriptionStatus;
      amount_paid?: number;
      exemption_reason?: string | null;
    },
  ) {
    const group = await GroupsRepository.findById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    // Allocate per-group id first so student_code starts at 1 inside this group
    const memberNo = await StudentsRepository.nextGroupMemberNo(groupId);

    const student = await StudentsRepository.create({
      teacherId,
      fullName: input.full_name.trim(),
      phone: input.phone.trim(),
      parentPhone: input.parent_phone?.trim() || null,
      notes: input.notes,
      studentCode: String(memberNo),
    });

    const enrollment = await StudentsRepository.enrollWithMemberNo(student.id, groupId, memberNo);

    const qrToken = randomUUID();
    const card = await PublicStudentCardService.getByStudentId(student.id, teacherId);
    const { payload, qrImageBase64 } = await buildStudentQr(qrToken, card);
    await StudentsRepository.upsertQr({
      studentId: student.id,
      qrToken,
      qrPayload: payload,
      qrImageBase64,
      barcode: String(memberNo),
    });

    // إنشاء اشتراك الشهر الحالي إن وُجد شهر مفتوح أو دائماً
    const { year, month } = currentYearMonth();
    const status = input.payment_status ?? 'unpaid';
    const amountDue = Number(group.monthly_fee);
    let amountPaid = 0;
    if (status === 'paid') amountPaid = amountDue;
    else if (status === 'partial') amountPaid = Math.min(input.amount_paid ?? 0, amountDue);
    else if (status === 'exempt') amountPaid = 0;

    await SubscriptionsRepository.openMonth({
      teacherId,
      year,
      month,
      openedBy: actorUserId,
    });

    await SubscriptionsRepository.upsertSubscription({
      teacherId,
      studentId: student.id,
      groupId,
      year,
      month,
      status,
      amountDue,
      amountPaid,
      exemptionReason: status === 'exempt' ? input.exemption_reason ?? null : null,
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'student.create',
      entityType: 'tc_students',
      entityId: student.id,
      meta: {
        group_id: groupId,
        full_name: student.full_name,
        group_student_id: memberNo,
        member_no: memberNo,
      },
    });

    const detail = await StudentsRepository.findById(student.id, teacherId);
    return {
      ...detail!,
      group_student_id: enrollment.member_no ?? memberNo,
      member_no: enrollment.member_no ?? memberNo,
      student_code: String(enrollment.member_no ?? memberNo),
    };
  }

  static async update(
    teacherId: number,
    actorUserId: number,
    studentId: number,
    input: Partial<{
      full_name: string;
      phone: string | null;
      parent_phone: string | null;
      notes: string | null;
      is_active: boolean;
    }>,
  ) {
    const updated = await StudentsRepository.update(studentId, teacherId, {
      fullName: input.full_name?.trim(),
      phone: input.phone === undefined ? undefined : input.phone?.trim() || null,
      parentPhone: input.parent_phone === undefined ? undefined : input.parent_phone?.trim() || null,
      notes: input.notes,
      isActive: input.is_active,
    });
    if (!updated) throw new HttpError(404, 'الطالب غير موجود');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'student.update',
      entityType: 'tc_students',
      entityId: studentId,
    });

    return StudentsRepository.findById(studentId, teacherId);
  }

  static async remove(teacherId: number, actorUserId: number, studentId: number) {
    const ok = await StudentsRepository.softDelete(studentId, teacherId);
    if (!ok) throw new HttpError(404, 'الطالب غير موجود');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'student.delete',
      entityType: 'tc_students',
      entityId: studentId,
    });

    return { success: true };
  }

  static list(teacherId: number, opts: Parameters<typeof StudentsRepository.list>[1]) {
    return StudentsRepository.list(teacherId, opts);
  }

  static async get(teacherId: number, studentId: number) {
    const student = await StudentsRepository.findById(studentId, teacherId);
    if (!student) return null;
    const exams = await ExamsRepository.listByStudent(studentId, teacherId);
    return { ...student, exams };
  }

  static listByGroup(teacherId: number, groupId: number) {
    return StudentsRepository.listByGroup(groupId, teacherId);
  }

  static async enroll(teacherId: number, actorUserId: number, studentId: number, groupId: number) {
    const student = await StudentsRepository.findById(studentId, teacherId);
    if (!student) throw new HttpError(404, 'الطالب غير موجود');
    const group = await GroupsRepository.findById(groupId, teacherId);
    if (!group) throw new HttpError(404, 'المجموعة غير موجودة');

    const enrollment = await StudentsRepository.enroll(studentId, groupId);

    const { year, month } = currentYearMonth();
    await SubscriptionsRepository.openMonth({ teacherId, year, month, openedBy: actorUserId });
    await SubscriptionsRepository.upsertSubscription({
      teacherId,
      studentId,
      groupId,
      year,
      month,
      status: 'unpaid',
      amountDue: Number(group.monthly_fee),
    });

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'student.enroll',
      entityType: 'tc_student_groups',
      entityId: enrollment.id,
      meta: { student_id: studentId, group_id: groupId },
    });

    return enrollment;
  }

  static async unenroll(teacherId: number, actorUserId: number, studentId: number, groupId: number) {
    const ok = await StudentsRepository.unenroll(studentId, groupId, teacherId);
    if (!ok) throw new HttpError(404, 'الطالب غير مسجل في هذه المجموعة');

    await ActivityLogsRepository.log({
      teacherId,
      actorUserId,
      action: 'student.unenroll',
      entityType: 'tc_student_groups',
      meta: { student_id: studentId, group_id: groupId },
    });

    return { success: true };
  }

  static async getQr(teacherId: number, studentId: number) {
    const student = await StudentsRepository.findById(studentId, teacherId);
    if (!student) throw new HttpError(404, 'الطالب غير موجود');

    const existing = await StudentsRepository.getQr(studentId, teacherId);
    const qrToken = existing?.qr_token || randomUUID();
    const card = await PublicStudentCardService.getByStudentId(studentId, teacherId);
    const { payload, qrImageBase64 } = await buildStudentQr(qrToken, card);
    const qr = await StudentsRepository.upsertQr({
      studentId,
      qrToken,
      qrPayload: payload,
      qrImageBase64,
      barcode: student.student_code,
    });
    if (!qr) throw new HttpError(500, 'تعذر إنشاء رمز QR');

    return {
      student_id: student.id,
      student_code: student.student_code,
      full_name: student.full_name,
      qr_token: qr.qr_token,
      qr_payload: qr.qr_payload,
      qr_image_base64: qr.qr_image_base64,
      barcode: qr.barcode,
    };
  }
}
