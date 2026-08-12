import pool from '../../../../db/pool';
import { logger } from '../../../../utils';
import {
  getTeacherPackage,
  hasPlanFeature,
} from '../../../../services/teacherPlanPolicy';
import { registerWhatsAppHandler } from '../registry';
import {
  listEligibleScientificTeachers,
  resolveStudentByPhone,
  type EligibleScientificTeacher,
} from '../resolveStudent';
import type { HandlerResult, InboundContext, WaConversationRow } from '../types';
import { runStudentScientificBridge } from './bridge';
import {
  formatTeacherPickerMessage,
  isSwitchTeacherCommand,
  parseTeacherSelection,
  teacherSelectedAck,
} from './teacherSelect';

export const STUDENT_SCIENTIFIC_BOT_KEY = 'student_scientific_bot';

const NOT_STUDENT_REPLY =
  'هذا الرقم غير مسجل كطالب على المنصة. لو عندك حساب طالب، تأكد إن رقم الواتساب هو نفس الرقم المسجل.';

const VOICE_UNSUPPORTED_REPLY =
  'معلش، الرسائل الصوتية مش مدعومة هنا 🙏 لو سمحت اكتب سؤالك نص أو ابعت صورة من المنهج.';

const NO_ELIGIBLE_TEACHERS_REPLY =
  'مفيش مساعد علمي متاح ليك دلوقتي. تأكد إنك مشترك في كورس لمدرس فعّل المساعد العلمي ورفع مواد.';

const DEFAULT_HUMAN_MUTE_MINUTES = 60;

function isVoiceOrAudioInbound(ctx: InboundContext): boolean {
  const mimeCandidates = [
    ctx.media?.mimetype,
    typeof ctx.metadata?.media_mimetype === 'string'
      ? ctx.metadata.media_mimetype
      : null,
  ];
  for (const raw of mimeCandidates) {
    if (!raw) continue;
    const mime = raw.toLowerCase();
    if (
      mime.startsWith('audio/') ||
      mime.includes('ogg') ||
      mime.includes('opus')
    ) {
      return true;
    }
  }
  const mediaType =
    ctx.metadata?.wa_message_type ??
    ctx.metadata?.media_type ??
    ctx.metadata?.type;
  if (typeof mediaType === 'string') {
    const t = mediaType.toLowerCase();
    if (t === 'ptt' || t === 'audio' || t === 'voice' || t === 'voip') return true;
  }
  return false;
}

function getHumanMuteMinutes(ctx: InboundContext): number {
  const raw = ctx.service?.config?.human_mute_minutes;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_HUMAN_MUTE_MINUTES;
}

function parseMuteUntil(meta: Record<string, unknown>): Date | null {
  const raw = meta.human_mute_until;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function readTeacherId(meta: Record<string, unknown>): number | null {
  const raw = meta.teacher_id;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
  return null;
}

function readPendingTeachers(meta: Record<string, unknown>): EligibleScientificTeacher[] {
  const raw = meta.pending_teacher_options;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const id = Number((item as { id?: unknown }).id);
      const name =
        typeof (item as { name?: unknown }).name === 'string'
          ? ((item as { name: string }).name as string)
          : null;
      if (!Number.isFinite(id)) return null;
      return { id, name };
    })
    .filter((t): t is EligibleScientificTeacher => Boolean(t));
}

