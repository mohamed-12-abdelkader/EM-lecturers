import type { PoolClient } from 'pg';
import pool from '../db/pool';
import {
  OWNER_BILLING_SUBSCRIPTION_JOIN,
  OWNER_BILLING_SUBSCRIPTION_SELECT,
} from './teacherPlanPolicy';
import { SeoHooks } from './seo/hooks';

type OwnerSubscriptionPackage = 'bronze' | 'silver' | 'gold' | 'diamond';

function resolveOwnerSubscriptionFields(row: Record<string, unknown>) {
  const pkg = (row.owner_billing_plan_code ??
    row.owner_subscription_package ??
    'bronze') as OwnerSubscriptionPackage;
  return {
    subscription_package: pkg,
    subscription_package_assigned_at:
      (row.owner_billing_starts_at as Date | null) ??
      (row.owner_subscription_package_assigned_at as Date | null) ??
      null,
    subscription_plan_name: (row.owner_billing_plan_name as string | null) ?? null,
    subscription_status: (row.owner_billing_status as string | null) ?? null,
    subscription_ends_at: (row.owner_billing_ends_at as Date | null) ?? null,
    subscription_number: (row.owner_billing_number as string | null) ?? null,
    subscription_id: row.owner_billing_subscription_id
      ? Number(row.owner_billing_subscription_id)
      : null,
  };
}

export type TenantLandingPage = Record<string, unknown>;

export type CreateTenantInput = {
  subdomain: string;
  display_name: string;
  specialty?: string | null;
  bio?: string | null;
  avatar_url?: string | null;
  is_active?: boolean;
  seo_title?: string | null;
  seo_meta_description?: string | null;
  favicon_url?: string | null;
  og_image_url?: string | null;
  settings?: Record<string, unknown>;
  landing?: TenantLandingPage;
  owner?: {
    name: string;
    email: string;
    password: string;
    description?: string;
    subject?: string;
    grade_ids?: number[];
  };
};

export type PatchTenantInput = Partial<
  Pick<
    CreateTenantInput,
    | 'subdomain'
    | 'display_name'
    | 'specialty'
    | 'bio'
    | 'avatar_url'
    | 'is_active'
    | 'seo_title'
    | 'seo_meta_description'
    | 'favicon_url'
    | 'og_image_url'
  >
> & {
  settings?: Record<string, unknown>;
  landing?: TenantLandingPage;
  merge_settings?: boolean;
  merge_landing?: boolean;
  owner?: {
    name?: string;
    email?: string;
    password?: string;
    description?: string | null;
    subject?: string | null;
    phone?: string | null;
    facebook_url?: string | null;
    youtube_url?: string | null;
    tiktok_url?: string | null;
    whatsapp_number?: string | null;
    account_status?: 'active' | 'inactive' | 'suspended' | null;
    grade_ids?: number[];
  };
};

export type AdminTeacherTenantListItem = {
  id: number;
  subdomain: string;
  display_name: string;
  specialty: string | null;
  bio: string | null;
  avatar_url: string | null;
  is_active: boolean;
  seo_title: string | null;
  seo_meta_description: string | null;
  favicon_url: string | null;
  og_image_url: string | null;
  owner_user_id: number | null;
  created_at: Date;
  updated_at: Date;
  owner: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    subject: string | null;
    avatar: string | null;
    account_status: string | null;
    subscription_package: 'bronze' | 'silver' | 'gold' | 'diamond' | null;
    subscription_package_assigned_at: Date | null;
    subscription_plan_name?: string | null;
    subscription_status?: string | null;
    subscription_ends_at?: Date | null;
    subscription_number?: string | null;
    subscription_id?: number | null;
    created_at: Date;
  } | null;
  stats: {
    teachers_count: number;
    courses_count: number;
    students_count: number;
  };
};

export type AdminTeacherTenantDetail = AdminTeacherTenantListItem & {
  settings: Record<string, unknown>;
  landing: TenantLandingPage;
  owner:
    | (NonNullable<AdminTeacherTenantListItem['owner']> & {
        description: string | null;
        facebook_url: string | null;
        youtube_url: string | null;
        tiktok_url: string | null;
        whatsapp_number: string | null;
        grade_ids: number[];
      })
    | null;
};

