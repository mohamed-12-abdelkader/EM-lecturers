import type { Request, Response } from 'express';
import pool from '../db/pool';
import { HttpError, config } from '../utils';
import { validateSubdomain } from '../utils/subdomain';
import { TenantService, type CreateTenantInput } from './tenants';
import { AuthSessionsService, setRefreshCookie } from './authSessions';
import { buildTenantPublicUrl } from '../config/appUrls';
import { SeoHooks } from './seo/hooks';

export type PublicRegisterPayload = CreateTenantInput & { remember_me?: boolean };

export class PublicPlatformSignupService {
  /** التسجيل الذاتي للمنصات متوقف — الإنشاء للأدمن فقط عبر POST /api/super/tenants */
  static isEnabled(): boolean {
    return false;
  }

  static assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new HttpError(403, 'إنشاء المنصات متاح للأدمن فقط عبر لوحة الإدارة', {
        code: 'PUBLIC_SIGNUP_DISABLED',
        admin_endpoint: 'POST /api/super/tenants',
      });
    }
  }

  static async checkSubdomainAvailability(raw: string) {
    const validation = validateSubdomain(raw);
    if (!validation.ok) {
      return {
        available: false,
        subdomain: raw.trim().toLowerCase(),
        reason: validation.code,
        message: validation.message,
      };
    }

    const existing = await TenantService.getBySubdomain(validation.subdomain);
    if (existing) {
      return {
        available: false,
        subdomain: validation.subdomain,
        reason: 'SUBDOMAIN_TAKEN',
        message: 'هذا النطاق مستخدم بالفعل — جرّب اسماً آخر',
      };
    }

    return {
      available: true,
      subdomain: validation.subdomain,
      platform_url: buildTenantPublicUrl(validation.subdomain),
      message: 'النطاق متاح',
    };
  }

  /**
   * نفس body الخاص بـ POST /api/super/tenants
   * مع إلزام owner + دخول تلقائي بعد الإنشاء.
   */
  static async register(input: PublicRegisterPayload, req: Request, res: Response) {
    this.assertEnabled();

    if (!input.owner?.name || !input.owner?.email || !input.owner?.password) {
      throw new HttpError(400, 'owner مطلوب (name, email, password)', {
        code: 'OWNER_REQUIRED',
      });
    }

    const subdomainCheck = validateSubdomain(input.subdomain);
    if (!subdomainCheck.ok) {
      throw new HttpError(400, subdomainCheck.message, { code: subdomainCheck.code });
    }

    const settings = {
      registration_mode: 'self_registration',
      student_device_limit: 'multiple_devices',
      ...(input.settings ?? {}),
    };

    const landing =
      input.landing && Object.keys(input.landing).length > 0
        ? input.landing
        : {
            hero: {
              title: input.display_name.trim(),
              subtitle: input.specialty ?? input.bio ?? '',
            },
          };

    const payload: CreateTenantInput = {
      subdomain: subdomainCheck.subdomain,
      display_name: input.display_name.trim(),
      specialty: input.specialty ?? null,
      bio: input.bio ?? null,
      avatar_url: input.avatar_url ?? null,
      is_active: input.is_active !== false,
      seo_title: input.seo_title ?? input.display_name.trim(),
      seo_meta_description: input.seo_meta_description ?? null,
      favicon_url: input.favicon_url ?? null,
      og_image_url: input.og_image_url ?? null,
      platform_type: input.platform_type === 'academy' ? 'academy' : 'teacher',
      settings,
      landing,
      owner: {
        name: input.owner.name.trim(),
        email: input.owner.email.trim().toLowerCase(),
        password: input.owner.password,
        description: input.owner.description,
        subject: input.owner.subject ?? input.specialty ?? '',
        grade_ids: input.owner.grade_ids,
        facebook_url: input.owner.facebook_url ?? null,
        instagram_url: input.owner.instagram_url ?? null,
        youtube_url: input.owner.youtube_url ?? null,
        tiktok_url: input.owner.tiktok_url ?? null,
        whatsapp_number: input.owner.whatsapp_number ?? null,
      },
    };

    let tenant: {
      id: number;
      subdomain: string;
      display_name: string;
      is_active: boolean;
      owner_user_id: number | null;
    };

    try {
      tenant = await TenantService.createTenantTransaction(payload);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      if (err.code === '23505') {
        throw new HttpError(409, 'هذا النطاق مستخدم بالفعل', { code: 'SUBDOMAIN_TAKEN' });
      }
      if (err.message?.includes('Invalid owner grade_ids')) {
        throw new HttpError(400, 'معرّفات الصفوف الدراسية غير صالحة', {
          code: 'INVALID_GRADE_IDS',
        });
      }
      throw e;
    }

    if (!tenant.owner_user_id) {
      throw new HttpError(500, 'فشل إنشاء حساب المدرس');
    }

    try {
      await SeoHooks.onTenantProfileChanged(tenant.id);
    } catch {
      // لا نكسر التسجيل إن فشل SEO
    }

    const userRes = await pool.query(
      `SELECT id, name, email, phone, student_code, role, avatar, tenant_id, account_status, must_change_password
       FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [tenant.owner_user_id, tenant.id],
    );
    if (!userRes.rowCount) {
      throw new HttpError(500, 'فشل تحميل حساب المدرس بعد الإنشاء');
    }
    const user = userRes.rows[0];

    const rememberMe = input.remember_me === true;
    const session = await AuthSessionsService.createDeviceSession({
      userId: user.id,
      role: user.role,
      tenantId: tenant.id,
      rememberMe,
      req,
      exclusiveSession: false,
    });
    const token = await AuthSessionsService.signAccessToken(user, session.session);
    setRefreshCookie(req, res, session.refreshToken, rememberMe);
    AuthSessionsService.logLogin(user.id, user.role, 'email', req);

    return {
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        display_name: tenant.display_name,
        is_active: tenant.is_active,
        owner_user_id: tenant.owner_user_id,
        platform_type: (tenant as { platform_type?: string }).platform_type || input.platform_type || 'teacher',
        platform_url: buildTenantPublicUrl(tenant.subdomain),
      },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        must_change_password: user.must_change_password === true,
      },
      token,
      token_type: 'Bearer' as const,
      expires_in: config.ACCESS_TOKEN_TTL,
      message: 'تم إنشاء منصتك بنجاح — مرحباً بك!',
    };
  }
}
