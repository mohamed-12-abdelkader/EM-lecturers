export type ExamBuilderWaCommand =
  | { type: 'help' }
  | { type: 'cancel' }
  | { type: 'chat'; text: string };

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseExamBuilderCommand(text: string): ExamBuilderWaCommand {
  const normalized = normalize(text);
  if (!normalized) return { type: 'help' };
  if (['مساعدة', 'مساعده', 'help', 'مرحبا', 'اهلا', 'أهلا', 'السلام عليكم'].includes(normalized)) {
    return { type: 'help' };
  }
  if (/^(إلغاء|الغاء|الغي|ألغي|cancel)$/.test(normalized)) {
    return { type: 'cancel' };
  }
  return { type: 'chat', text: text.trim() };
}

export const WA_COMMAND_FOOTER = [
  '',
  '—',
  'للتعديل: اكتب مثلاً «شيل السؤال 3»',
  'للنشر بعد المراجعة: انشر',
  'للإلغاء: إلغاء',
].join('\n');

export const WA_HELP_REPLY = [
  'أنا *مساعد الامتحانات* عبر واتساب 🎓',
  '',
  'أقدر أعمل معاك:',
  '• امتحان من *بنك الأسئلة* (مثال: اعمل امتحان 20 سؤال على درس الهرمونات)',
  '• امتحان من *ملف PDF أو صور* (ابعت الملفات ثم اكتب خلصت)',
  '',
  'بعد التجهيز:',
  '• راجع من الرابط',
  '• عدّل: شيل السؤال 3 / زود 5 أسئلة',
  '• اختار النوع: عام / واجب / شامل',
  '• انشر بعد الموافقة الصريحة فقط',
  '',
  'أوامر مفيدة: مساعدة · إلغاء · خلصت · انشر',
].join('\n');