async function persistConversationMeta(
  conversationId: number | null | undefined,
  patch: Record<string, unknown>,
  removeKeys: string[] = [],
): Promise<void> {
  if (!conversationId) return;
  let metadataExpr = `COALESCE(metadata, '{}'::jsonb)`;
  const params: unknown[] = [conversationId];
  for (const key of removeKeys) {
    params.push(key);
    metadataExpr = `(${metadataExpr} - $${params.length})`;
  }
  params.push(JSON.stringify(patch));
  const patchIdx = params.length;
  await pool.query(
    `UPDATE wa_conversations
     SET metadata = ${metadataExpr} || $${patchIdx}::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    params,
  );
}

async function maybeResumeFromHumanMute(
  conversation: WaConversationRow,
  muteMinutes: number,
): Promise<WaConversationRow> {
  if (conversation.status === 'bot' || conversation.status === 'closed') {
    return conversation;
  }

  const now = Date.now();
  const muteUntil = parseMuteUntil(conversation.metadata || {});
  let expired = false;

  if (muteUntil) {
    expired = muteUntil.getTime() <= now;
  } else if (conversation.assigned_at) {
    const assignedAt = new Date(conversation.assigned_at).getTime();
    expired =
      Number.isFinite(assignedAt) &&
      assignedAt + muteMinutes * 60_000 <= now;
  } else {
    expired = true;
  }

  if (!expired) return conversation;

  const result = await pool.query<WaConversationRow>(
    `UPDATE wa_conversations
     SET status = 'bot',
         metadata = (COALESCE(metadata, '{}'::jsonb) - 'human_mute_until'),
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, service_id, session_slug, tenant_id, student_user_id,
               contact_phone, status, metadata, wwebjs_conversation_id,
               last_message_at, assigned_at, created_at, updated_at`,
    [conversation.id],
  );

  const row = result.rows[0];
  if (!row) return conversation;

  logger.info(
    { conversationId: conversation.id },
    'student_scientific_bot resumed after human mute expired',
  );

  return {
    ...row,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata || {},
  };
}

async function ensureTeacherStillEligible(
  studentId: number,
  teacherId: number,
): Promise<boolean> {
  const teachers = await listEligibleScientificTeachers(studentId);
  return teachers.some((t) => t.id === teacherId);
}

async function onInbound(ctx: InboundContext): Promise<HandlerResult> {
  if (!ctx.service?.is_enabled) {
    return { handled: false };
  }

  let conversation = ctx.conversation;
  if (conversation && conversation.status !== 'bot') {
    conversation = await maybeResumeFromHumanMute(
      conversation,
      getHumanMuteMinutes(ctx),
    );
    ctx = { ...ctx, conversation };

    if (conversation.status !== 'bot') {
      logger.info(
        {
          conversationId: conversation.id,
          status: conversation.status,
          humanMuteUntil: conversation.metadata?.human_mute_until ?? null,
        },
        'student_scientific_bot skipped (human mute active)',
      );
      return { handled: true };
    }
  }

  if (!ctx.body?.trim() && !ctx.media && !ctx.mediaError) {
    logger.info(
      { waMessageId: ctx.waMessageId, fromPhone: ctx.fromPhone },
      'student_scientific_bot skipped (empty non-media inbound)',
    );
    return { handled: true };
  }

  if (isVoiceOrAudioInbound(ctx)) {
    return {
      handled: true,
      reply: VOICE_UNSUPPORTED_REPLY,
      metadata: { voice_unsupported: true },
    };
  }

  const student = await resolveStudentByPhone(ctx.fromPhone);
  if (!student) {
    return {
      handled: true,
      reply: NOT_STUDENT_REPLY,
      metadata: { access_denied: 'not_student' },
    };
  }

  const meta = (conversation?.metadata || {}) as Record<string, unknown>;
  const text = (ctx.body || '').trim();

  if (isSwitchTeacherCommand(text)) {
    await persistConversationMeta(conversation?.id, { student_id: student.id }, [
      'teacher_id',
      'pending_teacher_options',
    ]);
    const teachers = await listEligibleScientificTeachers(student.id);
    if (teachers.length === 0) {
      return {
        handled: true,
        reply: NO_ELIGIBLE_TEACHERS_REPLY,
        metadata: { student_id: student.id, access_denied: 'no_eligible_teachers' },
      };
    }
    if (teachers.length === 1) {
      await persistConversationMeta(conversation?.id, {
        student_id: student.id,
        teacher_id: teachers[0].id,
      });
      return {
        handled: true,
        reply: teacherSelectedAck(teachers[0]),
        metadata: { student_id: student.id, teacher_id: teachers[0].id },
      };
    }
    await persistConversationMeta(conversation?.id, {
      student_id: student.id,
      pending_teacher_options: teachers,
    });
    return {
      handled: true,
      reply: formatTeacherPickerMessage(teachers),
      metadata: { student_id: student.id, awaiting_teacher_pick: true },
    };
  }

  let teacherId = readTeacherId(meta);

  // Pending numbered selection
  const pending = readPendingTeachers(meta);
  if (!teacherId && pending.length && text) {
    const picked = parseTeacherSelection(text, pending);
    if (picked) {
      await persistConversationMeta(
        conversation?.id,
        { student_id: student.id, teacher_id: picked.id },
        ['pending_teacher_options'],
      );
      return {
        handled: true,
        reply: teacherSelectedAck(picked),
        metadata: { student_id: student.id, teacher_id: picked.id },
      };
    }
    return {
      handled: true,
      reply: `اختار رقم من القائمة (1-${pending.length}).\n\n${formatTeacherPickerMessage(pending)}`,
      metadata: { student_id: student.id, awaiting_teacher_pick: true },
    };
  }

  if (!teacherId) {
    const teachers = await listEligibleScientificTeachers(student.id);
    if (teachers.length === 0) {
      return {
        handled: true,
        reply: NO_ELIGIBLE_TEACHERS_REPLY,
        metadata: { student_id: student.id, access_denied: 'no_eligible_teachers' },
      };
    }
    if (teachers.length === 1) {
      teacherId = teachers[0].id;
      await persistConversationMeta(conversation?.id, {
        student_id: student.id,
        teacher_id: teacherId,
      });
      // If this was only a picker-trigger with no real question/media, ack selection
      if (!text && !ctx.media) {
        return {
          handled: true,
          reply: teacherSelectedAck(teachers[0]),
          metadata: { student_id: student.id, teacher_id: teacherId },
        };
      }
    } else {
      await persistConversationMeta(conversation?.id, {
        student_id: student.id,
        pending_teacher_options: teachers,
      });
      return {
        handled: true,
        reply: formatTeacherPickerMessage(teachers),
        metadata: { student_id: student.id, awaiting_teacher_pick: true },
      };
    }
  }

  if (!(await ensureTeacherStillEligible(student.id, teacherId))) {
    await persistConversationMeta(
      conversation?.id,
      { student_id: student.id },
      ['teacher_id', 'pending_teacher_options'],
    );
    return {
      handled: true,
      reply: NO_ELIGIBLE_TEACHERS_REPLY,
      metadata: { student_id: student.id, access_denied: 'teacher_no_longer_eligible' },
    };
  }

  // Defense: plan feature still on
  const pkg = await getTeacherPackage(teacherId);
  if (!hasPlanFeature(pkg, 'scientific_support')) {
    return {
      handled: true,
      reply: 'المساعد العلمي غير متاح حالياً لمدرس هذا الكورس.',
      metadata: { student_id: student.id, teacher_id: teacherId, access_denied: 'plan' },
    };
  }

  try {
    const result = await runStudentScientificBridge(ctx, student.id, teacherId);
    return {
      handled: true,
      reply: result.reply,
      metadata: result.metadata,
    };
  } catch (err) {
    logger.error(
      { err, studentId: student.id, teacherId },
      'student_scientific_bot handler error',
    );
    const message =
      err instanceof Error && err.message
        ? err.message
        : 'معلش، حصل خطأ مش متوقع. جرّب تاني بعدين.';
    return {
      handled: true,
      reply: message,
      metadata: { student_id: student.id, teacher_id: teacherId, error: true },
    };
  }
}

export function registerStudentScientificBot(): void {
  registerWhatsAppHandler({
    key: STUDENT_SCIENTIFIC_BOT_KEY,
    onInbound,
  });
  logger.info('Registered WhatsApp handler: student_scientific_bot');
}
