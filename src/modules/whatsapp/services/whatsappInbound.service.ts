import crypto from 'node:crypto';
import pool from '../../../db/pool';
import {
  normalizePhone,
  verifyWebhookSignature,
} from '../gateway/whatsappGatewayClient';
import { SessionPoolService } from '../routing/sessionPool.service';
import { dispatchInbound } from '../automations/registry';
import { WhatsAppOutboundQueue } from '../queue/whatsappOutboundQueue';
import type {
  InboundMedia,
  WaConversationRow,
  WaServiceRow,
} from '../automations/types';
import { logger } from '../../../utils';

export interface WhatsAppWebhookPayload {
  type?: string;
  session_id?: string;
  from?: string;
  body?: string;
  wa_message_id?: string;
  conversation_id?: string | null;
  metadata?: Record<string, unknown>;
  media?: InboundMedia | null;
  media_error?: string | null;
  received_at?: string;
}

function parseConfig(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw as Record<string, unknown>;
}

function parseMedia(raw: unknown): InboundMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const mimetype = typeof m.mimetype === 'string' ? m.mimetype : '';
  const data = typeof m.data === 'string' ? m.data : '';
  if (!mimetype || !data) return null;
  return {
    mimetype,
    data,
    filename: typeof m.filename === 'string' ? m.filename : null,
    caption: typeof m.caption === 'string' ? m.caption : null,
  };
}

function mediaSummary(
  media: InboundMedia | null,
  mediaError: string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (mediaError) out.media_error = mediaError;
  if (media) {
    out.has_media = true;
    out.media_mimetype = media.mimetype;
    out.media_filename = media.filename ?? null;
    out.media_approx_bytes = Math.floor((media.data.length * 3) / 4);
  }
  return out;
}

export class WhatsAppInboundService {
  static verify(rawBody: Buffer | undefined, signature: string | undefined): boolean {
    return verifyWebhookSignature(rawBody, signature);
  }

  /**
   * Persist inbound event + conversation, then ack. Bot dispatch runs async
   * so LLM latency does not exceed the wwebjs webhook timeout (~10s).
   */
  static async process(payload: WhatsAppWebhookPayload): Promise<{
    ok: boolean;
    duplicate?: boolean;
    conversationId?: number | null;
    serviceKey?: string | null;
  }> {
    const sessionSlug = String(payload.session_id || '').trim();
    const fromRaw = String(payload.from || '').trim();
    const body = String(payload.body || '');
    let waMessageId = String(payload.wa_message_id || '').trim();
    const eventType = String(payload.type || 'message.inbound');
    const baseMetadata =
      payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
    const media = parseMedia(payload.media);
    const mediaError =
      typeof payload.media_error === 'string' && payload.media_error
        ? payload.media_error
        : null;
    const metadata = {
      ...baseMetadata,
      ...mediaSummary(media, mediaError),
    };

    if (!sessionSlug || !fromRaw) {
      logger.warn({ payload: { sessionSlug, fromRaw, waMessageId } }, 'WhatsApp webhook missing required fields');
      return { ok: false };
    }

    const fromPhone = normalizePhone(fromRaw);

    // Some WhatsApp Web messages arrive without _serialized id — synthesize one for idempotency.
    if (!waMessageId) {
      const stamp = payload.received_at || new Date().toISOString();
      const digest = crypto
        .createHash('sha1')
        .update(`${sessionSlug}|${fromPhone}|${body}|${stamp}|${media?.mimetype || ''}`)
        .digest('hex')
        .slice(0, 20);
      waMessageId = `fallback:${sessionSlug}:${fromPhone}:${digest}`;
      metadata.wa_message_id_fallback = true;
      logger.warn({ sessionSlug, fromPhone, waMessageId }, 'WhatsApp webhook missing wa_message_id; using fallback');
    }

    // Idempotent insert
    const insert = await pool.query<{ id: number }>(
      `INSERT INTO wa_inbound_events
         (wa_message_id, session_slug, from_phone, body, event_type, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (wa_message_id) DO NOTHING
       RETURNING id`,
      [waMessageId, sessionSlug, fromPhone, body, eventType, JSON.stringify(metadata)],
    );

    if (!insert.rowCount) {
      return { ok: true, duplicate: true };
    }
    const inboundEventId = insert.rows[0].id;

    // Resolve open conversation for this phone+session
    let conversation: WaConversationRow | null = null;
    const openConvo = await pool.query<WaConversationRow>(
      `SELECT * FROM wa_conversations
       WHERE session_slug = $1
         AND contact_phone = $2
         AND status IN ('bot', 'waiting_human', 'human')
       ORDER BY last_message_at DESC
       LIMIT 1`,
      [sessionSlug, fromPhone],
    );
    conversation = openConvo.rows[0]
      ? {
          ...openConvo.rows[0],
          metadata: parseConfig(openConvo.rows[0].metadata),
        }
      : null;

    let service: WaServiceRow | null = null;
    if (conversation?.service_id) {
      const svc = await pool.query<WaServiceRow>(
        `SELECT * FROM wa_services WHERE id = $1`,
        [conversation.service_id],
      );
      service = svc.rows[0]
        ? { ...svc.rows[0], config: parseConfig(svc.rows[0].config) }
        : null;
    }

    if (!service) {
      const resolved = await SessionPoolService.resolveServiceBySession(sessionSlug);
      if (resolved) {
        const svc = await pool.query<WaServiceRow>(
          `SELECT * FROM wa_services WHERE id = $1`,
          [resolved.id],
        );
        service = svc.rows[0]
          ? { ...svc.rows[0], config: parseConfig(svc.rows[0].config) }
          : null;
      }
    }

    // Upsert conversation
    if (conversation) {
      const updated = await pool.query<WaConversationRow>(
        `UPDATE wa_conversations
         SET last_message_at = NOW(),
             updated_at = NOW(),
             service_id = COALESCE($2, service_id),
             wwebjs_conversation_id = COALESCE($3, wwebjs_conversation_id)
         WHERE id = $1
         RETURNING *`,
        [
          conversation.id,
          service?.id ?? null,
          payload.conversation_id ? String(payload.conversation_id) : null,
        ],
      );
      conversation = updated.rows[0]
        ? {
            ...updated.rows[0],
            metadata: parseConfig(updated.rows[0].metadata),
          }
        : conversation;
    } else if (service) {
      const created = await pool.query<WaConversationRow>(
        `INSERT INTO wa_conversations
           (service_id, session_slug, contact_phone, status, metadata, wwebjs_conversation_id)
         VALUES ($1, $2, $3, 'bot', $4::jsonb, $5)
         RETURNING *`,
        [
          service.id,
          sessionSlug,
          fromPhone,
          JSON.stringify({}),
          payload.conversation_id ? String(payload.conversation_id) : null,
        ],
      );
      conversation = created.rows[0]
        ? {
            ...created.rows[0],
            metadata: parseConfig(created.rows[0].metadata),
          }
        : null;
    }

    await pool.query(
      `UPDATE wa_inbound_events
       SET routed_service_id = $2, conversation_id = $3
       WHERE id = $1`,
      [inboundEventId, service?.id ?? null, conversation?.id ?? null],
    );

    const sessionOwner = await pool.query<{ teacher_id: number | null }>(
      `SELECT teacher_id FROM wa_sessions WHERE slug = $1`,
      [sessionSlug],
    );
    const teacherId = sessionOwner.rows[0]?.teacher_id ?? null;
    const isTeacherOwned =
      teacherId != null || service?.config?.owner === 'teacher';

    // Background bot dispatch (do not block webhook ACK)
    setImmediate(() => {
      void this.dispatchAndReply({
        sessionSlug,
        fromPhone,
        body,
        waMessageId,
        eventType,
        metadata,
        media,
        mediaError,
        service,
        conversation,
        isTeacherOwned,
      }).catch((err) => {
        logger.error({ err, waMessageId, sessionSlug }, 'WhatsApp async inbound dispatch failed');
      });
    });

    return {
      ok: true,
      conversationId: conversation?.id ?? null,
      serviceKey: service?.key ?? null,
    };
  }

