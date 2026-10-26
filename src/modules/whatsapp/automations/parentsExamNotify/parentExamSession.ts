import pool from '../../../../db/pool';
import { SessionPoolService } from '../../routing/sessionPool.service';

export type OwnedSessionDecision =
  | { action: 'keep'; slug: string }
  | { action: 'move'; slug: string; serviceId: number }
  | { action: 'wait' };

/**
 * A parent-exam message may leave only on a ready إشعارات الطلاب session
 * owned by that exam's teacher. A deleted or foreign slug is replaced with
 * the teacher's current session, or the send waits until one exists.
 */
export function decideOwnedSession(input: {
  parentExam: boolean;
  teacherId: number | null;
  jobSlug: string;
  slugReady: boolean;
  current: { sessionSlug: string; serviceId: number } | null;
}): OwnedSessionDecision {
  if (!input.parentExam || input.teacherId == null) {
    return { action: 'keep', slug: input.jobSlug };
  }
  if (input.slugReady) return { action: 'keep', slug: input.jobSlug };
  if (input.current && input.current.sessionSlug !== input.jobSlug) {
    return {
      action: 'move',
      slug: input.current.sessionSlug,
      serviceId: input.current.serviceId,
    };
  }
  return { action: 'wait' };
}

export async function resolveParentExamSendSession(job: {
  id: number;
  session_slug: string;
  to_phone: string;
  trigger_type: string | null;
}): Promise<{ slug: string } | { wait: true }> {
  const parentExam = Boolean(job.trigger_type?.startsWith('parents_exam_'));
  if (!parentExam) return { slug: job.session_slug };

  const note = await pool.query<{ teacher_id: number | null }>(
    `SELECT teacher_id FROM wa_parent_exam_notifications WHERE job_id = $1`,
    [job.id],
  );
  const teacherId = note.rows[0]?.teacher_id ?? null;
  if (teacherId == null) return { slug: job.session_slug };

  const owned = await pool.query(
    `SELECT 1
     FROM wa_sessions s
     JOIN wa_service_sessions ps ON ps.session_slug = s.slug AND ps.is_enabled
     JOIN wa_services sv ON sv.id = ps.service_id AND sv.key = 'teacher_student_notify'
     WHERE s.slug = $1
       AND s.teacher_id = $2
       AND s.is_enabled
       AND s.status = 'ready'`,
    [job.session_slug, teacherId],
  );

  let current: { sessionSlug: string; serviceId: number } | null = null;
  if (!owned.rowCount) {
    try {
      current = await SessionPoolService.pickSessionForTeacher(
        'teacher_student_notify',
        teacherId,
        job.to_phone,
      );
    } catch {
      current = null;
    }
  }

  const decision = decideOwnedSession({
    parentExam: true,
    teacherId,
    jobSlug: job.session_slug,
    slugReady: Boolean(owned.rowCount),
    current,
  });
  if (decision.action === 'wait') return { wait: true };
  if (decision.action === 'move') {
    await pool.query(
      `UPDATE wa_outbound_jobs
       SET session_slug = $2, service_id = $3, last_error = NULL
       WHERE id = $1`,
      [job.id, decision.slug, decision.serviceId],
    );
  }
  return { slug: decision.slug };
}
