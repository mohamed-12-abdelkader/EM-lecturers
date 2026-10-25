import type { ExamCohort } from './constants';

export const DEFAULT_PARENT_EXAM_TEMPLATES: Record<ExamCohort, string> = {
  passed: 'ولي أمر {الاسم}، نتيجة «{الامتحان}»: {الدرجة}/{المجموع} — ألف مبروك، نجح.',
  failed: 'ولي أمر {الاسم}، نتيجة «{الامتحان}»: {الدرجة}/{المجموع} — للأسف ما نجحش.',
  absent: 'ولي أمر {الاسم}، {الاسم} ما دخلش امتحان «{الامتحان}» خالص.',
};

export function applyParentExamTemplate(
  template: string,
  input: { studentName: string; examTitle: string; score?: number | null; total?: number | null },
): string {
  const name = (input.studentName || 'الطالب').trim();
  const exam = (input.examTitle || 'الامتحان').trim();
  const score = String(Number(input.score ?? 0));
  const total = String(Number(input.total ?? 0));
  return template
    .replaceAll('{الاسم}', name)
    .replaceAll('{name}', name)
    .replaceAll('{الامتحان}', exam)
    .replaceAll('{exam}', exam)
    .replaceAll('{الدرجة}', score)
    .replaceAll('{score}', score)
    .replaceAll('{المجموع}', total)
    .replaceAll('{total}', total);
}

export function renderParentExamMessage(input: {
  cohort: ExamCohort;
  studentName: string;
  examTitle: string;
  score?: number | null;
  total?: number | null;
  template?: string | null;
}): string {
  const custom = input.template?.trim();
  const template = custom || DEFAULT_PARENT_EXAM_TEMPLATES[input.cohort];
  return applyParentExamTemplate(template, input);
}
