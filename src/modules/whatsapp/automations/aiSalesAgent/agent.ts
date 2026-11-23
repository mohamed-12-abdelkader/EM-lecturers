import { config, logger } from '../../../../utils';
import type { InboundContext } from '../types';
import { SalesKnowledgeStore } from './knowledgeStore';
import { SalesLeadStore } from './leadStore';
import { SalesAgentSessionStore } from './sessionStore';
import type { SalesAgentSessionRow, SalesLeadRow } from './types';
import { executeSalesTool, filterToolDefinitions } from './tools';
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

export type SalesAgentRunResult = {
  reply: string;
  escalate: boolean;
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

function buildSystemPrompt(
  session: SalesAgentSessionRow,
  lead: SalesLeadRow,
  kbBrief: string,
): string {
  const stages = (session.custom_stages || []).map((s) => `${s.key}=${s.label}`).join(', ');
  const packages =
    (session.packages || [])
      .map(
        (p) =>
          `- ${p.name}${p.price ? `: ${p.price}${p.currency ? ' ' + p.currency : ''}` : ''}${
            p.description ? ` — ${p.description}` : ''
          }`,
      )
      .join('\n') || '(لا باقات مضبوطة بعد — استخدم search_knowledge فقط)';

  return [
    'أنت وكيل مبيعات واتساب ذكي متخصص في منتج واحد فقط ضمن Session معزولة.',
    'لا تختلق أسعار أو عروض أو مميزات غير موجودة في الإعدادات أو قاعدة المعرفة.',
    'لو المعلومة مش موجودة، قول بصراحة إنك هتتأكد أو حوّل لإنسان عبر escalate_human.',
    'بعد escalate_human: بلّغ العميل إن التيم هيتابع، وكمل الرد على أسئلته بشكل طبيعي لحد ما حد بشري يدخل المحادثة.',
    'ردود قصيرة مناسبة لواتساب (جمل قليلة). لو محتاج تفاصيل، قسّمها ذهنياً لرسائل قصيرة.',
    'لا تكرر نفس السؤال. استخدم ملخص العميل والأدوات لتحديث الحالة.',
    'لا تقدم خصومات من عندك. لا تضغط بشكل مزعج.',
    '',
    `## Session`,
    `الاسم: ${session.name}`,
    `المنتج: ${session.product_name}`,
    session.product_description ? `وصف المنتج: ${session.product_description}` : '',
    session.goal ? `الهدف: ${session.goal}` : '',
    session.target_audience ? `الجمهور: ${session.target_audience}` : '',
    `اللغة: ${session.language} | اللهجة: ${session.dialect || 'egyptian'} | الأسلوب: ${session.tone || 'friendly'} | الرسمية: ${session.formality}`,
    session.persona ? `الشخصية: ${session.persona}` : '',
    session.general_instructions ? `تعليمات عامة:\n${session.general_instructions}` : '',
    session.sales_instructions ? `استراتيجية البيع:\n${session.sales_instructions}` : '',
    '',
    `## الباقات`,
    packages,
    session.demo_url ? `رابط ديمو: ${session.demo_url}` : '',
    session.signup_url ? `رابط اشتراك: ${session.signup_url}` : '',
    '',
    `## مراحل البيع المتاحة`,
    stages,
    '',
    `## العميل الحالي`,
    `الهاتف: ${lead.contact_phone}`,
    `الاسم: ${lead.contact_name || 'غير معروف'}`,
    `المرحلة: ${lead.stage} | الاهتمام: ${lead.interest_score}`,
    lead.needs ? `الاحتياجات: ${lead.needs}` : '',
    lead.budget ? `الميزانية: ${lead.budget}` : '',
    lead.objections?.length ? `الاعتراضات: ${lead.objections.join(' | ')}` : '',
    lead.context_summary ? `ملخص سابق:\n${lead.context_summary}` : '',
    lead.campaign_name ? `حملة: ${lead.campaign_name}` : '',
    '',
    `## مقتطف من قاعدة المعرفة (هذه الجلسة فقط)`,
    kbBrief,
    '',
    'بعد كل محادثة مهمة استخدم update_lead لتحديث الملخص والاحتياجات، واستخدم create_followup لو العميل هيتأخر.',
  ]
    .filter(Boolean)
    .join('\n');
}

async function loadHistory(conversationId: number | null): Promise<ChatMessage[]> {
  if (!conversationId) return [];
  const [inbound, outbound] = await Promise.all([
    pool.query(
      `SELECT body, processed_at, metadata FROM wa_inbound_events
       WHERE conversation_id = $1 AND body IS NOT NULL AND body <> ''
       ORDER BY processed_at DESC LIMIT 16`,
      [conversationId],
    ),
    pool.query(
      `SELECT body, created_at FROM wa_outbound_jobs
       WHERE conversation_id = $1 AND body IS NOT NULL AND body <> ''
         AND status IN ('sent','pending','processing')
       ORDER BY created_at DESC LIMIT 16`,
      [conversationId],
    ),
  ]);
  const rows: Array<{ role: 'user' | 'assistant'; content: string; at: number }> = [];
  for (const r of inbound.rows) {
    const img =
      r.metadata && typeof r.metadata === 'object' && (r.metadata as any).image_description
        ? `\n[صورة: ${(r.metadata as any).image_description}]`
        : '';
    rows.push({
      role: 'user',
      content: `${String(r.body || '')}${img}`.trim(),
      at: new Date(r.processed_at).getTime(),
    });
  }
  for (const r of outbound.rows) {
    rows.push({
      role: 'assistant',
      content: String(r.body || ''),
      at: new Date(r.created_at).getTime(),
    });
  }
  return rows
    .sort((a, b) => a.at - b.at)
    .slice(-20)
    .map((r) => ({ role: r.role, content: r.content }));
}

async function callDeepSeek(
  messages: ChatMessage[],
  tools: ReturnType<typeof filterToolDefinitions>,
): Promise<{ content: string | null; tool_calls?: ToolCall[] }> {
  if (!config.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is required');

  const payload: Record<string, unknown> = {
    // Tool-calling path needs a chat model that supports tools (same as technical support)
    model: 'deepseek-chat',
    messages,
    temperature: 0.45,
    max_tokens: 700,
  };
  if (tools.length) {
    payload.tools = tools;
    payload.tool_choice = 'auto';
  }

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
        const msg = `DeepSeek error ${response.status}: ${errText.slice(0, 400)}`;
        if ((response.status >= 500 || response.status === 429) && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 600));
          lastError = new Error(msg);
          continue;
        }
        throw new Error(msg);
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
      };
      const message = data.choices?.[0]?.message;
      return { content: message?.content ?? null, tool_calls: message?.tool_calls };
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const transient =
        msg.includes('fetch failed') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('other side closed');
      if (!transient || attempt >= 3) break;
      logger.warn({ attempt, err: msg }, 'sales DeepSeek call failed; retrying');
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function extractReferral(ctx: InboundContext): Record<string, unknown> {
  const meta = (ctx.metadata || {}) as Record<string, unknown>;
  const referral =
    (meta.referral as Record<string, unknown>) ||
    (meta.ctwa_context as Record<string, unknown>) ||
    {};
  return {
    campaign_id: referral.campaign_id || meta.campaign_id || null,
    campaign_name: referral.campaign_name || meta.campaign_name || null,
    ad_id: referral.ad_id || meta.ad_id || null,
    ad_name: referral.ad_name || meta.ad_name || null,
    adset: referral.adset || meta.adset || null,
    source_url: referral.source_url || meta.source_url || null,
    raw: referral,
  };
}

