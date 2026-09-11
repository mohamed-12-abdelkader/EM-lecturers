import { getMistralConfig } from './mistral';

export type ExtractionModelOption = {
  id: string;
  label: string;
  description: string;
  type: 'chat' | 'ocr';
  is_default: boolean;
};

/** Default Chat step for extract-questions (OCR stays on Mistral). */
export const DEFAULT_EXTRACTION_CHAT_MODEL = 'deepseek-chat';

export function isDeepSeekChatModel(model: string): boolean {
  return model.trim().toLowerCase().startsWith('deepseek');
}

const CHAT_MODELS: Omit<ExtractionModelOption, 'is_default'>[] = [
  {
    id: 'deepseek-chat',
    label: 'DeepSeek Chat',
    description: 'الافتراضي — تحليل الأسئلة من نص OCR (يتجنب حد معدل Mistral Chat)',
    type: 'chat',
  },
  {
    id: 'mistral-medium-latest',
    label: 'Mistral Medium',
    description: 'دقة عالية مع صور الصفحات — قد يُرفض (429) إذا نفد حد الحساب',
    type: 'chat',
  },
  {
    id: 'mistral-large-latest',
    label: 'Mistral Large',
    description: 'أعلى دقة — يتطلب اشتراك أعلى وقد يُرفض (403) على بعض الحسابات',
    type: 'chat',
  },
  {
    id: 'mistral-small-latest',
    label: 'Mistral Small',
    description: 'أسرع وأخف — مناسب للملفات البسيطة',
    type: 'chat',
  },
  {
    id: 'ministral-8b-latest',
    label: 'Ministral 8B',
    description: 'خفيف وسريع — للمعاينة السريعة',
    type: 'chat',
  },
];

const OCR_MODELS: Omit<ExtractionModelOption, 'is_default'>[] = [
  {
    id: 'mistral-ocr-latest',
    label: 'Mistral OCR',
    description: 'استخراج النص والصور من PDF وصور',
    type: 'ocr',
  },
];

const ALLOWED_CHAT_MODELS = new Set(CHAT_MODELS.map((m) => m.id));
const ALLOWED_OCR_MODELS = new Set(OCR_MODELS.map((m) => m.id));

export function resolveChatModel(requested?: string | null): string {
  const trimmed = requested?.trim();
  if (trimmed && ALLOWED_CHAT_MODELS.has(trimmed)) return trimmed;
  const envDefault =
    process.env.QUESTION_EXTRACTION_CHAT_MODEL?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim();
  if (envDefault && ALLOWED_CHAT_MODELS.has(envDefault)) return envDefault;
  if (envDefault && isDeepSeekChatModel(envDefault)) return envDefault;
  return DEFAULT_EXTRACTION_CHAT_MODEL;
}

export function resolveOcrModel(requested?: string | null): string {
  const trimmed = requested?.trim();
  if (trimmed && ALLOWED_OCR_MODELS.has(trimmed)) return trimmed;
  return getMistralConfig().ocrModel;
}

export function listExtractionModels(): {
  chat_models: ExtractionModelOption[];
  ocr_models: ExtractionModelOption[];
  defaults: { chat_model: string; ocr_model: string };
} {
  const chatModel = resolveChatModel();
  const { ocrModel } = getMistralConfig();
  return {
    chat_models: CHAT_MODELS.map((m) => ({
      ...m,
      is_default: m.id === chatModel,
    })),
    ocr_models: OCR_MODELS.map((m) => ({
      ...m,
      is_default: m.id === ocrModel,
    })),
    defaults: {
      chat_model: chatModel,
      ocr_model: ocrModel,
    },
  };
}
