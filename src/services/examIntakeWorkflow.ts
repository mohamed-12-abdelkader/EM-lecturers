import fs from 'node:fs';
import path from 'node:path';
import { ExamAssistantSessionStore } from '../modules/whatsapp/automations/teacherExamBuilder/sessionStore';
import { runExamAssistantWorkflow } from '../modules/whatsapp/automations/teacherExamBuilder/workflow';
import type { ExamAssistantSessionRow } from '../modules/whatsapp/automations/teacherExamBuilder/types';
import type { InboundContext } from '../modules/whatsapp/automations/types';
import { cancelWorkflow } from '../modules/whatsapp/automations/teacherExamBuilder/workflowActions';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads/wa-exam-assistant');

function webPhone(teacherId: number): string {
  return `web:${teacherId}`;
}

function toInbound(opts: {
  teacherId: number;
  message?: string;
  media?: InboundContext['media'];
  mediaError?: string | null;
}): InboundContext {
  return {
    sessionSlug: 'web-exam-builder',
    fromPhone: webPhone(opts.teacherId),
    body: opts.message || '',
    waMessageId: `web-${opts.teacherId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    eventType: 'message.inbound',
    metadata: { channel: 'web' },
    media: opts.media ?? null,
    mediaError: opts.mediaError ?? null,
    service: null,
    conversation: null,
  };
}

async function ensureWebSession(teacherId: number): Promise<ExamAssistantSessionRow> {
  const existing = await ExamAssistantSessionStore.getActiveForTeacher(teacherId);
  if (existing) {
    if (existing.context.channel !== 'web') {
      return ExamAssistantSessionStore.mergeContext(existing.id, teacherId, {
        channel: 'web',
      });
    }
    return existing;
  }
  return ExamAssistantSessionStore.create({
    teacherId,
    contactPhone: webPhone(teacherId),
    state: 'IDLE',
    context: { channel: 'web' },
  });
}

export class ExamIntakeWorkflowService {
  static async getActiveSession(teacherId: number) {
    return ExamAssistantSessionStore.getActiveForTeacher(teacherId);
  }

  static async reset(teacherId: number) {
    const active = await ExamAssistantSessionStore.getActiveForTeacher(teacherId);
    if (active) await cancelWorkflow(active);
    const session = await ExamAssistantSessionStore.create({
      teacherId,
      contactPhone: webPhone(teacherId),
      state: 'IDLE',
      context: { channel: 'web' },
    });
    return {
      reply:
        'بدأنا محادثة جديدة.\nلو تحب نجهّز امتحان اكتب مثلًا: «اعمل امتحان» وهسألك عن الصف والكورس والإعدادات.',
      session,
    };
  }

  static async sendMessage(teacherId: number, message: string) {
    await ensureWebSession(teacherId);
    const result = await runExamAssistantWorkflow(toInbound({ teacherId, message }), teacherId);
    return {
      reply: result.reply,
      session: result.session,
      metadata: result.metadata || {},
      choices: Array.isArray(result.metadata?.choices)
        ? (result.metadata!.choices as string[])
        : [],
      state: result.session?.state ?? null,
      draft_exam_id: result.session?.draft_exam_id ?? null,
      draft_exam_kind: result.session?.draft_exam_kind ?? null,
      exam_builder_session_id: result.session?.exam_builder_session_id ?? null,
      review_url: result.session?.context?.review_url ?? null,
    };
  }

  static async uploadFiles(
    teacherId: number,
    files: Express.Multer.File[],
    caption?: string | null,
  ) {
    await ensureWebSession(teacherId);
    let lastResult: Awaited<ReturnType<typeof runExamAssistantWorkflow>> | null = null;

    for (let i = 0; i < files.length; i++) {
      const file = files[i]!;
      const buffer = file.buffer?.length
        ? file.buffer
        : fs.readFileSync(file.path);
      const media = {
        mimetype: file.mimetype || 'application/octet-stream',
        data: buffer.toString('base64'),
        filename: file.originalname || `upload-${Date.now()}`,
        caption: i === 0 ? caption || null : null,
      };
      lastResult = await runExamAssistantWorkflow(
        toInbound({
          teacherId,
          message: i === 0 ? caption || '' : '',
          media,
        }),
        teacherId,
      );
    }

    if (!lastResult) {
      return {
        reply: 'مفيش ملفات للاستلام.',
        session: await ensureWebSession(teacherId),
        metadata: {},
        choices: [] as string[],
      };
    }

    return {
      reply: lastResult.reply,
      session: lastResult.session,
      metadata: lastResult.metadata || {},
      choices: Array.isArray(lastResult.metadata?.choices)
        ? (lastResult.metadata!.choices as string[])
        : [],
      state: lastResult.session?.state ?? null,
      draft_exam_id: lastResult.session?.draft_exam_id ?? null,
      draft_exam_kind: lastResult.session?.draft_exam_kind ?? null,
      exam_builder_session_id: lastResult.session?.exam_builder_session_id ?? null,
      review_url: lastResult.session?.context?.review_url ?? null,
    };
  }

  static ensureUploadDir() {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    return UPLOAD_DIR;
  }
}
