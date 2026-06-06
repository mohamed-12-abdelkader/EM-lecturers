"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TenantService = void 0;
const pool_1 = __importDefault(require("../db/pool"));
function normalizeSubdomain(raw) {
    return raw.trim().toLowerCase();
}
class TenantService {
    static async getBySubdomain(subdomain) {
        const sub = normalizeSubdomain(subdomain);
        const r = await pool_1.default.query(`SELECT id, subdomain, display_name, specialty, bio, avatar_url, is_active,
              seo_title, seo_meta_description, favicon_url, og_image_url, owner_user_id,
              created_at, updated_at
       FROM tenants WHERE subdomain = $1`, [sub]);
        return r.rows[0] ?? null;
    }
    static async getPublicBundle(subdomain) {
        const tenant = await this.getBySubdomain(subdomain);
        if (!tenant || !tenant.is_active)
            return null;
        const ownerId = tenant.owner_user_id;
        const [settings, landing, teacherRes, gradesRes, latestCoursesRes] = await Promise.all([
            pool_1.default.query(`SELECT data FROM tenant_settings WHERE tenant_id = $1`, [tenant.id]),
            pool_1.default.query(`SELECT page FROM tenant_landing_pages WHERE tenant_id = $1`, [tenant.id]),
            ownerId
                ? pool_1.default.query(`SELECT name, avatar, description, subject, facebook_url, youtube_url, tiktok_url, whatsapp_number
             FROM users
             WHERE id = $1 AND role = 'teacher' AND tenant_id = $2
             LIMIT 1`, [ownerId, tenant.id])
                : Promise.resolve({ rows: [] }),
            ownerId
                ? pool_1.default.query(`SELECT g.id, g.name, g.slug, g.stage, g.status
             FROM teacher_grades tg
             JOIN grades g ON g.id = tg.grade_id
             WHERE tg.teacher_id = $1 AND g.status = 'active'
             ORDER BY g.id`, [ownerId])
                : Promise.resolve({ rows: [] }),
            ownerId
                ? pool_1.default.query(`SELECT c.id, c.title, c.description, c.price, c.avatar, c.grade_id, c.created_at,
                    g.name AS grade_name, g.slug AS grade_slug
             FROM courses c
             LEFT JOIN grades g ON g.id = c.grade_id
             WHERE c.teacher_id = $1
             ORDER BY c.created_at DESC
             LIMIT 12`, [ownerId])
                : Promise.resolve({ rows: [] }),
        ]);
        const row = teacherRes.rows[0];
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
    static async getPublicTeacherGradesBySubdomain(subdomain) {
        const tenant = await this.getBySubdomain(subdomain);
        if (!tenant || !tenant.is_active)
            return null;
        const ownerId = tenant.owner_user_id;
        if (!ownerId)
            return [];
        const r = await pool_1.default.query(`SELECT g.id, g.name, g.slug, g.stage, g.status
       FROM teacher_grades tg
       JOIN grades g ON g.id = tg.grade_id
       WHERE tg.teacher_id = $1
         AND g.status = 'active'
       ORDER BY g.id`, [ownerId]);
        return r.rows;
    }
    static async createWithDefaults(client, input) {
        const subdomain = normalizeSubdomain(input.subdomain);
        const t = await client.query(`INSERT INTO tenants (
         subdomain, display_name, specialty, bio, avatar_url, is_active,
         seo_title, seo_meta_description, favicon_url, og_image_url
       ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7, $8, $9, $10)
       RETURNING id, subdomain, display_name, is_active, owner_user_id`, [
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
        ]);
        const created = t.rows[0];
        await client.query(`INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [created.id, JSON.stringify(input.settings ?? {})]);
        await client.query(`INSERT INTO tenant_landing_pages (tenant_id, page) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET page = EXCLUDED.page, updated_at = NOW()`, [created.id, JSON.stringify(input.landing ?? {})]);
        if (input.owner?.email && input.owner?.password && input.owner?.name) {
            const bcrypt = await import('bcrypt');
            const hashed = await bcrypt.hash(input.owner.password, 10);
            const description = input.owner.description ?? '';
            const subject = input.owner.subject ?? '';
            const u = await client.query(`INSERT INTO users (email, password, name, avatar, role, description, subject, tenant_id)
         VALUES ($1, $2, $3, $4, 'teacher', $5, $6, $7)
         RETURNING id`, [
                input.owner.email,
                hashed,
                input.owner.name,
                input.avatar_url ?? null,
                description,
                subject,
                created.id,
            ]);
            const teacherId = u.rows[0].id;
            if (input.owner.grade_ids?.length) {
                const gradeIds = Array.from(new Set(input.owner.grade_ids.map((id) => Number(id)))).filter((id) => Number.isInteger(id) && id > 0);
                if (gradeIds.length !== input.owner.grade_ids.length) {
                    throw new Error('Invalid owner grade_ids');
                }
                const gradesRes = await client.query(`SELECT id FROM grades WHERE id = ANY($1::int[])`, [gradeIds]);
                const found = new Set(gradesRes.rows.map((r) => Number(r.id)));
                const missing = gradeIds.filter((id) => !found.has(id));
                if (missing.length) {
                    throw new Error(`Invalid owner grade_ids: ${missing.join(', ')}`);
                }
                await client.query(`INSERT INTO teacher_grades (teacher_id, grade_id)
           SELECT $1, unnest($2::int[])`, [teacherId, gradeIds]);
            }
            await client.query(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [
                teacherId,
                created.id,
            ]);
            created.owner_user_id = teacherId;
        }
        return created;
    }
    static async createTenantTransaction(input) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const tenant = await this.createWithDefaults(client, input);
            await client.query('COMMIT');
            return tenant;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    static async listAll(limit = 50, offset = 0) {
        const r = await pool_1.default.query(`SELECT id, subdomain, display_name, is_active, owner_user_id, created_at
       FROM tenants
       ORDER BY id ASC
       LIMIT $1 OFFSET $2`, [limit, offset]);
        return r.rows;
    }
    static async patchTenant(id, patch) {
        const client = await pool_1.default.connect();
        try {
            await client.query('BEGIN');
            const tenantRes = await client.query(`SELECT owner_user_id, avatar_url FROM tenants WHERE id = $1 LIMIT 1`, [id]);
            if (!tenantRes.rowCount)
                throw new Error('Tenant not found');
            const tenant = tenantRes.rows[0];
            const fields = [];
            const vals = [];
            let i = 1;
            const add = (col, v) => {
                fields.push(`${col} = $${i++}`);
                vals.push(v);
            };
            if (patch.subdomain !== undefined)
                add('subdomain', normalizeSubdomain(patch.subdomain));
            if (patch.display_name !== undefined)
                add('display_name', patch.display_name);
            if (patch.specialty !== undefined)
                add('specialty', patch.specialty);
            if (patch.bio !== undefined)
                add('bio', patch.bio);
            if (patch.avatar_url !== undefined)
                add('avatar_url', patch.avatar_url);
            if (patch.is_active !== undefined)
                add('is_active', patch.is_active);
            if (patch.seo_title !== undefined)
                add('seo_title', patch.seo_title);
            if (patch.seo_meta_description !== undefined)
                add('seo_meta_description', patch.seo_meta_description);
            if (patch.favicon_url !== undefined)
                add('favicon_url', patch.favicon_url);
            if (patch.og_image_url !== undefined)
                add('og_image_url', patch.og_image_url);
            if (fields.length) {
                vals.push(id);
                await client.query(`UPDATE tenants SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i}`, vals);
            }
            if (patch.settings) {
                await client.query(`INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
           ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [id, JSON.stringify(patch.settings)]);
            }
            if (patch.landing) {
                await client.query(`INSERT INTO tenant_landing_pages (tenant_id, page) VALUES ($1, $2::JSONB)
           ON CONFLICT (tenant_id) DO UPDATE SET page = EXCLUDED.page, updated_at = NOW()`, [id, JSON.stringify(patch.landing)]);
            }
            if (patch.owner) {
                let ownerId = tenant.owner_user_id;
                if (!ownerId) {
                    if (!patch.owner.name || !patch.owner.email || !patch.owner.password) {
                        throw new Error('owner.name, owner.email and owner.password are required to create owner');
                    }
                    const bcrypt = await import('bcrypt');
                    const hashed = await bcrypt.hash(patch.owner.password, 10);
                    const createdOwner = await client.query(`INSERT INTO users (email, password, name, avatar, role, description, subject, tenant_id)
             VALUES ($1, $2, $3, $4, 'teacher', $5, $6, $7)
             RETURNING id`, [
                        patch.owner.email,
                        hashed,
                        patch.owner.name,
                        patch.avatar_url ?? tenant.avatar_url ?? null,
                        patch.owner.description ?? '',
                        patch.owner.subject ?? '',
                        id,
                    ]);
                    ownerId = createdOwner.rows[0].id;
                    await client.query(`UPDATE tenants SET owner_user_id = $1 WHERE id = $2`, [ownerId, id]);
                }
                else {
                    const ownerFields = [];
                    const ownerVals = [];
                    let oi = 1;
                    const addOwner = (col, val) => {
                        ownerFields.push(`${col} = $${oi++}`);
                        ownerVals.push(val);
                    };
                    if (patch.owner.name !== undefined)
                        addOwner('name', patch.owner.name);
                    if (patch.owner.email !== undefined)
                        addOwner('email', patch.owner.email);
                    if (patch.owner.description !== undefined)
                        addOwner('description', patch.owner.description ?? '');
                    if (patch.owner.subject !== undefined)
                        addOwner('subject', patch.owner.subject ?? '');
                    if (patch.owner.password !== undefined) {
                        const bcrypt = await import('bcrypt');
                        const hashed = await bcrypt.hash(patch.owner.password, 10);
                        addOwner('password', hashed);
                    }
                    if (patch.avatar_url !== undefined)
                        addOwner('avatar', patch.avatar_url);
                    if (ownerFields.length) {
                        ownerVals.push(ownerId, id);
                        await client.query(`UPDATE users
               SET ${ownerFields.join(', ')}
               WHERE id = $${oi++} AND tenant_id = $${oi} AND role = 'teacher'`, ownerVals);
                    }
                }
                if (ownerId && patch.owner.grade_ids !== undefined) {
                    const gradeIds = Array.from(new Set(patch.owner.grade_ids.map((v) => Number(v)))).filter((n) => Number.isInteger(n) && n > 0);
                    if (gradeIds.length !== patch.owner.grade_ids.length) {
                        throw new Error('Invalid owner grade_ids');
                    }
                    const gradesRes = await client.query(`SELECT id FROM grades WHERE id = ANY($1::int[])`, [gradeIds]);
                    const found = new Set(gradesRes.rows.map((r) => Number(r.id)));
                    const missing = gradeIds.filter((gid) => !found.has(gid));
                    if (missing.length) {
                        throw new Error(`Invalid owner grade_ids: ${missing.join(', ')}`);
                    }
                    await client.query(`DELETE FROM teacher_grades WHERE teacher_id = $1`, [ownerId]);
                    if (gradeIds.length) {
                        await client.query(`INSERT INTO teacher_grades (teacher_id, grade_id)
               SELECT $1, unnest($2::int[])`, [ownerId, gradeIds]);
                    }
                }
            }
            await client.query('COMMIT');
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
}
exports.TenantService = TenantService;
