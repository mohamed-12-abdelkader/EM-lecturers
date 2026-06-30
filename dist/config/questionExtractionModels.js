"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveChatModel = resolveChatModel;
exports.resolveOcrModel = resolveOcrModel;
exports.listExtractionModels = listExtractionModels;
const mistral_1 = require("./mistral");
const CHAT_MODELS = [
    {
        id: 'mistral-large-latest',
        label: 'Mistral Large',
        description: 'أعلى دقة — مناسب للامتحانات المعقدة والقطع الطويلة',
        type: 'chat',
    },
    {
        id: 'mistral-medium-latest',
        label: 'Mistral Medium',
        description: 'توازن بين السرعة والدقة',
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
const OCR_MODELS = [
    {
        id: 'mistral-ocr-latest',
        label: 'Mistral OCR',
        description: 'استخراج النص والصور من PDF وصور',
        type: 'ocr',
    },
];
const ALLOWED_CHAT_MODELS = new Set(CHAT_MODELS.map((m) => m.id));
const ALLOWED_OCR_MODELS = new Set(OCR_MODELS.map((m) => m.id));
function resolveChatModel(requested) {
    const trimmed = requested?.trim();
    if (trimmed && ALLOWED_CHAT_MODELS.has(trimmed))
        return trimmed;
    return (0, mistral_1.getMistralConfig)().chatModel;
}
function resolveOcrModel(requested) {
    const trimmed = requested?.trim();
    if (trimmed && ALLOWED_OCR_MODELS.has(trimmed))
        return trimmed;
    return (0, mistral_1.getMistralConfig)().ocrModel;
}
function listExtractionModels() {
    const { chatModel, ocrModel } = (0, mistral_1.getMistralConfig)();
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
