import { config, logger } from '../../../../utils';
import type { InboundContext } from '../types';
import { describeInboundImage } from './image';
import { loadConversationHistory } from './history';
import { TECHNICAL_SUPPORT_SYSTEM_PROMPT } from './prompts';
import { SUPPORT_TOOL_DEFINITIONS, executeSupportTool } from './tools';
import pool from '../../../../db/pool';

const MAX_TOOL_ROUNDS = 6;
const DEEPSEEK_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
};

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type AgentRunResult = {
  reply: string;
  escalate: boolean;
  imageDescription?: string | null;
  metadata?: Record<string, unknown>;
};

function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function wantsEscalate(text: string): boolean {
  const t = text.toLowerCase();
  return (
    t.includes('متابعة بشرية') ||
    t.includes('escalat') ||
    t.includes('تواصل مع فريق الدعم') ||
    t.includes('كلّم الدعم') ||
    t.includes('كلم الدعم') ||
    t.includes('لا أستطيع حل') ||
    t.includes('مش قادر أحل')
  );
}

type TenantSearchHit = {
  login_url?: string;
  signup_url?: string;
  caller_has_account_on_this_tenant?: boolean;
  recommended_reply_ar?: string;
};

/** If the model soft-replies with only a homepage link, use the tool's ready Arabic reply. */
function ensureTenantJoinReply(
  reply: string,
  tenants: TenantSearchHit[] | null | undefined,
): string {
  if (!tenants || tenants.length !== 1) return reply;
  const t = tenants[0];
  const recommended = t.recommended_reply_ar?.trim();
  if (!recommended) return reply;

  if (t.caller_has_account_on_this_tenant) {
    const hasLogin =
      (t.login_url && reply.includes(t.login_url)) || reply.includes('/login');
    return hasLogin ? reply : recommended;
  }

  const hasSignup =
    (t.signup_url && reply.includes(t.signup_url)) || reply.includes('/signup');
  const hasNumberedSteps = /(?:^|\n)\s*[1١][)\].\-،]/.test(reply);
  const mentionsSignupFlow =
    reply.includes('تسجيل') ||
    reply.includes('حساب جديد') ||
    reply.includes('إنشاء حساب');

  if (hasSignup && hasNumberedSteps && mentionsSignupFlow) return reply;
  return recommended;
}

