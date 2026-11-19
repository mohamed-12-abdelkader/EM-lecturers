type TaskRow = {
  task_type: string;
  title: string;
  course_name?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  due_at?: string | Date | null;
  meeting_url?: string | null;
  notes?: string | null;
};

const TYPE_META: Record<string, { icon: string; label: string }> = {
  lecture: { icon: '📚', label: 'محاضرة' },
  live: { icon: '🎥', label: 'حصة مباشرة' },
  exam: { icon: '📝', label: 'امتحان' },
  homework: { icon: '📌', label: 'واجب' },
};

function formatTime(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2];
  const period = hour < 12 ? 'صباحًا' : hour === 12 ? 'ظهرًا' : hour < 17 ? 'ظهرًا' : 'مساءً';
  const h12 = hour % 12 || 12;
  return `${h12}:${minute} ${period}`;
}

function taskSortKey(task: TaskRow): string {
  if (task.start_time) return String(task.start_time);
  if (task.due_at) {
    const d = new Date(task.due_at);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
  }
  return '99:99';
}

export function buildTeacherDailyReminderMessage(
  teacherName: string,
  tasks: TaskRow[],
): string {
  const ordered = [...tasks].sort((a, b) =>
    taskSortKey(a).localeCompare(taskSortKey(b)),
  );
  const lines: string[] = [
    '📅 *جدول مهامك اليوم*',
    '',
    `أهلًا ${teacherName?.trim() || 'مستر'} 👋`,
    '',
    'إليك المهام المطلوبة منك اليوم:',
    '',
  ];

  for (const task of ordered) {
    const meta = TYPE_META[task.task_type] || { icon: '📋', label: 'مهمة' };
    const when =
      formatTime(task.start_time) ||
      formatTime(task.due_at) ||
      'موعد غير محدد';
    lines.push(`${meta.icon} *${when}*`);
    lines.push(`${meta.label}: ${task.title}`);
    if (task.course_name) lines.push(`المادة/الكورس: ${task.course_name}`);
    if (task.end_time) {
      const end = formatTime(task.end_time);
      if (end) lines.push(`حتى: ${end}`);
    }
    if (task.meeting_url) lines.push(`الرابط: ${task.meeting_url}`);
    if (task.notes) lines.push(`ملاحظات: ${task.notes}`);
    lines.push('');
  }

  lines.push('نتمنى لك يومًا موفقًا ❤️');
  return lines.join('\n').trim();
}

export function buildSubscriptionExpiredMessage(
  teacherName: string,
  template: string,
  endsAt?: string | null,
): string {
  const name = teacherName?.trim() || 'مستر';
  let message = String(template || '').trim();
  if (!message) {
    message =
      '⚠️ *تنبيه انتهاء الاشتراك*\n\nأهلًا {{name}} 👋\n\nاشتراكك في المنصة انتهى، ويحتاج إلى تجديد.';
  }
  message = message
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*ends_at\s*\}\}/gi, endsAt ? String(endsAt).slice(0, 10) : '—');
  return message.trim();
}
