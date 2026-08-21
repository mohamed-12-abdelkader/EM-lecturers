import type { PublicStudentCard } from '../services/publicStudentCard.service';

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${rounded} ج.م.`;
}

export function renderPublicStudentCardHtml(card: PublicStudentCard): string {
  const totals = card.attendance_totals;
  const groupsHtml = card.groups.length
    ? card.groups
        .map((g) => {
          const meta = [g.subject_name, g.grade_name].filter(Boolean).join(' · ');
          const payClass = g.payment_status ? `pill ${g.payment_status}` : 'pill muted-pill';
          const payText = g.payment_status_ar ?? 'لم يُسجَّل اشتراك هذا الشهر';
          const payAmounts =
            g.payment_status == null
              ? g.monthly_fee
                ? `<div class="muted">اشتراك المجموعة: ${escapeHtml(money(g.monthly_fee))}</div>`
                : ''
              : `<div class="muted">المطلوب ${escapeHtml(money(g.amount_due))} · المدفوع ${escapeHtml(money(g.amount_paid))} · المتبقي ${escapeHtml(money(g.remaining))}</div>`;

          return `
        <div class="group">
          <div class="group-head">
            <div>
              <strong>${escapeHtml(g.group_name)}</strong>
              ${meta ? `<div class="muted">${escapeHtml(meta)}</div>` : ''}
              ${g.schedule_label ? `<div class="muted">${escapeHtml(g.schedule_label)}</div>` : ''}
            </div>
            <span class="${payClass}">${escapeHtml(payText)}</span>
          </div>
          <div class="mini-stats">
            <span>حضر ${g.lectures_attended}</span>
            <span>غاب ${g.absent}</span>
            <span>تأخر ${g.late}</span>
            ${g.excused ? `<span>بعذر ${g.excused}</span>` : ''}
          </div>
          ${payAmounts}
          ${g.last_attendance_date ? `<div class="muted">آخر حضور: ${escapeHtml(formatDate(g.last_attendance_date))}</div>` : ''}
        </div>`;
        })
        .join('')
    : '<p class="muted">لا توجد مجموعات مسجّل فيها الطالب</p>';

  const recentHtml = card.recent_attendance.length
    ? card.recent_attendance
        .map(
          (row) => `
        <div class="row">
          <div>
            <strong>${escapeHtml(row.status_ar)}</strong>
            <div class="muted">${escapeHtml(row.group_name)}${row.day_name ? ` · ${escapeHtml(row.day_name)}` : ''}</div>
          </div>
          <div class="score status-${escapeHtml(row.status)}">${escapeHtml(row.attendance_date)}</div>
        </div>`,
        )
        .join('')
    : '<p class="muted">لا يوجد سجل حضور بعد</p>';

  const examsHtml = card.exams.length
    ? card.exams
        .map((e) => {
          const scoreText = e.is_absent
            ? 'غائب'
            : e.score != null
              ? `${e.score} / ${e.total_grade}${e.percentage != null ? ` (${e.percentage}%)` : ''}`
              : '—';
          return `
        <div class="row">
          <div>
            <strong>${escapeHtml(e.title)}</strong>
            <div class="muted">${escapeHtml(e.group_name)}${e.exam_date ? ` · ${escapeHtml(formatDate(e.exam_date))}` : ''}</div>
          </div>
          <div class="score">${escapeHtml(scoreText)}</div>
        </div>`;
        })
        .join('')
    : '<p class="muted">لا توجد امتحانات مرصودة بعد</p>';

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(card.student.full_name)} — بطاقة ولي الأمر</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Tahoma, "Segoe UI", Arial, sans-serif;
      background: #eef2f7;
      color: #122033;
    }
    .wrap { max-width: 560px; margin: 0 auto; padding: 16px; }
    .hero {
      background: linear-gradient(135deg, #123a63, #1d5a93);
      color: #fff;
      border-radius: 18px;
      padding: 22px 18px;
    }
    .hero .label { opacity: .85; font-size: 13px; }
    .hero h1 { margin: 6px 0 4px; font-size: 24px; }
    .hero .code { opacity: .9; font-size: 14px; }
    .stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin: 14px 0;
    }
    .stat {
      background: #fff;
      border-radius: 14px;
      padding: 14px;
      box-shadow: 0 6px 18px rgba(18, 58, 99, .08);
    }
    .stat b { display: block; font-size: 22px; color: #123a63; }
    .stat span { color: #5b6b7c; font-size: 13px; }
    .card {
      background: #fff;
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 12px;
      box-shadow: 0 6px 18px rgba(18, 58, 99, .08);
    }
    .card h2 { margin: 0 0 10px; font-size: 16px; color: #123a63; }
    .group {
      padding: 12px 0;
      border-bottom: 1px solid #eef2f7;
    }
    .group:last-child { border-bottom: 0; }
    .group-head {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }
    .mini-stats {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0 4px;
      font-size: 13px;
      color: #345;
    }
    .mini-stats span {
      background: #f4f7fb;
      padding: 3px 8px;
      border-radius: 999px;
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid #eef2f7;
    }
    .row:last-child { border-bottom: 0; }
    .muted { color: #6b7c8d; font-size: 13px; margin: 4px 0 0; }
    .pill {
      display: inline-block;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      white-space: nowrap;
    }
    .pill.paid { background: #e8f3ee; color: #1b6b45; }
    .pill.unpaid { background: #fdecec; color: #a12a2a; }
    .pill.partial { background: #fff4e5; color: #9a5b00; }
    .pill.exempt { background: #eef2f7; color: #445566; }
    .pill.muted-pill { background: #eef2f7; color: #5b6b7c; }
    .score { font-weight: 700; color: #123a63; white-space: nowrap; }
    .status-absent { color: #a12a2a; }
    .status-present { color: #1b6b45; }
    .status-late { color: #9a5b00; }
    .foot { text-align: center; color: #7b8a99; font-size: 12px; margin-top: 8px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="label">بطاقة ولي الأمر · ${escapeHtml(card.teacher_name)}</div>
      <h1>${escapeHtml(card.student.full_name)}</h1>
      <div class="code">كود الطالب: ${escapeHtml(card.student.student_code)}</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${totals.lectures_attended}</b><span>محاضرة حضرها</span></div>
      <div class="stat"><b>${totals.absent}</b><span>غياب</span></div>
      <div class="stat"><b>${totals.late}</b><span>تأخير</span></div>
      <div class="stat"><b>${totals.excused}</b><span>غياب بعذر</span></div>
    </div>
    <div class="card">
      <h2>المجموعات والحضور · ${escapeHtml(card.billing_month.label)}</h2>
      ${groupsHtml}
    </div>
    <div class="card">
      <h2>آخر الحصص</h2>
      ${recentHtml}
    </div>
    <div class="card">
      <h2>درجات السنتر</h2>
      ${examsHtml}
    </div>
    <p class="foot">مسح الكود من تطبيق المدرس يسجّل الحضور — ومن أي قارئ يعرض هذه البطاقة لولي الأمر</p>
  </div>
</body>
</html>`;
}

export function renderPublicStudentNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>الطالب غير موجود</title>
  <style>
    body { font-family: Tahoma, Arial, sans-serif; background: #eef2f7; color: #122033; margin: 0; }
    .box { max-width: 420px; margin: 48px auto; background: #fff; padding: 24px; border-radius: 16px; text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <h1>البطاقة غير صالحة</h1>
    <p>لم يتم العثور على طالب مرتبط بهذا الكود.</p>
  </div>
</body>
</html>`;
}