export async function runSalesAgent(opts: {
  ctx: InboundContext;
  session: SalesAgentSessionRow;
  userText?: string;
}): Promise<SalesAgentRunResult> {
  const { ctx, session } = opts;
  const phone = ctx.fromPhone;
  const conversationId = ctx.conversation?.id ?? null;

  try {
    let lead = await SalesLeadStore.upsertFromInbound({
      sessionId: session.id,
      phone,
      conversationId,
      contactName:
        (typeof ctx.metadata?.push_name === 'string' && ctx.metadata.push_name) ||
        (typeof ctx.metadata?.notify_name === 'string' && ctx.metadata.notify_name) ||
        null,
      referral: extractReferral(ctx),
    });

    // Legacy escalate used to disable AI permanently. Re-enable unless a human
    // already owns the WhatsApp conversation from the inbox.
    if (!lead.ai_enabled) {
      const humanOwnsChat = ctx.conversation?.status === 'human';
      if (humanOwnsChat) {
        return {
          reply: '',
          escalate: false,
          metadata: { skipped: true, reason: 'ai_disabled_for_lead' },
        };
      }
      await SalesLeadStore.update(lead.id, session.id, {
        ai_enabled: true,
        last_action: 'ai_reenabled_after_escalate',
      }).catch(() => undefined);
      lead = { ...lead, ai_enabled: true };
    }

    if (session.status === 'paused') {
      return {
        reply: '',
        escalate: false,
        metadata: { skipped: true, reason: 'session_paused' },
      };
    }

    const userText = (opts.userText ?? ctx.body ?? '').trim();
    const kbBrief = await SalesKnowledgeStore.buildContextBrief(session.id);
    const tools = filterToolDefinitions(session);
    const history = await loadHistory(conversationId);

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(session, lead, kbBrief) },
      ...history,
    ];
    if (userText) {
      messages.push({ role: 'user', content: userText });
    } else if (ctx.mediaError) {
      messages.push({
        role: 'user',
        content: `تعذر استلام مرفق من العميل: ${ctx.mediaError}. اطلب إعادة الإرسال بلطف.`,
      });
    } else {
      messages.push({
        role: 'user',
        content: '(رسالة بدون نص — رحّب باختصار واسأل كيف تساعد)',
      });
    }

    let escalate = false;
    let finalReply = '';
    let mediaUrlsToSend: string[] = [];
    let llmError: string | null = null;

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const result = await callDeepSeek(messages, tools);
        if (result.tool_calls?.length) {
          messages.push({
            role: 'assistant',
            content: result.content ?? '',
            tool_calls: result.tool_calls,
          });
          for (const call of result.tool_calls) {
            const fnName = call?.function?.name || 'unknown';
            const args = parseToolArgs(call?.function?.arguments || '{}');
            const freshLead = (await SalesLeadStore.getById(lead.id, session.id)) || lead;
            let toolResult: Awaited<ReturnType<typeof executeSalesTool>>;
            try {
              toolResult = await executeSalesTool(fnName, args, {
                session,
                lead: freshLead,
                conversationId,
              });
            } catch (toolErr) {
              toolResult = {
                ok: false,
                data: {
                  error: toolErr instanceof Error ? toolErr.message : String(toolErr),
                },
              };
            }
            if (toolResult.escalate) escalate = true;
            if (typeof toolResult.data.message_to_include === 'string') {
              mediaUrlsToSend.push(String(toolResult.data.message_to_include));
            }
            lead = (await SalesLeadStore.getById(lead.id, session.id)) || lead;
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              name: fnName,
              content: JSON.stringify(toolResult),
            });
          }
          continue;
        }
        finalReply = (result.content || '').trim();
        break;
      }
    } catch (err) {
      llmError = err instanceof Error ? err.message : String(err);
      logger.error(
        { err, sessionId: session.id, leadId: lead.id, llmError },
        'sales agent LLM failed',
      );
      finalReply =
        'حاضر، دقيقة لو سمحت… حصل تأخير بسيط. ابعتلي تاني طلبك وأنا معاك على طول.';
    }

    if (!finalReply && mediaUrlsToSend.length) {
      finalReply = mediaUrlsToSend.join('\n');
    } else if (finalReply && mediaUrlsToSend.length) {
      for (const extra of mediaUrlsToSend) {
        if (!finalReply.includes(extra)) finalReply = `${finalReply}\n${extra}`;
      }
    }

    if (!finalReply && escalate) {
      finalReply = 'تمام، هحوّلك لحد من فريقنا يتابع معاك.';
    }

    if (!finalReply && !escalate) {
      return {
        reply: '',
        escalate: false,
        metadata: { skipped: true, reason: 'empty_reply', llm_error: llmError },
      };
    }

    if (userText && finalReply) {
      const summaryBits = [
        lead.context_summary || '',
        `آخر رسالة عميل: ${userText.slice(0, 160)}`,
        `آخر رد: ${finalReply.slice(0, 160)}`,
      ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 1800);
      await SalesLeadStore.update(lead.id, session.id, {
        context_summary: summaryBits,
        last_contact_at: new Date().toISOString(),
        stage: lead.stage === 'new' ? 'contacted' : lead.stage,
      }).catch(() => undefined);
    }

    if (llmError) {
      await SalesAgentSessionStore.update(session.id, {
        last_error: llmError.slice(0, 500),
      }).catch(() => undefined);
    }

    return {
      reply: finalReply,
      escalate,
      metadata: {
        sales_session_id: session.id,
        lead_id: lead.id,
        stage: lead.stage,
        ...(llmError ? { llm_error: llmError.slice(0, 300) } : {}),
      },
    };
  } catch (err) {
    // Ensure unexpected DB/setup errors still surface a reply via handler
    logger.error({ err, sessionId: session.id }, 'sales agent run failed');
    throw err;
  }
}