  private static async dispatchAndReply(ctx: {
    sessionSlug: string;
    fromPhone: string;
    body: string;
    waMessageId: string;
    eventType: string;
    metadata: Record<string, unknown>;
    media: InboundMedia | null;
    mediaError: string | null;
    service: WaServiceRow | null;
    conversation: WaConversationRow | null;
    isTeacherOwned: boolean;
  }): Promise<void> {
    // Teacher outbound channels: log inbound only; no platform chatbot auto-reply.
    if (ctx.isTeacherOwned) {
      if (ctx.conversation && !ctx.conversation.metadata?.outbound_only_notified) {
        await WhatsAppOutboundQueue.enqueue({
          sessionSlug: ctx.conversation.session_slug,
          to: ctx.fromPhone,
          body: 'هذه القناة للإرسال فقط. للاستفسارات استخدم قنوات الدعم الرسمية.',
          serviceId: ctx.service?.id ?? null,
          conversationId: ctx.conversation.id,
          tenantId: ctx.conversation.tenant_id,
          triggerType: 'outbound_only_notice',
          triggerRef: ctx.waMessageId,
          metadata: { owner: 'teacher' },
        });
        await pool.query(
          `UPDATE wa_conversations
           SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"outbound_only_notified":true}'::jsonb,
               updated_at = NOW()
           WHERE id = $1`,
          [ctx.conversation.id],
        );
      }
      return;
    }

    const handlerResult = await dispatchInbound({
      sessionSlug: ctx.sessionSlug,
      fromPhone: ctx.fromPhone,
      body: ctx.body,
      waMessageId: ctx.waMessageId,
      eventType: ctx.eventType,
      metadata: ctx.metadata,
      media: ctx.media,
      mediaError: ctx.mediaError,
      service: ctx.service,
      conversation: ctx.conversation,
    });

    if (
      (handlerResult.reply || handlerResult.mediaUrl) &&
      ctx.conversation &&
      ctx.service
    ) {
      await WhatsAppOutboundQueue.enqueue({
        sessionSlug: ctx.conversation.session_slug,
        to: ctx.fromPhone,
        body: handlerResult.reply || '',
        mediaUrl: handlerResult.mediaUrl ?? null,
        serviceId: ctx.service.id,
        conversationId: ctx.conversation.id,
        tenantId: ctx.conversation.tenant_id,
        triggerType: 'inbound_reply',
        triggerRef: ctx.waMessageId,
        metadata: {
          ...(handlerResult.metadata || {}),
          escalate: handlerResult.escalate === true,
        },
      });
    }

    if (handlerResult.escalate && ctx.conversation) {
      await pool.query(
        `UPDATE wa_conversations SET status = 'waiting_human', updated_at = NOW() WHERE id = $1`,
        [ctx.conversation.id],
      );
    }
  }
}
