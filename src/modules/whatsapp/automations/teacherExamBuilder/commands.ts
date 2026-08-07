export type ExamBuilderWaCommand =
  | { type: 'approve' }
  | { type: 'regenerate' }
  | { type: 'help' }
  | { type: 'chat'; text: string };

const APPROVE_COMMANDS = [
  'موافق',
  'اعتماد',
  'اعتماد الأسئلة',
  'اعتمد',
  'اعتمد الأسئلة',
  'اعتماد القائمة',
];

const REGENERATE_COMMANDS = [
  'أعد',
  'اعد',
  'اعادة',
  'إعادة',
  'إعادة اختيار',
  'اعادة اختيار',
  'مجموعة جديدة',
  'اسئلة جديدة',
  'أسئلة جديدة',
];

const HELP_COMMANDS = ['مساعدة', 'مساعده', 'help', 'مرحبا', 'اهلا', 'أهلا', 'السلام عليكم'];

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function parseExamBuilderCommand(text: string): ExamBuilderWaCommand {
  const normalized = normalize(text);
  if (!normalized) {
    return { type: 'help' };
  }
  if (APPROVE_COMMANDS.some((c) => normalized === c.toLowerCase())) {
    return { type: 'approve' };
  }
  if (REGENERATE_COMMANDS.some((c) => normalized === c.toLowerCase())) {
    return { type: 'regenerate' };
  }
  if (HELP_COMMANDS.some((c) => normalized === c.toLowerCase())) {
    return { type: 'help' };
  }
  return { type: 'chat', text: text.trim() };
}

export const WA_COMMAND_FOOTER = [
  '',
  '—',
  'للتعديل: اكتب مثلاً «شيل السؤال 3»',
  'لإعادة الاختيار: أعد',
  'لاعتماد القائمة فقط: موافق',
  'لإكمال إنشاء الامتحان: افتح مساعد الامتحانات في الموقع',
].join('\n');

export const WA_HELP_REPLY = [
  'أنا *مساعد الامتحانات* عبر واتساب.',
  '',
  'مثال: أنشئ امتحان 10 أسئلة من الفصل الأول',
  '',
  'بعد الاقتراح:',
  '• عدّل: شيل السؤال 3',
  '• أعد الاختيار: أعد',
  '• اعتمد القائمة فقط: موافق',
  '',
  'بعد الاعتماد، أكمل إنشاء الامتحان من الموقع (اختيار الكورس/المحاضرة).',
].join('\n');
