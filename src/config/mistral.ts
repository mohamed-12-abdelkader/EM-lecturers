/** إعدادات Mistral — تُقرأ عند الاستخدام (بعد تحميل dotenv) */
export function getMistralConfig() {
  return {
    apiKey: (process.env.MISTRAL_API_KEY ?? '').trim(),
    ocrModel: process.env.MISTRAL_OCR_MODEL?.trim() || 'mistral-ocr-latest',
    chatModel: process.env.MISTRAL_CHAT_MODEL?.trim() || 'mistral-large-latest',
    apiBaseUrl: process.env.MISTRAL_API_BASE_URL?.trim() || 'https://api.mistral.ai/v1',
    /**
     * Max upload size for OCR / extract-questions (bytes).
     * Env: MISTRAL_OCR_MAX_FILE_SIZE_MB — default 512. Set 0 for unlimited.
     */
    maxUploadBytes: (() => {
      const raw = process.env.MISTRAL_OCR_MAX_FILE_SIZE_MB;
      if (raw === undefined || raw === '') return 512 * 1024 * 1024;
      const mb = Number(raw);
      if (!Number.isFinite(mb) || mb < 0) return 512 * 1024 * 1024;
      if (mb === 0) return Number.POSITIVE_INFINITY;
      return Math.trunc(mb) * 1024 * 1024;
    })(),
    /** Pages per Mistral OCR request (hard limit from provider). */
    maxPagesPerOcrRequest: 50,
  };
}

export function assertMistralConfigured(): void {
  if (!getMistralConfig().apiKey) {
    throw new Error('MISTRAL_API_KEY_MISSING');
  }
}
