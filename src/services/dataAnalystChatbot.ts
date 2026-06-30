import pool from '../db/pool';
import { config, HttpError, logger } from '../utils';
import {
  DATA_ANALYST_BOT_NAME,
  DATA_ANALYST_SYSTEM_PROMPT,
  DATA_ANALYST_WELCOME_MESSAGE,
} from './dataAnalyst.prompts';
import { DataAnalystReportsService } from './dataAnalystReports';
import {
  DataAnalystExamReportsService,
  classifyExamReportKind,
  extractExamSearchQuery,
  isExamAnalysisRequest,
  type ExamReportKind,
} from './dataAnalystExamReports';

const DEEPSEEK_API_URL = `${config.DEEPSEEK_API_URL}/v1/chat/completions`;

export type DataAnalystReportType = 'student' | 'course' | 'general' | 'exam' | 'other';

export type DataAnalystMessage = {
  id: number;
  teacher_id: number;
  role: 'teacher' | 'assistant';
  message: string;
  report_type: DataAnalystReportType | null;
  context: Record<string, unknown>;
  created_at: Date;
};

export type DataAnalystChatResult = {
  reply: string;
  report_type: DataAnalystReportType;
  context?: Record<string, unknown>;
};

type ChatContextMessage = { role: 'teacher' | 'assistant'; text: string };

const STUDENT_REPORT_PREFIXES = [
  'تقرير الطالب',
  'تقرير طالب',
  'تقرير عن الطالب',
  'تقرير عن طالب',
  'تحليل الطالب',
  'تحليل طالب',
];

const COURSE_REPORT_PREFIXES = [
  'تقرير الكورس',
  'تقرير كورس',
  'تقرير عن الكورس',
  'تقرير عن كورس',
  'تحليل الكورس',
  'تحليل كورس',
];

const GENERAL_REPORT_KEYWORDS = [
  'تقرير عام',
  'ملخص شامل',
  'تقرير شامل',
  'تحليل شامل',
  'إحصائيات عامة',
  'نظرة عامة',
  'كل الطلاب',
  'جميع الطلاب',
  'كل الكورسات',
];

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[أةؤإئ]/g, 'ا');
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function parseIdAfterPrefixes(
  text: string,
  prefixes: string[],
): { type: 'id'; value: number } | { type: 'name'; value: string } | null {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  for (const prefix of prefixes) {
    const regex = new RegExp(prefix.replace(/\s+/g, '\\s+'), 'i');
    const match = trimmed.match(regex);
    if (!match) continue;
    const rest = trimmed.slice(match.index! + match[0].length).trim();
    if (!rest) continue;
    if (/^\d+$/.test(rest)) return { type: 'id', value: Number(rest) };
    return { type: 'name', value: rest };
  }
  return null;
}

