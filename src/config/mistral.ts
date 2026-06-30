/** إعدادات Mistral — تُقرأ عند الاستخدام (بعد تحميل dotenv) */
export function getMistralConfig() {
  return {
    apiKey: (process.env.MISTRAL_API_KEY ?? '').trim(),
    ocrModel: process.env.MISTRAL_OCR_MODEL?.trim() || 'mistral-ocr-latest',
    chatModel: process.env.MISTRAL_CHAT_MODEL?.trim() || 'mistral-large-latest',
    apiBaseUrl: process.env.MISTRAL_API_BASE_URL?.trim() || 'https://api.mistral.ai/v1',
  };
}

export function assertMistralConfigured(): void {
  if (!getMistralConfig().apiKey) {
    throw new Error('MISTRAL_API_KEY_MISSING');
  }
}
