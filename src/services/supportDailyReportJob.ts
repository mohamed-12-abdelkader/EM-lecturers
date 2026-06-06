import pool from '../db/pool';
import { Server as SocketIOServer } from 'socket.io';
import { SupportChatService } from './supportChat';
import { SupportChatSocketService } from './supportChatSocket';
import { StudentDailyReportService } from './studentDailyReport';
import type { StudentDailyReport } from './studentDailyReport';
import { TEACHER_DAILY_GREETING } from './teacherSupportChatbot';

/**
 * بناء نص التقرير اليومي مع النصائح لإرساله في شات الدعم الفني
 */
function formatDailyReportMessage(report: StudentDailyReport): string {
  const lines: string[] = [
    '📋 **تقريرك اليومي – محاضرات وامتحانات متراكمة**',
    '',
    '---',
  ];

  if (report.summary.pending_lectures_count > 0) {
    lines.push('');
    lines.push(`📚 **محاضرات لم تشاهدها بعد (${report.summary.pending_lectures_count}):**`);
    report.pending_lectures.slice(0, 15).forEach((p) => {
      lines.push(`• ${p.title} — كورس: ${p.course_title} (شاهدت ${p.watched_videos}/${p.total_videos} فيديو)`);
    });
    if (report.pending_lectures.length > 15) {
      lines.push(`... و${report.pending_lectures.length - 15} محاضرة أخرى.`);
    }
  }

  if (report.summary.pending_exams_count > 0) {
    lines.push('');
    lines.push(`📝 **امتحانات لم تحلها بعد (${report.summary.pending_exams_count}):**`);
    report.pending_exams.slice(0, 15).forEach((e) => {
      const typeLabel = e.type === 'lecture' ? 'امتحان محاضرة' : 'امتحان كورس';
      lines.push(`• ${e.title} — ${e.course_title} (${typeLabel})`);
    });
    if (report.pending_exams.length > 15) {
      lines.push(`... و${report.pending_exams.length - 15} امتحان آخر.`);
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('💡 **نصائح لإنجاز المتراكم:**');
  lines.push('1️⃣ خصص وقتاً ثابتاً كل يوم للمشاهدة والحل حتى لا يتراكم.');
  lines.push('2️⃣ ابدأ بالمحاضرات الأقدم ثم امتحانها قبل الانتقال للتالي.');
  lines.push('3️⃣ لو الوقت ضيق، ركّز على محاضرة واحدة أو امتحان واحد في اليوم.');
  lines.push('4️⃣ يمكنك كتابة "تقريري" أو فتح التقرير من تطبيق المنصة لمتابعة تقدمك.');
  lines.push('');
  lines.push('أي سؤال أو استفسار؟ اكتب هنا وسأساعدك. 😊');

  return lines.join('\n');
}

/**
 * إرسال التقرير اليومي لطالب واحد في شات الدعم الفني
 */
async function sendReportToStudentChat(
  studentId: number,
  io: SocketIOServer | null,
  adminUserId: number,
): Promise<void> {
  const report = await StudentDailyReportService.getReport(studentId);
  if (report.summary.pending_lectures_count === 0 && report.summary.pending_exams_count === 0) {
    return;
  }

  const chat = await SupportChatService.getOrCreateStudentChat(studentId);
  const text = formatDailyReportMessage(report);
  const message = await SupportChatService.saveMessage(chat.id, adminUserId, 'admin', {
    text,
    message_type: 'auto_reply',
    is_auto_reply: true,
  });

  if (io) {
    await SupportChatSocketService.emitNewMessage(io, chat.id, message, 'admin');
  }
}

let lastRunDate: string = '';

/**
 * تشغيل مهمة التقرير اليومي لجميع الطلاب وإرساله في شات الدعم.
 * يُفترض استدعاؤها مرة واحدة يومياً (مثلاً الساعة 6:50 مساءً).
 */
export async function runSupportDailyReportJob(io: SocketIOServer | null): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (lastRunDate === today) {
    return;
  }
  lastRunDate = today;

  try {
    const adminRes = await pool.query(
      `SELECT id FROM users WHERE role = 'admin' LIMIT 1`,
    );
    const adminUserId = adminRes.rows[0]?.id;
    if (!adminUserId) {
      console.warn('[SupportDailyReport] No admin user found, skipping job.');
      return;
    }

    const studentsRes = await pool.query(
      `SELECT DISTINCT e.user_id
       FROM enrollments e
       JOIN courses c ON e.course_id = c.id
       WHERE c.is_visible = true
         AND (e.subscription_status IS NULL OR e.subscription_status = 'active')
         AND (e.expires_at IS NULL OR e.expires_at > NOW())
         AND (e.is_blocked_by_teacher IS NULL OR e.is_blocked_by_teacher = false)`,
    );
    const studentIds = studentsRes.rows.map((r: any) => r.user_id);
    let sent = 0;
    for (const studentId of studentIds) {
      try {
        await sendReportToStudentChat(studentId, io, adminUserId);
        sent++;
      } catch (err) {
        console.error(`[SupportDailyReport] Failed for student ${studentId}:`, err);
      }
    }
    console.log(`[SupportDailyReport] Sent daily report to ${sent} students.`);
  } catch (err) {
    console.error('[SupportDailyReport] Job failed:', err);
    lastRunDate = '';
  }
}

/**
 * التحقق من أن الوقت الحالي 7 مساءً (19:00) — يُرسل التقرير تلقائياً في الشات دون طلب من الطالب
 */
export function isDailyReportTime(): boolean {
  const d = new Date();
  return d.getHours() === 19 && d.getMinutes() === 0;
}

let teacherGreetingLastRunDate: string = '';

/**
 * التحقق من أن الوقت 8 صباحاً (08:00) لإرسال التحية اليومية للمدرسين
 */
export function isTeacherDailyGreetingTime(): boolean {
  const d = new Date();
  return d.getHours() === 8 && d.getMinutes() === 0;
}

/**
 * إرسال الرسالة اليومية التلقائية (تحية + عرض الخدمات) لكل مدرس في شات الدعم الفني
 */
export async function runTeacherDailyGreetingJob(io: SocketIOServer | null): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  if (teacherGreetingLastRunDate === today) return;
  teacherGreetingLastRunDate = today;

  try {
    const adminRes = await pool.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`, []);
    const adminUserId = adminRes.rows[0]?.id;
    if (!adminUserId) {
      console.warn('[TeacherDailyGreeting] No admin user found.');
      return;
    }

    const teachersRes = await pool.query(
      `SELECT id FROM users WHERE role = 'teacher'`,
      [],
    );
    const teacherIds = (teachersRes.rows || []).map((r: any) => r.id);
    let sent = 0;

    for (const teacherId of teacherIds) {
      try {
        const chat = await SupportChatService.getOrCreateTeacherChat(teacherId);
        const lastMsg = await pool.query(
          `SELECT text, created_at FROM teacher_support_messages
           WHERE chat_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [chat.id],
        );
        const row = lastMsg.rows[0];
        const alreadySentToday =
          row &&
          row.text &&
          String(row.text).trim().startsWith('صباح الخير') &&
          new Date(row.created_at).toISOString().slice(0, 10) === today;
        if (alreadySentToday) continue;

        const botMessage = await SupportChatService.saveTeacherMessage(
          chat.id,
          adminUserId,
          'admin',
          {
            text: TEACHER_DAILY_GREETING,
            message_type: 'auto_reply',
            is_auto_reply: true,
          },
        );
        if (io) {
          await SupportChatSocketService.emitNewTeacherMessage(
            io,
            chat.id,
            teacherId,
            botMessage,
            'admin',
          );
        }
        sent++;
      } catch (err) {
        console.error(`[TeacherDailyGreeting] Failed for teacher ${teacherId}:`, err);
      }
    }
    console.log(`[TeacherDailyGreeting] Sent to ${sent} teachers.`);
  } catch (err) {
    console.error('[TeacherDailyGreeting] Job failed:', err);
    teacherGreetingLastRunDate = '';
  }
}
