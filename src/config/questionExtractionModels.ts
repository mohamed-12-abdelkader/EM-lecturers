import { getMistralConfig } from './mistral';

export type ExtractionModelOption = {
  id: string;
  label: string;
  description: string;
  type: 'chat' | 'ocr';
  is_default: boolean;
};

const CHAT_MODELS: Omit<ExtractionModelOption, 'is_default'>[] = [
  {
    id: 'mistral-medium-latest',
    label: 'Mistral Medium',
    description: 'الافتراضي — دقة عالية مع صور الصفحات، متاح على معظم الاشتراكات',
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
  return getMistralConfig().chatModel;
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
  const { chatModel, ocrModel } = getMistralConfig();
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