async function callDeepSeek(messages: ChatMessage[]): Promise<{
  content: string | null;
  tool_calls?: ToolCall[];
}> {
  if (!config.DEEPSEEK_API_KEY) {
    throw new Error('DEEPSEEK_API_KEY is required');
  }

  const payload = {
    model: 'deepseek-chat',
    messages,
    tools: SUPPORT_TOOL_DEFINITIONS,
    tool_choice: 'auto' as const,
    temperature: 0.3,
    max_tokens: 900,
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        // Retry transient upstream failures
        if ((response.status >= 500 || response.status === 429) && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 600));
          continue;
        }
        throw new Error(`DeepSeek error ${response.status}: ${errText.slice(0, 400)}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string | null;
            tool_calls?: ToolCall[];
          };
        }>;
      };

      const message = data.choices?.[0]?.message;
      return {
        content: message?.content ?? null,
        tool_calls: message?.tool_calls,
      };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes('fetch failed') ||
        msg.includes('other side closed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT');
      if (!transient || attempt >= 3) break;
      logger.warn({ attempt, err: msg }, 'DeepSeek call failed; retrying');
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function runTechnicalSupportAgent(ctx: InboundContext): Promise<AgentRunResult> {
  const conversationId = ctx.conversation?.id ?? null;

  let imageDescription: string | null = null;
  if (ctx.media) {
    imageDescription = await describeInboundImage(ctx.media);
    if (imageDescription && conversationId) {
      // Persist description on this inbound event for future history loads
      await pool.query(
        `UPDATE wa_inbound_events
         SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
         WHERE wa_message_id = $1`,
        [
          ctx.waMessageId,
          JSON.stringify({ image_description: imageDescription }),
        ],
      );
    }
  } else if (ctx.mediaError) {
    imageDescription = `تعذر استلام المرفق: ${ctx.mediaError}`;
  }

  const history = await loadConversationHistory(conversationId);

  const messages: ChatMessage[] = [
    { role: 'system', content: TECHNICAL_SUPPORT_SYSTEM_PROMPT },
    {
      role: 'system',
      content: `رقم واتساب المتصل حالياً: ${ctx.fromPhone}. conversation_id=${conversationId ?? 'null'}. service=${ctx.service?.key ?? 'unknown'}.`,
    },
  ];

  for (const h of history) {
    // Skip duplicating the current inbound body if it's the last user message — we'll append with image
    messages.push({ role: h.role, content: h.content });
  }

  // Ensure current turn is present (history may already include it from DB insert)
  const currentParts: string[] = [];
  if (ctx.body?.trim()) currentParts.push(ctx.body.trim());
  if (imageDescription) currentParts.push(`[وصف الصورة المرفقة الآن]\n${imageDescription}`);
  if (!currentParts.length) {
    // Empty non-media turns are skipped in the handler; only image-without-caption remains.
    currentParts.push('[أرسل الطالب صورة بدون نص]');
  }
  const currentUserText = currentParts.join('\n\n');

  const lastHist = history[history.length - 1];
  const alreadyInHistory =
    lastHist?.role === 'user' &&
    (lastHist.content === ctx.body?.trim() ||
      lastHist.content.includes(ctx.body?.trim() || '__never__'));

  if (!alreadyInHistory || imageDescription) {
    // If history already has the bare body, replace conceptually by appending richer turn
    if (alreadyInHistory && imageDescription) {
      messages.push({
        role: 'user',
        content: `[تحديث للرسالة الأخيرة مع تحليل الصورة]\n${currentUserText}`,
      });
    } else if (!alreadyInHistory) {
      messages.push({ role: 'user', content: currentUserText });
    }
  }

  let escalate = false;
  let finalReply =
    'حصل خطأ مؤقت في الدعم الفني. جرّب تاني بعد شوية، أو كلّم المدرس.';
  let lastSearchTenants: TenantSearchHit[] | null = null;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const result = await callDeepSeek(messages);
      const toolCalls = result.tool_calls;

      if (toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: result.content,
          tool_calls: toolCalls,
        });

        for (const call of toolCalls) {
          const args = parseToolArgs(call.function.arguments);
          const toolResult = await executeSupportTool(call.function.name, args, {
            fromPhone: ctx.fromPhone,
            conversationId,
          });

          if (call.function.name === 'search_tenants') {
            const tenants = (toolResult as { tenants?: TenantSearchHit[] })?.tenants;
            if (Array.isArray(tenants)) lastSearchTenants = tenants;
          }

          // Never log temporary passwords
          const safeForLog =
            call.function.name === 'reset_student_password'
              ? { tool: call.function.name, ok: (toolResult as { ok?: boolean })?.ok }
              : { tool: call.function.name };
          logger.info(safeForLog, 'support bot tool executed');

          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.function.name,
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      finalReply = (result.content || '').trim() || finalReply;
      escalate = wantsEscalate(finalReply);
      break;
    }
  } catch (err) {
    logger.error({ err }, 'technical support agent failed');
    finalReply =
      'معلش، مقدرتش أرد على رسالتك دلوقتي. جرّب تاني بعد شوية، أو كلّم المدرس على طول.';
  }

  const beforeJoinGuard = finalReply;
  finalReply = ensureTenantJoinReply(finalReply, lastSearchTenants);
  if (finalReply !== beforeJoinGuard) {
    logger.info(
      { conversationId },
      'support bot replaced soft tenant reply with recommended_reply_ar',
    );
  }

  // WhatsApp-friendly length
  if (finalReply.length > 3500) {
    finalReply = `${finalReply.slice(0, 3400)}…`;
  }

  return {
    reply: finalReply,
    escalate,
    imageDescription,
    metadata: {
      image_described: Boolean(imageDescription),
      tool_rounds_used: true,
    },
  };
}
