import type { ExamCohort } from './constants';

export function renderParentExamMessage(input: {
  cohort: ExamCohort;
  studentName: string;
  examTitle: string;
  score?: number | null;
  total?: number | null;
}): string {
  const name = (input.studentName || 'الطالب').trim();
  const exam = (input.examTitle || 'الامتحان').trim();
  if (input.cohort === 'absent') {
    return `ولي أمر ${name}، ${name} ما دخلش امتحان «${exam}» خالص.`;
  }
  const score = Number(input.score ?? 0);
  const total = Number(input.total ?? 0);
  if (input.cohort === 'failed') {
    return `ولي أمر ${name}، نتيجة «${exam}»: ${score}/${total} — للأسف ما نجحش.`;
  }
  return `ولي أمر ${name}، نتيجة «${exam}»: ${score}/${total} — ألف مبروك، نجح.`;
}
