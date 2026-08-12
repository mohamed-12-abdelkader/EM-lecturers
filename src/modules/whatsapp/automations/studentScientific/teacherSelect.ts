import type { EligibleScientificTeacher } from '../resolveStudent';

export const SWITCH_TEACHER_COMMANDS = [
  'تغيير المدرس',
  'غير المدرس',
  'تغيير معلم',
  'غير معلم',
  'change teacher',
  'switch teacher',
];

export function isSwitchTeacherCommand(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, ' ');
  return SWITCH_TEACHER_COMMANDS.some((cmd) => normalized === cmd.toLowerCase());
}

export function formatTeacherPickerMessage(
  teachers: EligibleScientificTeacher[],
): string {
  const lines = teachers.map(
    (t, i) => `${i + 1}) ${t.name?.trim() || `مدرس #${t.id}`}`,
  );
  return [
    'اختر المدرس اللي عايز تسأل عن مواده (رد برقم الاختيار):',
    '',
    ...lines,
    '',
    'تقدر تغيّر المدرس في أي وقت بكتابة: تغيير المدرس',
  ].join('\n');
}

export function parseTeacherSelection(
  text: string,
  teachers: EligibleScientificTeacher[],
): EligibleScientificTeacher | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const index = Number(trimmed) - 1;
  if (index < 0 || index >= teachers.length) return null;
  return teachers[index];
}

export function teacherSelectedAck(teacher: EligibleScientificTeacher): string {
  const name = teacher.name?.trim() || `مدرس #${teacher.id}`;
  return [
    `تم اختيار: *${name}*`,
    '',
    'اسأل أي سؤال عن المنهج (نص أو صورة).',
    'لتغيير المدرس اكتب: تغيير المدرس',
  ].join('\n');
}
