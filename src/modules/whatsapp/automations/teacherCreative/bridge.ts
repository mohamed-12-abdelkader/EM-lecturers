import fs from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import pool from '../../../../db/pool';
import { TeacherCreativeChatbotService } from '../../../../services/teacherCreativeChatbot';
import type { InboundContext, InboundMedia } from '../types';

export type CreativeBridgeResult = {
  reply: string;
  mediaUrl?: string;
  sessionId: number;
  teacherId: number;
  metadata: Record<string, unknown>;
};

const REF_UPLOAD_DIR = path.join(process.cwd(), 'uploads/teacher-creative-references');

async function mediaToMulterFile(media: InboundMedia): Promise<Express.Multer.File> {
  await fs.promises.mkdir(REF_UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(media.data, 'base64');
  const mimetype = media.mimetype || 'image/jpeg';
  const ext = mimetype.includes('png')
    ? 'png'
    : mimetype.includes('webp')
      ? 'webp'
      : 'jpg';
  const filename = media.filename || `wa-ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const filePath = path.join(REF_UPLOAD_DIR, filename);
  await fs.promises.writeFile(filePath, buffer);

  return {
    fieldname: 'reference',
    originalname: filename,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
    destination: REF_UPLOAD_DIR,
    filename,
    path: filePath,
    stream: undefined as unknown as Express.Multer.File['stream'],
  };
}

function isImageMedia(media: InboundMedia): boolean {
  const mime = (media.mimetype || '').toLowerCase();
  return mime.startsWith('image/');
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

export async function runTeacherCreativeBridge(
  ctx: InboundContext,
  teacherId: number,
): Promise<CreativeBridgeResult> {
  const meta = (ctx.conversation?.metadata || {}) as Record<string, unknown>;
  const sessionIdRaw = meta.creative_session_id;
  const sessionId =
    typeof sessionIdRaw === 'number'
      ? sessionIdRaw
      : typeof sessionIdRaw === 'string' && /^\d+$/.test(sessionIdRaw)
        ? Number(sessionIdRaw)
        : undefined;

  let caption =
    (ctx.media?.caption || '').trim() ||
    (ctx.body || '').trim() ||
    (ctx.media ? 'استخدم الصورة المرجعية' : '');

  if (!caption && !ctx.media) {
    throw new Error('الرسالة مطلوبة');
  }

  const referenceFiles: Express.Multer.File[] = [];
  if (ctx.media) {
    if (!isImageMedia(ctx.media)) {
      throw new Error('حالياً ندعم الصور فقط كمرفقات. ابعت صورة أو اكتب رسالتك.');
    }
    referenceFiles.push(await mediaToMulterFile(ctx.media));
    if (!caption.includes('صورة')) {
      caption = `${caption}\n[مرفق: صورة مرجعية من واتساب]`.trim();
    }
  } else if (ctx.mediaError) {
    throw new Error('تعذر استلام الصورة. جرّب تبعتها تاني بحجم أصغر.');
  }

  const result = await TeacherCreativeChatbotService.chat(teacherId, {
    message: caption,
    sessionId,
    referenceFiles: referenceFiles.length ? referenceFiles : undefined,
  });

  await persistConversationMeta(ctx.conversation?.id, {
    teacher_id: teacherId,
    creative_session_id: result.session_id,
  });

  const mediaUrl =
    result.generation?.generated_image_url &&
    typeof result.generation.generated_image_url === 'string'
      ? result.generation.generated_image_url
      : undefined;

  return {
    reply: result.reply,
    mediaUrl,
    sessionId: result.session_id,
    teacherId,
    metadata: {
      teacher_id: teacherId,
      creative_session_id: result.session_id,
      executed: result.executed,
      suggested_action: result.suggested_action,
      generation_id: result.generation?.id ?? null,
      has_image: Boolean(mediaUrl),
    },
  };
}
