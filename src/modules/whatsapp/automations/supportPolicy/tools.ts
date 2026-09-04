import { applySupportPolicies } from '../technicalSupport/policyLayer';
import {
  loadPolicyPack,
  POLICY_STYLE_MODES,
  savePolicyPack,
  summarizePack,
  type PolicyStyleMode,
} from './pack';

export type PolicyToolContext = {
  adminUserId: number;
};

export const POLICY_TOOL_DEFINITIONS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_policies',
      description: 'عرض حالة التخصيص الحالية: مفعّل أم لا، الأسلوب، ونص تعليمات إعادة الصياغة.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_rewrite_prompt',
      description:
        'تعيين أو تحديث تعليمات إعادة الصياغة التي تُطبَّق على ردود الدعم الفني للطلاب. اكتب النص الكامل المحدّث (ادمج القديم مع الجديد). فارغ للمسح.',
      parameters: {
        type: 'object',
        properties: {
          rewrite_prompt: { type: 'string', description: 'النص الكامل للسياسة، أو فارغ للمسح' },
        },
        required: ['rewrite_prompt'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_style',
      description: 'تعيين أسلوب الردود النهائية: normal أو summary أو shorter.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: [...POLICY_STYLE_MODES] },
          tone_notes: { type: 'string' },
        },
        required: ['mode'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'set_pack_enabled',
      description: 'تشغيل أو إيقاف طبقة التخصيص بالكامل.',
      parameters: {
        type: 'object',
        properties: { enabled: { type: 'boolean' } },
        required: ['enabled'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'preview_rewrite',
      description:
        'معاينة ناتج الطبقة على مسودة جاهزة + نص طالب تجريبي بدون تشغيل وكيل الدعم الفني.',
      parameters: {
        type: 'object',
        properties: {
          draft: { type: 'string' },
          student_text: { type: 'string' },
        },
        required: ['draft', 'student_text'],
      },
    },
  },
];

export async function executePolicyTool(
  name: string,
  args: Record<string, unknown>,
  _ctx: PolicyToolContext,
): Promise<unknown> {
  switch (name) {
    case 'list_policies': {
      const pack = await loadPolicyPack();
      return { ok: true, pack: summarizePack(pack) };
    }
    case 'set_rewrite_prompt': {
      const pack = await loadPolicyPack();
      const prompt = String(args.rewrite_prompt || '').trim() || null;
      const saved = await savePolicyPack({ ...pack, rewrite_prompt: prompt });
      return { ok: true, rewrite_prompt: saved.rewrite_prompt };
    }
    case 'set_style': {
      const modeRaw = String(args.mode || 'normal');
      const mode: PolicyStyleMode = POLICY_STYLE_MODES.includes(modeRaw as PolicyStyleMode)
        ? (modeRaw as PolicyStyleMode)
        : 'normal';
      const pack = await loadPolicyPack();
      const tone_notes =
        typeof args.tone_notes === 'string' && args.tone_notes.trim()
          ? args.tone_notes.trim()
          : undefined;
      const saved = await savePolicyPack({
        ...pack,
        style: tone_notes ? { mode, tone_notes } : { mode },
      });
      return { ok: true, style: saved.style };
    }
    case 'set_pack_enabled': {
      const pack = await loadPolicyPack();
      const saved = await savePolicyPack({ ...pack, enabled: args.enabled !== false });
      return { ok: true, enabled: saved.enabled };
    }
    case 'preview_rewrite': {
      const draft = String(args.draft || '').trim();
      const studentText = String(args.student_text || '').trim();
      if (!draft) return { ok: false, error: 'draft مطلوب' };
      const result = await applySupportPolicies({
        draft,
        studentText,
        metadata: {},
      });
      return { ok: true, ...result };
    }
    default:
      return { ok: false, error: `أداة غير معروفة: ${name}` };
  }
}
