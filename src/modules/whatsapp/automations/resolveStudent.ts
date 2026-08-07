import pool from '../../../db/pool';
import { ScientificChatbotService } from '../../../services/scientificChatbot';
import {
  getTeacherPackage,
  hasPlanFeature,
} from '../../../services/teacherPlanPolicy';
import { phoneMatchVariants } from './phoneMatch';

export type ResolvedStudent = {
  id: number;
  name: string | null;
  phone: string | null;
  tenant_id: number | null;
};

export type EligibleScientificTeacher = {
  id: number;
  name: string | null;
};

/**
 * Identify a student by WhatsApp from-phone against users.phone.
 */
export async function resolveStudentByPhone(
  fromPhone: string,
): Promise<ResolvedStudent | null> {
  const variants = phoneMatchVariants(fromPhone);
  if (variants.length === 0) return null;

  const result = await pool.query<ResolvedStudent>(
    `SELECT id, name, phone, tenant_id
     FROM users
     WHERE role = 'student'
       AND phone IS NOT NULL
       AND regexp_replace(phone, '[^0-9]', '', 'g') = ANY($1::text[])
     ORDER BY id ASC
     LIMIT 1`,
    [variants],
  );

  return result.rows[0] ?? null;
}

/**
 * Teachers the student is enrolled with who have scientific_support + uploaded content.
 */
export async function listEligibleScientificTeachers(
  studentId: number,
): Promise<EligibleScientificTeacher[]> {
  const result = await pool.query<{ id: number; name: string | null }>(
    `SELECT DISTINCT u.id, u.name
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = c.teacher_id AND u.role = 'teacher'
     WHERE e.user_id = $1
     ORDER BY u.name ASC NULLS LAST, u.id ASC`,
    [studentId],
  );

  const eligible: EligibleScientificTeacher[] = [];
  for (const row of result.rows) {
    const pkg = await getTeacherPackage(row.id);
    if (!hasPlanFeature(pkg, 'scientific_support')) continue;
    const hasContent = await ScientificChatbotService.teacherHasContent(row.id);
    if (!hasContent) continue;
    eligible.push({ id: row.id, name: row.name });
  }
  return eligible;
}
