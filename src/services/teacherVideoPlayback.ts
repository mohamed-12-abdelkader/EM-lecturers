import pool from '../db/pool';
import { HttpError } from '../utils';
import type { Request } from 'express';

/**
 * إعداد عرض الفيديوهات على مستوى منصة المدرس (tenant_settings.data)
 *
 * website     → تشغيل عادي داخل الموقع
 * player_app  → التشغيل عبر تطبيق عرض الفيديوهات فقط (حماية)
 */

export type VideoPlaybackMode = 'website' | 'player_app';

export interface VideoPlaybackSettings {
  video_playback_mode: VideoPlaybackMode;
  /** هل يُسمح بعرض الرابط داخل الموقع؟ */
  allow_website_playback: boolean;
  /** هل التشغيل محصور على تطبيق الفيديوهات؟ */
  player_app_only: boolean;
}

const DEFAULT_SETTINGS: VideoPlaybackSettings = {
  video_playback_mode: 'website',
  allow_website_playback: true,
  player_app_only: false,
};

async function loadTenantSettingsData(tenantId: number): Promise<Record<string, unknown>> {
  const res = await pool.query<{ data: Record<string, unknown> | null }>(
    `SELECT data FROM tenant_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  const data = res.rows[0]?.data;
  return data && typeof data === 'object' ? data : {};
}

function normalizeMode(raw: unknown): VideoPlaybackMode {
  return raw === 'player_app' ? 'player_app' : 'website';
}

function toSettings(mode: VideoPlaybackMode): VideoPlaybackSettings {
  return {
    video_playback_mode: mode,
    allow_website_playback: mode === 'website',
    player_app_only: mode === 'player_app',
  };
}

export class TeacherVideoPlaybackService {
  static async getSettings(tenantId: number): Promise<VideoPlaybackSettings> {
    if (!tenantId) return { ...DEFAULT_SETTINGS };
    const data = await loadTenantSettingsData(tenantId);
    return toSettings(normalizeMode(data.video_playback_mode));
  }

  static async setSettings(
    tenantId: number,
    patch: { video_playback_mode?: VideoPlaybackMode },
  ): Promise<VideoPlaybackSettings> {
    if (!tenantId) throw new HttpError(400, 'تعذر تحديد المنصة');

    const current = await this.getSettings(tenantId);
    const nextMode = patch.video_playback_mode ?? current.video_playback_mode;

    if (nextMode !== 'website' && nextMode !== 'player_app') {
      throw new HttpError(400, 'video_playback_mode غير صالح. القيم: website | player_app');
    }

    const data = await loadTenantSettingsData(tenantId);
    const merged = {
      ...data,
      video_playback_mode: nextMode,
    };

    await pool.query(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::JSONB)
       ON CONFLICT (tenant_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
      [tenantId, JSON.stringify(merged)],
    );

    return toSettings(nextMode);
  }

  /** هل العميل هو تطبيق عرض الفيديوهات؟ */
  static isPlayerAppClient(req: Request): boolean {
    const header = String(
      req.get('x-client-type') || req.get('x-video-client') || req.query.client || '',
    )
      .trim()
      .toLowerCase();
    return header === 'player_app' || header === 'video_app' || header === 'app';
  }

  /**
   * هل يُسمح بإرجاع video_url لهذا الطلب؟
   * - website: دائماً نعم
   * - player_app: للمدرس/الأدمن أو تطبيق الفيديوهات فقط
   */
  static async canExposeVideoUrl(
    req: Request,
    tenantId: number | null | undefined,
  ): Promise<{ settings: VideoPlaybackSettings; expose: boolean }> {
    const settings = await this.getSettings(tenantId || 0);
    if (settings.video_playback_mode === 'website') {
      return { settings, expose: true };
    }

    const role = (req as Request & { user?: { role?: string } }).user?.role;
    if (role === 'teacher' || role === 'admin' || role === 'employee') {
      return { settings, expose: true };
    }

    return { settings, expose: this.isPlayerAppClient(req) };
  }

  /** إخفاء روابط الفيديو من كائن/مصفوفة عند الحاجة */
  static redactVideoUrls<T>(payload: T): T {
    if (payload == null) return payload;
    if (Array.isArray(payload)) {
      return payload.map((item) => this.redactVideoUrls(item)) as T;
    }
    if (typeof payload === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
        if (key === 'video_url' || key === 'stream_url' || key === 'playback_url') {
          out[key] = null;
          out.video_url_hidden = true;
        } else if (typeof value === 'object' && value !== null) {
          out[key] = this.redactVideoUrls(value);
        } else {
          out[key] = value;
        }
      }
      return out as T;
    }
    return payload;
  }
}
