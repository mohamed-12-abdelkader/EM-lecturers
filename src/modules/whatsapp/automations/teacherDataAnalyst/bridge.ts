import pool from '../../../../db/pool';
import { DataAnalystChatbotService } from '../../../../services/dataAnalystChatbot';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import type { InboundContext } from '../types';
import type { ResolvedTeacher } from '../resolveTeacher';

const WA_CHUNK_SIZE = 3500;

export type DataAnalystBridgeResult = {
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

export async function runTeacherDataAnalystBridge(
  ctx: InboundContext,
  teacher: ResolvedTeacher,
): Promise<DataAnalystBridgeResult> {
  const teacherId = teacher.id;
  const tenantId = teacher.tenant_id ?? 1;
  const text = (ctx.body || '').trim();

  const recentHistory = await DataAnalystChatbotService.getHistory(teacherId, 10, 0);
  const recentMessages = recentHistory.messages.map((message) => ({
    role: message.role,
    text: message.message,
  }));

  await DataAnalystChatbotService.saveMessage(teacherId, 'teacher', text || 'مرحبا');

  const result = await DataAnalystChatbotService.handleMessage(
    teacherId,
    tenantId,
    text || 'مرحبا',
    recentMessages,
  );

  await DataAnalystChatbotService.saveMessage(
    teacherId,
    'assistant',
    result.reply,
    result.report_type,
    result.context ?? {},
  );

  await persistConversationMeta(ctx.conversation?.id, {
    teacher_id: teacherId,
    last_report_type: result.report_type,
  });

  const chunks = splitWhatsAppChunks(result.reply);
  const first = chunks[0] || result.reply;
  const rest = chunks.slice(1);

  if (rest.length && ctx.conversation && ctx.service) {
    for (let i = 0; i < rest.length; i += 1) {
      await WhatsAppOutboundQueue.enqueue({
        sessionSlug: ctx.conversation.session_slug,
        to: ctx.fromPhone,
        body: rest[i],
        serviceId: ctx.service.id,
        conversationId: ctx.conversation.id,
        tenantId: ctx.conversation.tenant_id ?? tenantId,
        triggerType: 'inbound_reply_chunk',
        triggerRef: `${ctx.waMessageId}:chunk:${i + 2}`,
        metadata: {
          teacher_id: teacherId,
          report_type: result.report_type,
          chunk_index: i + 2,
          chunk_total: chunks.length,
        },
        scheduledAt: new Date(Date.now() + (i + 1) * 750),
      });
    }
  }

  return {
    reply: first,
    teacherId,
    metadata: {
      teacher_id: teacherId,
      report_type: result.report_type,
      chunk_total: chunks.length,
      chunk_index: 1,
    },
  };
}
