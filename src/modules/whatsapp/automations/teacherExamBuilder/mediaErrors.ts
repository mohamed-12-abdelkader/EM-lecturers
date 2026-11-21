/**
 * Map gateway / save failures to clear Arabic replies.
 * Never blame file size unless the real error indicates size.
 */

export const MAX_EXAM_ASSISTANT_FILE_BYTES = 15 * 1024 * 1024; // 15MB decoded

export type MediaFailureKind =
  | 'too_large'
  | 'download_failed'
  | 'unsupported'
  | 'corrupt'
  | 'timeout'
  | 'payload_too_large'
  | 'unknown';

export function classifyMediaError(raw: string | null | undefined): MediaFailureKind {
  const t = String(raw || '').toLowerCase();
  if (!t) return 'unknown';
  if (
    /(payload.?too.?large|entity.?too.?large|413|body.?limit|request.?entity)/.test(t)
  ) {
    return 'payload_too_large';
  }
  if (/(too.?large|file.?size|max.?size|exceeds?.?limit|larger than|حجم|size.?limit)/.test(t)) {
    return 'too_large';
  }
  if (/(timeout|timed?\s*out|etimedout)/.test(t)) return 'timeout';
  if (
    /(download|fetch|media.?fail|failed to (get|download|load)|cannot download|unable to download)/.test(
      t,
    )
  ) {
    return 'download_failed';
  }
  if (/(unsupported|mime|invalid.?type|not.?supported|صيغة)/.test(t)) return 'unsupported';
  if (/(corrupt|empty|invalid.?media|truncated|unreadable|zero.?byte)/.test(t)) return 'corrupt';
  return 'unknown';
}

export function replyForMediaFailure(
  raw: string | null | undefined,
  opts?: { approxBytes?: number | null },
): { reply: string; kind: MediaFailureKind } {
  const kind = classifyMediaError(raw);
  const hint = String(raw || '').trim().slice(0, 120);

  switch (kind) {
    case 'too_large':
    case 'payload_too_large':
      return {
        kind,
        reply:
          'الملف أكبر من الحد المسموح للاستلام عبر واتساب.\nجرّب تصغير الصورة أو تقسيم الـ PDF، أو ابعت الملف على أجزاء.',
      };
    case 'timeout':
      return {
        kind,
        reply:
          'انتهت مهلة تحميل الملف من واتساب.\nابعت الملف تاني من فضلك (إعادة المحاولة عادةً بتنجح).',
      };
    case 'download_failed':
      return {
        kind,
        reply:
          'تعذر تحميل الملف من واتساب.\nابعت الصورة/الملف مرة تانية، ولو استمرت المشكلة جرّب صيغة JPG أو PDF.',
      };
    case 'unsupported':
      return {
        kind,
        reply: 'صيغة الملف غير مدعومة.\nابعت PDF أو صورة JPG / PNG / WEBP.',
      };
    case 'corrupt':
      return {
        kind,
        reply: 'الملف تالف أو فاضي ومش قابل للقراءة.\nابعت نسخة تانية واضحة من الملف.',
      };
    default: {
      const sizeNote =
        opts?.approxBytes != null && Number.isFinite(opts.approxBytes)
          ? `\n(حجم تقريبي للرسالة: ${Math.round(Number(opts.approxBytes) / 1024)} KB)`
          : '';
      return {
        kind,
        reply: hint
          ? `تعذر استلام المرفق: ${hint}${sizeNote}\nابعت الملف تاني لو تحب، أو وضّحلي المطلوب.`
          : `تعذر استلام المرفق.${sizeNote}\nابعت الملف تاني، ولو المشكلة استمرت قولّي نوع الملف (صورة ولا PDF).`,
      };
    }
  }
}

export function isSupportedExamAssistantMime(mime: string | null | undefined): boolean {
  const m = (mime || '').toLowerCase();
  return (
    m === 'application/pdf' ||
    m.includes('pdf') ||
    m === 'image/jpeg' ||
    m === 'image/jpg' ||
    m === 'image/png' ||
    m === 'image/webp' ||
    m.startsWith('image/jpeg') ||
    m.startsWith('image/png') ||
    m.startsWith('image/webp')
  );
}

export function validateDecodedMediaBuffer(opts: {
  buffer: Buffer;
  mimetype?: string | null;
}): { ok: true } | { ok: false; reply: string; kind: MediaFailureKind } {
  if (!opts.buffer.length) {
    return {
      ok: false,
      kind: 'corrupt',
      reply: 'الملف تالف أو فاضي ومش قابل للقراءة.\nابعت نسخة تانية.',
    };
  }
  if (opts.buffer.length > MAX_EXAM_ASSISTANT_FILE_BYTES) {
    return {
      ok: false,
      kind: 'too_large',
      reply: `الملف أكبر من الحد المسموح (${Math.round(MAX_EXAM_ASSISTANT_FILE_BYTES / (1024 * 1024))}MB بعد الاستلام).\nصغّر الملف أو قسّمه.`,
    };
  }
  if (!isSupportedExamAssistantMime(opts.mimetype)) {
    return {
      ok: false,
      kind: 'unsupported',
      reply: 'صيغة الملف غير مدعومة.\nابعت PDF أو صورة JPG / PNG / WEBP.',
    };
  }
  return { ok: true };
}
