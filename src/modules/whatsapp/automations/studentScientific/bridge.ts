import fs from 'node:fs';
import path from 'node:path';
import pool from '../../../../db/pool';
import { ScientificChatbotService } from '../../../../services/scientificChatbot';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import type { InboundContext, InboundMedia } from '../types';

const WA_CHUNK_SIZE = 3500;
const IMAGE_UPLOAD_DIR = path.join(process.cwd(), 'uploads/scientific-chat-wa');
const DEFAULT_IMAGE_QUESTION = 'اشرح لي هذه الصورة من المنهج';

export type ScientificBridgeResult = {
  reply: string;
  studentId: number;
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

function isImageMedia(media: InboundMedia): boolean {
  return (media.mimetype || '').toLowerCase().startsWith('image/');
}

async function mediaToImagePath(media: InboundMedia): Promise<string> {
  await fs.promises.mkdir(IMAGE_UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(media.data, 'base64');
  const mime = (media.mimetype || 'image/jpeg').toLowerCase();
  const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
  const filename =
    media.filename ||
    `wa-sci-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(IMAGE_UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);
  return filePath.replace(/\\/g, '/');
}

async function cleanupFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => fs.promises.unlink(p).catch(() => undefined)));
}

export async function runStudentScientificBridge(
  ctx: InboundContext,
  studentId: number,
  teacherId: number,
): Promise<ScientificBridgeResult> {
  const question =
    (ctx.media?.caption || '').trim() ||
    (ctx.body || '').trim() ||
    (ctx.media ? DEFAULT_IMAGE_QUESTION : '');

  if (!question) {
    throw new Error('اكتب سؤالك أو ابعت صورة من المنهج.');
  }

  const imagePaths: string[] = [];
  try {
    if (ctx.media) {
      if (!isImageMedia(ctx.media)) {
        throw new Error('حالياً ندعم الصور فقط كمرفقات مع السؤال.');
      }
      imagePaths.push(await mediaToImagePath(ctx.media));
    } else if (ctx.mediaError) {
      throw new Error('تعذر استلام الصورة. جرّب تبعتها تاني بحجم أصغر.');
    }

    const subscribed = await ScientificChatbotService.studentHasTeacherSubscription(
      studentId,
      teacherId,
    );
    if (!subscribed) {
      throw new Error('لازم تكون مشترك في كورس لهذا المدرس عشان تستخدم المساعد العلمي.');
    }

    const hasContent = await ScientificChatbotService.teacherHasContent(teacherId);
    if (!hasContent) {
      throw new Error('المدرس لسه ما رفعش مواد للمساعد العلمي.');
    }

    const result = await ScientificChatbotService.answerTeacherQuestion(
      studentId,
      teacherId,
      question,
      imagePaths,
    );

    await persistConversationMeta(ctx.conversation?.id, {
      student_id: studentId,
      teacher_id: teacherId,
    });

    const chunks = splitWhatsAppChunks(result.answer);
    const first = chunks[0] || result.answer;
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
            student_id: studentId,
            teacher_id: teacherId,
            chunk_index: i + 2,
            chunk_total: chunks.length,
          },
          scheduledAt: new Date(Date.now() + (i + 1) * 750),
        });
      }
    }

    return {
      reply: first,
      studentId,
      teacherId,
      metadata: {
        student_id: studentId,
        teacher_id: teacherId,
        chunk_total: chunks.length,
        chunk_index: 1,
        retrieved_chunks: result.retrievedChunks?.length ?? 0,
      },
    };
  } finally {
    await cleanupFiles(imagePaths);
  }
}