function mergeJsonObjects(
  existing: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...existing };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      existing[key] &&
      typeof existing[key] === 'object' &&
      !Array.isArray(existing[key])
    ) {
      out[key] = {
        ...(existing[key] as Record<string, unknown>),
        ...(value as Record<string, unknown>),
      };
    } else {
      out[key] = value;
    }
  }
  return out;
}

function normalizeSubdomain(raw: string): string {
  return raw.trim().toLowerCase();
}

export class TenantService {
  static async getBySubdomain(subdomain: string) {
    const sub = normalizeSubdomain(subdomain);
    const r = await pool.query(
      `SELECT id, subdomain, display_name, specialty, bio, avatar_url, is_active,
              seo_title, seo_meta_description, favicon_url, og_image_url, owner_user_id,
              created_at, updated_at
       FROM tenants WHERE subdomain = $1`,
      [sub],
    );
    return r.rows[0] ?? null;
  }

  /** Active teacher platforms for public sitemap (excludes `default`). */
  static async listActivePublicTenants(): Promise<
    { subdomain: string; updated_at: Date }[]
  > {
    const r = await pool.query<{ subdomain: string; updated_at: Date }>(
      `SELECT subdomain, updated_at
       FROM tenants
       WHERE is_active = true AND subdomain <> 'default'
       ORDER BY updated_at DESC`,
    );
    return r.rows;
  }

  static async getPublicBundle(subdomain: string) {
    const tenant = await this.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) return null;

    const ownerId = tenant.owner_user_id as number | null | undefined;

