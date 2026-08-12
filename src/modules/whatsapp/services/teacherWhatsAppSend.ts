import pool from '../../../db/pool';
import { SessionPoolService } from '../routing/sessionPool.service';
import { WhatsAppOutboundQueue } from '../queue/whatsappOutboundQueue';

export type TeacherSendResult = {
  jobId: number;
  sessionSlug: string;
  serviceId: number;
  toPhone: string;
};

/**
 * Enqueue an outbound WhatsApp message using only the teacher's ready sessions.
 */
export class TeacherWhatsAppSend {
  static async enqueue(
    teacherId: number,
    serviceKey: string,
    toPhone: string,
    body: string,
    metadata: Record<string, unknown> = {},
  ): Promise<TeacherSendResult> {
    const { sessionSlug, serviceId } = await SessionPoolService.pickSessionForTeacher(
      serviceKey,
      teacherId,
      toPhone,
    );

    const tenantRes = await pool.query<{ tenant_id: number | null }>(
      `SELECT tenant_id FROM users WHERE id = $1`,
      [teacherId],
    );
    const tenantId = tenantRes.rows[0]?.tenant_id ?? null;

    const jobId = await WhatsAppOutboundQueue.enqueue({
      sessionSlug,
      to: toPhone,
      body,
      serviceId,
      tenantId,
      triggerType: serviceKey,
      triggerRef: `teacher:${teacherId}`,
      metadata: {
        ...metadata,
        teacher_id: teacherId,
        owner: 'teacher',
      },
    });

    return { jobId, sessionSlug, serviceId, toPhone };
  }
}
