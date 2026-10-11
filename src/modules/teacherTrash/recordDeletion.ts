import pool from '../../db/pool';
import { TeacherTrashService } from './trash.service';
import type { RecordTrashSnapshotInput } from './types';

/** يسجّل نسخة قبل الحذف النهائي — لا يرمي خطأ إذا فشل التسجيل */
export async function recordTeacherTrashSnapshot(input: RecordTrashSnapshotInput): Promise<void> {
  try {
    await TeacherTrashService.recordSnapshot(input);
  } catch (err) {
    console.warn('[TeacherTrash] failed to record snapshot', err);
  }
}

export async function snapshotCourseBeforeDelete(
  courseId: number,
  teacherId: number,
  deletedBy?: number,
): Promise<void> {
  const result = await pool.query(`SELECT * FROM courses WHERE id = $1`, [courseId]);
  const row = result.rows[0];
  if (!row) return;

  await recordTeacherTrashSnapshot({
    teacherId,
    tenantId: row.tenant_id ?? null,
    entityType: 'course',
    entityId: courseId,
    title: row.title || `كورس #${courseId}`,
    subtitle: row.description ?? null,
    snapshot: row,
    deletedBy: deletedBy ?? teacherId,
    canRestore: true,
    restoreBlockers: ['PARTIAL_RESTORE'],
  });
}

export async function snapshotLectureBeforeDelete(
  lecture: Record<string, unknown> & { id: number; course_id: number; table_name?: string },
  teacherId: number,
  deletedBy?: number,
): Promise<void> {
  await recordTeacherTrashSnapshot({
    teacherId,
    entityType: 'lecture',
    entityId: lecture.id,
    title: String(lecture.title || `محاضرة #${lecture.id}`),
    subtitle: `كورس #${lecture.course_id}`,
    snapshot: lecture,
    deletedBy: deletedBy ?? teacherId,
    canRestore: true,
    restoreBlockers: ['PARTIAL_RESTORE'],
  });
}

/**
 * يحفظ نسخة كاملة لحساب طالب المنصة قبل/بعد الحذف النهائي لاستعادته لاحقاً.
 * يُفضّل أن يحتوي snapshot على { user, grade_id, group_id, course_group_ids }.
 */
export async function snapshotPlatformStudentBeforeDelete(
  student: Record<string, unknown> & { id: number; name?: string; email?: string; phone?: string },
  teacherId: number,
  tenantId: number,
  deletedBy?: number,
): Promise<void> {
  const user =
    student.user && typeof student.user === 'object'
      ? (student.user as Record<string, unknown>)
      : student;
  const studentId = Number(user.id ?? student.id);
  const name = String(user.name ?? student.name ?? `طالب #${studentId}`);
  const subtitle = String(
    user.student_code ?? student.student_code ?? user.phone ?? student.phone ?? user.email ?? student.email ?? '',
  );

  await recordTeacherTrashSnapshot({
    teacherId,
    tenantId,
    entityType: 'platform_student',
    entityId: studentId,
    title: name,
    subtitle: subtitle || null,
    snapshot: student,
    deletedBy: deletedBy ?? teacherId,
    canRestore: true,
    restoreBlockers: [],
  });
}
