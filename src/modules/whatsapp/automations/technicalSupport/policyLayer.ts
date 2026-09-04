import { config, logger } from '../../../../utils';
import { loadPolicyPack, type SupportPolicyPack } from '../supportPolicy/pack';

export type PolicyLayerInput = {
  draft: string;
  studentText: string;
  metadata?: Record<string, unknown> | null;
};

export type PolicyLayerResult = {
  reply: string;
  metadata: Record<string, unknown>;
};

const DEEPSEEK_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;

function extractProtectedTokens(draft: string): string[] {
  const urls = draft.match(/https?:\/\/[^\s)]+/gi) || [];
  const codes = draft.match(/\b\d{6,10}\b/g) || [];
  return [...new Set([...urls, ...codes])];
}

function restoreProtectedTokens(draft: string, rewritten: string): string {
  const missing = extractProtectedTokens(draft).filter((t) => !rewritten.includes(t));
  if (!missing.length) return rewritten;
  return `${rewritten.trim()}\n\n${missing.join('\n')}`.trim();
}

function styleInstruction(pack: SupportPolicyPack): string {
  if (pack.style.mode === 'summary') {
    return 'اختصر الرد في خلاصة قصيرة واضحة (٣–٦ أسطر كحد أقصى).';
  }
  if (pack.style.mode === 'shorter') {
    return 'اجعل الرد أقصر من المسودة مع الإبقاء على الخطوات الأساسية.';
  }
  return 'حافظ على طول قريب من المسودة.';
}

async function rewriteDraft(params: {
  draft: string;
  studentText: string;
  pack: SupportPolicyPack;
}): Promise<string> {
  if (!config.DEEPSEEK_API_KEY) {
    logger.warn('policy layer skipped rewrite: DEEPSEEK_API_KEY missing');
    return params.draft;
  }

  const tone = params.pack.style.tone_notes
    ? `ملاحظات الأسلوب: ${params.pack.style.tone_notes}`
    : '';

  const system = `أنت طبقة تخصيص فوق دعم فني واتساب. تعيد صياغة المسودة النهائية للطالب بالعامية المصرية المهذبة.
قيود صارمة:
- ممنوع اختراع باسورد أو كود تفعيل أو رابط غير موجود في المسودة.
- لازم تبقي أي روابط أو أكواد موجودة في المسودة كما هي حرفياً.
- طبّق تعليمات الإدارة كسياق طبيعي داخل الرد — لا تستبدل المسودة بنص ثابت جاهز إلا لو التعليمات تقول توضّح معلومة معيّنة.
- لا تقل إنك روبوت تخصيص.`;

  const user = [
    `سؤال الطالب:\n${params.studentText || '—'}`,
    `مسودة الدعم الفني:\n${params.draft}`,
    `تعليمات الإدارة:\n${params.pack.rewrite_prompt}`,
    styleInstruction(params.pack),
    tone,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`DeepSeek error ${response.status}: ${errText.slice(0, 300)}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const text = (data.choices?.[0]?.message?.content || '').trim();
    if (!text) return params.draft;
    return restoreProtectedTokens(params.draft, text);
  } catch (err) {
    logger.warn({ err }, 'support policy rewrite failed; using draft');
    return params.draft;
  }
}

export async function applySupportPolicies(
  input: PolicyLayerInput,
): Promise<PolicyLayerResult> {
  const draft = (input.draft || '').trim();
  if (!draft) {
    return { reply: input.draft, metadata: { policy_applied: false } };
  }

  let pack: SupportPolicyPack;
  try {
    pack = await loadPolicyPack();
  } catch (err) {
    logger.warn({ err }, 'failed to load support policy pack');
    return { reply: draft, metadata: { policy_applied: false, policy_error: true } };
  }

  if (!pack.enabled) {
    return { reply: draft, metadata: { policy_applied: false, pack_disabled: true } };
  }

  if (!pack.rewrite_prompt && pack.style.mode === 'normal') {
    return { reply: draft, metadata: { policy_applied: false } };
  }

  const rewritten = await rewriteDraft({
    draft,
    studentText: input.studentText,
    pack,
  });

  return {
    reply: rewritten,
    metadata: {
      policy_applied: rewritten.trim() !== draft,
      policy_action: 'rewrite',
      style_mode: pack.style.mode,
    },
  };
}
