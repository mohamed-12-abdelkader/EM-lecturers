import { SalesLeadStore } from './leadStore';
import type { SalesLeadRow } from './types';

const TERMINAL = new Set(['won', 'lost', 'not_interested']);

const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  interested: 2,
  qualified: 3,
  demo_requested: 4,
  demo_completed: 5,
  negotiation: 6,
  follow_up: 2,
  won: 10,
  lost: 10,
  not_interested: 10,
};

function bumpStage(current: string, next: string): string {
  if (TERMINAL.has(current)) return current;
  if (TERMINAL.has(next)) return next;
  const curRank = STAGE_RANK[current] ?? 0;
  const nextRank = STAGE_RANK[next] ?? 0;
  // follow_up can move sideways from early stages
  if (next === 'follow_up' && curRank <= 3) return 'follow_up';
  return nextRank >= curRank ? next : current;
}

function maxScore(a: number, b: number): number {
  return Math.max(0, Math.min(100, Math.max(a || 0, b || 0)));
}

/**
 * Deterministic lead classification after each turn so dashboards stay accurate
 * even if the LLM forgets to call set_lead_stage / update_lead.
 */
export function classifyLeadPatch(opts: {
  lead: SalesLeadRow;
  userText: string;
  escalate?: boolean;
  toolsUsed?: string[];
}): Record<string, unknown> {
  const text = String(opts.userText || '').toLowerCase();
  const tools = new Set(opts.toolsUsed || []);
  let stage = opts.lead.stage || 'new';
  let score = Number(opts.lead.interest_score || 0);
  const memory = { ...(opts.lead.memory || {}) };
  let needsHuman = Boolean(memory.needs_human) || opts.lead.last_action === 'escalate_human';

  // Always at least contacted after a real exchange
  if (opts.userText?.trim()) {
    stage = bumpStage(stage, 'contacted');
    score = maxScore(score, 15);
  }

  if (
    /(بكام|سعر|أسعار|باقة|باقات|اشتراك|تسجيل|تجربة|ديمو|demo|price|pricing|package)/i.test(
      text,
    )
  ) {
    stage = bumpStage(stage, 'interested');
    score = maxScore(score, 45);
  }

  if (/(مهتم|عايز|محتاج|نبدأ|ممكن نشترك|أبعت اللينك|ابعت اللينك)/i.test(text)) {
    stage = bumpStage(stage, 'interested');
    score = maxScore(score, 55);
  }

  if (/(تجربة|ديمو|demo|جرب|جرّب)/i.test(text) || tools.has('send_demo_link')) {
    stage = bumpStage(stage, 'demo_requested');
    score = maxScore(score, 70);
  }

  if (tools.has('send_signup_link') || /(رابط الاشتراك|أسجل|اسجل|أدفع|ادفع)/i.test(text)) {
    stage = bumpStage(stage, 'negotiation');
    score = maxScore(score, 80);
  }

  if (/(هفكر|هرد|بعدين|ليس الآن|مش دلوقتي|لاحقا|later)/i.test(text)) {
    stage = bumpStage(stage, 'follow_up');
    score = maxScore(score, 35);
  }

  if (/(مش مهتم|لا شكرا|لا شكراً|مش عايز|الغاء|إلغاء)/i.test(text)) {
    stage = 'not_interested';
    score = Math.min(score, 10);
    needsHuman = false;
  }

  if (
    /(بشري|انسان|إنسان|موظف|مندوب|حد منكم|كلموني|كلّموني|عايز أتكلم مع|speak to (a )?human|real person|call me)/i.test(
      text,
    )
  ) {
    needsHuman = true;
    score = maxScore(score, 55);
  }

  if (opts.escalate || tools.has('escalate_human')) {
    needsHuman = true;
    score = maxScore(score, 60);
    if (!TERMINAL.has(stage) && stage === 'new') stage = 'contacted';
  }

  if (tools.has('mark_won')) {
    stage = 'won';
    score = 100;
    needsHuman = false;
  }

  memory.needs_human = needsHuman;
  memory.last_classified_at = new Date().toISOString();

  const patch: Record<string, unknown> = {
    stage,
    interest_score: score,
    memory,
  };
  if (needsHuman) {
    patch.last_action =
      opts.lead.last_action === 'escalate_human' ? 'escalate_human' : 'needs_human';
  }
  return patch;
}

export async function applyLeadClassification(opts: {
  lead: SalesLeadRow;
  sessionId: number;
  userText: string;
  escalate?: boolean;
  toolsUsed?: string[];
}): Promise<SalesLeadRow> {
  const patch = classifyLeadPatch(opts);
  const updated = await SalesLeadStore.update(opts.lead.id, opts.sessionId, patch);
  return updated || opts.lead;
}

export function isNeedsHumanLead(lead: SalesLeadRow): boolean {
  if (lead.last_action === 'escalate_human' || lead.last_action === 'needs_human') return true;
  return Boolean(lead.memory?.needs_human);
}
