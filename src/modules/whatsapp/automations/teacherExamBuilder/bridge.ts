import pool from '../../../../db/pool';
import { ExamBuilderChatbotService } from '../../../../services/examBuilderChatbot';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import type { InboundContext } from '../types';
import { WA_COMMAND_FOOTER, WA_HELP_REPLY } from './commands';

const WA_CHUNK_SIZE = 3500;

export type ExamBuilderBridgeResult = {
  reply: string;
  teacherId: number;
  metadata: Record<string, unknown>;
};

function splitWhatsAppChunks(text: string, maxLen = WA_CHUNK_SIZE): string[] {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf('\n\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf('\n', maxLen);
    if (cut < maxLen * 0.5) cut = remaining.lastIndexOf(' ', maxLen);
    if (cut < maxLen * 0.5) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks.filter(Boolean);
}

async function persistConversationMeta(
  conversationId: number | null | undefined,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!conversationId) return;
  await pool.query(
    `UPDATE wa_conversations
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [conversationId, JSON.stringify(patch)],
  );
}

function readSessionId(meta: Record<string, unknown>): string | null {
  const raw = meta.exam_builder_session_id;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}

function withFooter(reply: string, includeFooter: boolean): string {
  const body = reply.trim();
  if (!includeFooter) return body;
  if (body.includes('لاعتماد القائمة فقط')) return body;
  return `${body}${WA_COMMAND_FOOTER}`;
}

async function enqueueChunks(
  ctx: InboundContext,
  chunks: string[],
  metadata: Record<string, unknown>,
): Promise<string> {
  const first = chunks[0] || '';
  const rest = chunks.slice(1);
  if (rest.length && ctx.conversation && ctx.service) {
    for (let i = 0; i < rest.length; i += 1) {
      await WhatsAppOutboundQueue.enqueue({
        sessionSlug: ctx.conversation.session_slug,
        to: ctx.fromPhone,
        body: rest[i],
        serviceId: ctx.service.id,
        conversationId: ctx.conversation.id,
        tenantId: ctx.conversation.tenant_id,
        triggerType: 'inbound_reply_chunk',
        triggerRef: `${ctx.waMessageId}:chunk:${i + 2}`,
        metadata: {
          ...metadata,
          chunk_index: i + 2,
          chunk_total: chunks.length,
        },
        scheduledAt: new Date(Date.now() + (i + 1) * 750),
      });
    }
  }
  return first;
}

async function resolveSessionId(
  teacherId: number,
  meta: Record<string, unknown>,
): Promise<string | null> {
  const fromMeta = readSessionId(meta);
  if (fromMeta) return fromMeta;
  const latest = await ExamBuilderChatbotService.getLatestProposedSession(teacherId);
  return latest?.id ?? null;
}

export async function runExamBuilderHelp(): Promise<ExamBuilderBridgeResult> {
  return {
    reply: WA_HELP_REPLY,
    teacherId: 0,
    metadata: { action: 'help' },
  };
}

export async function runExamBuilderChat(
  ctx: InboundContext,
  teacherId: number,
  message: string,
): Promise<ExamBuilderBridgeResult> {
  const meta = (ctx.conversation?.metadata || {}) as Record<string, unknown>;
  const sessionId = readSessionId(meta);

  const result = await ExamBuilderChatbotService.handleChatMessage(
    teacherId,
    message,
    sessionId,
  );

  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'teacher',
    message,
    result.session?.id ?? null,
    {
      action: result.session ? 'request_or_adjust' : 'request',
      session_id: result.session?.id ?? null,
      channel: 'whatsapp',
    },
  );

  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'assistant',
    result.reply,
    result.session?.id ?? null,
    {
      action: 'proposal',
      session_id: result.session?.id ?? null,
      status: result.session ? 'proposal_ready' : 'message_only',
      actions: result.actions,
      channel: 'whatsapp',
    },
  );

  if (result.session?.id) {
    await persistConversationMeta(ctx.conversation?.id, {
      teacher_id: teacherId,
      exam_builder_session_id: result.session.id,
    });
  } else {
    await persistConversationMeta(ctx.conversation?.id, { teacher_id: teacherId });
  }

  const includeFooter = Boolean(result.session) || result.actions.can_approve;
  const full = withFooter(result.reply, includeFooter);
  const chunks = splitWhatsAppChunks(full);
  const metadata = {
    teacher_id: teacherId,
    exam_builder_session_id: result.session?.id ?? null,
    action: result.session ? 'proposal' : 'message',
  };
  const reply = await enqueueChunks(ctx, chunks, metadata);

  return {
    reply,
    teacherId,
    metadata: {
      ...metadata,
      chunk_total: chunks.length,
      chunk_index: 1,
    },
  };
}

export async function runExamBuilderRegenerate(
  ctx: InboundContext,
  teacherId: number,
): Promise<ExamBuilderBridgeResult> {
  const meta = (ctx.conversation?.metadata || {}) as Record<string, unknown>;
  const sessionId = await resolveSessionId(teacherId, meta);
  if (!sessionId) {
    return {
      reply: 'مفيش اقتراح أسئلة مفتوح حالياً. اكتب طلب امتحان أولاً مثل: أنشئ امتحان 10 أسئلة.',
      teacherId,
      metadata: { teacher_id: teacherId, action: 'regenerate_no_session' },
    };
  }

  const result = await ExamBuilderChatbotService.regenerateSession(sessionId, teacherId);

  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'teacher',
    'أعد',
    result.session?.id ?? sessionId,
    { action: 'regenerate', channel: 'whatsapp' },
  );
  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'assistant',
    result.reply,
    result.session?.id ?? sessionId,
    { action: 'regenerate_result', channel: 'whatsapp', actions: result.actions },
  );

  if (result.session?.id) {
    await persistConversationMeta(ctx.conversation?.id, {
      teacher_id: teacherId,
      exam_builder_session_id: result.session.id,
    });
  }

  const full = withFooter(result.reply, true);
  const chunks = splitWhatsAppChunks(full);
  const metadata = {
    teacher_id: teacherId,
    exam_builder_session_id: result.session?.id ?? sessionId,
    action: 'regenerate',
  };
  const reply = await enqueueChunks(ctx, chunks, metadata);

  return {
    reply,
    teacherId,
    metadata: { ...metadata, chunk_total: chunks.length, chunk_index: 1 },
  };
}

export async function runExamBuilderApprove(
  ctx: InboundContext,
  teacherId: number,
): Promise<ExamBuilderBridgeResult> {
  const meta = (ctx.conversation?.metadata || {}) as Record<string, unknown>;
  const sessionId = await resolveSessionId(teacherId, meta);
  if (!sessionId) {
    return {
      reply: 'مفيش قائمة أسئلة للاعتماد. اطلب امتحان أولاً ثم اكتب «موافق».',
      teacherId,
      metadata: { teacher_id: teacherId, action: 'approve_no_session' },
    };
  }

  const approved = await ExamBuilderChatbotService.approveSession(teacherId, sessionId, {
    create_exam: false,
  });

  const count =
    Array.isArray(approved?.question_ids) ? approved.question_ids.length : null;
  const reply = [
    'تم اعتماد قائمة الأسئلة ✅',
    count != null ? `عدد الأسئلة: ${count}` : null,
    '',
    'لإكمال إنشاء الامتحان (اختيار الكورس/المحاضرة والعنوان)، افتح *مساعد الامتحانات* من الموقع.',
  ]
    .filter(Boolean)
    .join('\n');

  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'teacher',
    'موافق',
    sessionId,
    { action: 'approve', channel: 'whatsapp', create_exam: false },
  );
  await ExamBuilderChatbotService.saveMessage(
    teacherId,
    'assistant',
    reply,
    sessionId,
    { action: 'approved', channel: 'whatsapp', create_exam: false },
  );

  await persistConversationMeta(ctx.conversation?.id, {
    teacher_id: teacherId,
    exam_builder_session_id: sessionId,
    exam_builder_approved: true,
  });

  return {
    reply,
    teacherId,
    metadata: {
      teacher_id: teacherId,
      exam_builder_session_id: sessionId,
      action: 'approve',
      create_exam: false,
    },
  };
}