function extractCourseId(text: string): number | null {
  const parsed = parseIdAfterPrefixes(text, COURSE_REPORT_PREFIXES);
  if (parsed?.type === 'id') return parsed.value;
  const match = text.match(/(?:كورس|course)\s*[#:]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function parseCourseReportRequest(
  text: string,
): { type: 'id'; value: number } | { type: 'name'; value: string } | null {
  const parsed = parseIdAfterPrefixes(text, COURSE_REPORT_PREFIXES);
  if (parsed) return parsed;
  const match = text.match(/(?:كورس|course)\s*[#:]?\s*(\d+)/i);
  if (match) return { type: 'id', value: Number(match[1]) };
  return null;
}

function extractStudentId(text: string): number | null {
  const parsed = parseIdAfterPrefixes(text, STUDENT_REPORT_PREFIXES);
  if (parsed?.type === 'id') return parsed.value;
  const match = text.match(/(?:طالب|student|كود)\s*[#:]?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

function isGeneralReportRequest(text: string): boolean {
  if (isExamAnalysisRequest(text)) return false;
  if (parseIdAfterPrefixes(text, STUDENT_REPORT_PREFIXES)) return false;
  if (parseCourseReportRequest(text)) return false;
  return containsAny(text, GENERAL_REPORT_KEYWORDS) || containsAny(text, ['تقرير', 'إحصائيات', 'تحليل']);
}

function isLastBotAskingForStudentId(messages: ChatContextMessage[]): boolean {
  if (!messages.length) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'assistant') return false;
  const text = normalizeText(last.text);
  return text.includes('اكثر من طالب') || text.includes('كود الطالب');
}

function isLastBotAskingForCourseId(messages: ChatContextMessage[]): boolean {
  if (!messages.length) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'assistant') return false;
  const text = normalizeText(last.text);
  return text.includes('اكثر من كورس') || text.includes('كود الكورس');
}

function formatStudentReportFallback(report: Awaited<ReturnType<typeof DataAnalystReportsService.getStudentReport>>): string {
  const lines: string[] = [];
  lines.push(`# تقرير الطالب: ${report.student.name}`);
  lines.push(`- **كود الطالب:** ${report.student.id}`);
  lines.push(`- **البريد:** ${report.student.email}`);
  lines.push('');
  lines.push('## الملخص الإجمالي');
  lines.push(`- الكورسات المسجلة: ${report.overallStatistics.totalCourses}`);
  lines.push(`- المحاضرات: ${report.overallStatistics.watchedLectures}/${report.overallStatistics.totalLectures}`);
  lines.push(`- الامتحانات المحلولة: ${report.overallStatistics.submittedExams}/${report.overallStatistics.totalExams}`);
  lines.push(`- متوسط الدرجات: ${report.overallStatistics.overallAverageGrade}%`);
  lines.push(`- نسبة المشاهدة: ${report.overallStatistics.watch_percentage ?? 0}%`);
  lines.push('');
  lines.push('## تفاصيل الكورسات');
  report.courses.forEach((course, index) => {
    lines.push(`### ${index + 1}. ${course.courseTitle}`);
    lines.push(`- المحاضرات المشاهدة: ${course.watchedLecturesCount}/${course.totalLectures}`);
    lines.push(`- نسبة المشاهدة: ${course.statistics.watch_percentage ?? course.watch_percentage ?? 0}%`);
    lines.push(`- الامتحانات: ${course.statistics.submittedExams}/${course.statistics.totalExams}`);
    lines.push(`- متوسط الدرجة: ${course.statistics.averageGrade}%`);
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    if ((course.statistics.watch_percentage ?? 0) >= 70) strengths.push('التزام جيد بالمشاهدة');
    else weaknesses.push('مشاهدة منخفضة');
    if (course.statistics.averageGrade >= 70) strengths.push('أداء امتحانات جيد');
    else if (course.statistics.submittedExams > 0) weaknesses.push('درجات امتحانات تحتاج تحسين');
    if (course.statistics.submittedExams < course.statistics.totalExams) weaknesses.push('امتحانات غير مكتملة');
    if (strengths.length) lines.push(`- نقاط القوة: ${strengths.join('، ')}`);
    if (weaknesses.length) lines.push(`- نقاط الضعف: ${weaknesses.join('، ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

function formatGeneralReportFallback(data: Awaited<ReturnType<typeof DataAnalystReportsService.getGeneralReport>>): string {
  const { overview, course_reports } = data;
  const lines: string[] = [];
  lines.push('# التقرير العام للمحاضر');
  lines.push(`- **إجمالي الطلاب:** ${overview.total_students}`);
  lines.push(`- **عدد الكورسات:** ${overview.total_courses}`);
  lines.push(`- **متوسط المشاهدة:** ${overview.average_watch_percentage.toFixed(1)}%`);
  lines.push(`- **متوسط درجات الامتحانات:** ${overview.average_exam_percentage.toFixed(1)}%`);
  lines.push('');
  lines.push('## ترتيب أفضل الطلاب');
  if (!overview.top_students.length) {
    lines.push('- لا توجد بيانات كافية حالياً.');
  } else {
    overview.top_students.forEach((student) => {
      lines.push(
        `${student.rank}. ${student.student_name} (كود ${student.student_id}) — مشاهدة ${student.watch_percentage.toFixed(1)}% | امتحانات ${student.exam_percentage.toFixed(1)}%`,
      );
    });
  }
  lines.push('');
  lines.push('## الطلاب المعرضون للتأخر');
  if (!overview.at_risk_students.length) {
    lines.push('- لا يوجد طلاب في منطقة الخطر حالياً.');
  } else {
    overview.at_risk_students.slice(0, 5).forEach((student) => {
      lines.push(
        `- ${student.student_name} (كود ${student.student_id}) — خمول ${student.inactivity_days} يوم | مشاهدة ${student.watch_percentage.toFixed(1)}% | درجة خطورة ${student.risk_score.toFixed(0)}`,
      );
    });
  }
  lines.push('');
  lines.push('## ملخص الكورسات');
  course_reports.forEach((report) => {
    if (!report.course) return;
    lines.push(`### ${report.course.course_title}`);
    lines.push(`- الطلاب المسجلين: ${report.students_stats.total_enrolled}`);
    lines.push(`- متوسط المشاهدة: ${report.lecture_stats.average_watch_percentage}%`);
    if (report.last_exam) {
      lines.push(`- آخر امتحان: نجاح ${report.last_exam.success_rate}%`);
    }
    lines.push('');
  });
  return lines.join('\n');
}

function isLastBotAskingForExamChoice(messages: ChatContextMessage[]): boolean {
  if (!messages.length) return false;
  const last = messages[messages.length - 1];
  if (last.role !== 'assistant') return false;
  const text = normalizeText(last.text);
  return text.includes('اكثر من') && (text.includes('واجب') || text.includes('امتحان'));
}

function formatExamReportFallback(
  data: Awaited<ReturnType<typeof DataAnalystExamReportsService.getLectureExamAnalysis>>,
): string {
  const lines: string[] = [];
  const label = data.examKind === 'lecture' ? 'واجب/امتحان المحاضرة' : 'امتحان الكورس';
  lines.push(`# تقرير ${label}: ${data.exam.title}`);
  if ('lectureTitle' in data.exam && data.exam.lectureTitle) {
    lines.push(`- **المحاضرة:** ${data.exam.lectureTitle}`);
  }
  lines.push(`- **الكورس:** ${data.exam.courseTitle ?? '—'}`);
  lines.push(`- **المسجلين:** ${data.participation.totalEnrolled}`);
  lines.push(`- **سلّموا:** ${data.participation.submittedCount}`);
  lines.push(`- **لم يُسلّموا بعد:** ${data.participation.notSubmittedCount}`);
  lines.push(`- **نسبة التسليم:** ${data.participation.submissionRate}%`);
  lines.push('');
  lines.push('## نقاط القوة');
  if (!data.insights.strengths.length) lines.push('- لا توجد بيانات كافية بعد.');
  else data.insights.strengths.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## نقاط الضعف');
  if (!data.insights.weaknesses.length) lines.push('- لا توجد ملاحظات سلبية واضحة.');
  else data.insights.weaknesses.forEach((item) => lines.push(`- ${item}`));
  lines.push('');
  lines.push('## من امتحن');
  if (!data.participation.submittedStudents.length) lines.push('- لا أحد بعد.');
  else {
    data.participation.submittedStudents.forEach((student) => {
      const grade =
        'totalGrade' in student && student.totalGrade != null
          ? ` — درجة ${student.totalGrade}`
          : 'percentage' in student && student.percentage != null
            ? ` — ${student.percentage}%`
            : '';
      lines.push(`- ${student.studentName}${grade}`);
    });
  }
  lines.push('');
  lines.push('## لم يمتحن بعد');
  if (!data.participation.notSubmittedStudents.length) lines.push('- الجميع سلّم/امتحن.');
  else {
    data.participation.notSubmittedStudents.forEach((student) => {
      lines.push(`- ${student.studentName}`);
    });
  }
  return lines.join('\n');
}

function formatCourseExamReportFallback(
  data: Awaited<ReturnType<typeof DataAnalystExamReportsService.getCourseExamAnalysis>>,
): string {
  return formatExamReportFallback(data as unknown as Awaited<
    ReturnType<typeof DataAnalystExamReportsService.getLectureExamAnalysis>
  >);
}

function formatCourseReportFallback(data: Awaited<ReturnType<typeof DataAnalystReportsService.getCourseReport>>): string {
  const { daily_report: report, analytics } = data;
  const lines: string[] = [];
  if (!report.course) return 'لا توجد بيانات لهذا الكورس.';
  lines.push(`# تقرير الكورس: ${report.course.course_title}`);
  lines.push(`- **كود الكورس:** ${report.course.course_id}`);
  lines.push(`- **عدد الطلاب:** ${report.students_stats.total_enrolled}`);
  lines.push(`- **متوسط المشاهدة:** ${report.lecture_stats.average_watch_percentage}%`);
  if (report.last_exam) {
    lines.push(`- **متوسط نجاح آخر امتحان:** ${report.last_exam.success_rate}%`);
  }
  lines.push('');
  lines.push('## أكثر الطلاب نشاطاً');
  const top = (analytics.top_students as Array<Record<string, unknown>>) || [];
  if (!top.length) lines.push('- لا توجد بيانات مشاهدة كافية.');
  else {
    top.slice(0, 5).forEach((student, index) => {
      lines.push(
        `${index + 1}. ${student.student_name} — مشاهدة ${Number(student.completion_percentage ?? 0).toFixed(1)}%`,
      );
    });
  }
  lines.push('');
  lines.push('## أقل الطلاب نشاطاً');
  const bottom = [...top].reverse().slice(0, 5);
  if (!bottom.length) lines.push('- لا توجد بيانات.');
  else {
    bottom.forEach((student, index) => {
      lines.push(
        `${index + 1}. ${student.student_name} — مشاهدة ${Number(student.completion_percentage ?? 0).toFixed(1)}%`,
      );
    });
  }
  return lines.join('\n');
}

function formatExamMatches(
  matches: Awaited<ReturnType<typeof DataAnalystExamReportsService.findLectureExams>>,
  kind: ExamReportKind,
): string {
  const label = kind === 'lecture' ? 'واجب/امتحان المحاضرة' : 'امتحان الكورس';
  return (
    matches
      .map((match) => {
        const lecturePart = match.lectureTitle ? ` — محاضرة: ${match.lectureTitle}` : '';
        return `- ${match.title}${lecturePart} (كود ${match.id}) — كورس: ${match.courseTitle}`;
      })
      .join('\n') || `لا توجد نتائج لـ ${label}.`
  );
}

async function generateReportWithAi(
  reportType: DataAnalystReportType,
  userRequest: string,
  rawData: Record<string, unknown>,
  recentMessages: ChatContextMessage[],
): Promise<string | null> {
  try {
    const history = recentMessages.slice(-6).map((message) => ({
      role: message.role === 'teacher' ? ('user' as const) : ('assistant' as const),
      content: message.text,
    }));

    const response = await fetch(DEEPSEEK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: DATA_ANALYST_SYSTEM_PROMPT },
          ...history,
          {
            role: 'user',
            content: `طلب المستخدم: ${userRequest}

نوع التقرير: ${reportType}

البيانات الخام من النظام (JSON):
${JSON.stringify(rawData, null, 2)}

أنشئ التقرير النهائي بالعربية بناءً على هذه البيانات فقط.`,
          },
        ],
        temperature: 0.3,
        max_tokens: 2500,
      }),
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (error) {
    logger.warn({ error, reportType }, 'Data analyst AI formatting failed');
    return null;
  }
}

export class DataAnalystChatbotService {
  private static reportTypeConstraintReady = false;

  /** Ensures report_type accepts 'exam' (migration 1773100000000). */
  private static async ensureReportTypeConstraint(): Promise<void> {
    if (this.reportTypeConstraintReady) return;

    const check = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conname = 'teacher_data_analyst_messages_report_type_check'
       LIMIT 1`,
    );

    const definition = check.rows[0]?.definition ?? '';
    if (!definition.includes("'exam'")) {
      await pool.query(`
        ALTER TABLE teacher_data_analyst_messages
        DROP CONSTRAINT IF EXISTS teacher_data_analyst_messages_report_type_check
      `);
      await pool.query(`
        ALTER TABLE teacher_data_analyst_messages
        ADD CONSTRAINT teacher_data_analyst_messages_report_type_check
        CHECK (report_type IN ('student', 'course', 'general', 'exam', 'other'))
      `);
    }

    this.reportTypeConstraintReady = true;
  }

  static async saveMessage(
    teacherId: number,
    role: 'teacher' | 'assistant',
    message: string,
    reportType: DataAnalystReportType | null = null,
    context: Record<string, unknown> = {},
  ): Promise<DataAnalystMessage> {
    await this.ensureReportTypeConstraint();

    const result = await pool.query<DataAnalystMessage>(
      `INSERT INTO teacher_data_analyst_messages (teacher_id, role, message, report_type, context)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, teacher_id, role, message, report_type, context, created_at`,
      [teacherId, role, message, reportType, JSON.stringify(context)],
    );
    return result.rows[0];
  }

  static async getHistory(teacherId: number, limit = 30, offset = 0) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safeOffset = Math.max(offset, 0);
    const [rows, count] = await Promise.all([
      pool.query<DataAnalystMessage>(
        `SELECT id, teacher_id, role, message, report_type, context, created_at
         FROM teacher_data_analyst_messages
         WHERE teacher_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, safeLimit, safeOffset],
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total FROM teacher_data_analyst_messages WHERE teacher_id = $1`,
        [teacherId],
      ),
    ]);
    return {
      messages: rows.rows.reverse(),
      total: Number(count.rows[0]?.total ?? 0),
    };
  }

  static async handleMessage(
    teacherId: number,
    tenantId: number,
    text: string,
    recentMessages: ChatContextMessage[] = [],
  ): Promise<DataAnalystChatResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      return {
        reply: DATA_ANALYST_WELCOME_MESSAGE,
        report_type: 'other',
      };
    }

    if (isLastBotAskingForStudentId(recentMessages)) {
      const studentId = extractStudentId(trimmed) ?? (/^\d+$/.test(trimmed) ? Number(trimmed) : null);
      if (studentId != null) {
        return this.buildStudentReport(teacherId, tenantId, trimmed, studentId, recentMessages);
      }
    }

    if (isLastBotAskingForCourseId(recentMessages)) {
      const courseId = extractCourseId(trimmed) ?? (/^\d+$/.test(trimmed) ? Number(trimmed) : null);
      if (courseId != null) {
        return this.buildCourseReport(teacherId, tenantId, trimmed, courseId, recentMessages);
      }
    }

    if (isLastBotAskingForExamChoice(recentMessages) && /^\d+$/.test(trimmed)) {
      return this.buildExamReportById(teacherId, trimmed, Number(trimmed), recentMessages);
    }

    if (isExamAnalysisRequest(trimmed)) {
      return this.handleExamAnalysisRequest(teacherId, trimmed, recentMessages);
    }

    const studentReq = parseIdAfterPrefixes(trimmed, STUDENT_REPORT_PREFIXES);
    if (studentReq) {
      if (studentReq.type === 'id') {
        return this.buildStudentReport(teacherId, tenantId, trimmed, studentReq.value, recentMessages);
      }
      try {
        const result = await DataAnalystReportsService.getStudentReportByName(teacherId, studentReq.value);
        if ('matches' in result) {
          const list = result.matches
            .map((m) => `- ${m.name} (كود ${m.id}) — ${m.courses_count} كورس`)
            .join('\n');
          return {
            reply: `وجد أكثر من طالب بهذا الاسم. أرسل **كود الطالب** لتحديده:\n\n${list}`,
            report_type: 'student',
            context: { pending_student_name: studentReq.value },
          };
        }
        const aiReply = await generateReportWithAi('student', trimmed, { report: result.report }, recentMessages);
        return {
          reply: aiReply ?? formatStudentReportFallback(result.report),
          report_type: 'student',
          context: { student_id: result.report.student.id },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
        return { reply: `تعذر إنشاء تقرير الطالب. ${message}`, report_type: 'student' };
      }
    }

    const courseReq = parseCourseReportRequest(trimmed);
    if (courseReq || containsAny(trimmed, COURSE_REPORT_PREFIXES)) {
      if (courseReq?.type === 'id') {
        return this.buildCourseReport(teacherId, tenantId, trimmed, courseReq.value, recentMessages);
      }
      if (courseReq?.type === 'name') {
        try {
          const result = await DataAnalystReportsService.getCourseReportByName(
            teacherId,
            courseReq.value,
            tenantId,
          );
          if ('matches' in result) {
            const list = result.matches
              .map((m) => `- ${m.title} (كود ${m.id}) — ${m.enrolled_students} طالب`)
              .join('\n');
            return {
              reply: `وجد أكثر من كورس بهذا الاسم. أرسل **كود الكورس** لتحديده:\n\n${list}`,
              report_type: 'course',
              context: { pending_course_name: courseReq.value },
            };
          }
          const aiReply = await generateReportWithAi(
            'course',
            trimmed,
            result.report as unknown as Record<string, unknown>,
            recentMessages,
          );
          return {
            reply: aiReply ?? formatCourseReportFallback(result.report),
            report_type: 'course',
            context: { course_id: result.course_id, course_name: courseReq.value },
          };
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
          return { reply: `تعذر إنشاء تقرير الكورس. ${message}`, report_type: 'course' };
        }
      }
      const courses = await DataAnalystReportsService.getTeacherCourses(teacherId);
      if (!courses.length) {
        return { reply: 'لا توجد كورسات لديك حالياً.', report_type: 'course' };
      }
      const list = courses.map((c) => `- ${c.course_title} (كود ${c.course_id})`).join('\n');
      return {
        reply: `حدد الكورس بالاسم أو الكود، مثال:\n• **تقرير الكورس فيزياء**\n• **تقرير الكورس 5**\n\nكورساتك:\n${list}`,
        report_type: 'course',
      };
    }

    if (isGeneralReportRequest(trimmed)) {
      try {
        const data = await DataAnalystReportsService.getGeneralReport(teacherId, tenantId);
        const aiReply = await generateReportWithAi('general', trimmed, data as unknown as Record<string, unknown>, recentMessages);
        return {
          reply: aiReply ?? formatGeneralReportFallback(data),
          report_type: 'general',
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
        return { reply: `تعذر إنشاء التقرير العام. ${message}`, report_type: 'general' };
      }
    }

    return {
      reply: `${DATA_ANALYST_WELCOME_MESSAGE}

**أمثلة:**
- تقرير عام شامل
- تقرير الطالب 12
- تقرير الطالب أحمد
- تقرير الكورس 3
- تقرير الكورس فيزياء
- تقرير واجب المحاضرة الأولى
- تحليل امتحان نصف العام`,
      report_type: 'other',
    };
  }

  private static async handleExamAnalysisRequest(
    teacherId: number,
    userRequest: string,
    recentMessages: ChatContextMessage[],
  ): Promise<DataAnalystChatResult> {
    const kind = classifyExamReportKind(userRequest);
    if (!kind) {
      return {
        reply:
          'حدّد نوع التقرير:\n• **واجب/محاضرة** — مثال: `تقرير واجب المحاضرة الأولى`\n• **امتحان كورس** — مثال: `تحليل امتحان نصف العام`',
        report_type: 'exam',
      };
    }

    const searchQuery = extractExamSearchQuery(userRequest);
    if (/^\d+$/.test(searchQuery)) {
      return this.buildExamReportById(teacherId, userRequest, Number(searchQuery), recentMessages, kind);
    }

    if (!searchQuery) {
      return {
        reply:
          kind === 'lecture'
            ? 'اكتب اسم المحاضرة أو الواجب، مثال: `تقرير واجب المحاضرة الأولى`'
            : 'اكتب اسم الامتحان، مثال: `تحليل امتحان الكورس النهائي`',
        report_type: 'exam',
        context: { pending_exam_kind: kind },
      };
    }

    const matches =
      kind === 'lecture'
        ? await DataAnalystExamReportsService.findLectureExams(teacherId, searchQuery)
        : await DataAnalystExamReportsService.findCourseExams(teacherId, searchQuery);

    if (matches.length === 1) {
      return this.buildExamReportById(teacherId, userRequest, matches[0].id, recentMessages, kind);
    }

    if (matches.length > 1) {
      const label = kind === 'lecture' ? 'واجب/امتحان المحاضرة' : 'امتحان الكورس';
      return {
        reply: `وجد أكثر من ${label}. أرسل **كود الامتحان** لتحديده:\n\n${formatExamMatches(matches, kind)}`,
        report_type: 'exam',
        context: { pending_exam_kind: kind, pending_exam_search: searchQuery },
      };
    }

    return {
      reply: `لم أجد ${kind === 'lecture' ? 'واجب/امتحان محاضرة' : 'امتحان كورس'} بهذا الاسم. جرّب اسم المحاضرة أو الامتحان بدقة أكبر، أو أرسل الكود مباشرة.`,
      report_type: 'exam',
      context: { pending_exam_kind: kind, pending_exam_search: searchQuery },
    };
  }

  private static async buildExamReportById(
    teacherId: number,
    userRequest: string,
    examId: number,
    recentMessages: ChatContextMessage[],
    preferredKind?: ExamReportKind,
  ): Promise<DataAnalystChatResult> {
    const attempts: Array<{ kind: ExamReportKind; loader: () => Promise<Record<string, unknown>>; fallback: (data: any) => string }> = [];

    if (!preferredKind || preferredKind === 'lecture') {
      attempts.push({
        kind: 'lecture',
        loader: async () =>
          (await DataAnalystExamReportsService.getLectureExamAnalysis(teacherId, examId)) as unknown as Record<string, unknown>,
        fallback: formatExamReportFallback,
      });
    }
    if (!preferredKind || preferredKind === 'course') {
      attempts.push({
        kind: 'course',
        loader: async () =>
          (await DataAnalystExamReportsService.getCourseExamAnalysis(teacherId, examId)) as unknown as Record<string, unknown>,
        fallback: formatCourseExamReportFallback,
      });
    }

    for (const attempt of attempts) {
      try {
        const rawData = await attempt.loader();
        const aiReply = await generateReportWithAi('exam', userRequest, rawData, recentMessages);
        return {
          reply:
            aiReply ??
            (attempt.kind === 'course'
              ? formatCourseExamReportFallback(rawData as any)
              : formatExamReportFallback(rawData as any)),
          report_type: 'exam',
          context: { exam_id: examId, exam_kind: attempt.kind },
        };
      } catch (error: unknown) {
        if (error instanceof HttpError && error.status === 404) {
          continue;
        }
        const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
        return {
          reply: `تعذر إنشاء تقرير الامتحان رقم ${examId}. ${message}`,
          report_type: 'exam',
          context: { exam_id: examId },
        };
      }
    }

    return {
      reply: `لم أجد امتحاناً بالكود ${examId} ضمن صلاحياتك.`,
      report_type: 'exam',
      context: { exam_id: examId },
    };
  }

  private static async buildCourseReport(
    teacherId: number,
    tenantId: number,
    userRequest: string,
    courseId: number,
    recentMessages: ChatContextMessage[],
  ): Promise<DataAnalystChatResult> {
    try {
      const data = await DataAnalystReportsService.getCourseReport(teacherId, courseId, tenantId);
      const aiReply = await generateReportWithAi('course', userRequest, data as unknown as Record<string, unknown>, recentMessages);
      return {
        reply: aiReply ?? formatCourseReportFallback(data),
        report_type: 'course',
        context: { course_id: courseId },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
      return {
        reply: `تعذر إنشاء تقرير الكورس رقم ${courseId}. ${message}`,
        report_type: 'course',
        context: { course_id: courseId },
      };
    }
  }

  private static async buildStudentReport(
    teacherId: number,
    tenantId: number,
    userRequest: string,
    studentId: number,
    recentMessages: ChatContextMessage[],
  ): Promise<DataAnalystChatResult> {
    try {
      const report = await DataAnalystReportsService.getStudentReport(teacherId, studentId);
      const aiReply = await generateReportWithAi('student', userRequest, { report }, recentMessages);
      return {
        reply: aiReply ?? formatStudentReportFallback(report),
        report_type: 'student',
        context: { student_id: studentId, tenant_id: tenantId },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'تعذر جلب التقرير';
      return {
        reply: `تعذر إنشاء تقرير الطالب رقم ${studentId}. ${message}`,
        report_type: 'student',
        context: { student_id: studentId },
      };
    }
  }

  static getBotInfo() {
    return {
      name: DATA_ANALYST_BOT_NAME,
      welcome_message: DATA_ANALYST_WELCOME_MESSAGE,
      capabilities: [
        'تقرير تفصيلي لطالب معين (بالكود أو الاسم)',
        'تقرير كورس معين (بالكود أو اسم الكورس)',
        'تقرير عام شامل لكل الطلاب والكورسات',
        'تحليل واجب/امتحان محاضرة (بالاسم أو الكود)',
        'تحليل امتحان كورس عام (بالاسم أو الكود)',
      ],
      examples: [
        'تقرير عام شامل',
        'تقرير الطالب 15',
        'تقرير الطالب أحمد',
        'تقرير الكورس 3',
        'تقرير الكورس فيزياء',
        'تقرير واجب المحاضرة الأولى',
        'تحليل امتحان نصف العام',
      ],
    };
  }
}
