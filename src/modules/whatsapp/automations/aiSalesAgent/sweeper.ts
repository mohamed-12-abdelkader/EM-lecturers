import { config, logger } from '../../../../utils';
import { WhatsAppOutboundQueue } from '../../queue/whatsappOutboundQueue';
import { AI_SALES_AGENT_KEY } from './constants';
import { SalesFollowupStore } from './followupStore';
import { SalesLeadStore } from './leadStore';
import pool from '../../../../db/pool';

const DEEPSEEK_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;
let timer: NodeJS.Timeout | null = null;
let running = false;

function inQuietHours(settings: any, now = new Date()): boolean {
  const start = Number(settings?.quiet_hours_start ?? 22);
  const end = Number(settings?.quiet_hours_end ?? 9);
  const hour = now.getHours();
  if (start === end) return false;
  if (start > end) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

function isWorkday(settings: any, now = new Date()): boolean {
  const days: number[] = Array.isArray(settings?.workdays) ? settings.workdays : [0, 1, 2, 3, 4];
  // JS: 0=Sun … align with settings as 0=Sun
  return days.includes(now.getDay());
}

async function craftFollowupMessage(row: any): Promise<string> {
  const fallback = `مرحباً 👋 كنت بكلمك بخصوص ${row.product_name || 'عرضنا'}. لو حابب نكمل أو عندك سؤال، أنا موجود.`;
  if (!config.DEEPSEEK_API_KEY) return fallback;

  try {
    const prompt = [
      'اكتب رسالة متابعة واتساب قصيرة جداً (سطرين أو 3) باللهجة المحددة.',
      'لا تضغط. لا تختلق أسعار. لا تكرر نفس الجملة الحرفية إن أمكن.',
      `المنتج: ${row.product_name}`,
      `اللهجة/الأسلوب: ${row.dialect || 'egyptian'} / ${row.tone || 'friendly'}`,
      row.context_summary ? `ملخص العميل:\n${row.context_summary}` : '',
      row.instructions ? `تعليمات المتابعة:\n${row.instructions}` : '',
      row.followup_settings?.instructions
        ? `تعليمات عامة للمتابعة:\n${row.followup_settings.instructions}`
        : '',
      row.reason ? `سبب المتابعة: ${row.reason}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: 'أنت كاتب رسائل متابعة مبيعات واتساب مختصر.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 220,
      }),
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return (data.choices?.[0]?.message?.content || '').trim() || fallback;
  } catch {
    return fallback;
  }
}

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due = await SalesFollowupStore.listDue(15);
    for (const row of due) {
      try {
        if (!row.wa_session_slug) {
          await SalesFollowupStore.mark(row.id, {
            status: 'skipped',
            lastError: 'missing_wa_session_slug',
          });
          continue;
        }
        if (inQuietHours(row.followup_settings) || !isWorkday(row.followup_settings)) {
          // push 2 hours later instead of failing
          await pool.query(
            `UPDATE wa_sales_followups
             SET scheduled_at = NOW() + INTERVAL '2 hours', updated_at = NOW()
             WHERE id = $1 AND status = 'pending'`,
            [row.id],
          );
          continue;
        }

        const body = await craftFollowupMessage(row);
        const jobId = await WhatsAppOutboundQueue.enqueue({
          serviceId: row.service_id,
          sessionSlug: row.wa_session_slug,
          to: row.contact_phone,
          body,
          conversationId: null,
          triggerType: 'sales_followup',
          triggerRef: String(row.id),
          metadata: {
            sales_session_id: row.session_id,
            lead_id: row.lead_id,
            followup_id: row.id,
            service_key: AI_SALES_AGENT_KEY,
          },
        });

        await SalesFollowupStore.mark(row.id, {
          status: 'sent',
          outboundJobId: jobId,
          messagePreview: body.slice(0, 500),
        });

        const lead = await SalesLeadStore.getById(row.lead_id, row.session_id);
        if (lead) {
          await SalesLeadStore.update(lead.id, row.session_id, {
            followup_count: Number(lead.followup_count || 0) + 1,
            last_action: 'followup_sent',
            last_contact_at: new Date().toISOString(),
            next_followup_at: null,
          });
        }

        await SalesLeadStore.logAction({
          sessionId: row.session_id,
          leadId: row.lead_id,
          actionType: 'followup_sent',
          payload: { followup_id: row.id },
          result: { job_id: jobId },
        });
      } catch (err) {
        logger.error({ err, followupId: row.id }, 'sales followup send failed');
        await SalesFollowupStore.mark(row.id, {
          status: 'failed',
          lastError: err instanceof Error ? err.message.slice(0, 300) : 'send_failed',
        });
      }
    }
  } finally {
    running = false;
  }
}

export function startAiSalesFollowupSweeper(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch((err) => logger.error({ err }, 'sales followup sweeper tick failed'));
  }, 60_000);
  // first pass shortly after boot
  setTimeout(() => {
    tick().catch(() => undefined);
  }, 12_000);
  logger.info('AI Sales Agent follow-up sweeper started');
}
