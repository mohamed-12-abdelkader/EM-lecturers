import { SalesFollowupStore } from './followupStore';
import { SalesKnowledgeStore } from './knowledgeStore';
import { SalesLeadStore } from './leadStore';
import type { SalesAgentSessionRow, SalesLeadRow } from './types';

export type SalesToolContext = {
  session: SalesAgentSessionRow;
  lead: SalesLeadRow;
  conversationId: number | null;
};

export const SALES_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_knowledge',
      description:
        'ابحث في قاعدة معرفة هذه الجلسة فقط عن أسعار/مميزات/عروض/FAQ. لا تختلق معلومات.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'كلمات البحث' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_packages',
      description: 'اعرض الباقات والأسعار المعرّفة في إعدادات الجلسة',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_demo_link',
      description: 'جهّز رابط التجربة/الديمو المعتمد في الإعدادات لإرساله للعميل',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_signup_link',
      description: 'جهّز رابط التسجيل/الاشتراك المعتمد في الإعدادات',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_lead',
      description: 'حدّث بيانات العميل (احتياج، ميزانية، اهتمام، ملاحظات AI)',
      parameters: {
        type: 'object',
        properties: {
          contact_name: { type: 'string' },
          needs: { type: 'string' },
          budget: { type: 'string' },
          business_size: { type: 'string' },
          product_interest: { type: 'string' },
          interest_score: { type: 'integer', minimum: 0, maximum: 100 },
          objections: { type: 'array', items: { type: 'string' } },
          ai_notes: { type: 'string' },
          context_summary: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_lead_stage',
      description: 'غيّر مرحلة البيع للعميل',
      parameters: {
        type: 'object',
        properties: {
          stage: { type: 'string' },
        },
        required: ['stage'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_note',
      description: 'أضف ملاحظة داخلية على العميل',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: ['note'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_followup',
      description: 'جدول متابعة لاحقة (ساعات من الآن)',
      parameters: {
        type: 'object',
        properties: {
          hours_from_now: { type: 'number', minimum: 1 },
          reason: { type: 'string' },
          instructions: { type: 'string' },
        },
        required: ['hours_from_now'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'cancel_followup',
      description: 'ألغِ المتابعات المعلّقة لهذا العميل',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'stop_followups',
      description: 'أوقف كل المتابعات نهائياً (عدم اهتمام / طلب إيقاف)',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'mark_won',
      description: 'سجّل أن العميل اشترك / تم البيع',
      parameters: {
        type: 'object',
        properties: { note: { type: 'string' } },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'escalate_human',
      description:
        'بلّغ فريق المبيعات للمتابعة البشرية. لا توقف الردود — كمل مساعدة العميل إلى أن يتدخل إنسان من لوحة التحكم',
      parameters: {
        type: 'object',
        properties: { reason: { type: 'string' } },
      },
    },
  },
];

function toolAllowed(session: SalesAgentSessionRow, name: string): boolean {
  const tools = session.enabled_tools || [];
  return tools.includes(name);
}

export async function executeSalesTool(
  name: string,
  args: Record<string, unknown>,
  ctx: SalesToolContext,
): Promise<{ ok: boolean; data: Record<string, unknown>; escalate?: boolean }> {
  if (!toolAllowed(ctx.session, name)) {
    return { ok: false, data: { error: `الأداة غير مفعّلة لهذه الجلسة: ${name}` } };
  }

  const { session, lead } = ctx;

  switch (name) {
    case 'search_knowledge': {
      const query = String(args.query || '').trim();
      const hits = await SalesKnowledgeStore.search(session.id, query, 6);
      await SalesLeadStore.logAction({
        sessionId: session.id,
        leadId: lead.id,
        conversationId: ctx.conversationId,
        actionType: 'search_knowledge',
        payload: { query },
        result: { hits: hits.length },
      });
      return { ok: true, data: { hits } };
    }
    case 'list_packages': {
      return {
        ok: true,
        data: {
          packages: session.packages || [],
          demo_url: session.demo_url,
          signup_url: session.signup_url,
        },
      };
    }
    case 'send_demo_link': {
      if (!session.demo_url) {
        return { ok: false, data: { error: 'لا يوجد رابط ديمو مضبوط في إعدادات الجلسة' } };
      }
      await SalesLeadStore.update(lead.id, session.id, {
        last_action: 'sent_demo_link',
        stage: lead.stage === 'new' || lead.stage === 'contacted' ? 'demo_requested' : lead.stage,
      });
      await SalesLeadStore.logAction({
        sessionId: session.id,
        leadId: lead.id,
        conversationId: ctx.conversationId,
        actionType: 'send_demo_link',
        result: { url: session.demo_url },
      });
      return {
        ok: true,
        data: {
          message_to_include: `رابط التجربة: ${session.demo_url}`,
          url: session.demo_url,
        },
      };
    }
    case 'send_signup_link': {
      if (!session.signup_url) {
        return { ok: false, data: { error: 'لا يوجد رابط تسجيل مضبوط في إعدادات الجلسة' } };
      }
      await SalesLeadStore.update(lead.id, session.id, { last_action: 'sent_signup_link' });
      return {
        ok: true,
        data: {
          message_to_include: `رابط الاشتراك: ${session.signup_url}`,
          url: session.signup_url,
        },
      };
    }
    case 'update_lead': {
      const patch: Record<string, unknown> = {};
      for (const key of [
        'contact_name',
        'needs',
        'budget',
        'business_size',
        'product_interest',
        'interest_score',
        'objections',
        'ai_notes',
        'context_summary',
      ]) {
        if (args[key] !== undefined) patch[key] = args[key];
      }
      if (Object.keys(patch).length) {
        await SalesLeadStore.update(lead.id, session.id, { ...patch, last_action: 'update_lead' });
      }
      return { ok: true, data: { updated: Object.keys(patch) } };
    }
    case 'set_lead_stage': {
      const stage = String(args.stage || '').trim();
      const allowed = (session.custom_stages || []).map((s) => s.key);
      if (!allowed.includes(stage)) {
        return { ok: false, data: { error: 'مرحلة غير معرّفة', allowed } };
      }
      const status =
        stage === 'won' ? 'won' : stage === 'lost' || stage === 'not_interested' ? 'lost' : 'open';
      await SalesLeadStore.update(lead.id, session.id, {
        stage,
        status,
        last_action: `stage:${stage}`,
        ...(stage === 'won' ? { won_at: new Date().toISOString(), followups_stopped: true } : {}),
        ...(stage === 'not_interested' || stage === 'lost'
          ? { followups_stopped: true, followup_stop_reason: stage }
          : {}),
      });
      if (stage === 'won' || stage === 'lost' || stage === 'not_interested') {
        await SalesFollowupStore.cancelPendingForLead(lead.id, stage);
      }
      return { ok: true, data: { stage, status } };
    }
    case 'add_note': {
      const note = String(args.note || '').trim();
      if (!note) return { ok: false, data: { error: 'note مطلوب' } };
      const prev = lead.ai_notes ? `${lead.ai_notes}\n` : '';
      await SalesLeadStore.update(lead.id, session.id, {
        ai_notes: `${prev}${new Date().toISOString().slice(0, 16)}: ${note}`.slice(0, 4000),
        last_action: 'add_note',
      });
      return { ok: true, data: { saved: true } };
    }
    case 'create_followup': {
      const settings = session.followup_settings || {};
      if (settings.enabled === false) {
        return { ok: false, data: { error: 'المتابعة التلقائية متوقفة لهذه الجلسة' } };
      }
      if (lead.followups_stopped) {
        return { ok: false, data: { error: 'المتابعات متوقفة لهذا العميل' } };
      }
      const max = Number(settings.max_followups ?? 3);
      if (lead.followup_count >= max) {
        return { ok: false, data: { error: `تم الوصول للحد الأقصى للمتابعات (${max})` } };
      }
      const hours = Math.max(1, Number(args.hours_from_now || 24));
      const minHours = Number(settings.min_hours_between ?? 24);
      const when = new Date(Date.now() + Math.max(hours, minHours) * 3600 * 1000);
      const fu = await SalesFollowupStore.create({
        sessionId: session.id,
        leadId: lead.id,
        scheduledAt: when,
        reason: String(args.reason || 'ai_scheduled'),
        instructions: String(args.instructions || ''),
      });
      await SalesLeadStore.update(lead.id, session.id, {
        last_action: 'create_followup',
        stage: lead.stage === 'new' ? 'follow_up' : lead.stage,
      });
      return { ok: true, data: { followup_id: fu.id, scheduled_at: fu.scheduled_at } };
    }
    case 'cancel_followup': {
      await SalesFollowupStore.cancelPendingForLead(lead.id, 'cancelled_by_agent');
      return { ok: true, data: { cancelled: true } };
    }
    case 'stop_followups': {
      const reason = String(args.reason || 'stopped_by_agent');
      await SalesFollowupStore.cancelPendingForLead(lead.id, reason);
      await SalesLeadStore.update(lead.id, session.id, {
        followups_stopped: true,
        followup_stop_reason: reason,
        last_action: 'stop_followups',
      });
      return { ok: true, data: { stopped: true, reason } };
    }
    case 'mark_won': {
      await SalesFollowupStore.cancelPendingForLead(lead.id, 'won');
      await SalesLeadStore.update(lead.id, session.id, {
        stage: 'won',
        status: 'won',
        won_at: new Date().toISOString(),
        followups_stopped: true,
        followup_stop_reason: 'won',
        last_action: 'mark_won',
        ai_notes: args.note
          ? `${lead.ai_notes ? lead.ai_notes + '\n' : ''}Won: ${String(args.note)}`
          : lead.ai_notes,
      });
      return { ok: true, data: { won: true } };
    }
    case 'escalate_human': {
      // Notify inbox (waiting_human) but keep AI enabled so the customer
      // still gets answers until a human actually takes the chat.
      await SalesLeadStore.update(lead.id, session.id, {
        ai_enabled: true,
        last_action: 'escalate_human',
        ai_notes: [
          lead.ai_notes || '',
          `${new Date().toISOString().slice(0, 16)}: طلب تحويل لفريق بشري${
            args.reason ? ` — ${String(args.reason)}` : ''
          }`,
        ]
          .filter(Boolean)
          .join('\n')
          .slice(0, 4000),
      });
      await SalesLeadStore.logAction({
        sessionId: session.id,
        leadId: lead.id,
        conversationId: ctx.conversationId,
        actionType: 'escalate_human',
        payload: { reason: args.reason || null, ai_kept_active: true },
      });
      return {
        ok: true,
        escalate: true,
        data: {
          escalated: true,
          reason: args.reason || null,
          user_message:
            'تمام، بلّغت فريقنا وهيتابعوا معاك. ولو عندك أي سؤال كمان قولي وأنا معاك لحد ما حد من التيم يرد.',
        },
      };
    }
    default:
      return { ok: false, data: { error: `أداة غير معروفة: ${name}` } };
  }
}

export function filterToolDefinitions(session: SalesAgentSessionRow) {
  const enabled = new Set(session.enabled_tools || []);
  return SALES_TOOL_DEFINITIONS.filter((t) => enabled.has(t.function.name));
}
