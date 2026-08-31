import { HttpError } from '../../utils';
import { TeacherTrashRepository } from './trash.repository';
import type { RecordTrashSnapshotInput, TrashListResult, TrashSummaryItem } from './types';
import { TRASH_TYPE_LABELS } from './types';

export class TeacherTrashService {
  static async list(
    teacherId: number,
    opts: {
      type?: string;
      search?: string;
      page?: number;
      limit?: number;
      includeActivityLog?: boolean;
    } = {},
  ): Promise<TrashListResult> {
    const page = opts.page ?? 1;
    const limit = opts.limit ?? 30;

    const [live, snapshots] = await Promise.all([
      TeacherTrashRepository.listLiveTrash(teacherId, opts),
      TeacherTrashRepository.listSnapshots(teacherId, opts),
    ]);

    let merged = [...live.rows, ...snapshots.rows];

    if (opts.includeActivityLog !== false && !opts.type) {
      const activity = await TeacherTrashRepository.listActivityLogDeletes(teacherId);
      const liveKeys = new Set(
        merged.map((item) => `${item.type}:${item.metadata?.original_entity_id ?? item.id}`),
      );
      for (const item of activity) {
        const key = `${item.type}:${item.metadata?.entity_id ?? item.id}`;
        if (!liveKeys.has(key)) merged.push(item);
      }
    }

    if (opts.search?.trim()) {
      const q = opts.search.trim().toLowerCase();
      merged = merged.filter(
        (item) =>
          item.title.toLowerCase().includes(q) ||
          (item.subtitle ?? '').toLowerCase().includes(q),
      );
    }

    if (opts.type?.trim()) {
      const typeFilter = opts.type.trim();
      merged = merged.filter((item) => item.type === typeFilter);
    }

    merged.sort((a, b) => new Date(b.deletedAt).getTime() - new Date(a.deletedAt).getTime());

    const total = merged.length;
    const offset = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
    const pageLimit = Math.min(100, Math.max(1, limit));
    const items = merged.slice(offset, offset + pageLimit).map((item) => ({
      ...item,
      typeLabel: TRASH_TYPE_LABELS[item.type] ?? item.type,
    }));

    return { items, total, page: Math.max(1, page), limit: pageLimit };
  }

  static async summary(teacherId: number): Promise<TrashSummaryItem[]> {
    const { items } = await this.list(teacherId, {
      limit: 5000,
      page: 1,
      includeActivityLog: false,
    });
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count, label: TRASH_TYPE_LABELS[type] ?? type }))
      .sort((a, b) => b.count - a.count);
  }

  static async restore(
    teacherId: number,
    type: string,
    id: number,
    opts: { source?: 'live' | 'snapshot' } = {},
  ): Promise<{ restored: boolean; type: string; id: number; entityId?: number }> {
    if (opts.source === 'snapshot') {
      return this.restoreSnapshot(teacherId, id);
    }

    if (TeacherTrashRepository.isKnownLiveType(type)) {
      const ok = await this.restoreLive(type, id, teacherId);
      if (!ok) {
        throw new HttpError(404, 'العنصر غير موجود في المحذوفات أو لا يمكن استعادته');
      }
      return { restored: true, type, id };
    }

    return this.restoreSnapshot(teacherId, id);
  }

  private static async restoreLive(type: string, id: number, teacherId: number): Promise<boolean> {
    switch (type) {
      case 'center_group':
        return TeacherTrashRepository.restoreCenterGroup(id, teacherId);
      case 'center_student':
        return TeacherTrashRepository.restoreCenterStudent(id, teacherId);
      case 'center_enrollment':
        return TeacherTrashRepository.restoreCenterEnrollment(id, teacherId);
      case 'center_exam':
        return TeacherTrashRepository.restoreCenterExam(id, teacherId);
      case 'center_payment':
        return TeacherTrashRepository.restoreCenterPayment(id, teacherId);
      case 'center_subscription':
        return TeacherTrashRepository.restoreCenterSubscription(id, teacherId);
      case 'teacher_file':
        return TeacherTrashRepository.restoreTeacherFile(id, teacherId);
      case 'course_file':
        return TeacherTrashRepository.restoreCourseFile(id, teacherId);
      default:
        return false;
    }
  }

  private static async restoreSnapshot(teacherId: number, snapshotId: number) {
    const row = await TeacherTrashRepository.getSnapshot(snapshotId, teacherId);
    if (!row) {
      throw new HttpError(404, 'سجل المحذوفات غير موجود');
    }
    if (!row.can_restore) {
      throw new HttpError(409, 'لا يمكن استعادة هذا العنصر', {
        restore_blockers: row.restore_blockers ?? [],
      });
    }

    const snapshot = (row.snapshot ?? {}) as Record<string, unknown>;
    let entityId: number | null = null;

    switch (row.entity_type) {
      case 'course':
        entityId = await TeacherTrashRepository.restoreCourseFromSnapshot(snapshot, teacherId);
        break;
      case 'lecture':
        entityId = await TeacherTrashRepository.restoreLectureFromSnapshot(snapshot, teacherId);
        break;
      default:
        throw new HttpError(400, `نوع الاستعادة غير مدعوم: ${row.entity_type}`);
    }

    if (!entityId) {
      throw new HttpError(409, 'تعذّرت استعادة العنصر — قد يكون موجوداً بالفعل أو بياناته ناقصة');
    }

    await TeacherTrashRepository.markSnapshotRestored(snapshotId, teacherId);
    return {
      restored: true,
      type: row.entity_type,
      id: snapshotId,
      entityId,
    };
  }

  static async recordSnapshot(input: RecordTrashSnapshotInput): Promise<number> {
    return TeacherTrashRepository.insertSnapshot(input);
  }
}