    const [settings, landing, teacherRes, gradesRes, latestCoursesRes] = await Promise.all([
      pool.query(`SELECT data FROM tenant_settings WHERE tenant_id = $1`, [tenant.id]),
      pool.query(`SELECT page FROM tenant_landing_pages WHERE tenant_id = $1`, [tenant.id]),
      ownerId
        ? pool.query(
            `SELECT name, avatar, description, subject, facebook_url, youtube_url, tiktok_url, whatsapp_number
             FROM users
             WHERE id = $1 AND role = 'teacher' AND tenant_id = $2
             LIMIT 1`,
            [ownerId, tenant.id],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      ownerId
        ? pool.query(
            `SELECT g.id, g.name, g.slug, g.stage, g.status
             FROM teacher_grades tg
             JOIN grades g ON g.id = tg.grade_id
             WHERE tg.teacher_id = $1 AND g.status = 'active'
             ORDER BY g.id`,
            [ownerId],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
      ownerId
        ? pool.query(
            `SELECT c.id, c.title, c.description, c.price, c.avatar, c.grade_id, c.created_at, c.slug,
                    g.name AS grade_name, g.slug AS grade_slug
             FROM courses c
             LEFT JOIN grades g ON g.id = c.grade_id
             WHERE c.teacher_id = $1
             ORDER BY c.created_at DESC
             LIMIT 12`,
            [ownerId],
          )
        : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    ]);

    const row = teacherRes.rows[0] as
      | {
          name: string;
          avatar: string | null;
          description: string | null;
          subject: string | null;
          facebook_url: string | null;
          youtube_url: string | null;
          tiktok_url: string | null;
          whatsapp_number: string | null;
        }
      | undefined;

    const teacher = row
      ? {
          name: row.name,
          avatar: row.avatar,
          description: row.description,
          subject: row.subject,
          facebook_url: row.facebook_url,
          youtube_url: row.youtube_url,
          tiktok_url: row.tiktok_url,
          whatsapp_number: row.whatsapp_number,
        }
      : null;

    const teacher_grades = gradesRes.rows;
    const latest_courses = latestCoursesRes.rows.map((c) => ({
      id: c.id,
      title: c.title,
      slug: c.slug,
      description: c.description,
      price: c.price,
      avatar: c.avatar,
      created_at: c.created_at,
      grade: c.grade_id
        ? {
            id: c.grade_id,
            name: c.grade_name,
            slug: c.grade_slug,
          }
        : null,
    }));

    return {
      tenant: {
        subdomain: tenant.subdomain,
        display_name: tenant.display_name,
        specialty: tenant.specialty,
        bio: tenant.bio,
        avatar_url: tenant.avatar_url,
        seo_title: tenant.seo_title,
        seo_meta_description: tenant.seo_meta_description,
        favicon_url: tenant.favicon_url,
        og_image_url: tenant.og_image_url,
      },
      teacher,
      teacher_grades,
      latest_courses,
      settings: settings.rows[0]?.data ?? {},
      landing: landing.rows[0]?.page ?? {},
    };
  }

  static async getPublicTeacherGradesBySubdomain(subdomain: string) {
    const tenant = await this.getBySubdomain(subdomain);
    if (!tenant || !tenant.is_active) return null;
    const ownerId = tenant.owner_user_id as number | null | undefined;
    if (!ownerId) return [];
    const r = await pool.query(
      `SELECT g.id, g.name, g.slug, g.stage, g.status
       FROM teacher_grades tg
       JOIN grades g ON g.id = tg.grade_id
       WHERE tg.teacher_id = $1
         AND g.status = 'active'
       ORDER BY g.id`,
      [ownerId],
    );
    return r.rows;
  }

  static async createWithDefaults(client: PoolClient, input: CreateTenantInput) {
    const subdomain = normalizeSubdomain(input.subdomain);
    const t = await client.query(
      `INSERT INTO tenants (
         subdomain, display_name, specialty, bio, avatar_url, is_active,
         seo_title, seo_meta_description, favicon_url, og_image_url
       ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7, $8, $9, $10)
       RETURNING id, subdomain, display_name, is_active, owner_user_id`,
      [
        subdomain,
        input.display_name,
        input.specialty ?? null,
        input.bio ?? null,
        input.avatar_url ?? null,
        input.is_active,
        input.seo_title ?? input.display_name,
        input.seo_meta_description ?? null,
        input.favicon_url ?? null,
        input.og_image_url ?? null,
      ],
    );
    const created = t.rows[0] as {
      id: number;
      subdomain: string;
      display_name: string;
      is_active: boolean;
      owner_user_id: number | null;
    };

    await client.query(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [created.id, JSON.stringify(input.settings ?? {})],
    );

    await client.query(
      `INSERT INTO tenant_landing_pages (tenant_id, page) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET page = EXCLUDED.page, updated_at = NOW()`,
      [created.id, JSON.stringify(input.landing ?? {})],
    );

    if (input.owner?.email && input.owner?.password && input.owner?.name) {
      const bcrypt = await import('bcrypt');
      const hashed = await bcrypt.hash(input.owner.password, 10);
      const description = input.owner.description ?? '';
      const subject = input.owner.subject ?? '';
      const u = await client.query(
        `INSERT INTO users (email, password, name, avatar, role, description, subject, tenant_id)
         VALUES ($1, $2, $3, $4, 'teacher', $5, $6, $7)
         RETURNING id`,
        [
          input.owner.email,
          hashed,
          input.owner.name,
          input.avatar_url ?? null,
          description,
          subject,
          created.id,
        ],
      );
      const teacherId = u.rows[0].id as number;

      if (input.owner.grade_ids?.length) {
        const gradeIds = Array.from(new Set(input.owner.grade_ids.map((id) => Number(id)))).filter(
          (id) => Number.isInteger(id) && id > 0,
        );
        if (gradeIds.length !== input.owner.grade_ids.length) {
          throw new Error('Invalid owner grade_ids');
        }
        const gradesRes = await client.query<{ id: number }>(
          `SELECT id FROM grades WHERE id = ANY($1::int[])`,
          [gradeIds],
        );
        const found = new Set(gradesRes.rows.map((r) => Number(r.id)));
        const missing = gradeIds.filter((id) => !found.has(id));
        if (missing.length) {
          throw new Error(`Invalid owner grade_ids: ${missing.join(', ')}`);
        }
        await client.query(
          `INSERT INTO teacher_grades (teacher_id, grade_id)
           SELECT $1, unnest($2::int[])`,
          [teacherId, gradeIds],
        );
      }

      await client.query(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [
        teacherId,
        created.id,
      ]);
      created.owner_user_id = teacherId;
    }

    return created;
  }

  static async createTenantTransaction(input: CreateTenantInput) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenant = await this.createWithDefaults(client, input);
      await client.query('COMMIT');
      return tenant;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  static async listAll(limit = 50, offset = 0) {
    const r = await pool.query(
      `SELECT id, subdomain, display_name, is_active, owner_user_id, created_at
       FROM tenants
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return r.rows;
  }

  static async listTeacherTenantsForAdmin(options: {
    limit?: number;
    offset?: number;
    includeDefault?: boolean;
    isActive?: boolean | null;
    search?: string;
  } = {}): Promise<{ tenants: AdminTeacherTenantListItem[]; total: number }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const includeDefault = options.includeDefault ?? false;
    const search = options.search?.trim() || null;
    const isActive = options.isActive ?? null;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    if (!includeDefault) {
      conditions.push(`t.subdomain <> 'default'`);
    }
    if (isActive !== null) {
      conditions.push(`t.is_active = $${i++}`);
      values.push(isActive);
    }
    if (search) {
      conditions.push(
        `(t.subdomain ILIKE $${i} OR t.display_name ILIKE $${i} OR owner.name ILIKE $${i} OR owner.email ILIKE $${i})`,
      );
      values.push(`%${search}%`);
      i++;
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM tenants t
       LEFT JOIN users owner ON owner.id = t.owner_user_id AND owner.tenant_id = t.id
       ${whereClause}`,
      values,
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    const listValues = [...values, limit, offset];
    const result = await pool.query(
      `SELECT
         t.id,
         t.subdomain,
         t.display_name,
         t.specialty,
         t.bio,
         t.avatar_url,
         t.is_active,
         t.seo_title,
         t.seo_meta_description,
         t.favicon_url,
         t.og_image_url,
         t.owner_user_id,
         t.created_at,
         t.updated_at,
         owner.id AS owner_id,
         owner.name AS owner_name,
         owner.email AS owner_email,
         owner.phone AS owner_phone,
         owner.subject AS owner_subject,
         owner.avatar AS owner_avatar,
         owner.account_status AS owner_account_status,
         owner.subscription_package AS owner_subscription_package,
         owner.subscription_package_assigned_at AS owner_subscription_package_assigned_at,
         owner.created_at AS owner_created_at,
         ${OWNER_BILLING_SUBSCRIPTION_SELECT},
         (
           SELECT COUNT(*)::int
           FROM users u
           WHERE u.tenant_id = t.id AND u.role = 'teacher'
         ) AS teachers_count,
         (
           SELECT COUNT(*)::int
           FROM courses c
           JOIN users teacher ON teacher.id = c.teacher_id
           WHERE teacher.tenant_id = t.id
         ) AS courses_count,
         (
           SELECT COUNT(DISTINCT e.user_id)::int
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           JOIN users teacher ON teacher.id = c.teacher_id
           WHERE teacher.tenant_id = t.id
         ) AS students_count
       FROM tenants t
       LEFT JOIN users owner ON owner.id = t.owner_user_id AND owner.tenant_id = t.id
       ${OWNER_BILLING_SUBSCRIPTION_JOIN}
       ${whereClause}
       ORDER BY t.created_at DESC, t.id DESC
       LIMIT $${i++} OFFSET $${i}`,
      listValues,
    );

    const tenants: AdminTeacherTenantListItem[] = result.rows.map((row) => ({
      id: row.id,
      subdomain: row.subdomain,
      display_name: row.display_name,
      specialty: row.specialty,
      bio: row.bio,
      avatar_url: row.avatar_url,
      is_active: row.is_active,
      seo_title: row.seo_title,
      seo_meta_description: row.seo_meta_description,
      favicon_url: row.favicon_url,
      og_image_url: row.og_image_url,
      owner_user_id: row.owner_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      owner: row.owner_id
        ? {
            id: row.owner_id,
            name: row.owner_name,
            email: row.owner_email,
            phone: row.owner_phone,
            subject: row.owner_subject,
            avatar: row.owner_avatar,
            account_status: row.owner_account_status,
            ...resolveOwnerSubscriptionFields(row),
            created_at: row.owner_created_at,
          }
        : null,
      stats: {
        teachers_count: Number(row.teachers_count ?? 0),
        courses_count: Number(row.courses_count ?? 0),
        students_count: Number(row.students_count ?? 0),
      },
    }));

    return { tenants, total };
  }

  static async getTenantForAdmin(id: number): Promise<AdminTeacherTenantDetail | null> {
    const result = await pool.query(
      `SELECT
         t.id,
         t.subdomain,
         t.display_name,
         t.specialty,
         t.bio,
         t.avatar_url,
         t.is_active,
         t.seo_title,
         t.seo_meta_description,
         t.favicon_url,
         t.og_image_url,
         t.owner_user_id,
         t.created_at,
         t.updated_at,
         owner.id AS owner_id,
         owner.name AS owner_name,
         owner.email AS owner_email,
         owner.phone AS owner_phone,
         owner.subject AS owner_subject,
         owner.avatar AS owner_avatar,
         owner.description AS owner_description,
         owner.facebook_url AS owner_facebook_url,
         owner.youtube_url AS owner_youtube_url,
         owner.tiktok_url AS owner_tiktok_url,
         owner.whatsapp_number AS owner_whatsapp_number,
         owner.account_status AS owner_account_status,
         owner.subscription_package AS owner_subscription_package,
         owner.subscription_package_assigned_at AS owner_subscription_package_assigned_at,
         owner.created_at AS owner_created_at,
         ${OWNER_BILLING_SUBSCRIPTION_SELECT},
         (
           SELECT COUNT(*)::int
           FROM users u
           WHERE u.tenant_id = t.id AND u.role = 'teacher'
         ) AS teachers_count,
         (
           SELECT COUNT(*)::int
           FROM courses c
           JOIN users teacher ON teacher.id = c.teacher_id
           WHERE teacher.tenant_id = t.id
         ) AS courses_count,
         (
           SELECT COUNT(DISTINCT e.user_id)::int
           FROM enrollments e
           JOIN courses c ON c.id = e.course_id
           JOIN users teacher ON teacher.id = c.teacher_id
           WHERE teacher.tenant_id = t.id
         ) AS students_count
       FROM tenants t
       LEFT JOIN users owner ON owner.id = t.owner_user_id AND owner.tenant_id = t.id
       ${OWNER_BILLING_SUBSCRIPTION_JOIN}
       WHERE t.id = $1
       LIMIT 1`,
      [id],
    );
    if (!result.rowCount) return null;

    const row = result.rows[0];
    const [settingsRes, landingRes, gradesRes] = await Promise.all([
      pool.query<{ data: Record<string, unknown> }>(
        `SELECT data FROM tenant_settings WHERE tenant_id = $1`,
        [id],
      ),
      pool.query<{ page: TenantLandingPage }>(
        `SELECT page FROM tenant_landing_pages WHERE tenant_id = $1`,
        [id],
      ),
      row.owner_id
        ? pool.query<{ grade_id: number }>(
            `SELECT grade_id FROM teacher_grades WHERE teacher_id = $1 ORDER BY grade_id`,
            [row.owner_id],
          )
        : Promise.resolve({ rows: [] as { grade_id: number }[] }),
    ]);

    return {
      id: row.id,
      subdomain: row.subdomain,
      display_name: row.display_name,
      specialty: row.specialty,
      bio: row.bio,
      avatar_url: row.avatar_url,
      is_active: row.is_active,
      seo_title: row.seo_title,
      seo_meta_description: row.seo_meta_description,
      favicon_url: row.favicon_url,
      og_image_url: row.og_image_url,
      owner_user_id: row.owner_user_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      settings: settingsRes.rows[0]?.data ?? {},
      landing: landingRes.rows[0]?.page ?? {},
      owner: row.owner_id
        ? {
            id: row.owner_id,
            name: row.owner_name,
            email: row.owner_email,
            phone: row.owner_phone,
            subject: row.owner_subject,
            avatar: row.owner_avatar,
            account_status: row.owner_account_status,
            ...resolveOwnerSubscriptionFields(row),
            created_at: row.owner_created_at,
            description: row.owner_description,
            facebook_url: row.owner_facebook_url,
            youtube_url: row.owner_youtube_url,
            tiktok_url: row.owner_tiktok_url,
            whatsapp_number: row.owner_whatsapp_number,
            grade_ids: gradesRes.rows.map((g) => g.grade_id),
          }
        : null,
      stats: {
        teachers_count: Number(row.teachers_count ?? 0),
        courses_count: Number(row.courses_count ?? 0),
        students_count: Number(row.students_count ?? 0),
      },
    };
  }

  static async patchTenant(id: number, patch: PatchTenantInput): Promise<AdminTeacherTenantDetail> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const tenantRes = await client.query<{ owner_user_id: number | null; avatar_url: string | null }>(
        `SELECT owner_user_id, avatar_url FROM tenants WHERE id = $1 LIMIT 1`,
        [id],
      );
      if (!tenantRes.rowCount) throw new Error('Tenant not found');
      const tenant = tenantRes.rows[0];

      const fields: string[] = [];
      const vals: unknown[] = [];
      let i = 1;
      const add = (col: string, v: unknown) => {
        fields.push(`${col} = $${i++}`);
        vals.push(v);
      };
      if (patch.subdomain !== undefined) add('subdomain', normalizeSubdomain(patch.subdomain));
      if (patch.display_name !== undefined) add('display_name', patch.display_name);
      if (patch.specialty !== undefined) add('specialty', patch.specialty);
      if (patch.bio !== undefined) add('bio', patch.bio);
      if (patch.avatar_url !== undefined) add('avatar_url', patch.avatar_url);
      if (patch.is_active !== undefined) add('is_active', patch.is_active);
      if (patch.seo_title !== undefined) add('seo_title', patch.seo_title);
      if (patch.seo_meta_description !== undefined)
        add('seo_meta_description', patch.seo_meta_description);
      if (patch.favicon_url !== undefined) add('favicon_url', patch.favicon_url);
      if (patch.og_image_url !== undefined) add('og_image_url', patch.og_image_url);
      if (fields.length) {
        vals.push(id);
        await client.query(
          `UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i}`,
          vals,
        );
      }

      if (patch.settings) {
        const mergeSettings = patch.merge_settings !== false;
        let settingsPayload = patch.settings;
        if (mergeSettings) {
          const existing = await client.query<{ data: Record<string, unknown> }>(
            `SELECT data FROM tenant_settings WHERE tenant_id = $1`,
            [id],
          );
          const current = existing.rows[0]?.data ?? {};
          settingsPayload = mergeJsonObjects(current, patch.settings);
        }
        await client.query(
          `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
           ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
          [id, JSON.stringify(settingsPayload)],
        );
      }

      if (patch.landing) {
        const mergeLanding = patch.merge_landing !== false;
        let landingPayload = patch.landing;
        if (mergeLanding) {
          const existing = await client.query<{ page: TenantLandingPage }>(
            `SELECT page FROM tenant_landing_pages WHERE tenant_id = $1`,
            [id],
          );
          const current = existing.rows[0]?.page ?? {};
          landingPayload = mergeJsonObjects(
            current as Record<string, unknown>,
            patch.landing as Record<string, unknown>,
          ) as TenantLandingPage;
        }
        await client.query(
          `INSERT INTO tenant_landing_pages (tenant_id, page) VALUES ($1, $2::JSONB)
           ON CONFLICT (tenant_id) DO UPDATE SET page = EXCLUDED.page, updated_at = NOW()`,
          [id, JSON.stringify(landingPayload)],
        );
      }

      if (patch.owner) {
        let ownerId = tenant.owner_user_id;
        if (!ownerId) {
          if (!patch.owner.name || !patch.owner.email || !patch.owner.password) {
            throw new Error('owner.name, owner.email and owner.password are required to create owner');
          }
          const bcrypt = await import('bcrypt');
          const hashed = await bcrypt.hash(patch.owner.password, 10);
          const createdOwner = await client.query<{ id: number }>(
            `INSERT INTO users (email, password, name, avatar, role, description, subject, tenant_id)
             VALUES ($1, $2, $3, $4, 'teacher', $5, $6, $7)
             RETURNING id`,
            [
              patch.owner.email,
              hashed,
              patch.owner.name,
              patch.avatar_url ?? tenant.avatar_url ?? null,
              patch.owner.description ?? '',
              patch.owner.subject ?? '',
              id,
            ],
          );
          ownerId = createdOwner.rows[0].id;
          await client.query(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [ownerId, id]);
        } else {
          const ownerFields: string[] = [];
          const ownerVals: unknown[] = [];
          let oi = 1;
          const addOwner = (col: string, val: unknown) => {
            ownerFields.push(`${col} = $${oi++}`);
            ownerVals.push(val);
          };

          if (patch.owner.name !== undefined) addOwner('name', patch.owner.name);
          if (patch.owner.email !== undefined) addOwner('email', patch.owner.email);
          if (patch.owner.description !== undefined)
            addOwner('description', patch.owner.description ?? '');
          if (patch.owner.subject !== undefined) addOwner('subject', patch.owner.subject ?? '');
          if (patch.owner.phone !== undefined) addOwner('phone', patch.owner.phone);
          if (patch.owner.facebook_url !== undefined) addOwner('facebook_url', patch.owner.facebook_url);
          if (patch.owner.youtube_url !== undefined) addOwner('youtube_url', patch.owner.youtube_url);
          if (patch.owner.tiktok_url !== undefined) addOwner('tiktok_url', patch.owner.tiktok_url);
          if (patch.owner.whatsapp_number !== undefined) {
            addOwner('whatsapp_number', patch.owner.whatsapp_number);
          }
          if (patch.owner.account_status !== undefined) {
            addOwner('account_status', patch.owner.account_status);
          }
          if (patch.owner.password !== undefined) {
            const bcrypt = await import('bcrypt');
            const hashed = await bcrypt.hash(patch.owner.password, 10);
            addOwner('password', hashed);
          }
          if (patch.avatar_url !== undefined) addOwner('avatar', patch.avatar_url);

          if (ownerFields.length) {
            ownerVals.push(ownerId, id);
            await client.query(
              `UPDATE users
               SET ${ownerFields.join(', ')}
               WHERE id = $${oi++} AND tenant_id = $${oi} AND role = 'teacher'`,
              ownerVals,
            );
          }
        }

        if (ownerId && patch.owner.grade_ids !== undefined) {
          const gradeIds = Array.from(new Set(patch.owner.grade_ids.map((v) => Number(v)))).filter(
            (n) => Number.isInteger(n) && n > 0,
          );
          if (gradeIds.length !== patch.owner.grade_ids.length) {
            throw new Error('Invalid owner grade_ids');
          }
          const gradesRes = await client.query<{ id: number }>(
            `SELECT id FROM grades WHERE id = ANY($1::int[])`,
            [gradeIds],
          );
          const found = new Set(gradesRes.rows.map((r) => Number(r.id)));
          const missing = gradeIds.filter((gid) => !found.has(gid));
          if (missing.length) {
            throw new Error(`Invalid owner grade_ids: ${missing.join(', ')}`);
          }
          await client.query(`DELETE FROM teacher_grades WHERE teacher_id = $1`, [ownerId]);
          if (gradeIds.length) {
            await client.query(
              `INSERT INTO teacher_grades (teacher_id, grade_id)
               SELECT $1, unnest($2::int[])`,
              [ownerId, gradeIds],
            );
          }
        }
      }
      await client.query('COMMIT');
      try {
        await SeoHooks.onTenantProfileChanged(id);
      } catch (seoErr) {
        console.error('SEO sync after tenant patch:', seoErr);
      }
      const updated = await this.getTenantForAdmin(id);
      if (!updated) throw new Error('Tenant not found after update');
      return updated;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
