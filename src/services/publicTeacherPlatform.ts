import pool from '../db/pool';
import { HttpError } from '../utils';
import { TeacherPlatformSubscriptionsService } from './teacherPlatformSubscriptions';

export type ResolvedTeacherPlatform = {
  tenant: {
    id: number;
    subdomain: string;
    display_name: string;
    is_active: boolean;
  };
  teacher: {
    id: number;
    name: string;
    avatar: string | null;
    description: string | null;
    subject: string | null;
  };
};

function normalizeSubdomain(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function resolveTeacherPlatformBySubdomain(
  subdomainRaw: string,
): Promise<ResolvedTeacherPlatform | null> {
  const subdomain = normalizeSubdomain(subdomainRaw);
  if (!subdomain) return null;

  const tenantRes = await pool.query(
    `SELECT id, subdomain, display_name, owner_user_id, is_active
     FROM tenants
     WHERE subdomain = $1
     LIMIT 1`,
    [subdomain],
  );
  if (!tenantRes.rowCount) return null;

  const tenant = tenantRes.rows[0];
  if (!tenant.owner_user_id) return null;

  const access = await TeacherPlatformSubscriptionsService.getPlatformAccessState(
    tenant.owner_user_id,
  );
  if (!access.allowed) return null;

  if (!tenant.is_active) {
    if (access.phase === 'grace') {
      await pool.query(
        `UPDATE tenants SET is_active = true, updated_at = NOW() WHERE id = $1`,
        [tenant.id],
      );
      tenant.is_active = true;
    } else {
      return null;
    }
  }

  const teacherRes = await pool.query(
    `SELECT id, name, avatar, description, subject
     FROM users
     WHERE id = $1 AND role = 'teacher'
     LIMIT 1`,
    [tenant.owner_user_id],
  );
  if (!teacherRes.rowCount) return null;

  return {
    tenant: {
      id: tenant.id,
      subdomain: tenant.subdomain,
      display_name: tenant.display_name,
      is_active: tenant.is_active,
    },
    teacher: teacherRes.rows[0],
  };
}

export async function getPublicFreeLecturesBySubdomain(subdomainRaw: string) {
  const platform = await resolveTeacherPlatformBySubdomain(subdomainRaw);
  if (!platform) return null;

  const lecturesRes = await pool.query(
    `SELECT
       l.id,
       l.title,
       l.link,
       l.image_url,
       l.created_at,
       l.updated_at,
       l.teacher_id,
       u.name AS teacher_name,
       u.avatar AS teacher_avatar
     FROM teacher_free_lectures l
     JOIN users u ON u.id = l.teacher_id
     WHERE l.teacher_id = $1 AND l.is_published = TRUE
     ORDER BY l.created_at DESC`,
    [platform.teacher.id],
  );

  return {
    platform: {
      subdomain: platform.tenant.subdomain,
      display_name: platform.tenant.display_name,
      teacher_id: platform.teacher.id,
      teacher_name: platform.teacher.name,
      teacher_avatar: platform.teacher.avatar,
    },
    lectures: lecturesRes.rows,
  };
}

export async function getPublicCoursesBySubdomain(
  subdomainRaw: string,
  gradeId?: number | null,
) {
  const platform = await resolveTeacherPlatformBySubdomain(subdomainRaw);
  if (!platform) return null;

  const params: unknown[] = [platform.teacher.id];
  let gradeFilter = '';

  if (gradeId != null) {
    if (!Number.isInteger(gradeId) || gradeId <= 0) {
      throw new HttpError(400, 'grade_id غير صحيح');
    }
    params.push(gradeId);
    gradeFilter = ` AND c.grade_id = $${params.length}`;
  }

  const coursesRes = await pool.query(
    `SELECT
       c.id,
       c.title,
       c.description,
       c.price,
       c.avatar,
       c.grade_id,
       c.created_at,
       c.slug,
       COALESCE(c.is_free, FALSE) AS is_free,
       g.name AS grade_name,
       g.slug AS grade_slug
     FROM courses c
     LEFT JOIN grades g ON g.id = c.grade_id
     WHERE c.teacher_id = $1
       AND (c.is_visible IS NULL OR c.is_visible = TRUE)
       ${gradeFilter}
     ORDER BY c.created_at DESC`,
    params,
  );

  return {
    platform: {
      subdomain: platform.tenant.subdomain,
      display_name: platform.tenant.display_name,
      teacher_id: platform.teacher.id,
      teacher_name: platform.teacher.name,
      teacher_avatar: platform.teacher.avatar,
    },
    courses: coursesRes.rows.map((course) => ({
      id: course.id,
      title: course.title,
      slug: course.slug,
      description: course.description,
      price: course.price,
      avatar: course.avatar,
      is_free: course.is_free === true,
      grade_id: course.grade_id,
      grade: course.grade_id
        ? {
            id: course.grade_id,
            name: course.grade_name,
            slug: course.grade_slug,
          }
        : null,
      created_at: course.created_at,
    })),
  };
}
